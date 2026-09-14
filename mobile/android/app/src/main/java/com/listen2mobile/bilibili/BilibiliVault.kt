package com.listen2mobile.bilibili

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/** Native-only encrypted refresh-material storage. It deliberately has no plaintext getter. */
class BilibiliVault(context: Context) : BilibiliVault.Store {
    interface Store {
        fun isAvailable(): Boolean
        fun saveRefreshMaterial(value: String)
        fun clear()
    }

    private val preferences = context.getSharedPreferences("listen2_bilibili_vault", Context.MODE_PRIVATE)
    private val alias = "listen2-bilibili-v1"

    override fun isAvailable(): Boolean = try { key(); true } catch (_: Exception) { false }

    override fun saveRefreshMaterial(value: String) {
        require(value.isNotBlank() && value.length <= 4096)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val encoded = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
        if (!preferences.edit().putString("ciphertext", encoded).commit()) throw IllegalStateException("secure-storage-failed")
    }

    override fun clear() {
        preferences.edit().clear().commit()
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null); if (containsAlias(alias)) deleteEntry(alias) } } catch (_: Exception) { throw IllegalStateException("secure-storage-failed") }
    }

    private fun key(): javax.crypto.SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? javax.crypto.SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return generator.generateKey()
    }
}
