package com.listen2mobile.local

import android.content.Context
import android.net.Uri
import java.security.MessageDigest

/** Native-private association for revocable SAF grants and explicit lyric text. Never bridged or backed up. */
internal class LocalPrivateStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("listen2-local-private-v1", Context.MODE_PRIVATE)
    fun rememberDocument(recordId: String, uri: Uri) {
        prefs.edit().putString("document:$recordId", uri.toString()).putString("document-index:${fingerprint(uri)}", recordId).apply()
    }
    fun document(recordId: String): Uri? = prefs.getString("document:$recordId", null)?.let(Uri::parse)
    fun hasDocument(uri: Uri) = prefs.contains("document-index:${fingerprint(uri)}")
    fun rememberLyric(recordId: String, lyric: String) { prefs.edit().putString("lyric:$recordId", lyric).apply() }
    fun hasLyric(recordId: String) = prefs.contains("lyric:$recordId")
    private fun fingerprint(uri: Uri) = MessageDigest.getInstance("SHA-256").digest(uri.toString().toByteArray()).joinToString("") { "%02x".format(it) }
}
