package com.listen2mobile.local

import android.net.Uri
import android.os.SystemClock
import java.security.SecureRandom

/** Pure validation for the app-private local playback provider. */
internal object LocalMediaPolicy {
    const val PATH_SEGMENT = "play"
    const val TOKEN_TTL_MS = 45_000L
    const val ACTIVE_PLAYBACK_TTL_MS = 6 * 60 * 60 * 1000L
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

/**
 * A short bootstrap becomes a bounded playback lease only after an authorized open.
 * ExoPlayer closes and reopens progressive sources while seeking; each open still
 * requires current native ownership. No document handle or lease survives death.
 */
internal object LocalPlaybackTokens {
    private data class Entry(val recordId: String, val playbackRequestId: String, val generation: Long, var expiresAt: Long)
    private val hex = "0123456789abcdef".toCharArray()
    private val lock = Any()
    private val random = SecureRandom()
    private val entries = LinkedHashMap<String, Entry>()
    private var activeToken: String? = null
    private var issuedGeneration = 0L
    private var resetEpoch = 0L
    private fun clockMillis() = SystemClock.elapsedRealtime()
    private fun expire(now: Long) {
        entries.entries.removeIf { it.value.expiresAt <= now }
        if (activeToken?.let(entries::containsKey) != true) activeToken = null
    }
    fun issue(recordId: String, playbackRequestId: String, now: Long = clockMillis()): String? {
        if (!LocalMediaPolicy.validRecordId(recordId) || !LocalMediaPolicy.validRequestId(playbackRequestId)) return null
        synchronized(lock) {
            expire(now)
            // Abandoned resolutions cannot evict an already playing lease.
            while (entries.size >= LocalMediaPolicy.MAX_TOKENS) entries.remove(entries.keys.first { it != activeToken })
            val bytes = ByteArray(24); random.nextBytes(bytes)
            val token = buildString(bytes.size * 2) {
                bytes.forEach { byte ->
                    val unsigned = byte.toInt() and 0xff
                    append(hex[unsigned ushr 4])
                    append(hex[unsigned and 0x0f])
                }
            }
            issuedGeneration += 1
            entries[token] = Entry(recordId, playbackRequestId, issuedGeneration, now + LocalMediaPolicy.TOKEN_TTL_MS)
            return token
        }
    }
    fun <T : Any> open(token: String, clock: () -> Long = ::clockMillis, closeRejected: (T) -> Unit, openAuthorized: (String) -> T): T? {
        val captured = synchronized(lock) {
            expire(clock())
            val entry = entries[token] ?: return null
            if (activeToken != token && entry.generation != issuedGeneration) return null
            entry to resetEpoch
        }
        // Room/resolver I/O must not hold the lease monitor: revoke/reset can
        // finish while a document provider is slow or awaiting another process.
        val opened = try { openAuthorized(captured.first.recordId) } catch (error: Exception) {
            synchronized(lock) {
                if (entries[token] === captured.first) entries.remove(token)
                if (activeToken == token) activeToken = null
            }
            throw error
        }
        val accepted = synchronized(lock) {
            val now = clock()
            expire(now)
            val entry = entries[token]
            if (entry == null || entry !== captured.first || resetEpoch != captured.second ||
                (activeToken != token && entry.generation != issuedGeneration)) {
                if (entry === captured.first && activeToken != token) entries.remove(token)
                false
            } else {
                if (activeToken != token) {
                    activeToken?.let(entries::remove)
                    activeToken = token
                    entry.expiresAt = now + LocalMediaPolicy.ACTIVE_PLAYBACK_TTL_MS
                }
                // Reopening never extends the hard deadline, including sleep.
                true
            }
        }
        if (accepted) return opened
        try { closeRejected(opened) } catch (_: Exception) { /* Ownership was rejected; never publish it. */ }
        return null
    }
    fun endActive(preservePlaybackRequestId: String? = null) = synchronized(lock) {
        resetEpoch += 1
        val pending = if (preservePlaybackRequestId != null && LocalMediaPolicy.validRequestId(preservePlaybackRequestId)) {
            entries.entries.firstOrNull { it.key != activeToken && it.value.playbackRequestId == preservePlaybackRequestId && it.value.generation == issuedGeneration }?.key
        } else null
        entries.entries.removeIf { it.key != pending }
        activeToken = null
    }
    fun clearRecord(recordId: String) = synchronized(lock) {
        entries.entries.removeIf { it.value.recordId == recordId }
        if (activeToken?.let(entries::containsKey) != true) activeToken = null
    }
}

/** Recheck revocable native ownership for every descriptor, including range reopens. */
internal object LocalPlaybackReadPolicy {
    fun <T : Any> open(available: () -> Boolean, persistedReadGrant: () -> Boolean, openDescriptor: () -> T): T? =
        try { if (available() && persistedReadGrant()) openDescriptor() else null } catch (_: Exception) { null }
}
