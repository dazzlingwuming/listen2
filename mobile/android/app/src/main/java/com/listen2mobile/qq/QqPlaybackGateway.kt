package com.listen2mobile.qq

import java.io.IOException
import java.io.InputStream
import java.net.SocketTimeoutException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Stateless QQ transport: no Cookie manager, no cookie header, and no retained response state. */
internal class QqPlaybackGateway(
    private val transport: Transport = HttpsTransport(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    data class MetadataRequest(val url: String, val method: String, val headers: Map<String, String>, val body: String, val maxBytes: Int)
    data class ProbeRequest(val url: String, val headers: Map<String, String>, val maxBytes: Int, val maxRedirects: Int)
    data class HttpResponse(val status: Int, val body: String, val headers: Map<String, List<String>>)

    interface Transport {
        fun metadata(request: MetadataRequest): HttpResponse
        fun probe(request: ProbeRequest): HttpResponse
        fun cancel(requestId: String)
    }

    fun resolve(requestId: String, track: QqPlaybackPolicy.SemanticTrack, isCancelled: () -> Boolean = { false }): QqPlaybackPolicy.Descriptor {
        if (!QqPlaybackPolicy.isRequestId(requestId) || !QqPlaybackPolicy.policyReady())
            throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.INVALID_REQUEST)
        requireActive(requestId, isCancelled)
        val metadata = transport.metadata(
            MetadataRequest(
                QqPlaybackPolicy.METADATA_URL,
                "POST",
                QqPlaybackPolicy.fixedMetadataHeaders(),
                QqPlaybackPolicy.fixedMetadataBody(track),
                QqPlaybackPolicy.MAX_METADATA_BYTES,
            ),
        )
        requireActive(requestId, isCancelled)
        if (metadata.status !in 200..299 || metadata.body.toByteArray(Charsets.UTF_8).size > QqPlaybackPolicy.MAX_METADATA_BYTES)
            throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
        val mediaUrl = QqPlaybackPolicy.resolveMediaUrl(metadata.body)
        requireActive(requestId, isCancelled)
        val probe = transport.probe(ProbeRequest(mediaUrl, QqPlaybackPolicy.fixedProbeHeaders(), 1, 0))
        requireActive(requestId, isCancelled)
        val (mimeType, sizeBytes) = QqPlaybackPolicy.validateProbe(probe.status, probe.headers)
        return QqPlaybackPolicy.Descriptor(
            QqPlaybackPolicy.CONTRACT_VERSION,
            requestId,
            track.trackId,
            QqPlaybackPolicy.PROVIDER,
            mediaUrl,
            mimeType,
            sizeBytes,
            clock() + QqPlaybackPolicy.MAX_LEASE_MS,
        )
    }

    fun cancel(requestId: String) = transport.cancel(requestId)

    private fun requireActive(requestId: String, isCancelled: () -> Boolean) {
        if (isCancelled()) {
            transport.cancel(requestId)
            throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.CANCELLED)
        }
    }

    private class HttpsTransport : Transport {
        @Volatile private var active: HttpsURLConnection? = null

        override fun metadata(request: MetadataRequest): HttpResponse = request(request.url, request.method, request.headers, request.body, request.maxBytes)
        override fun probe(request: ProbeRequest): HttpResponse = request(request.url, "GET", request.headers, null, request.maxBytes)
        override fun cancel(requestId: String) { active?.disconnect() }

        private fun request(url: String, method: String, headers: Map<String, String>, body: String?, maxBytes: Int): HttpResponse {
            var connection: HttpsURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpsURLConnection
                active = connection
                connection.instanceFollowRedirects = false
                connection.connectTimeout = QqPlaybackPolicy.CONNECT_TIMEOUT_MS
                connection.readTimeout = QqPlaybackPolicy.READ_TIMEOUT_MS
                connection.requestMethod = method
                headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
                if (body != null) {
                    val bytes = body.toByteArray(Charsets.UTF_8)
                    if (bytes.size > QqPlaybackPolicy.MAX_METADATA_BYTES) throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.INVALID_REQUEST)
                    connection.doOutput = true
                    connection.outputStream.use { it.write(bytes) }
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val responseBody = stream?.use { readBounded(it, maxBytes) } ?: ""
                // HttpURLConnection includes the status line under a null header key. Do not
                // pass that platform-specific entry into the strict probe-header parser.
                val responseHeaders = linkedMapOf<String, List<String>>()
                connection.headerFields.forEach { (name, values) ->
                    if (name != null && values != null) responseHeaders[name] = values
                }
                return HttpResponse(status, responseBody, responseHeaders)
            } catch (_: SocketTimeoutException) {
                throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.REQUEST_TIMEOUT)
            } catch (error: QqPlaybackPolicy.ProviderException) {
                throw error
            } catch (_: IOException) {
                throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.NETWORK_ERROR)
            } catch (_: Exception) {
                throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
            } finally {
                active = null
                connection?.disconnect()
            }
        }

        private fun readBounded(input: InputStream, maxBytes: Int): String {
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (output.size() + count > maxBytes) throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
                output.write(buffer, 0, count)
            }
            return output.toString(Charsets.UTF_8.name())
        }
    }
}
