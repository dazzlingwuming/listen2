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

/** Narrow vault abstraction keeps session tests away from encrypted platform storage. */
internal interface BilibiliVaultStore {
    fun isAvailable(): Boolean
    fun saveProvisionalSession(material: BilibiliVault.SessionMaterial)
    fun commitProvisionalSession(ownerId: String): Boolean
    fun saveCommittedSession(material: BilibiliVault.SessionMaterial)
    fun loadSession(): BilibiliVault.SessionMaterial?
    fun clearIfOwned(ownerId: String)
    fun clear()
}

/** Native-only encrypted storage; React Native has no plaintext getter. */
internal class BilibiliVault(context: Context) : BilibiliVaultStore {
    data class SessionMaterial(
        val refreshMaterial: String,
        val cookies: Map<String, String>,
        val csrf: String?,
        val ownerId: String? = null,
    )
    private val preferences = context.getSharedPreferences("listen2_bilibili_vault", Context.MODE_PRIVATE)
    private val alias = "listen2-bilibili-v1"
    override fun isAvailable(): Boolean = try { key(); true } catch (_: Exception) { false }

    override fun saveProvisionalSession(material: SessionMaterial) {
        require(material.ownerId != null)
        write(material, "provisional")
    }

    override fun commitProvisionalSession(ownerId: String): Boolean {
        if (!ownerId.matches(Regex("[A-Za-z0-9_-]{1,64}"))) return false
        val encoded = preferences.getString("session", null) ?: return false
        return try {
            val envelope = decode(encoded)
            if (!envelope.provisional || envelope.material.ownerId != ownerId) false
            else {
                write(envelope.material, "committed")
                true
            }
        } catch (_: Exception) {
            clear()
            false
        }
    }

    override fun saveCommittedSession(material: SessionMaterial) {
        write(material, "committed")
    }

    private fun write(material: SessionMaterial, state: String) {
        require(material.refreshMaterial.isNotBlank() && material.refreshMaterial.length <= 4096)
        require(material.cookies.size <= 32 && material.cookies.all { (name, value) -> name.matches(Regex("[A-Za-z0-9_-]{1,128}")) && value.length <= 4096 && !value.contains('\r') && !value.contains('\n') })
        require(material.ownerId == null || material.ownerId.matches(Regex("[A-Za-z0-9_-]{1,64}")))
        require(state == "provisional" || state == "committed")
        val root = JSONObject().put("refresh", material.refreshMaterial).put("csrf", material.csrf ?: "").put("owner", material.ownerId ?: "").put("state", state)
        val storedCookies = JSONObject(); material.cookies.forEach { (name, value) -> storedCookies.put(name, value) }; root.put("cookies", storedCookies)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        val encoded = Base64.encodeToString(cipher.iv + cipher.doFinal(root.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        if (!preferences.edit().putString("session", encoded).commit()) throw IllegalStateException("secure-storage-failed")
    }

    /** Package-private native decrypt path; invalid data is removed, never surfaced. */
    override fun loadSession(): SessionMaterial? {
        val encoded = preferences.getString("session", null) ?: return null
        return try {
            val envelope = decode(encoded)
            if (envelope.provisional) {
                envelope.material.ownerId?.let { clearIfOwned(it) } ?: clear()
                null
            } else envelope.material
        } catch (_: Exception) { clear(); null }
    }

    /** Revocation only removes the envelope written by this QR attempt. */
    override fun clearIfOwned(ownerId: String) {
        if (!ownerId.matches(Regex("[A-Za-z0-9_-]{1,64}"))) return
        val encoded = preferences.getString("session", null) ?: return
        try {
            if (decode(encoded).material.ownerId == ownerId) clear()
        } catch (_: Exception) {
            clear()
        }
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
    private data class Envelope(val material: SessionMaterial, val provisional: Boolean)
    private fun decode(encoded: String): Envelope {
        val payload = Base64.decode(encoded, Base64.NO_WRAP)
        if (payload.size <= 12) throw IllegalArgumentException()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, payload.copyOfRange(0, 12)))
        val root = JSONObject(String(cipher.doFinal(payload.copyOfRange(12, payload.size)), Charsets.UTF_8))
        val refresh = root.optString("refresh", "")
        val rawCookies = root.optJSONObject("cookies") ?: throw IllegalArgumentException()
        val cookies = LinkedHashMap<String, String>()
        val names = rawCookies.keys()
        while (names.hasNext()) {
            val name = names.next()
            val value = rawCookies.optString(name, "")
            if (!name.matches(Regex("[A-Za-z0-9_-]{1,128}")) || value.length > 4096 || value.contains('\r') || value.contains('\n')) throw IllegalArgumentException()
            cookies[name] = value
        }
        val owner = root.optString("owner", "").takeIf { it.isNotBlank() }
        val state = root.optString("state", "committed")
        if (refresh.isBlank() || refresh.length > 4096 || cookies.size > 32 || owner?.matches(Regex("[A-Za-z0-9_-]{1,64}")) == false || state !in setOf("provisional", "committed") || (state == "provisional" && owner == null)) throw IllegalArgumentException()
        return Envelope(SessionMaterial(refresh, cookies, root.optString("csrf", "").takeIf { it.isNotBlank() && it.length <= 512 }, owner), state == "provisional")
    }
}
