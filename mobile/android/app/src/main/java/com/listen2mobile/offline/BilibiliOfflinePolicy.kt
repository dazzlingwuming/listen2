package com.listen2mobile.offline

import com.listen2mobile.bilibili.BilibiliPolicy
import com.listen2mobile.media.CacheAuthorization
import com.listen2mobile.media.NativeTransport
import com.listen2mobile.media.OfflineEntitlementClass
import java.io.BufferedInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Exact video/part identity and an existing native account grant are both required. */
internal object BilibiliOfflinePolicy {
    fun partId(trackId: String): String? = BilibiliPolicy.parseSemanticTrack(trackId, 1L)?.cid?.toString()

    fun matches(grant: CacheAuthorization, source: String, trackId: String): Boolean =
        source == "bilibili" && grant.identity.source == source && grant.identity.trackId == trackId &&
            partId(trackId)?.let { it == grant.identity.partId } == true &&
            grant.identity.generation == grant.accountGeneration && grant.accountGeneration > 0L &&
            grant.entitlementClass == OfflineEntitlementClass.ACCOUNT_BOUND

    /** Audio DASH only. A CDN host alone cannot admit an arbitrary CDN path or video asset. */
    fun permits(transport: NativeTransport, now: Long): Boolean {
        if (transport.source != "bilibili" || transport.localFile != null || transport.candidates.isNotEmpty()) return false
        val deadline = BilibiliPolicy.signedDeadline(transport.url) ?: return false
        if (!BilibiliPolicy.isSafeAudioHandoff(transport.url, transport.headers, deadline, now)) return false
        return try {
            val path = URI(transport.url).rawPath ?: return false
            path.matches(Regex("/[A-Za-z0-9_./-]+\\.m4s")) &&
                path.split('/').none { it == "." || it == ".." }
        } catch (_: Exception) { false }
    }
}

/** Single native URL, fixed Referer, no redirects. Nothing from this object crosses RN or disk. */
internal class BilibiliOfflineTransport(
    private val open: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
    private val clock: () -> Long = System::currentTimeMillis,
) {
    fun fetch(transport: NativeTransport, deadlineMillis: Long): OfflineResponse {
        if (!BilibiliOfflinePolicy.permits(transport, clock())) throw IOException("ROUTE_UNAVAILABLE")
        val remaining = deadlineMillis - System.nanoTime() / 1_000_000
        if (remaining <= 0L) throw IOException("DEADLINE_EXCEEDED")
        val connection = open(URL(transport.url))
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = minOf(15_000L, remaining).toInt()
            connection.readTimeout = minOf(30_000L, remaining).toInt()
            connection.requestMethod = "GET"
            connection.useCaches = false
            connection.setRequestProperty("Referer", BilibiliPolicy.FIXED_REFERER)
            if (connection.responseCode in 300..399) throw IOException("REDIRECT_REJECTED")
            if (connection.responseCode in setOf(401, 403)) throw IOException("ENTITLEMENT")
            if (connection.responseCode !in 200..299) throw IOException("HTTP_FAILED")
            // DASH audio responses sometimes use the container or generic byte MIME.
            // Admission still comes from the native audio descriptor, and the completed
            // bytes must pass the MP4 signature gate before atomic publication.
            val mime = connection.contentType?.substringBefore(';')?.lowercase()
            if (mime !in setOf("audio/mp4", "video/mp4", "application/octet-stream")) throw IOException("INVALID_MEDIA")
            return OfflineResponse(BufferedInputStream(connection.inputStream), "audio/mp4", connection.contentLengthLong) { connection.disconnect() }
        } catch (error: Exception) {
            connection.disconnect()
            throw error
        }
    }
}
