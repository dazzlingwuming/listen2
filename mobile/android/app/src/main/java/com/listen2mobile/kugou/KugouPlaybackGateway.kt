package com.listen2mobile.kugou

import com.listen2mobile.media.NativeTransport
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** The authoritative Kugou hash is semantic input; a transport URL is never caller-controlled. */
internal class KugouPlaybackGateway(private val transport: Transport = HttpsTransport()) {
    data class Resolution(val requestId: String, val trackId: String, val transport: NativeTransport)
    interface Transport { fun bootstrap(url: String): String }

    fun resolve(requestId: String, trackId: String): Resolution {
        require(requestId.matches(REQUEST_ID) && trackId.matches(TRACK_ID))
        val hash = trackId.removePrefix("kgtrack_")
        val route = "https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=$hash"
        val media = try { JSONObject(transport.bootstrap(route)).optString("play_url", "") } catch (_: Exception) { "" }
        require(isApprovedMedia(media))
        return Resolution(requestId, trackId, NativeTransport(media, mapOf("Accept" to "audio/*", "User-Agent" to "Listen2Mobile/1"), source = "kugou"))
    }

    private fun isApprovedMedia(raw: String): Boolean = try {
        val uri = java.net.URI(raw)
        uri.scheme == "https" && uri.host == "sharefs.kugou.com" && uri.userInfo == null && uri.port == -1 && uri.fragment == null && uri.rawPath?.startsWith("/") == true
    } catch (_: Exception) { false }

    private class HttpsTransport : Transport {
        override fun bootstrap(url: String): String {
            val connection = URL(url).openConnection() as? HttpsURLConnection ?: throw IllegalArgumentException()
            try {
                connection.instanceFollowRedirects = false; connection.connectTimeout = 10_000; connection.readTimeout = 15_000
                connection.requestMethod = "GET"; connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("User-Agent", "Listen2Mobile/1")
                if (connection.responseCode !in 200..299) throw IllegalArgumentException()
                connection.inputStream.use { input ->
                    val out = ByteArrayOutputStream(); val bytes = ByteArray(4096)
                    while (true) { val count = input.read(bytes); if (count < 0) break; if (out.size() + count > MAX_BODY_BYTES) throw IllegalArgumentException(); out.write(bytes, 0, count) }
                    return out.toString(Charsets.UTF_8.name())
                }
            } finally { connection.disconnect() }
        }
    }

    private companion object {
        val REQUEST_ID = Regex("[A-Za-z0-9_-]{8,96}")
        val TRACK_ID = Regex("kgtrack_[A-Za-z0-9]{8,128}")
        const val MAX_BODY_BYTES = 64 * 1024
    }
}
