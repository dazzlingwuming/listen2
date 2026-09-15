package com.listen2mobile.media

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.ProxyFileDescriptorCallback
import android.os.storage.StorageManager
import androidx.annotation.RequiresApi
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Non-exported, grant-free package provider. API 24/25 intentionally exposes only
 * verified local bytes; a remote lease must be resolved/downloaded natively first.
 */
class MediaStreamProvider : ContentProvider() {
    private val proxyThread = HandlerThread("listen2-media-proxy").apply { start() }
    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r" || uri.pathSegments.size != 2 || uri.pathSegments[0] != "lease") throw FileNotFoundException()
        val leaseId = uri.pathSegments[1]
        val transport = MediaLeaseRegistryHolder.current()?.transportForProvider(leaseId) ?: throw FileNotFoundException()
        val local = transport.localFile?.takeIf { it.isFile && it.canRead() }
        if (local != null) return ParcelFileDescriptor.open(local, ParcelFileDescriptor.MODE_READ_ONLY)
        // Keep this branch explicit: caller never receives transport details on old Android.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) throw FileNotFoundException()
        val storage = context?.getSystemService(StorageManager::class.java) ?: throw FileNotFoundException()
        return storage.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, LeaseCallback(leaseId), Handler(proxyThread.looper))
    }

    override fun getType(uri: Uri): String? = null
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    @RequiresApi(Build.VERSION_CODES.O)
    private class LeaseCallback(private val leaseId: String) : ProxyFileDescriptorCallback() {
        override fun onGetSize(): Long = -1L
        override fun onRead(offset: Long, size: Int, data: ByteArray): Int {
            if (!MediaStreamPolicy.isAllowedRange(offset, size, data.size)) return -1
            val transport = MediaLeaseRegistryHolder.current()?.transportForProvider(leaseId) ?: return -1
            return try { MediaStreamPolicy.readRange(transport, offset, size, data) } catch (_: Exception) { -1 }
        }
        override fun onRelease() = Unit
    }
}

/** Pure bounded transport checks used by the proxy callback and JVM contract tests. */
internal object MediaStreamPolicy {
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
                transport.headers.filterKeys { it != "Range" }.forEach { (key, value) -> connection.setRequestProperty(key, value) }
                connection.setRequestProperty("Range", "bytes=$offset-${offset + size - 1L}")
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
    private val NETEASE_CDNS = setOf("m7.music.126.net", "m8.music.126.net", "m10.music.126.net", "m704.music.126.net", "m801.music.126.net")
}
