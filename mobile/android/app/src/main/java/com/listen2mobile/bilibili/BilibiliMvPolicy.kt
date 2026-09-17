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
        /** Native session generation; never supplied by JS. */
        val accountGeneration: Long = 0L,
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
        val hasAlternateUrl: Boolean = false,
        val backupUrls: List<String> = emptyList(),
    )
    data class VideoManifest(val bvid: String, val cid: Long, val candidates: List<VideoCandidate>)
    data class PublicVariant(val id: String, val label: String, val codec: String, val width: Int, val height: Int)
    /** Internal proof that each candidate passed URL, shape, and codec policy together. */
    data class SelectableVideoCandidates internal constructor(internal val values: List<VideoCandidate>)
    enum class CandidateSelectionFailure { NONE, SIZE, UNSAFE, QUALITY, CODEC }

    fun request(bvid: String?, cid: Long, qualityId: String?, preferredCodecs: List<String>?, forceRefresh: Boolean, accountGeneration: Long = 0L): MvRequest? {
        val normalizedQuality = qualityId ?: "auto"
        val normalizedCodecs = preferredCodecs ?: emptyList()
        if (!BilibiliPolicy.isCanonicalBvid(bvid) || cid <= 0 || normalizedQuality !in qualityIds ||
            normalizedCodecs.size > codecs.size || normalizedCodecs.distinct().size != normalizedCodecs.size ||
            normalizedCodecs.any { it !in codecs } || accountGeneration < 0L
        ) return null
        return MvRequest(bvid!!, cid, normalizedQuality, normalizedCodecs, forceRefresh, accountGeneration)
    }

    /** The exact safe candidate set used by both native selection and JS projection. */
    fun selectableVideoCandidates(candidates: List<VideoCandidate>, preferredCodecs: List<String>, now: Long): SelectableVideoCandidates? {
        if (candidates.isEmpty() || candidates.size > MAX_CANDIDATES) return null
        val allowed = if (preferredCodecs.isEmpty()) codecs else preferredCodecs.toSet()
        return SelectableVideoCandidates(candidates.mapNotNull { sanitizeCandidate(it, now) }.filter { codecFamily(it.codecs) in allowed })
    }

    fun selectVideoCandidate(candidates: List<VideoCandidate>, qualityId: String, preferredCodecs: List<String>, now: Long): VideoCandidate? {
        if (selectionFailure(candidates, qualityId, preferredCodecs, now) != CandidateSelectionFailure.NONE) return null
        return selectVideoCandidate(selectableVideoCandidates(candidates, preferredCodecs, now) ?: return null, qualityId)
    }

    fun selectVideoCandidate(candidates: SelectableVideoCandidates, qualityId: String): VideoCandidate? {
        val qualityMatches = if (qualityId == "auto") candidates.values else candidates.values.filter { it.id.toString() == qualityId }
        return qualityMatches
            .sortedWith(compareByDescending<VideoCandidate> { it.id }.thenBy { it.codecs }).firstOrNull()
    }

    /** A fixed diagnostic classification: no media values leave the native boundary. */
    fun selectionFailure(candidates: List<VideoCandidate>, qualityId: String, preferredCodecs: List<String>, now: Long): CandidateSelectionFailure {
        if (candidates.isEmpty() || candidates.size > MAX_CANDIDATES) return CandidateSelectionFailure.SIZE
        val safeCandidates = candidates.mapNotNull { sanitizeCandidate(it, now) }
        if (safeCandidates.isEmpty()) return CandidateSelectionFailure.UNSAFE
        val qualityMatches = if (qualityId == "auto") safeCandidates else safeCandidates.filter { it.id.toString() == qualityId }
        if (qualityMatches.isEmpty()) return CandidateSelectionFailure.QUALITY
        val allowed = if (preferredCodecs.isEmpty()) codecs else preferredCodecs.toSet()
        return if (qualityMatches.any { codecFamily(it.codecs) in allowed }) CandidateSelectionFailure.NONE else CandidateSelectionFailure.CODEC
    }

    private fun publicVariant(candidate: VideoCandidate): PublicVariant = PublicVariant(candidate.id.toString(), candidate.label, candidate.codecs.substringBefore('.'), candidate.width, candidate.height)
    /** Public variants must share the controller's exact safe candidate set. */
    fun publicVariants(candidates: SelectableVideoCandidates): List<PublicVariant> =
        candidates.values.groupBy { it.id }.values.map { sameQuality ->
            publicVariant(sameQuality.sortedWith(compareByDescending<VideoCandidate> { it.id }.thenBy { it.codecs }).first())
        }
    /** The UI may select only an exact ID from this native-reported projection. */
    fun selectAuthorizedVariant(variants: List<PublicVariant>, requestedId: String?): PublicVariant? =
        variants.takeIf { it.size in 1..MAX_CANDIDATES }?.singleOrNull { it.id == requestedId && requestedId in qualityIds }
    fun parseFrameRate(value: String?): Int? {
        val match = Regex("([1-9][0-9]{0,8})(?:/([1-9][0-9]{0,8}))?").matchEntire(value ?: "") ?: return null
        val numerator = match.groupValues[1].toLongOrNull() ?: return null
        val denominator = match.groupValues[2].takeIf { it.isNotEmpty() }?.toLongOrNull() ?: 1L
        if (numerator > 1_000_000_000L || denominator > 1_000_000_000L) return null
        val rate = numerator.toDouble() / denominator.toDouble()
        if (!rate.isFinite() || rate < 1.0 || rate > MAX_FRAME_RATE.toDouble()) return null
        return kotlin.math.round(rate).toInt()
    }
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

    /**
     * The primary URL is mandatory; backup CDNs are optional fallbacks. Filter
     * each backup before it reaches the native surface, rather than allowing
     * one unsuitable fallback to reject a separately safe primary rendition.
     */
    private fun sanitizeCandidate(candidate: VideoCandidate, now: Long): VideoCandidate? {
        if (!isSafePrimaryCandidate(candidate, now)) return null
        return candidate.copy(backupUrls = candidate.backupUrls.filter { isSafeVideoUrl(it, now) })
    }

    private fun isSafePrimaryCandidate(candidate: VideoCandidate, now: Long): Boolean {
        return candidate.id.toString() in qualityIds && BilibiliPolicy.safeText(candidate.label, 80) != null &&
            candidate.mimeType == "video/mp4" && codecFamily(candidate.codecs) != null &&
            candidate.width in 1..MAX_DIMENSION && candidate.height in 1..MAX_DIMENSION && candidate.frameRate in 1..MAX_FRAME_RATE &&
            candidate.role == "video" && !candidate.hasAlternateUrl && candidate.backupUrls.size <= 3 &&
            isSafeVideoUrl(candidate.url, now)
    }

    private fun codecFamily(value: String): String? =
        value.takeIf { codecToken.matches(it) }?.substringBefore('.')?.takeIf { it in codecs }

    fun opaqueHandle(randomBytes: ByteArray): String {
        return BilibiliRandom.lowercaseHex(randomBytes).take(MAX_HANDLE_LENGTH)
    }
}
