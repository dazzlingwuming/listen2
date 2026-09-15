package com.listen2mobile.kuwo

import java.net.URI
import java.security.SecureRandom
import java.util.Locale

/** Pure, closed policy for the original-author Kuwo Secret and media handoff. */
internal object KuwoPlaybackPolicy {
    const val CONTRACT_VERSION = 1
    const val PROVIDER = "kuwo"
    const val COOKIE_NAME = "Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324"
    const val HOMEPAGE_URL = "https://www.kuwo.cn/"
    const val MAX_METADATA_BYTES = 256 * 1024
    const val MAX_MEDIA_BYTES = 512L * 1024L * 1024L
    const val MAX_MEDIA_URL_BYTES = 4096
    const val MAX_LEASE_MS = 60_000L
    const val CONNECT_TIMEOUT_MS = 10_000
    const val READ_TIMEOUT_MS = 15_000

    enum class ErrorCode {
        INVALID_REQUEST, NETWORK_ERROR, REQUEST_TIMEOUT, LOGIN_REQUIRED,
        MEMBERSHIP_REQUIRED, DRM_RESTRICTED, REGION_RESTRICTED,
        PLAYBACK_UNAVAILABLE, INVALID_RESPONSE, CANCELLED,
    }

    data class SemanticTrack(val trackId: String, val mid: String)
    data class Descriptor(
        val version: Int, val requestId: String, val trackId: String,
        val source: String, val url: String, val mimeType: String,
        val sizeBytes: Long, val expiresAt: Long,
    )

    private val trackPattern = Regex("^kwtrack_([1-9][0-9]{0,17})$")
    private val requestPattern = Regex("^[A-Za-z0-9_-]{1,96}$")
    private val fixtureHosts = setOf("er-sycdn.kuwo.cn")
    private val audioTypes = setOf("audio/mpeg", "audio/mp4", "audio/aac", "audio/x-m4a")

    fun parseSemanticTrack(value: String?): SemanticTrack? {
        val match = trackPattern.matchEntire(value ?: return null) ?: return null
        return SemanticTrack(value, match.groupValues[1])
    }

    fun isRequestId(value: String?): Boolean = value != null && requestPattern.matches(value)

    fun policyReady(hosts: Set<String> = fixtureHosts): Boolean =
        hosts.isNotEmpty() && hosts.all { it == "er-sycdn.kuwo.cn" } &&
            secret("fixture-token", COOKIE_NAME, 1_234_567L) == "452fda90010b117cb165a7af6d0012d687"

    fun playUrl(mid: String): String? {
        if (!mid.matches(Regex("[1-9][0-9]{0,17}"))) return null
        return "https://www.kuwo.cn/api/v1/www/music/playUrl?mid=$mid&type=music&httpsStatus=1&reqId=&plat=web_www&from="
    }

    /** Exact original-author numeric decimal nonce algorithm, including its hex suffix. */
    fun secret(token: String?, cookieName: String, nonce: Long): String? {
        if (token.isNullOrEmpty() || token.length > MAX_METADATA_BYTES || nonceHex(nonce) == null) return null
        var digits = cookieName.map { it.code.toString() }.joinToString("")
        val group = digits.length / 5
        if (group <= 0) return null
        val multiplierText = listOf(group, 2 * group, 3 * group, 4 * group, 5 * group)
            // JavaScript charAt deliberately contributes an empty string past the
            // final index; retain that historical behavior exactly.
            .map { index -> digits.getOrNull(index)?.toString() ?: "" }
            .joinToString("")
        val multiplier = multiplierText.toLongOrNull() ?: return null
        if (multiplier < 2L) return null
        val lengthTerm = (cookieName.length + 1) / 2L
        digits += nonce.toString()
        while (digits.length > 10) {
            // The source is JavaScript: parseInt can reduce a huge tail through
            // IEEE-754 scientific notation before the following loop. Preserve
            // that behavior instead of treating the cookie digits as a bigint.
            val first = jsParseInt(digits.substring(0, 10)) ?: return null
            val rest = jsParseInt(digits.substring(10)) ?: return null
            val sum = first + rest
            digits = if (sum >= 1e21) java.lang.Double.toString(sum)
                .replace("E", "e+") else sum.toLong().toString()
        }
        val modulus = Int.MAX_VALUE.toLong()
        var state = (multiplier * (digits.toLongOrNull() ?: return null) + lengthTerm) % modulus
        val output = StringBuilder(token.length * 2 + 8)
        token.forEach { character ->
            val encoded = character.code xor ((state.toDouble() / modulus) * 255.0).toInt()
            output.append(encoded.toString(16).padStart(2, '0'))
            state = (multiplier * state + lengthTerm) % modulus
        }
        output.append(nonceHex(nonce))
        return output.toString()
    }

    fun nonceHex(nonce: Long): String? =
        nonce.takeIf { it in 0L..0xffffffffL }?.toString(16)?.padStart(8, '0')

    fun secureNonce(random: SecureRandom = SecureRandom()): Long = random.nextInt().toLong() and 0xffffffffL

    private fun jsParseInt(value: String): Double? =
        Regex("^[0-9]+").find(value)?.value?.toDoubleOrNull()

    fun isApprovedMediaUrl(raw: String?): Boolean {
        if (raw == null || raw.toByteArray(Charsets.UTF_8).size > MAX_MEDIA_URL_BYTES) return false
        return try {
            val uri = URI(raw)
            uri.scheme == "https" && uri.userInfo == null && uri.port == -1 && uri.fragment == null &&
                uri.host?.lowercase(Locale.ROOT) in fixtureHosts && uri.rawPath?.startsWith("/") == true
        } catch (_: Exception) { false }
    }

    fun validateProbe(status: Int, headers: Map<String, List<String>>): Pair<String, Long> {
        if (status != 206) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        val mime = header(headers, "Content-Type")?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
            ?: throw ProviderException(ErrorCode.INVALID_RESPONSE)
        if (mime !in audioTypes) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        val total = Regex("^bytes 0-0/([1-9][0-9]{0,11})$")
            .matchEntire(header(headers, "Content-Range") ?: "")?.groupValues?.get(1)?.toLongOrNull()
            ?: throw ProviderException(ErrorCode.INVALID_RESPONSE)
        if (total !in 1..MAX_MEDIA_BYTES) throw ProviderException(ErrorCode.INVALID_RESPONSE)
        return mime to total
    }

    fun fixedHomepageHeaders(): Map<String, String> = linkedMapOf("Accept" to "text/html", "User-Agent" to "Listen2Mobile/1")
    fun fixedPlayHeaders(token: String, nonce: Long): Map<String, String> {
        val secret = secret(token, COOKIE_NAME, nonce) ?: throw ProviderException(ErrorCode.INVALID_RESPONSE)
        return linkedMapOf("Accept" to "application/json", "Cookie" to "$COOKIE_NAME=$token", "Secret" to secret, "User-Agent" to "Listen2Mobile/1")
    }
    fun fixedProbeHeaders(): Map<String, String> = linkedMapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1")

    private fun header(headers: Map<String, List<String>>, name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name, true) }?.value?.singleOrNull()

    class ProviderException(val code: ErrorCode) : Exception(code.name)

    class RequestLedger {
        class Lease internal constructor(val requestId: String, internal val cancelled: java.util.concurrent.atomic.AtomicBoolean = java.util.concurrent.atomic.AtomicBoolean(false))
        private val active = LinkedHashMap<String, Lease>()
        @Synchronized fun claim(requestId: String): Lease? = if (!isRequestId(requestId) || active.containsKey(requestId)) null else Lease(requestId).also { active[requestId] = it }
        @Synchronized fun cancel(requestId: String): Lease? = active[requestId]?.also { it.cancelled.set(true) }
        @Synchronized fun isCurrent(lease: Lease): Boolean = active[lease.requestId] === lease && !lease.cancelled.get()
        @Synchronized fun complete(lease: Lease) { if (active[lease.requestId] === lease) active.remove(lease.requestId) }
        @Synchronized fun cancelAll(): List<Lease> = active.values.onEach { it.cancelled.set(true) }.toList()
    }
}
