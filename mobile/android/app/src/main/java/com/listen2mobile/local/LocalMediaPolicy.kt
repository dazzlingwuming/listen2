package com.listen2mobile.local

import android.net.Uri
import java.security.SecureRandom

/** Pure validation for the app-private local playback provider. */
internal object LocalMediaPolicy {
    const val PATH_SEGMENT = "play"
    const val TOKEN_TTL_MS = 45_000L
    const val MAX_TOKENS = 32
    private val tokenPattern = Regex("^[A-Za-z0-9_-]{32,128}$")
    private val recordPattern = Regex("^[A-Za-z0-9-]{16,64}$")
    private val requestPattern = Regex("^[A-Za-z0-9_-]{1,96}$")
    fun validRecordId(value: String) = recordPattern.matches(value)
    fun validRequestId(value: String) = requestPattern.matches(value)
    fun validToken(value: String?) = value != null && tokenPattern.matches(value)
    fun validReadMode(mode: String?) = mode == "r"
    fun tokenFrom(uri: Uri): String? = tokenFromSegments(uri.pathSegments)
    fun tokenFromSegments(segments: List<String>): String? = segments.let { segments ->
        if (segments.size == 2 && segments[0] == PATH_SEGMENT && validToken(segments[1])) segments[1] else null
    }
    fun providerUri(authority: String, token: String) = Uri.Builder().scheme("content").authority(authority).appendPath(PATH_SEGMENT).appendPath(token).build()
}

/** In-memory single-use mapping. Neither the provider path nor its token exposes a SAF URI. */
internal object LocalPlaybackTokens {
    private data class Entry(val recordId: String, val playbackRequestId: String, val expiresAt: Long)
    private val lock = Any()
    private val random = SecureRandom()
    private val entries = LinkedHashMap<String, Entry>()
    fun issue(recordId: String, playbackRequestId: String, now: Long = System.currentTimeMillis()): String? {
        if (!LocalMediaPolicy.validRecordId(recordId) || !LocalMediaPolicy.validRequestId(playbackRequestId)) return null
        synchronized(lock) {
            entries.entries.removeIf { it.value.expiresAt <= now }
            while (entries.size >= LocalMediaPolicy.MAX_TOKENS) entries.remove(entries.entries.first().key)
            val bytes = ByteArray(24); random.nextBytes(bytes)
            val token = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            entries[token] = Entry(recordId, playbackRequestId, now + LocalMediaPolicy.TOKEN_TTL_MS)
            return token
        }
    }
    fun consume(token: String, now: Long = System.currentTimeMillis()): String? = synchronized(lock) {
        val entry = entries.remove(token) ?: return@synchronized null
        if (entry.expiresAt <= now) null else entry.recordId
    }
    fun clearRecord(recordId: String) = synchronized(lock) { entries.entries.removeIf { it.value.recordId == recordId } }
}
