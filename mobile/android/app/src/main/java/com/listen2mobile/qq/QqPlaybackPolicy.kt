package com.listen2mobile.qq

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Locale

/** Pure, fail-closed QQ media policy. The host below is a deterministic fixture assumption only. */
internal object QqPlaybackPolicy {
    const val CONTRACT_VERSION = 1
    const val PROVIDER = "qq"
    const val METADATA_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg"
    const val MAX_METADATA_BYTES = 256 * 1024
    const val MAX_MEDIA_BYTES = 512L * 1024L * 1024L
    const val MAX_LEASE_MS = 60_000L
    const val CONNECT_TIMEOUT_MS = 10_000
    const val READ_TIMEOUT_MS = 15_000

    enum class ErrorCode {
        INVALID_REQUEST,
        NETWORK_ERROR,
        REQUEST_TIMEOUT,
        LOGIN_REQUIRED,
        MEMBERSHIP_REQUIRED,
        DRM_RESTRICTED,
        REGION_RESTRICTED,
        PLAYBACK_UNAVAILABLE,
        INVALID_RESPONSE,
        CANCELLED,
    }

    data class SemanticTrack(val trackId: String, val songmid: String)
    data class Descriptor(
        val version: Int,
        val requestId: String,
        val trackId: String,
        val source: String,
        val url: String,
        val mimeType: String,
        val sizeBytes: Long,
        val expiresAt: Long,
    )

    private val semanticTrack = Regex("^qqtrack_([A-Za-z0-9_-]{1,128})$")
    private val requestId = Regex("^[A-Za-z0-9_-]{1,96}$")
    private val fixtureHosts = setOf("isure.stream.qqmusic.qq.com")
    private val acceptedAudioTypes = setOf("audio/mpeg", "audio/mp4", "audio/aac", "audio/x-m4a")

    fun parseSemanticTrack(value: String?): SemanticTrack? {
        val match = semanticTrack.matchEntire(value ?: return null) ?: return null
        return SemanticTrack(value, match.groupValues[1])
    }

    fun isRequestId(value: String?) = value != null && requestId.matches(value)

    fun policyReady(hosts: Set<String> = fixtureHosts): Boolean = hosts.isNotEmpty() &&
        hosts.all { it == "isure.stream.qqmusic.qq.com" }

    fun fixedMetadataBody(track: SemanticTrack): String = JSONObject().apply {
        put("req_1", JSONObject().apply {
            put("module", "vkey.GetVkeyServer")
            put("method", "CgiGetVkey")
            put("param", JSONObject().apply {
                put("filename", JSONArray().put("M500${track.songmid}${track.songmid}.mp3"))
                put("guid", "10000")
                put("songmid", JSONArray().put(track.songmid))
                put("songtype", JSONArray().put(0))
                put("uin", "0")
                put("loginflag", 1)
                put("platform", "20")
            })
        })
        put("loginUin", "0")
        put("comm", JSONObject().apply {
            put("uin", "0")
            put("format", "json")
            put("ct", 24)
            put("cv", 0)
        })
    }.toString()

    fun fixedMetadataHeaders(): Map<String, String> = linkedMapOf(
        "Accept" to "application/json",
        "Content-Type" to "application/json; charset=UTF-8",
        "User-Agent" to "Listen2Mobile/1",
    )

    fun fixedProbeHeaders(): Map<String, String> = linkedMapOf(
        "Accept" to "audio/*",
        "Range" to "bytes=0-0",
        "User-Agent" to "Listen2Mobile/1",
    )

    fun resolveMediaUrl(metadataBody: String): String {
        val root = try { JSONObject(metadataBody) } catch (_: Exception) {
            throw ProviderException(ErrorCode.INVALID_RESPONSE)
        }
        val response = root.optJSONObject("req_1") ?: throw ProviderException(ErrorCode.INVALID_RESPONSE)
        explicitProviderError(response)?.let { throw ProviderException(it) }
        val data = response.optJSONObject("data") ?: throw ProviderException(ErrorCode.INVALID_RESPONSE)
        val info = data.optJSONArray("midurlinfo")?.optJSONObject(0)
            ?: throw ProviderException(ErrorCode.INVALID_RESPONSE)
        explicitProviderError(info)?.let { throw ProviderException(it) }
        val purl = info.optString("purl", "")
        if (purl.isBlank()) throw ProviderException(ErrorCode.PLAYBACK_UNAVAILABLE)
        if (purl.length > 4096 || purl.startsWith("//") || purl.contains("://") || purl.any { it.code <= 31 })
            throw ProviderException(ErrorCode.INVALID_RESPONSE)
        val sip = data.optJSONArray("sip")?.optString(0, "") ?: ""
        if (!isSafeSip(sip)) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        val url = try { URI(sip).resolve(purl).toString() } catch (_: Exception) { "" }
        if (!isApprovedMediaUrl(url)) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        return url
    }

    fun isApprovedMediaUrl(raw: String?): Boolean = try {
        val uri = URI(raw)
        uri.scheme == "https" && uri.userInfo == null && uri.port == -1 && uri.fragment == null &&
            uri.host?.lowercase(Locale.ROOT) in fixtureHosts && uri.rawPath?.startsWith("/") == true
    } catch (_: Exception) { false }

    fun validateProbe(status: Int, headers: Map<String, List<String>>): Pair<String, Long> {
        if (status != 206) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        val mime = header(headers, "Content-Type")?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
            ?: throw ProviderException(ErrorCode.INVALID_RESPONSE)
        if (mime !in acceptedAudioTypes) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        val range = header(headers, "Content-Range")
        val total = Regex("^bytes 0-0/([1-9][0-9]{0,11})$").matchEntire(range ?: "")
            ?.groupValues?.get(1)?.toLongOrNull()
        if (total == null || total !in 1..MAX_MEDIA_BYTES) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        return mime to total
    }

    private fun isSafeSip(raw: String): Boolean = try {
        val uri = URI(raw)
        uri.scheme == "https" && uri.userInfo == null && uri.port == -1 && uri.fragment == null &&
            uri.host?.lowercase(Locale.ROOT) in fixtureHosts && uri.path == "/" && uri.rawQuery == null
    } catch (_: Exception) { false }

    /** Only fixture-declared stable fields map to a restriction; unknown provider output stays unavailable. */
    private fun explicitProviderError(node: JSONObject): ErrorCode? = when (node.optString("listen2_error", "")) {
        "LOGIN_REQUIRED" -> ErrorCode.LOGIN_REQUIRED
        "MEMBERSHIP_REQUIRED" -> ErrorCode.MEMBERSHIP_REQUIRED
        "DRM_RESTRICTED" -> ErrorCode.DRM_RESTRICTED
        "REGION_RESTRICTED" -> ErrorCode.REGION_RESTRICTED
        else -> null
    }

    private fun header(headers: Map<String, List<String>>, name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name, true) }?.value?.singleOrNull()

    class ProviderException(val code: ErrorCode) : Exception(code.name)
}
