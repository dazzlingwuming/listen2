package com.listen2mobile.bilibili

import java.net.URI
import java.util.Locale

/**
 * Closed MV contract. It accepts semantic identifiers only; signed transport never crosses the
 * React boundary and is deliberately represented only by controller-private candidates.
 */
internal object BilibiliMvPolicy {
    private const val MAX_CANDIDATES = 4
    private const val MAX_DIMENSION = 7680
    private const val MAX_FRAME_RATE = 120
    private const val MAX_HANDLE_LENGTH = 96
    private val qualityIds = setOf("auto", "16", "32", "64", "74", "80", "112", "116", "120", "125", "126", "127")
    private val codecs = setOf("avc1", "hev1", "hvc1", "av01")
    private val codecToken = Regex("(avc1|hev1|hvc1|av01)(\\.[A-Za-z0-9]{1,16}){0,3}")

    data class MvRequest(
        val bvid: String,
        val cid: Long,
        val qualityId: String,
        val preferredCodecs: List<String>,
        val forceRefresh: Boolean,
    )
    data class VideoCandidate(
        val id: Int,
        val label: String,
        val url: String,
        val mimeType: String,
        val codecs: String,
        val width: Int,
        val height: Int,
        val frameRate: Int,
        val role: String,
        val hasAlternateUrl: Boolean,
    )
    data class VideoManifest(val bvid: String, val cid: Long, val candidates: List<VideoCandidate>)
    data class PublicVariant(val id: String, val label: String, val codec: String, val width: Int, val height: Int)

    fun request(bvid: String?, cid: Long, qualityId: String?, preferredCodecs: List<String>?, forceRefresh: Boolean): MvRequest? {
        val normalizedQuality = qualityId ?: "auto"
        val normalizedCodecs = preferredCodecs ?: emptyList()
        if (!BilibiliPolicy.isCanonicalBvid(bvid) || cid <= 0 || normalizedQuality !in qualityIds ||
            normalizedCodecs.size > codecs.size || normalizedCodecs.distinct().size != normalizedCodecs.size ||
            normalizedCodecs.any { it !in codecs }
        ) return null
        return MvRequest(bvid!!, cid, normalizedQuality, normalizedCodecs, forceRefresh)
    }

    fun selectVideoCandidate(candidates: List<VideoCandidate>, preferredCodecs: List<String>, now: Long): VideoCandidate? {
        if (candidates.isEmpty() || candidates.size > MAX_CANDIDATES || candidates.map { it.id }.distinct().size != candidates.size) return null
        if (candidates.any { !isSafeCandidate(it, now) }) return null
        val allowed = if (preferredCodecs.isEmpty()) codecs else preferredCodecs.toSet()
        return candidates.filter { candidate -> codecFamily(candidate.codecs) in allowed }
            .sortedWith(compareByDescending<VideoCandidate> { it.id }.thenBy { it.codecs }).firstOrNull()
    }

    fun publicVariant(candidate: VideoCandidate): PublicVariant = PublicVariant(candidate.id.toString(), candidate.label, candidate.codecs.substringBefore('.'), candidate.width, candidate.height)
    fun isOpaqueHandle(value: String?) = value != null && value.length in 16..MAX_HANDLE_LENGTH && value.matches(Regex("[A-Za-z0-9_-]+"))
    fun isSafeVideoUrl(url: String?, now: Long): Boolean {
        if (url == null || url.length > BilibiliPolicy.MAX_MEDIA_URL) return false
        val deadline = BilibiliPolicy.signedDeadline(url) ?: return false
        if (deadline - now !in (BilibiliPolicy.MIN_MEDIA_TTL_MS + 1)..BilibiliPolicy.MAX_MEDIA_TTL_MS) return false
        return try {
            val uri = URI(url)
            val host = uri.host?.lowercase(Locale.ROOT) ?: return false
            uri.scheme == "https" && uri.userInfo == null && uri.fragment == null && uri.port == -1 &&
                (host == "bilivideo.com" || host.endsWith(".bilivideo.com"))
        } catch (_: Exception) { false }
    }

    fun safeSnapshot(bvid: String?, cid: Long, qualityId: String?, positionMs: Long, playIntent: Boolean): Map<String, Any>? {
        val request = request(bvid, cid, qualityId, emptyList(), false) ?: return null
        if (positionMs !in 0L..(24L * 60L * 60L * 1000L)) return null
        return mapOf("bvid" to request.bvid, "cid" to request.cid.toString(), "qualityId" to request.qualityId, "positionMs" to positionMs, "playIntent" to playIntent)
    }

    private fun isSafeCandidate(candidate: VideoCandidate, now: Long): Boolean {
        return candidate.id.toString() in qualityIds && BilibiliPolicy.safeText(candidate.label, 80) != null &&
            candidate.mimeType == "video/mp4" && codecFamily(candidate.codecs) != null &&
            candidate.width in 1..MAX_DIMENSION && candidate.height in 1..MAX_DIMENSION && candidate.frameRate in 1..MAX_FRAME_RATE &&
            candidate.role == "video" && !candidate.hasAlternateUrl && isSafeVideoUrl(candidate.url, now)
    }

    private fun codecFamily(value: String): String? =
        value.takeIf { codecToken.matches(it) }?.substringBefore('.')?.takeIf { it in codecs }

    fun opaqueHandle(randomBytes: ByteArray): String {
        val encoded = android.util.Base64.encodeToString(randomBytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)
        return encoded.take(MAX_HANDLE_LENGTH)
    }
}
