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
    const val MAX_MEDIA_URL = 4096
    const val MIN_MEDIA_TTL_MS = 30_000L
    const val MAX_MEDIA_TTL_MS = 24 * 60 * 60 * 1000L
    const val FIXED_REFERER = "https://www.bilibili.com/"

    enum class ErrorCode { INVALID_REQUEST, NETWORK_ERROR, REQUEST_TIMEOUT, LOGIN_REQUIRED, MEMBERSHIP_REQUIRED, REGION_RESTRICTED, DRM_RESTRICTED, PROVIDER_ERROR, INVALID_RESPONSE, CANCELLED }

    data class SemanticTrack(val bvid: String, val cid: Long, val page: Long)
    data class AudioHandoff(val bvid: String, val cid: Long, val page: Long, val url: String, val deadline: Long)

    private val bvid = Regex("BV[0-9A-Za-z]{6,32}")
    private val positive = Regex("[1-9][0-9]{0,17}")
    private val semantic = Regex("bitrack_v_(BV[0-9A-Za-z]{6,32})-([1-9][0-9]{0,17})")
    private val approvedPaths = setOf(
        "/x/passport-login/web/qrcode/generate",
        "/x/passport-login/web/qrcode/poll",
        "/x/web-interface/nav",
        "/x/web-interface/view",
        "/x/player/wbi/playurl",
        "/x/passport-login/web/cookie/refresh",
        "/login/exit/v2",
    )

    fun parseSemanticTrack(id: String?, page: Long?): SemanticTrack? {
        if (id == null || page == null || page < 1L || page > Long.MAX_VALUE) return null
        val match = semantic.matchEntire(id) ?: return null
        val cid = match.groupValues[2].toLongOrNull() ?: return null
        return SemanticTrack(match.groupValues[1], cid, page)
    }

    fun isCanonicalBvid(value: String?) = value != null && bvid.matches(value)
    fun isPositiveText(value: String?) = value != null && positive.matches(value) && value.toLongOrNull() != null

    fun isApprovedApiRoute(raw: String): Boolean {
        return try {
            val uri = URI(raw)
            val host = uri.host?.lowercase(Locale.ROOT) ?: return false
            if (uri.scheme != "https" || uri.userInfo != null || uri.fragment != null || uri.port != -1) return false
            if (host != "api.bilibili.com" && host != "passport.bilibili.com") return false
            if (uri.path !in approvedPaths || uri.rawQuery?.toByteArray(StandardCharsets.UTF_8)?.size ?: 0 > MAX_QUERY_BYTES) return false
            host == "api.bilibili.com" || uri.path in setOf("/x/passport-login/web/qrcode/generate", "/x/passport-login/web/qrcode/poll", "/x/passport-login/web/cookie/refresh", "/login/exit/v2")
        } catch (_: Exception) { false }
    }

    fun isSafeAudioHandoff(url: String?, headers: Map<String, String>?, deadline: Long, now: Long): Boolean {
        if (url == null || url.length > MAX_MEDIA_URL || headers != mapOf("Referer" to FIXED_REFERER)) return false
        if (deadline - now !in (MIN_MEDIA_TTL_MS + 1)..MAX_MEDIA_TTL_MS) return false
        return try {
            val uri = URI(url)
            uri.scheme == "https" && uri.host != null &&
                (uri.host.equals("bilivideo.com", true) || uri.host.lowercase(Locale.ROOT).endsWith(".bilivideo.com")) &&
                uri.userInfo == null && uri.fragment == null && uri.port == -1
        } catch (_: Exception) { false }
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
        if (mixinKey.length !in 32..64 || params.keys.any { it !in setOf("bvid", "cid", "qn", "fnval", "fnver", "fourk") }) return null
        val canonical = (params + mapOf("wts" to nowSeconds.toString())).toSortedMap()
        if (canonical.any { (key, value) -> key.length > 32 || value.length > MAX_TEXT || value.any { it.code <= 31 } }) return null
        val query = canonical.entries.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value.filterNot { it in "!'()*" })}" }
        val digest = MessageDigest.getInstance("MD5").digest((query + mixinKey).toByteArray(StandardCharsets.UTF_8))
        return "$query&w_rid=${digest.joinToString("") { "%02x".format(it) }}"
    }

    fun decodeQueryKey(value: String): String? = try { URLDecoder.decode(value, StandardCharsets.UTF_8.name()) } catch (_: Exception) { null }
    private fun encode(value: String) = java.net.URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
