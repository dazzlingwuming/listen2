package com.listen2mobile.deepseek

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Native-only DeepSeek key vault.
 *
 * The production constructor has exactly one protection mechanism: an AES key
 * held by Android Keystore. The preference store contains only the versioned
 * ciphertext envelope. The test constructor uses a separate in-memory
 * cryptographic protector and therefore cannot accidentally exercise a
 * plaintext production path.
 */
class DeepSeekVault private constructor(
    private val storage: CiphertextStore,
    private val protector: KeyProtector,
) {
    sealed interface State {
        val wire: String

        data object Configured : State {
            override val wire = "configured"
        }

        data object NotConfigured : State {
            override val wire = "not-configured"
        }

        data object KeystoreUnavailable : State {
            override val wire = "keystore-unavailable"
        }

        data object CorruptCleared : State {
            override val wire = "corrupt-cleared"
        }
    }

    data class Status(
        val state: State,
        val errorCode: String? = null,
    )

    interface CiphertextStore {
        fun read(): String?
        fun write(value: String): Boolean
        fun clear(): Boolean
    }

    /** Test-only store. It stores the envelope, never a caller-provided key. */
    class InMemoryCiphertextStore : CiphertextStore {
        private var value: String? = null

        override fun read(): String? = value

        override fun write(value: String): Boolean {
            this.value = value
            return true
        }

        override fun clear(): Boolean {
            value = null
            return true
        }
    }

    /** Small native abstraction that keeps Keystore failures distinguishable. */
    internal interface KeyProtector {
        fun checkAvailable(): Boolean
        fun getOrCreate(): SecretKey
        fun getExisting(): SecretKey?
        fun delete(): Boolean
    }

    /** Test-only AES protector; it deliberately has no plaintext mode. */
    internal class InMemoryKeyProtector : KeyProtector {
        private var key: SecretKey? = null

        override fun checkAvailable(): Boolean = true

        override fun getOrCreate(): SecretKey {
            key?.let { return it }
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES).apply {
                init(256)
            }.generateKey().also { key = it }
        }

        override fun getExisting(): SecretKey? = key

        override fun delete(): Boolean {
            key = null
            return true
        }
    }

    /** Test-only failure injector used to prove fail-closed behavior. */
    internal class FailingKeyProtector(
        private val failureCode: String = "keystore-unavailable",
    ) : KeyProtector {
        override fun checkAvailable(): Boolean = throw VaultException(failureCode)

        override fun getOrCreate(): SecretKey = throw VaultException(failureCode)

        override fun getExisting(): SecretKey? = throw VaultException(failureCode)

        override fun delete(): Boolean = false
    }

    private class Preferences(context: Context) : CiphertextStore {
        private val prefs = context.applicationContext.getSharedPreferences(
            "listen2.deepseek.secure.v2",
            Context.MODE_PRIVATE,
        )

        override fun read(): String? = prefs.getString(CIPHERTEXT_KEY, null)

        override fun write(value: String): Boolean = prefs.edit()
            .putString(CIPHERTEXT_KEY, value)
            // Remove the old slot so an old raw value can never be selected.
            .remove(LEGACY_KEY)
            .commit()

        override fun clear(): Boolean = prefs.edit()
            .remove(CIPHERTEXT_KEY)
            .remove(LEGACY_KEY)
            .commit()
    }

    private class AndroidKeystoreProtector : KeyProtector {
        override fun checkAvailable(): Boolean {
            keyStore()
            return true
        }

        override fun getOrCreate(): SecretKey {
            val store = keyStore()
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            return KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE,
            ).apply {
                init(
                    KeyGenParameterSpec.Builder(
                        ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
            }.generateKey()
        }

        override fun getExisting(): SecretKey? = keyStore().getKey(ALIAS, null) as? SecretKey

        override fun delete(): Boolean {
            val store = keyStore()
            if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)
            return !store.containsAlias(ALIAS)
        }

        private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply {
            load(null)
        }
    }

    constructor(context: Context) : this(Preferences(context), AndroidKeystoreProtector())

    /**
     * Status is deliberately a projection. It never contains whether a key
     * was present as a boolean, the alias, ciphertext, or exception text.
     */
    fun status(): Status {
        val stored = try {
            storage.read()
        } catch (_: Exception) {
            return Status(State.KeystoreUnavailable)
        }
        if (stored == null) {
            return try {
                protector.checkAvailable()
                Status(State.NotConfigured)
            } catch (_: Exception) {
                Status(State.KeystoreUnavailable)
            }
        }
        return try {
            val key = protector.getExisting()
                ?: return corruptStatus()
            decrypt(stored, key)
            Status(State.Configured)
        } catch (error: VaultException) {
            if (error.code == "keystore-unavailable") Status(State.KeystoreUnavailable)
            else corruptStatus()
        } catch (_: Exception) {
            corruptStatus()
        }
    }

    /** Called only by the native key Activity; never exposed through React Native. */
    internal fun saveFromNativeEntry(value: String): Status {
        val normalized = value.trim()
        if (
            normalized.isEmpty() ||
            normalized.toByteArray(StandardCharsets.UTF_8).size > MAX_KEY_BYTES ||
            normalized.any { it.code < 32 || it.code == 127 }
        ) {
            return status().copy(errorCode = "INVALID_KEY")
        }
        return try {
            // No branch may write the value before this Keystore-backed key exists.
            val encrypted = encrypt(normalized, protector.getOrCreate())
            if (!storage.write(encrypted)) {
                Status(State.KeystoreUnavailable)
            } else {
                Status(State.Configured)
            }
        } catch (error: VaultException) {
            if (error.code == "keystore-unavailable") Status(State.KeystoreUnavailable)
            else Status(State.CorruptCleared)
        } catch (_: Exception) {
            Status(State.KeystoreUnavailable)
        }
    }

    /**
     * Keeps plaintext inside the native transaction only. The callback is
     * package-private and is never used to construct a React result.
     */
    internal fun <T> withApiKey(action: (String) -> T): T {
        val stored = try {
            storage.read()
        } catch (_: Exception) {
            throw VaultException("keystore-unavailable")
        } ?: try {
            // A missing ciphertext is only a normal unconfigured state when
            // Keystore itself is healthy; an unavailable protector is never a
            // permission to continue without encryption.
            protector.checkAvailable()
            throw VaultException("missing-key")
        } catch (error: VaultException) {
            throw error
        } catch (_: Exception) {
            throw VaultException("keystore-unavailable")
        }
        val key = try {
            protector.getExisting() ?: throw VaultException("corrupt-cleared")
        } catch (error: VaultException) {
            if (error.code == "keystore-unavailable") throw error
            clearCorrupt()
            throw VaultException("corrupt-cleared")
        } catch (_: Exception) {
            throw VaultException("keystore-unavailable")
        }
        val value = try {
            decrypt(stored, key)
        } catch (error: VaultException) {
            clearCorrupt()
            throw VaultException("corrupt-cleared")
        } catch (_: Exception) {
            clearCorrupt()
            throw VaultException("corrupt-cleared")
        }
        return try {
            action(value)
        } finally {
            // There is intentionally no outward projection of the key.
        }
    }

    /** Clear is also used by the native module after it invalidates operations. */
    fun clear(): Status {
        val storageCleared = try {
            storage.clear()
        } catch (_: Exception) {
            false
        }
        val keyDeleted = try {
            protector.delete()
        } catch (_: Exception) {
            false
        }
        return if (storageCleared && keyDeleted) {
            Status(State.NotConfigured)
        } else {
            Status(State.KeystoreUnavailable)
        }
    }

    private fun corruptStatus(): Status {
        val cleared = clearCorrupt()
        return if (cleared) Status(State.CorruptCleared) else Status(State.KeystoreUnavailable)
    }

    private fun clearCorrupt(): Boolean {
        val storageCleared = try {
            storage.clear()
        } catch (_: Exception) {
            false
        }
        val keyDeleted = try {
            protector.delete()
        } catch (_: Exception) {
            false
        }
        return storageCleared && keyDeleted
    }

    private fun encrypt(value: String, key: SecretKey): String {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
            val payload = ByteArray(cipher.iv.size + ciphertext.size)
            System.arraycopy(cipher.iv, 0, payload, 0, cipher.iv.size)
            System.arraycopy(ciphertext, 0, payload, cipher.iv.size, ciphertext.size)
            return ENVELOPE_PREFIX + Base64.getEncoder().withoutPadding().encodeToString(payload)
        } catch (_: GeneralSecurityException) {
            throw VaultException("keystore-unavailable")
        }
    }

    private fun decrypt(stored: String, key: SecretKey): String {
        if (!stored.startsWith(ENVELOPE_PREFIX)) throw VaultException("corrupt-cleared")
        val encoded = stored.removePrefix(ENVELOPE_PREFIX)
        val payload = try {
            Base64.getDecoder().decode(encoded)
        } catch (_: IllegalArgumentException) {
            throw VaultException("corrupt-cleared")
        }
        if (payload.size <= GCM_IV_BYTES + GCM_TAG_BYTES) throw VaultException("corrupt-cleared")
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                GCMParameterSpec(GCM_TAG_BITS, payload.copyOfRange(0, GCM_IV_BYTES)),
            )
            val value = String(
                cipher.doFinal(payload.copyOfRange(GCM_IV_BYTES, payload.size)),
                StandardCharsets.UTF_8,
            )
            if (
                value.isBlank() ||
                value.toByteArray(StandardCharsets.UTF_8).size > MAX_KEY_BYTES ||
                value.any { it.code < 32 || it.code == 127 }
            ) throw VaultException("corrupt-cleared")
            value
        } catch (error: VaultException) {
            throw error
        } catch (_: Exception) {
            throw VaultException("corrupt-cleared")
        }
    }

    class VaultException(val code: String) : Exception(code)

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "listen2.deepseek.api-key.v2"
        private const val CIPHERTEXT_KEY = "api-key.ciphertext.v2"
        private const val LEGACY_KEY = "api-key.v1"
        private const val ENVELOPE_PREFIX = "v2:"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BYTES = 16
        private const val GCM_TAG_BITS = 128
        private const val MAX_KEY_BYTES = 512

        internal fun forTesting(
            store: CiphertextStore,
            protector: KeyProtector = InMemoryKeyProtector(),
        ): DeepSeekVault = DeepSeekVault(store, protector)
    }
}
