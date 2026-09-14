package com.listen2mobile.bilibili

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/** Native-only encrypted storage; React Native has no plaintext getter. */
class BilibiliVault(context: Context) : BilibiliVault.Store {
    data class SessionMaterial(val refreshMaterial: String, val cookies: Map<String, String>, val csrf: String?)
    interface Store {
        fun isAvailable(): Boolean
        fun saveSession(material: SessionMaterial)
        fun loadSession(): SessionMaterial?
        fun clear()
    }
    private val preferences = context.getSharedPreferences("listen2_bilibili_vault", Context.MODE_PRIVATE)
    private val alias = "listen2-bilibili-v1"
    override fun isAvailable(): Boolean = try { key(); true } catch (_: Exception) { false }

    override fun saveSession(material: SessionMaterial) {
        require(material.refreshMaterial.isNotBlank() && material.refreshMaterial.length <= 4096)
        require(material.cookies.size <= 32 && material.cookies.all { (name, value) -> name.matches(Regex("[A-Za-z0-9_-]{1,128}")) && value.length <= 4096 && !value.contains('\r') && !value.contains('\n') })
        val root = JSONObject().put("refresh", material.refreshMaterial).put("csrf", material.csrf ?: "")
        val storedCookies = JSONObject(); material.cookies.forEach { (name, value) -> storedCookies.put(name, value) }; root.put("cookies", storedCookies)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        val encoded = Base64.encodeToString(cipher.iv + cipher.doFinal(root.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        if (!preferences.edit().putString("session", encoded).commit()) throw IllegalStateException("secure-storage-failed")
    }

    /** Package-private native decrypt path; invalid data is removed, never surfaced. */
    override fun loadSession(): SessionMaterial? {
        val encoded = preferences.getString("session", null) ?: return null
        return try {
            val payload = Base64.decode(encoded, Base64.NO_WRAP); if (payload.size <= 12) throw IllegalArgumentException()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, payload.copyOfRange(0, 12)))
            val root = JSONObject(String(cipher.doFinal(payload.copyOfRange(12, payload.size)), Charsets.UTF_8))
            val refresh = root.optString("refresh", ""); val rawCookies = root.optJSONObject("cookies") ?: throw IllegalArgumentException()
            val cookies = LinkedHashMap<String, String>(); val names = rawCookies.keys()
            while (names.hasNext()) { val name = names.next(); val value = rawCookies.optString(name, ""); if (!name.matches(Regex("[A-Za-z0-9_-]{1,128}")) || value.length > 4096 || value.contains('\r') || value.contains('\n')) throw IllegalArgumentException(); cookies[name] = value }
            if (refresh.isBlank() || refresh.length > 4096 || cookies.size > 32) throw IllegalArgumentException()
            SessionMaterial(refresh, cookies, root.optString("csrf", "").takeIf { it.isNotBlank() && it.length <= 512 })
        } catch (_: Exception) { clear(); null }
    }

    override fun clear() {
        if (!preferences.edit().clear().commit()) throw IllegalStateException("secure-storage-failed")
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null); if (containsAlias(alias)) deleteEntry(alias) } } catch (_: Exception) { throw IllegalStateException("secure-storage-failed") }
    }
    private fun key(): javax.crypto.SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? javax.crypto.SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return generator.generateKey()
    }
}
