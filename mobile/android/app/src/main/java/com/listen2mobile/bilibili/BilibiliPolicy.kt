package com.listen2mobile.bilibili

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale

/** Closed, pure validation policy for every Bilibili native boundary. */
internal object BilibiliPolicy {
    const val MAX_TEXT = 256
    const val MAX_RESPONSE_BYTES = 256 * 1024
    const val MAX_BODY_BYTES = 16 * 1024
    const val MAX_QUERY_BYTES = 2 * 1024
    const val MAX_SEARCH_QUERY_BYTES = 256
    const val MAX_SEARCH_PAGE = 1_000L
    const val SEARCH_PAGE_SIZE = 42
    const val MAX_SEARCH_ROWS = 50
    const val MAX_SEARCH_TOTAL = 1_000_000_000L
    const val MAX_MEDIA_URL = 4096
    const val MIN_MEDIA_TTL_MS = 30_000L
    const val MAX_MEDIA_TTL_MS = 24 * 60 * 60 * 1000L
    const val FIXED_REFERER = "https://www.bilibili.com/"

    enum class ErrorCode { INVALID_REQUEST, NETWORK_ERROR, REQUEST_TIMEOUT, LOGIN_REQUIRED, MEMBERSHIP_REQUIRED, REGION_RESTRICTED, DRM_RESTRICTED, PROVIDER_ERROR, INVALID_RESPONSE, VIDEO_UNAVAILABLE, UNSUPPORTED_VIDEO_CODEC, NOT_READY, CANCELLED }

    /**
     * Maps transport-only HTTP outcomes to stable public provider failures.
     * In particular Bilibili uses 412 for an anonymous-request security gate;
     * retrying it as an offline error is both misleading and wasteful.
     */
    fun errorForHttpStatus(status: Int): ErrorCode = when (status) {
        401, 403 -> ErrorCode.LOGIN_REQUIRED
        412 -> ErrorCode.PROVIDER_ERROR
        429 -> ErrorCode.REQUEST_TIMEOUT
        else -> ErrorCode.NETWORK_ERROR
    }

    fun statusDiagnostic(status: Int): String = when (status) {
        401, 403 -> "authorization"
        412 -> "security-policy"
        429 -> "rate-limit"
        in 500..599 -> "server"
        else -> "other"
    }

    data class SemanticTrack(val bvid: String, val cid: Long, val page: Long)
    data class AudioHandoff(val bvid: String, val cid: Long, val page: Long, val url: String, val deadline: Long)
    data class MediaCandidate(val id: Long, val url: String, val mimeType: String, val codecs: String, val hasAlternateUrl: Boolean)
    /** Public identifiers are semantic; URL/candidate material stays in the gateway. */
    data class AuthorizedPart(val cid: Long, val page: Long)
    data class AuthorizedRendition(val id: String, val label: String, val mimeType: String, val codec: String)

    private val bvid = Regex("BV[0-9A-Za-z]{6,32}")
    private val positive = Regex("[1-9][0-9]{0,17}")
    private val semantic = Regex("bitrack_v_(BV[0-9A-Za-z]{6,32})-([1-9][0-9]{0,17})")
    private val qrKey = Regex("[A-Za-z0-9_-]{1,256}")
    private val qrCallback = Regex("[A-Za-z0-9_-]{1,32}")
    private val qrFrom = Regex("[A-Za-z0-9_-]{0,32}")
    private val qrQueryKeys = setOf("qrcode_key", "navhide", "callback", "from")
    private val passportPaths = setOf(
        "/x/passport-login/web/qrcode/generate",
        "/x/passport-login/web/qrcode/poll",
        "/x/passport-login/web/cookie/info",
        "/x/passport-login/web/cookie/refresh",
        "/x/passport-login/web/confirm/refresh",
        "/login/exit/v2",
    )
    private val apiPaths = setOf(
        "/x/web-interface/nav",
        "/x/web-interface/view",
        "/x/web-interface/search/type",
        "/x/web-interface/wbi/search/type",
        "/x/player/wbi/playurl",
    )
    private val playbackWbiKeys = setOf("bvid", "cid", "qn", "fnval", "fnver", "fourk")
    private val directSearchKeys = setOf("__refresh__", "_extra", "category_id", "com2co", "context", "dynamic_offset", "highlight", "keyword", "page", "page_size", "platform", "preload", "search_type", "single_column")

    fun parseSemanticTrack(id: String?, page: Long?): SemanticTrack? {
        if (id == null || page == null || page < 1L || page > Long.MAX_VALUE) return null
        val match = semantic.matchEntire(id) ?: return null
        val cid = match.groupValues[2].toLongOrNull() ?: return null
        return SemanticTrack(match.groupValues[1], cid, page)
    }

    fun isCanonicalBvid(value: String?) = value != null && bvid.matches(value)
    fun isPositiveText(value: String?) = value != null && positive.matches(value) && value.toLongOrNull() != null
    fun isSearchPage(value: Long) = value in 1L..MAX_SEARCH_PAGE

    fun normalizeSearchQuery(value: String?): String? {
        val trimmed = value?.trim() ?: return null
        if (trimmed.isEmpty() || trimmed.toByteArray(StandardCharsets.UTF_8).size > MAX_SEARCH_QUERY_BYTES) return null
        if (trimmed.any { it.code <= 31 }) return null
        var index = 0
        while (index < trimmed.length) {
            val character = trimmed[index]
            if (Character.isHighSurrogate(character)) {
                if (index + 1 >= trimmed.length || !Character.isLowSurrogate(trimmed[index + 1])) return null
                index += 2
            } else if (Character.isLowSurrogate(character)) {
                return null
            } else {
                index += 1
            }
        }
        return trimmed
    }

    /**
     * The QR image is rendered locally, but its provider-owned URL is still an
     * input boundary. Keep both the current and legacy exact routes accepted,
     * while rejecting open redirects, unbounded query material, and a QR key
     * that does not belong to the challenge being rendered.
     */
    fun isApprovedQrUrl(raw: String?, expectedKey: String?): Boolean {
        if (raw == null || expectedKey == null || !qrKey.matches(expectedKey)) return false
        return try {
            val uri = URI(raw)
            val host = uri.host?.lowercase(Locale.ROOT) ?: return false
            val path = uri.rawPath
            val currentRoute = host == "account.bilibili.com" && path == "/h5/account-h5/auth/scan-web"
            val legacyRoute = host == "passport.bilibili.com" && path == "/h5-app/passport/login/scan"
            if (!currentRoute && !legacyRoute) return false
            if (uri.scheme != "https" || uri.userInfo != null || uri.fragment != null || uri.port != -1) return false
            val rawQuery = uri.rawQuery ?: return false
            if (rawQuery.toByteArray(StandardCharsets.UTF_8).size > MAX_QUERY_BYTES) return false
            val parts = rawQuery.split('&')
            if (parts.isEmpty() || parts.size > qrQueryKeys.size) return false
            val seen = mutableSetOf<String>()
            var matchedKey = false
            for (part in parts) {
                val separator = part.indexOf('=')
                if (separator <= 0) return false
                val key = decodeQueryKey(part.substring(0, separator)) ?: return false
                if (key !in qrQueryKeys || !seen.add(key)) return false
                val value = decodeQueryKey(part.substring(separator + 1)) ?: return false
                if (value.length > 256 || value.any { it.code <= 31 }) return false
                when (key) {
                    "qrcode_key" -> {
                        if (value != expectedKey) return false
                        matchedKey = true
                    }
                    "navhide" -> if (value != "0" && value != "1") return false
                    "callback" -> if (!qrCallback.matches(value)) return false
                    "from" -> if (!qrFrom.matches(value)) return false
                }
            }
            matchedKey
        } catch (_: Exception) { false }
    }

    fun isApprovedApiRoute(raw: String): Boolean {
        return try {
            val uri = URI(raw)
            val host = uri.host?.lowercase(Locale.ROOT) ?: return false
            if (uri.scheme != "https" || uri.userInfo != null || uri.fragment != null || uri.port != -1) return false
            if (host != "api.bilibili.com" && host != "passport.bilibili.com") return false
            val queryBytes = uri.rawQuery?.toByteArray(StandardCharsets.UTF_8)?.size ?: 0
            if (queryBytes > MAX_QUERY_BYTES) return false
            (host == "api.bilibili.com" &&
                if (uri.path == "/x/web-interface/search/type") isApprovedDirectSearchQuery(uri.rawQuery)
                else uri.path in apiPaths) ||
                (host == "passport.bilibili.com" && uri.path in passportPaths)
        } catch (_: Exception) { false }
    }

    fun isApprovedRefreshCorrespondRoute(raw: String): Boolean = try {
        val uri = URI(raw)
        uri.scheme == "https" && uri.host == "www.bilibili.com" && uri.userInfo == null &&
            uri.fragment == null && uri.port == -1 &&
            uri.path.matches(Regex("/correspond/1/[0-9a-f]{128,1024}")) &&
            uri.rawQuery == null
    } catch (_: Exception) { false }

    fun isSafeAudioHandoff(url: String?, headers: Map<String, String>?, deadline: Long, now: Long): Boolean {
        if (url == null || url.length > MAX_MEDIA_URL || headers != mapOf("Referer" to FIXED_REFERER)) return false
        if (signedDeadline(url) != deadline) return false
        if (deadline - now !in (MIN_MEDIA_TTL_MS + 1)..MAX_MEDIA_TTL_MS) return false
        return try {
            val uri = URI(url)
            uri.scheme == "https" && uri.host != null &&
                (uri.host.equals("bilivideo.com", true) || uri.host.lowercase(Locale.ROOT).endsWith(".bilivideo.com")) &&
                uri.userInfo == null && uri.fragment == null && uri.port == -1
        } catch (_: Exception) { false }
    }

    /** Provider signs `deadline` in seconds; reject duplicates, malformed values, and overflow. */
    fun signedDeadline(url: String?): Long? {
        if (url == null || url.length > MAX_MEDIA_URL) return null
        return try {
            val uri = URI(url)
            val values = uri.rawQuery?.split("&")?.mapNotNull { part ->
                val separator = part.indexOf('=')
                if (separator <= 0) null else decodeQueryKey(part.substring(0, separator))?.let { key -> key to decodeQueryKey(part.substring(separator + 1)) }
            } ?: emptyList()
            val deadlines = values.filter { it.first == "deadline" }.map { it.second }
            if (deadlines.size != 1 || deadlines[0] == null || !deadlines[0]!!.matches(Regex("[1-9][0-9]{8,12}"))) null else Math.multiplyExact(deadlines[0]!!.toLong(), 1000L)
        } catch (_: Exception) { null }
    }

    /**
     * The audio lease transports exactly one validated primary URL. Bilibili
     * normally includes provider backup URLs in the same response; they are
     * intentionally ignored here rather than copied into a transport, so their
     * presence must not make an otherwise safe primary rendition unplayable.
     */
    fun selectAudioCandidate(candidates: List<MediaCandidate>, now: Long): MediaCandidate? {
        if (candidates.isEmpty() || candidates.size > 8) return null
        // The provider may list WebM/Opus or lower-quality renditions beside a
        // valid MP4/AAC stream.  Validate each candidate independently and
        // retain only a safe primary URL; unsupported siblings are never used.
        return candidates.asSequence()
            .filter { candidate ->
                val deadline = signedDeadline(candidate.url)
                candidate.id > 0 &&
                    candidate.mimeType == "audio/mp4" &&
                    candidate.codecs.startsWith("mp4a.") &&
                    deadline != null &&
                    isSafeAudioHandoff(candidate.url, mapOf("Referer" to FIXED_REFERER), deadline, now)
            }
            .maxByOrNull { it.id }
    }

    fun authorizePart(parts: List<AuthorizedPart>, cid: Long, page: Long): AuthorizedPart? =
        parts.takeIf { it.size in 1..50 && it.map { part -> part.cid }.distinct().size == it.size }
            ?.singleOrNull { it.cid == cid && it.page == page && cid > 0L && page > 0L }

    /** Never infer membership from a caller's quality label. The provider's response owns it. */
    fun authorizeRendition(renditions: List<AuthorizedRendition>, requestedId: String?): AuthorizedRendition? =
        renditions.takeIf { it.size in 1..4 && it.map { rendition -> rendition.id }.distinct().size == it.size }
            ?.singleOrNull { rendition ->
                rendition.id == requestedId && rendition.id.matches(Regex("[A-Za-z0-9_.-]{1,80}")) &&
                    safeText(rendition.label, 80) != null && rendition.mimeType == "audio/mp4" && rendition.codec.startsWith("mp4a.")
            }

    fun safeText(value: String?, limit: Int = MAX_TEXT): String? {
        val trimmed = value?.trim() ?: return null
        return if (trimmed.isNotEmpty() && trimmed.length <= limit && trimmed.none { it.code <= 31 }) trimmed else null
    }

    fun safeAvatar(value: String?): String? = try {
        val uri = URI(value)
        if (value != null && value.length <= 2048 && uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.fragment == null) value else null
    } catch (_: Exception) { null }

    fun buildWbiQuery(params: Map<String, String>, mixinKey: String, nowSeconds: Long): String? {
        if (params.keys.any { it !in playbackWbiKeys }) return null
        return buildSignedQuery(params, mixinKey, nowSeconds)
    }

    fun buildWbiSearchQuery(query: String, page: Long, mixinKey: String, nowSeconds: Long): String? {
        return directSearchParameters(query, page)?.let { buildSignedQuery(it, mixinKey, nowSeconds) }
    }

    /**
     * Matches the original author-proven anonymous web-search route. It is a
     * fixed native profile, not a caller-provided URL or query surface.
     */
    fun buildDirectSearchQuery(query: String, page: Long): String? =
        directSearchParameters(query, page)?.let(::buildUnsignedQuery)

    private fun directSearchParameters(query: String, page: Long): LinkedHashMap<String, String>? {
        val normalized = normalizeSearchQuery(query) ?: return null
        if (!isSearchPage(page)) return null
        return linkedMapOf(
            "__refresh__" to "true",
            "_extra" to "",
            "category_id" to "",
            "com2co" to "true",
            "context" to "",
            "dynamic_offset" to "0",
            "highlight" to "1",
            "keyword" to normalized,
            "page" to page.toString(),
            "page_size" to SEARCH_PAGE_SIZE.toString(),
            "platform" to "pc",
            "preload" to "true",
            "search_type" to "video",
            "single_column" to "0",
        )
    }

    fun safeSearchTitle(value: String?): String? = safeText(value?.replace(Regex("<[^>]*>"), ""), 160)

    fun safeSearchArtwork(value: String?): String? {
        val candidate = value?.trim()?.let { if (it.startsWith("//")) "https:$it" else it } ?: return null
        return try {
            val uri = URI(candidate)
            val host = uri.host?.lowercase(Locale.ROOT) ?: return null
            if (candidate.length > 2048 || uri.scheme != "https" || uri.userInfo != null || uri.fragment != null || uri.port != -1) return null
            if (host == "hdslb.com" || host.endsWith(".hdslb.com") || host == "biliimg.com" || host.endsWith(".biliimg.com")) candidate else null
        } catch (_: Exception) { null }
    }

    fun searchDurationMs(value: String?): Long? {
        val normalized = value?.trim() ?: return null
        if (!normalized.matches(Regex("\\d{1,2}:\\d{2}(?::\\d{2})?"))) return null
        val parts = normalized.split(':').map { it.toLongOrNull() ?: return null }
        if (parts.drop(1).any { it !in 0L..59L }) return null
        val seconds = if (parts.size == 3) parts[0] * 3600L + parts[1] * 60L + parts[2] else parts[0] * 60L + parts[1]
        return seconds.takeIf { it in 1L..(8L * 60L * 60L) }?.times(1000L)
    }

    private fun buildSignedQuery(params: Map<String, String>, mixinKey: String, nowSeconds: Long): String? {
        if (mixinKey.length !in 32..64 || nowSeconds <= 0L || params.keys.any { !it.matches(Regex("[A-Za-z0-9_]{1,32}")) }) return null
        val canonical = (params + mapOf("wts" to nowSeconds.toString())).toSortedMap()
        if (canonical.any { (key, value) -> key.length > 32 || value.length > MAX_TEXT || value.any { it.code <= 31 } }) return null
        val query = canonical.entries.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value.filterNot { it in "!'()*" })}" }
        val digest = MessageDigest.getInstance("MD5").digest((query + mixinKey).toByteArray(StandardCharsets.UTF_8))
        return "$query&w_rid=${digest.joinToString("") { "%02x".format(it) }}"
    }

    private fun buildUnsignedQuery(params: Map<String, String>): String? {
        if (params.keys != directSearchKeys || params.any { (key, value) -> key.length > 32 || value.length > MAX_TEXT || value.any { it.code <= 31 } }) return null
        return params.entries.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value)}" }
    }

    private fun isApprovedDirectSearchQuery(rawQuery: String?): Boolean {
        if (rawQuery == null || rawQuery.toByteArray(StandardCharsets.UTF_8).size > MAX_QUERY_BYTES) return false
        val values = LinkedHashMap<String, String>()
        rawQuery.split('&').forEach { part ->
            val separator = part.indexOf('=')
            if (separator < 0) return false
            val key = decodeQueryKey(part.substring(0, separator)) ?: return false
            val value = decodeQueryKey(part.substring(separator + 1)) ?: return false
            if (key !in directSearchKeys || values.put(key, value) != null) return false
        }
        return values.keys == directSearchKeys &&
            values["__refresh__"] == "true" && values["_extra"] == "" && values["category_id"] == "" &&
            values["com2co"] == "true" && values["context"] == "" && values["dynamic_offset"] == "0" &&
            values["highlight"] == "1" && values["page_size"] == SEARCH_PAGE_SIZE.toString() && values["platform"] == "pc" &&
            values["preload"] == "true" && values["search_type"] == "video" && values["single_column"] == "0" &&
            values["keyword"]?.let { normalizeSearchQuery(it) == it } == true &&
            values["page"]?.toLongOrNull()?.let(::isSearchPage) == true
    }

    fun decodeQueryKey(value: String): String? = try { URLDecoder.decode(value, StandardCharsets.UTF_8.name()) } catch (_: Exception) { null }
    private fun encode(value: String) = java.net.URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
