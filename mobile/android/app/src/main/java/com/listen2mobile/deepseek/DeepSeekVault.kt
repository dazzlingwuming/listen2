package com.listen2mobile.deepseek

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Keystore-backed native key vault. Plaintext can be consumed only inside this package. */
class DeepSeekVault private constructor(private val storage: CiphertextStore, private val secret: (() -> SecretKey)?) {
    data class Status(val secureStorageAvailable: Boolean, val hasApiKey: Boolean, val errorCode: String? = null)
    interface CiphertextStore { fun read(): String?; fun write(value: String): Boolean; fun clear(): Boolean }
    class InMemoryCiphertextStore : CiphertextStore { private var value: String? = null; override fun read() = value; override fun write(value: String) = run { this.value = value; true }; override fun clear() = run { value = null; true } }
    private class Preferences(context: Context) : CiphertextStore { private val prefs = context.applicationContext.getSharedPreferences("listen2.deepseek.secure.v1", Context.MODE_PRIVATE); override fun read() = prefs.getString("api-key.v1", null); override fun write(value: String) = prefs.edit().putString("api-key.v1", value).commit(); override fun clear() = prefs.edit().remove("api-key.v1").commit() }
    constructor(context: Context) : this(Preferences(context), { getKey() })
    fun status(): Status = try { Status(secret?.invoke() != null, storage.read() != null) } catch (_: Exception) { Status(false, false, "SECURE_STORAGE_UNAVAILABLE") }
    /** Called only by [DeepSeekKeyActivity]; never exposed through React Native. */
    internal fun saveFromNativeEntry(value: String): Status {
        val normalized = value.trim()
        if (normalized.isEmpty() || normalized.toByteArray().size > 512 || normalized.any { it.code < 32 || it.code == 127 }) return status().copy(errorCode = "INVALID_KEY")
        return try {
            val key = secret?.invoke()
            if (key == null) { if (!storage.write(normalized)) Status(false, false, "SECURE_STORAGE_UNAVAILABLE") else Status(true, true) }
            else { val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key); val encrypted = cipher.iv + cipher.doFinal(normalized.toByteArray()); if (!storage.write("v1:" + Base64.encodeToString(encrypted, Base64.NO_WRAP))) Status(true, false, "SECURE_STORAGE_UNAVAILABLE") else Status(true, true) }
        } catch (_: Exception) { Status(false, false, "SECURE_STORAGE_UNAVAILABLE") }
    }
    internal fun <T> withApiKey(action: (String) -> T): T {
        val stored = storage.read() ?: throw VaultException("MISSING_KEY")
        val value = try {
            if (secret == null) stored else { val payload = Base64.decode(stored.removePrefix("v1:"), Base64.NO_WRAP); if (!stored.startsWith("v1:") || payload.size <= 12) throw VaultException("SECURE_STORAGE_CORRUPT"); val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, secret.invoke(), GCMParameterSpec(128, payload.copyOfRange(0, 12))); String(cipher.doFinal(payload.copyOfRange(12, payload.size))) }
        } catch (e: VaultException) { throw e } catch (_: Exception) { storage.clear(); throw VaultException("SECURE_STORAGE_CORRUPT") }
        try { return action(value) } finally { /* plaintext deliberately has no outward projection */ }
    }
    fun clear(): Status = if (storage.clear()) status() else status().copy(errorCode = "SECURE_STORAGE_UNAVAILABLE")
    class VaultException(val code: String) : Exception(code)
    companion object {
        internal fun forTesting(store: CiphertextStore) = DeepSeekVault(store, null)
        private fun getKey(): SecretKey { val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }; (store.getKey("listen2.deepseek.api-key.v1", null) as? SecretKey)?.let { return it }; return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(KeyGenParameterSpec.Builder("listen2.deepseek.api-key.v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build()) }.generateKey() }
    }
}
