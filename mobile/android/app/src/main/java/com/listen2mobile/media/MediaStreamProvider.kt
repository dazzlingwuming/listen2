package com.listen2mobile.media

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Non-exported, grant-free package provider. Remote bytes cross a bounded native
 * pipe; the renderer and RNTP receive only this app-owned content URI.
 */
class MediaStreamProvider : ContentProvider() {
    private val streamExecutor = ThreadPoolExecutor(
        2,
        2,
        30L,
        TimeUnit.SECONDS,
        ArrayBlockingQueue(2),
        ThreadPoolExecutor.AbortPolicy(),
    )

    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r" || uri.pathSegments.size != 2 || uri.pathSegments[0] != "lease") throw FileNotFoundException()
        val leaseId = uri.pathSegments[1]
        val transport = MediaLeaseRegistryHolder.current()?.transportForProvider(leaseId) ?: throw FileNotFoundException()
        val local = transport.localFile?.takeIf { it.isFile && it.canRead() }
        if (local != null) return ParcelFileDescriptor.open(local, ParcelFileDescriptor.MODE_READ_ONLY)
        if (!MediaStreamPolicy.isAllowedTransport(transport)) throw FileNotFoundException()

        val pipe = ParcelFileDescriptor.createPipe()
        try {
            streamExecutor.execute {
                ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { rawOutput ->
                    val outcome = MediaStreamPolicy.streamTo(transport, rawOutput)
                    Log.i(TAG, "lease-stream-${outcome.logName}")
                }
            }
        } catch (_: RejectedExecutionException) {
            pipe[0].close()
            pipe[1].close()
            throw FileNotFoundException()
        }
        Log.i(TAG, "lease-stream-open")
        return pipe[0]
    }

    override fun getType(uri: Uri): String? = null
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    private companion object {
        const val TAG = "Listen2Media"
    }
}

/** Pure bounded transport checks used by the proxy callback and JVM contract tests. */
internal object MediaStreamPolicy {
    enum class StreamOutcome(val logName: String) {
        COMPLETE("complete"),
        POLICY("policy"),
        ROUTE("route"),
        EMPTY("empty"),
        OVERSIZE("oversize"),
        RESPONSE("response"),
        IO("io"),
    }

    private const val MAX_READ_BYTES = 256 * 1024
    private const val MAX_OFFSET = 20L * 1024L * 1024L * 1024L
    fun isAllowedRange(offset: Long, size: Int, bufferSize: Int): Boolean =
        offset >= 0L && offset <= MAX_OFFSET && size in 1..MAX_READ_BYTES && size <= bufferSize
    /** Exact source-owned route and header profiles. No caller value selects these. */
    fun isAllowedTransport(transport: NativeTransport): Boolean =
        isAllowedUrl(transport.source, transport.url, initial = true) && headersMatch(transport.source, transport.headers) &&
            transport.candidates.all { isAllowedUrl(transport.source, it, initial = false) }

    fun readRange(transport: NativeTransport, offset: Long, size: Int, destination: ByteArray): Int {
        if (!isAllowedTransport(transport)) return -1
        var current = transport.url
        repeat(MAX_REDIRECTS + 1) { hop ->
            if (!isAllowedUrl(transport.source, current, initial = hop == 0)) return -1
            val connection = (URL(current).openConnection() as? HttpURLConnection) ?: return -1
            try {
                connection.instanceFollowRedirects = false; connection.connectTimeout = 10_000; connection.readTimeout = 15_000
                connection.requestMethod = "GET"
                requestHeadersFor(transport, "bytes=$offset-${offset + size - 1L}").forEach { (key, value) ->
                    connection.setRequestProperty(key, value)
                }
                when (val status = connection.responseCode) {
                    HttpURLConnection.HTTP_PARTIAL, HttpURLConnection.HTTP_OK -> {
                        if (status == HttpURLConnection.HTTP_OK && offset != 0L) return -1
                        connection.inputStream.use { input ->
                            var total = 0
                            while (total < size) { val count = input.read(destination, total, size - total); if (count < 0) break; total += count }
                            return total.takeIf { it > 0 } ?: -1
                        }
                    }
                    in 300..399 -> {
                        val location = connection.getHeaderField("Location") ?: return -1
                        current = try { URL(URL(current), location).toString() } catch (_: Exception) { return -1 }
                    }
                    401, 403 -> return -1
                    else -> return -1
                }
            } finally { connection.disconnect() }
        }
        return -1
    }

    /**
     * Streams only an already allow-listed native transport into an app-owned
     * descriptor. It deliberately does not accept a URL, headers, or range
     * from the caller, and closes after a bounded response size.
     */
    fun streamTo(transport: NativeTransport, output: java.io.OutputStream): StreamOutcome {
        if (!isAllowedTransport(transport)) return StreamOutcome.POLICY
        var current = transport.url
        repeat(MAX_REDIRECTS + 1) { hop ->
            if (!isAllowedUrl(transport.source, current, initial = hop == 0)) return StreamOutcome.ROUTE
            val connection = (URL(current).openConnection() as? HttpURLConnection) ?: return StreamOutcome.IO
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10_000
                connection.readTimeout = 15_000
                connection.requestMethod = "GET"
                requestHeadersFor(transport).forEach { (key, value) ->
                    connection.setRequestProperty(key, value)
                }
                when (val status = connection.responseCode) {
                    HttpURLConnection.HTTP_OK, HttpURLConnection.HTTP_PARTIAL -> {
                        val declaredLength = connection.contentLengthLong
                        if (declaredLength == 0L) return StreamOutcome.EMPTY
                        if (declaredLength > MAX_STREAM_BYTES) return StreamOutcome.OVERSIZE
                        BufferedInputStream(connection.inputStream).use { input ->
                            BufferedOutputStream(output).use { buffered ->
                                val buffer = ByteArray(STREAM_BUFFER_BYTES)
                                var total = 0L
                                while (true) {
                                    val read = input.read(buffer)
                                    if (read < 0) break
                                    total += read
                                    if (total > MAX_STREAM_BYTES) return StreamOutcome.OVERSIZE
                                    buffered.write(buffer, 0, read)
                                }
                                buffered.flush()
                                return if (total > 0L) StreamOutcome.COMPLETE else StreamOutcome.EMPTY
                            }
                        }
                    }
                    in 300..399 -> {
                        val location = connection.getHeaderField("Location") ?: return StreamOutcome.RESPONSE
                        current = try { URL(URL(current), location).toString() } catch (_: Exception) { return StreamOutcome.ROUTE }
                    }
                    else -> return StreamOutcome.RESPONSE
                }
            } catch (_: Exception) {
                return StreamOutcome.IO
            } finally {
                connection.disconnect()
            }
        }
        return StreamOutcome.ROUTE
    }

    /**
     * Request headers remain entirely native-owned. The descriptor's fixed
     * source profile is validated before this is called; the media user agent
     * is deliberately added here instead of accepting any JavaScript value.
     */
    internal fun requestHeadersFor(transport: NativeTransport, range: String? = null): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        transport.headers.filterKeys { it != "Range" }.forEach { (key, value) -> headers[key] = value }
        headers["User-Agent"] = FIXED_MEDIA_USER_AGENT
        if (range != null) headers["Range"] = range
        return headers
    }

    private fun headersMatch(source: String, headers: Map<String, String>): Boolean = when (source) {
        "bilibili" -> headers == mapOf("Referer" to "https://www.bilibili.com/")
        "qq" -> headers == mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1")
        "kuwo" -> headers == mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1")
        "netease" -> headers.isEmpty()
        "kugou" -> headers == mapOf("Accept" to "audio/*", "User-Agent" to "Listen2Mobile/1")
        else -> false
    }

    private fun isAllowedUrl(source: String, raw: String, initial: Boolean): Boolean {
        return try {
            val uri = java.net.URI(raw)
            val host = uri.host?.lowercase() ?: return false
            if (uri.scheme != "https" || uri.userInfo != null || uri.fragment != null || uri.port != -1) return false
            when (source) {
                "bilibili" -> host == "bilivideo.com" || host.endsWith(".bilivideo.com")
                "qq" -> host == "isure.stream.qqmusic.qq.com" && uri.rawPath?.startsWith("/") == true
                "kuwo" -> host == "er-sycdn.kuwo.cn" && uri.rawPath?.startsWith("/") == true
                "netease" -> if (initial) host == "music.163.com" && uri.path == "/song/media/outer/url" && Regex("id=[1-9][0-9]{0,17}\\.mp3").containsMatchIn(uri.rawQuery ?: "")
                    else host in NETEASE_CDNS && uri.rawPath?.startsWith("/") == true
                "kugou" -> host == "sharefs.kugou.com" && uri.rawPath?.startsWith("/") == true
                else -> false
            }
        } catch (_: Exception) { false }
    }

    private const val MAX_REDIRECTS = 2
    private const val FIXED_MEDIA_USER_AGENT = "Listen2Mobile/1"
    private const val STREAM_BUFFER_BYTES = 64 * 1024
    private const val MAX_STREAM_BYTES = 20L * 1024L * 1024L * 1024L
    private val NETEASE_CDNS = setOf("m7.music.126.net", "m8.music.126.net", "m10.music.126.net", "m704.music.126.net", "m801.music.126.net")
}
