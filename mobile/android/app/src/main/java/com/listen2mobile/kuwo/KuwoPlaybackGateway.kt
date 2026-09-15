package com.listen2mobile.kuwo

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.SocketTimeoutException
import java.net.URL
import java.security.SecureRandom
import javax.net.ssl.HttpsURLConnection

/** Native-only process-memory Kuwo session. It never exposes its cookie or Secret to JS. */
internal class KuwoPlaybackGateway(
    private val transport: Transport = HttpsTransport(),
    private val clock: () -> Long = System::currentTimeMillis,
    private val nonce: () -> Long = { KuwoPlaybackPolicy.secureNonce() },
) {
    data class HomeRequest(val url: String, val headers: Map<String, String>, val maxBytes: Int)
    data class PlayRequest(val url: String, val headers: Map<String, String>, val maxBytes: Int)
    data class ProbeRequest(val url: String, val headers: Map<String, String>, val maxBytes: Int, val maxRedirects: Int)
    data class HttpResponse(val status: Int, val body: String, val headers: Map<String, List<String>>)
    interface Transport {
        fun homepage(request: HomeRequest): HttpResponse
        fun playUrl(request: PlayRequest): HttpResponse
        fun probe(request: ProbeRequest): HttpResponse
        fun cancel(requestId: String)
    }

    @Volatile private var sessionToken: String? = null

    fun resolve(requestId: String, track: KuwoPlaybackPolicy.SemanticTrack, isCancelled: () -> Boolean = { false }): KuwoPlaybackPolicy.Descriptor {
        if (!KuwoPlaybackPolicy.isRequestId(requestId) || !KuwoPlaybackPolicy.policyReady()) throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_REQUEST)
        requireActive(requestId, isCancelled)
        for (attempt in 0..1) {
            val token = sessionToken ?: acquire(requestId, isCancelled)
            val route = KuwoPlaybackPolicy.playUrl(track.mid) ?: throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_REQUEST)
            val response = transport.playUrl(PlayRequest(route, KuwoPlaybackPolicy.fixedPlayHeaders(token, nonce()), KuwoPlaybackPolicy.MAX_METADATA_BYTES))
            requireActive(requestId, isCancelled)
            if (response.status !in 200..299 || response.body.toByteArray(Charsets.UTF_8).size > KuwoPlaybackPolicy.MAX_METADATA_BYTES) throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
            val result = parsePlayUrl(response.body)
            if (result == null) {
                sessionToken = null
                if (attempt == 0) continue
                throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.PLAYBACK_UNAVAILABLE)
            }
            if (!KuwoPlaybackPolicy.isApprovedMediaUrl(result)) throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
            val probe = transport.probe(ProbeRequest(result, KuwoPlaybackPolicy.fixedProbeHeaders(), 1, 0))
            requireActive(requestId, isCancelled)
            val (mime, size) = KuwoPlaybackPolicy.validateProbe(probe.status, probe.headers)
            return KuwoPlaybackPolicy.Descriptor(KuwoPlaybackPolicy.CONTRACT_VERSION, requestId, track.trackId, KuwoPlaybackPolicy.PROVIDER, result, mime, size, clock() + KuwoPlaybackPolicy.MAX_LEASE_MS)
        }
        throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.PLAYBACK_UNAVAILABLE)
    }

    fun cancel(requestId: String) = transport.cancel(requestId)
    fun clearSession() { sessionToken = null }

    private fun acquire(requestId: String, isCancelled: () -> Boolean): String {
        val response = transport.homepage(HomeRequest(KuwoPlaybackPolicy.HOMEPAGE_URL, KuwoPlaybackPolicy.fixedHomepageHeaders(), KuwoPlaybackPolicy.MAX_METADATA_BYTES))
        requireActive(requestId, isCancelled)
        if (response.status !in 200..299 || response.body.toByteArray(Charsets.UTF_8).size > KuwoPlaybackPolicy.MAX_METADATA_BYTES) throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
        val token = response.headers.entries.firstOrNull { it.key.equals("Set-Cookie", true) }?.value
            ?.asSequence()?.mapNotNull(::extractToken)?.firstOrNull()
            ?: throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.PLAYBACK_UNAVAILABLE)
        sessionToken = token
        return token
    }

    private fun extractToken(raw: String): String? {
        val prefix = "${KuwoPlaybackPolicy.COOKIE_NAME}="
        if (!raw.startsWith(prefix)) return null
        return raw.substringAfter(prefix).substringBefore(';').takeIf { it.isNotBlank() && it.length <= 1024 && it.none { c -> c.code <= 31 || c == ';' } }
    }

    /** false is the repository-proven authorization denial; unknown schema fails as INVALID_RESPONSE. */
    private fun parsePlayUrl(body: String): String? {
        val root = try { JSONObject(body) } catch (_: Exception) { throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE) }
        if (root.has("success") && !root.optBoolean("success", true)) return null
        val url = root.optJSONObject("data")?.optString("url", "") ?: ""
        return url.takeIf { it.isNotBlank() }
            ?: throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.PLAYBACK_UNAVAILABLE)
    }

    private fun requireActive(requestId: String, isCancelled: () -> Boolean) {
        if (isCancelled()) { transport.cancel(requestId); throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.CANCELLED) }
    }

    private class HttpsTransport : Transport {
        @Volatile private var active: HttpsURLConnection? = null
        override fun homepage(request: HomeRequest): HttpResponse = request(request.url, request.headers, null, request.maxBytes)
        override fun playUrl(request: PlayRequest): HttpResponse = request(request.url, request.headers, null, request.maxBytes)
        override fun probe(request: ProbeRequest): HttpResponse = request(request.url, request.headers, null, request.maxBytes)
        override fun cancel(requestId: String) { active?.disconnect() }
        private fun request(url: String, headers: Map<String, String>, body: String?, maxBytes: Int): HttpResponse {
            var connection: HttpsURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpsURLConnection
                active = connection; connection.instanceFollowRedirects = false
                connection.connectTimeout = KuwoPlaybackPolicy.CONNECT_TIMEOUT_MS; connection.readTimeout = KuwoPlaybackPolicy.READ_TIMEOUT_MS
                headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val response = stream?.use { readBounded(it, maxBytes) } ?: ""
                val responseHeaders = linkedMapOf<String, List<String>>()
                connection.headerFields.forEach { (name, values) -> if (name != null && values != null) responseHeaders[name] = values }
                return HttpResponse(status, response, responseHeaders)
            } catch (_: SocketTimeoutException) { throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.REQUEST_TIMEOUT) }
            catch (error: KuwoPlaybackPolicy.ProviderException) { throw error }
            catch (_: IOException) { throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.NETWORK_ERROR) }
            catch (_: Exception) { throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE) }
            finally { active = null; connection?.disconnect() }
        }
        private fun readBounded(input: InputStream, maxBytes: Int): String {
            val output = ByteArrayOutputStream(); val buffer = ByteArray(4096)
            while (true) { val count = input.read(buffer); if (count < 0) break; if (output.size() + count > maxBytes) throw KuwoPlaybackPolicy.ProviderException(KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE); output.write(buffer, 0, count) }
            return output.toString(Charsets.UTF_8.name())
        }
    }
}
