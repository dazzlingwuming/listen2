package com.listen2mobile.offline

import android.content.Context
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

internal data class OfflineLimits(val fileBytes: Long, val totalBytes: Long, val bootstrapBytes: Int) {
    companion object { val DEFAULT = OfflineLimits(128L * 1024 * 1024, 512L * 1024 * 1024, 64 * 1024) }
}

internal enum class OfflineStatus(val wire: String) {
    QUEUED("queued"), DOWNLOADING("downloading"), READY("ready"), FAILED("failed"), CANCELLED("cancelled");
    companion object { fun parse(value: String?) = entries.firstOrNull { it.wire == value } }
}

internal data class OfflineEntry(
    val operationId: String, val source: String, val trackId: String, val title: String, val artist: String,
    var status: OfflineStatus, var downloadedBytes: Long = 0, var totalBytes: Long = 0,
    var errorCode: String? = null, var updatedAt: Long = 0, var digest: String? = null, var mimeType: String? = null,
) { fun snapshot() = copy() }

internal object OfflinePolicy {
    private val netease = Regex("^netrack_([1-9][0-9]{0,17})$")
    private val kugou = Regex("^kgtrack_([A-Za-z0-9]{8,128})$")
    private val keyPattern = Regex("^[0-9a-f]{64}$")
    fun accepted(source: String, trackId: String) = (source == "netease" && netease.matches(trackId)) || (source == "kugou" && kugou.matches(trackId))
    fun key(source: String, trackId: String) = digest("$source:$trackId".toByteArray(StandardCharsets.UTF_8))
    fun validKey(value: String?) = value != null && keyPattern.matches(value)
    fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
    fun hash(file: File): String = FileInputStream(file).use { input ->
        val digest = MessageDigest.getInstance("SHA-256"); val bytes = ByteArray(8192)
        while (true) { val count = input.read(bytes); if (count < 0) break; digest.update(bytes, 0, count) }
        digest.digest().hex()
    }
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
}

/** A redirect must remain within the exact source-specific route that initiated it. */
internal enum class OfflineRoute {
    NETEASE_MEDIA, KUGOU_BOOTSTRAP, KUGOU_MEDIA;
    fun permits(url: URL): Boolean {
        if (url.protocol != "https" || url.userInfo != null || url.port !in setOf(-1, 443)) return false
        val path = url.path ?: return false
        return when (this) {
            NETEASE_MEDIA -> (url.host == "music.163.com" && path == "/song/media/outer/url") || (url.host in NETEASE_CDNS && path.startsWith("/"))
            KUGOU_BOOTSTRAP -> url.host == "wwwapi.kugou.com" && path == "/yy/index.php" && query(url, "r") == "play/getdata" && query(url, "hash")?.matches(Regex("[A-Za-z0-9]{8,128}")) == true
            KUGOU_MEDIA -> url.host in KUGOU_MEDIA_HOSTS && path.startsWith("/")
        }
    }
    private fun query(url: URL, name: String) = url.query?.split('&')?.map { it.split('=', limit = 2) }?.firstOrNull { it.firstOrNull() == name }?.getOrNull(1)
    private companion object {
        val NETEASE_CDNS = setOf("m7.music.126.net", "m8.music.126.net", "m10.music.126.net", "m704.music.126.net", "m801.music.126.net")
        val KUGOU_MEDIA_HOSTS = setOf("sharefs.kugou.com", "fs.w.kugou.com", "webfs.kugou.com")
    }
}

internal class OfflineResponse(val input: InputStream, val contentType: String?, val contentLength: Long, private val closeAction: () -> Unit = {}) : Closeable {
    override fun close() { try { input.close() } finally { closeAction() } }
}
internal interface OfflineTransport { @Throws(IOException::class) fun fetch(url: String, route: OfflineRoute): OfflineResponse }

/** HttpURLConnection automatic redirects stay disabled, so every response hop gets revalidated. */
internal class HttpOfflineTransport : OfflineTransport {
    override fun fetch(raw: String, route: OfflineRoute): OfflineResponse {
        var current = URL(raw)
        repeat(4) {
            if (!route.permits(current)) throw IOException("ROUTE_UNAVAILABLE")
            val connection = (current.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false; connectTimeout = 15_000; readTimeout = 30_000; requestMethod = "GET"; useCaches = false
            }
            when (val code = connection.responseCode) {
                in 200..299 -> return OfflineResponse(BufferedInputStream(connection.inputStream), connection.contentType, connection.contentLengthLong) { connection.disconnect() }
                401, 403 -> { connection.disconnect(); throw IOException("ENTITLEMENT") }
                in 300..399 -> {
                    val location = connection.getHeaderField("Location"); connection.disconnect()
                    current = try { URL(current, location ?: throw IOException("REDIRECT_REJECTED")) } catch (_: Exception) { throw IOException("REDIRECT_REJECTED") }
                    if (!route.permits(current)) throw IOException("REDIRECT_REJECTED")
                }
                else -> { connection.disconnect(); throw IOException("HTTP_FAILED") }
            }
        }
        throw IOException("REDIRECT_REJECTED")
    }
}

internal object BoundedRead {
    fun bytes(input: InputStream, maximum: Int): ByteArray {
        val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
        while (true) { val count = input.read(buffer); if (count < 0) break; if (output.size() + count > maximum) throw IOException("BODY_TOO_LARGE"); output.write(buffer, 0, count) }
        return output.toByteArray()
    }
}

internal interface OfflineTask { fun cancel() }
internal interface OfflineExecutor { @Throws(RejectedExecutionException::class) fun submit(work: () -> Unit): OfflineTask }
internal class ThreadOfflineExecutor : OfflineExecutor {
    private val executor = ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(8), ThreadPoolExecutor.AbortPolicy())
    override fun submit(work: () -> Unit): OfflineTask {
        val future = executor.submit(work)
        return object : OfflineTask { override fun cancel() = future.cancel(true) }
    }
}

private data class ActiveWork(val operationId: String, var reservation: Long = 0, var task: OfflineTask? = null)

/** Lock-owned entries, work tombstones, and reservations prevent stale completions from being published. */
internal class OfflineCoordinator(
    private val root: File, private val transport: OfflineTransport = HttpOfflineTransport(), private val executor: OfflineExecutor = ThreadOfflineExecutor(),
    private val clock: () -> Long = { System.currentTimeMillis() }, private val limits: OfflineLimits = OfflineLimits.DEFAULT,
) {
    private val lock = Any()
    private val entries = LinkedHashMap<String, OfflineEntry>()
    private val active = HashMap<String, ActiveWork>()
    private var observer: ((List<OfflineEntry>) -> Unit)? = null

    init { root.mkdirs(); synchronized(lock) { recoverLocked(); reconcileLocked() } }

    fun setObserver(value: (List<OfflineEntry>) -> Unit) {
        val initial = synchronized(lock) { observer = value; snapshotLocked() }; value(initial)
    }
    fun snapshot(): List<OfflineEntry> = synchronized(lock) { snapshotLocked() }

    fun enqueue(source: String, trackId: String, title: String, artist: String): OfflineEntry {
        val key = if (OfflinePolicy.accepted(source, trackId)) OfflinePolicy.key(source, trackId) else return failed(source, trackId, title, artist, "INVALID_REQUEST")
        lateinit var work: ActiveWork; lateinit var result: OfflineEntry; var event: List<OfflineEntry>? = null
        synchronized(lock) {
            entries[key]?.let { return it.snapshot() }
            if (active.size >= 10) return failed(source, trackId, title, artist, "QUEUE_FULL")
            val entry = OfflineEntry(UUID.randomUUID().toString(), source, trackId, title.take(256), artist.take(256), OfflineStatus.QUEUED, updatedAt = clock())
            work = ActiveWork(entry.operationId); entries[key] = entry; active[key] = work; persistLocked(); event = snapshotLocked(); result = entry.snapshot()
        }
        publish(event)
        try { work.task = executor.submit { download(key, work) } } catch (_: RejectedExecutionException) { failIfActive(key, work, "QUEUE_FULL") }
        return result
    }

    fun cancel(operationId: String) {
        val result = synchronized(lock) {
            val match = entries.entries.firstOrNull { it.value.operationId == operationId } ?: return@synchronized null
            val work = active.remove(match.key) ?: return@synchronized null
            work.reservation = 0; match.value.status = OfflineStatus.CANCELLED; match.value.errorCode = "CANCELLED"; match.value.updatedAt = clock(); persistLocked()
            Triple(match.key, work, snapshotLocked())
        } ?: return
        result.second.task?.cancel(); File(root, "${result.first}.$operationId.part").delete(); publish(result.third)
    }

    fun remove(source: String, trackId: String) {
        if (!OfflinePolicy.accepted(source, trackId)) return
        val key = OfflinePolicy.key(source, trackId)
        val result = synchronized(lock) {
            val removed = entries.remove(key) ?: return@synchronized null
            val work = active.remove(key); work?.reservation = 0; persistLocked(); Triple(removed.operationId, work, snapshotLocked())
        } ?: return
        result.second?.task?.cancel(); File(root, "$key.${result.first}.part").delete(); File(root, key).delete(); publish(result.third)
    }

    fun clear() {
        val result = synchronized(lock) {
            val values = entries.map { (key, entry) -> Triple(key, entry.operationId, active.remove(key)) }; entries.clear(); persistLocked(); Pair(values, snapshotLocked())
        }
        result.first.forEach { (key, operationId, work) -> work?.task?.cancel(); File(root, "$key.$operationId.part").delete(); File(root, key).delete() }
        publish(result.second)
    }

    fun retry(source: String, trackId: String): OfflineEntry? {
        val prior = synchronized(lock) { entries[OfflinePolicy.key(source, trackId)]?.snapshot() } ?: return null
        remove(prior.source, prior.trackId); return enqueue(prior.source, prior.trackId, prior.title, prior.artist)
    }

    fun resolve(source: String, trackId: String): OfflineEntry? = readyLookup(source, trackId)?.first
    fun file(key: String?): File? {
        val validatedKey = key ?: return null
        if (!OfflinePolicy.validKey(validatedKey)) return null
        val result = synchronized(lock) {
            val entry = entries[validatedKey]
            if (entry != null && entry.status == OfflineStatus.READY && validReadyLocked(validatedKey, entry)) Pair(File(root, validatedKey), null)
            else invalidateLocked(validatedKey)
        }
        publish(result.second); return result.first
    }

    private fun readyLookup(source: String, trackId: String): Pair<OfflineEntry?, List<OfflineEntry>?>? {
        if (!OfflinePolicy.accepted(source, trackId)) return null
        val key = OfflinePolicy.key(source, trackId)
        val result = synchronized(lock) {
            val entry = entries[key]
            if (entry != null && entry.status == OfflineStatus.READY && validReadyLocked(key, entry)) Pair(entry.snapshot(), null) else invalidateLocked(key)
        }
        publish(result.second); return result
    }
    private fun invalidateLocked(key: String): Pair<Nothing?, List<OfflineEntry>?> {
        if (entries.remove(key) == null) return Pair(null, null)
        File(root, key).delete(); persistLocked(); return Pair(null, snapshotLocked())
    }

    private fun download(key: String, work: ActiveWork) {
        val entry = markDownloading(key, work) ?: return
        val part = File(root, "$key.${work.operationId}.part")
        try {
            val media = mediaUrl(entry)
            transport.fetch(media, if (entry.source == "netease") OfflineRoute.NETEASE_MEDIA else OfflineRoute.KUGOU_MEDIA).use { response ->
                val mime = response.contentType?.substringBefore(';')?.lowercase() ?: ""
                if (mime !in AUDIO_TYPES) throw IOException("INVALID_MEDIA")
                if (response.contentLength > limits.fileBytes) throw IOException("FILE_TOO_LARGE")
                reserveKnown(key, work, response.contentLength)
                stream(key, work, response.input, part, response.contentLength)
                if (!mediaSignature(part)) throw IOException("INVALID_MEDIA")
                commitReady(key, work, entry, part, mime)
            }
        } catch (error: Exception) {
            part.delete()
            if (error is InterruptedIOException || Thread.currentThread().isInterrupted) cancelIfActive(key, work) else failIfActive(key, work, safeCode(error.message))
        }
    }

    private fun markDownloading(key: String, work: ActiveWork): OfflineEntry? {
        val result = synchronized(lock) {
            val entry = currentLocked(key, work) ?: return@synchronized null
            entry.status = OfflineStatus.DOWNLOADING; entry.errorCode = null; entry.updatedAt = clock(); persistLocked(); Pair(entry.snapshot(), snapshotLocked())
        } ?: return null
        publish(result.second); return result.first
    }
    private fun reserveKnown(key: String, work: ActiveWork, length: Long) {
        if (length <= 0) return
        val event = synchronized(lock) {
            val entry = currentLocked(key, work) ?: throw InterruptedIOException()
            if (committedLocked() + reservedLocked() - work.reservation + length > limits.totalBytes) throw IOException("QUOTA_EXCEEDED")
            work.reservation = length; entry.totalBytes = length; entry.updatedAt = clock(); persistLocked(); snapshotLocked()
        }
        publish(event)
    }
    private fun stream(key: String, work: ActiveWork, input: InputStream, part: File, length: Long) {
        FileOutputStream(part).use { output ->
            val buffer = ByteArray(8192); var downloaded = 0L
            while (true) {
                if (Thread.currentThread().isInterrupted) throw InterruptedIOException()
                val count = input.read(buffer); if (count < 0) break; downloaded += count
                if (downloaded > limits.fileBytes) throw IOException("FILE_TOO_LARGE")
                val event = synchronized(lock) {
                    val entry = currentLocked(key, work) ?: throw InterruptedIOException()
                    if (length <= 0) {
                        if (committedLocked() + reservedLocked() - work.reservation + downloaded > limits.totalBytes) throw IOException("QUOTA_EXCEEDED")
                        work.reservation = downloaded
                    }
                    entry.downloadedBytes = downloaded; entry.totalBytes = if (length > 0) length else downloaded; entry.updatedAt = clock(); persistLocked(); snapshotLocked()
                }
                output.write(buffer, 0, count); publish(event)
            }
            output.fd.sync()
        }
    }
    private fun commitReady(key: String, work: ActiveWork, downloaded: OfflineEntry, part: File, mime: String) {
        val digest = OfflinePolicy.hash(part)
        val event = synchronized(lock) {
            val entry = currentLocked(key, work) ?: throw InterruptedIOException()
            if (entry.operationId != downloaded.operationId) throw InterruptedIOException()
            atomicReplace(part, File(root, key)); entry.digest = digest; entry.mimeType = mime; entry.status = OfflineStatus.READY
            entry.downloadedBytes = File(root, key).length(); entry.totalBytes = entry.downloadedBytes; entry.errorCode = null; entry.updatedAt = clock()
            active.remove(key); work.reservation = 0; persistLocked(); snapshotLocked()
        }
        publish(event)
    }
    private fun cancelIfActive(key: String, work: ActiveWork) = terminal(key, work, OfflineStatus.CANCELLED, "CANCELLED")
    private fun failIfActive(key: String, work: ActiveWork, code: String) = terminal(key, work, OfflineStatus.FAILED, code)
    private fun terminal(key: String, work: ActiveWork, status: OfflineStatus, code: String) {
        val event = synchronized(lock) {
            val entry = currentLocked(key, work) ?: return@synchronized null
            active.remove(key); work.reservation = 0; entry.status = status; entry.errorCode = code; entry.updatedAt = clock(); persistLocked(); snapshotLocked()
        }
        publish(event)
    }

    private fun mediaUrl(entry: OfflineEntry): String = when (entry.source) {
        "netease" -> "https://music.163.com/song/media/outer/url?id=${entry.trackId.removePrefix("netrack_")}.mp3"
        "kugou" -> kugouMediaUrl(entry.trackId.removePrefix("kgtrack_"))
        else -> throw IOException("ROUTE_UNAVAILABLE")
    }
    private fun kugouMediaUrl(hash: String): String {
        val url = "https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=$hash"
        transport.fetch(url, OfflineRoute.KUGOU_BOOTSTRAP).use { response ->
            if (response.contentLength > limits.bootstrapBytes) throw IOException("BODY_TOO_LARGE")
            val candidate = try { JSONObject(String(BoundedRead.bytes(response.input, limits.bootstrapBytes), StandardCharsets.UTF_8)).optString("play_url", "") } catch (_: Exception) { "" }
            val media = try { URL(candidate) } catch (_: Exception) { throw IOException("ROUTE_UNAVAILABLE") }
            if (!OfflineRoute.KUGOU_MEDIA.permits(media)) throw IOException("ROUTE_UNAVAILABLE")
            return media.toString()
        }
    }
    private fun currentLocked(key: String, work: ActiveWork) = entries[key]?.takeIf { active[key] === work && it.operationId == work.operationId }
    private fun committedLocked() = entries.values.filter { it.status == OfflineStatus.READY }.sumOf { it.downloadedBytes }
    private fun reservedLocked() = active.values.sumOf { it.reservation }
    private fun snapshotLocked() = entries.values.map { it.snapshot() }.sortedByDescending { it.updatedAt }
    private fun publish(value: List<OfflineEntry>?) { if (value != null) observer?.invoke(value) }
    private fun failed(source: String, trackId: String, title: String, artist: String, code: String) = OfflineEntry(UUID.randomUUID().toString(), source, trackId, title.take(256), artist.take(256), OfflineStatus.FAILED, errorCode = code, updatedAt = clock())
    private fun safeCode(value: String?) = when (value) {
        "ROUTE_UNAVAILABLE", "REDIRECT_REJECTED", "BODY_TOO_LARGE", "FILE_TOO_LARGE", "QUOTA_EXCEEDED", "ENTITLEMENT", "INVALID_MEDIA", "COMMIT_FAILED" -> value
        else -> "DOWNLOAD_FAILED"
    }
    private fun mediaSignature(file: File) = FileInputStream(file).use { input ->
        val bytes = ByteArray(12); val count = input.read(bytes)
        count >= 4 && (String(bytes, 0, 3, StandardCharsets.US_ASCII) == "ID3" || (bytes[0].toInt() and 0xff) == 0xff || String(bytes, 0, 4, StandardCharsets.US_ASCII) in setOf("fLaC", "OggS") || String(bytes, 4, 4, StandardCharsets.US_ASCII) == "ftyp")
    }
    private fun validReadyLocked(key: String, entry: OfflineEntry): Boolean {
        val file = File(root, key)
        return file.isFile && entry.digest != null && entry.mimeType in AUDIO_TYPES && file.length() == entry.downloadedBytes && OfflinePolicy.hash(file) == entry.digest
    }

    private fun persistLocked() {
        val array = JSONArray()
        entries.forEach { (key, entry) -> array.put(JSONObject().put("key", key).put("operationId", entry.operationId).put("source", entry.source).put("trackId", entry.trackId).put("title", entry.title).put("artist", entry.artist).put("status", entry.status.wire).put("downloadedBytes", entry.downloadedBytes).put("totalBytes", entry.totalBytes).put("errorCode", entry.errorCode).put("updatedAt", entry.updatedAt).put("digest", entry.digest).put("mimeType", entry.mimeType)) }
        val payload = JSONObject().put("version", 1).put("entries", array).toString().toByteArray(StandardCharsets.UTF_8)
        // Write the independently recoverable copy first. A crash while replacing main can
        // therefore restore the same fully committed catalog instead of an old downloading row.
        writeAtomically(File(root, "catalog.previous.json"), payload)
        writeAtomically(File(root, "catalog.json"), payload)
    }
    private fun recoverLocked() {
        val main = File(root, "catalog.json"); val mainEntries = readCatalog(main); val recovered = mainEntries ?: readCatalog(File(root, "catalog.previous.json")) ?: return
        if (mainEntries == null && main.exists()) main.delete(); entries.putAll(recovered)
    }
    private fun readCatalog(file: File): Map<String, OfflineEntry>? {
        if (!file.isFile) return null
        return try {
            val objectValue = JSONObject(file.readText(StandardCharsets.UTF_8)); if (objectValue.optInt("version") != 1) return null
            val loaded = LinkedHashMap<String, OfflineEntry>()
            val array = objectValue.getJSONArray("entries")
            for (index in 0 until array.length()) {
                val value = array.getJSONObject(index); val key = value.getString("key"); val source = value.getString("source"); val trackId = value.getString("trackId")
                val status = OfflineStatus.parse(value.getString("status")) ?: return null; val downloaded = value.getLong("downloadedBytes"); val total = value.getLong("totalBytes")
                if (!OfflinePolicy.validKey(key) || key != OfflinePolicy.key(source, trackId) || !OfflinePolicy.accepted(source, trackId) || downloaded < 0 || total < 0 || downloaded > total) return null
                val digest = value.nullable("digest"); val mime = value.nullable("mimeType")
                if (status == OfflineStatus.READY && (digest == null || mime !in AUDIO_TYPES)) return null
                loaded[key] = OfflineEntry(value.getString("operationId"), source, trackId, value.getString("title").take(256), value.getString("artist").take(256), status, downloaded, total, value.nullable("errorCode"), value.getLong("updatedAt"), digest, mime)
            }
            loaded
        } catch (_: Exception) { null }
    }
    private fun reconcileLocked() {
        var changed = false
        root.listFiles()?.forEach { file -> if (file.name.endsWith(".part") || file.name.endsWith(".tmp") || (OfflinePolicy.validKey(file.name) && entries[file.name]?.status != OfflineStatus.READY)) changed = file.delete() || changed }
        entries.entries.toList().forEach { (key, entry) ->
            when {
                entry.status == OfflineStatus.READY && !validReadyLocked(key, entry) -> { entries.remove(key); File(root, key).delete(); changed = true }
                entry.status == OfflineStatus.QUEUED || entry.status == OfflineStatus.DOWNLOADING -> { entry.status = OfflineStatus.FAILED; entry.errorCode = "INTERRUPTED"; entry.updatedAt = clock(); changed = true }
            }
        }
        root.listFiles()?.filter { OfflinePolicy.validKey(it.name) && entries[it.name]?.status != OfflineStatus.READY }?.forEach { changed = it.delete() || changed }
        if (changed) persistLocked()
    }
    private fun writeAtomically(target: File, data: ByteArray) {
        val temporary = File(root, "${target.name}.tmp")
        FileOutputStream(temporary).use { output -> output.write(data); output.fd.sync() }; atomicReplace(temporary, target)
    }
    private fun atomicReplace(from: File, target: File) {
        // Same-directory rename is an atomic replacement on Android's app-private filesystem.
        if (!from.renameTo(target)) throw IOException("COMMIT_FAILED")
    }
    private fun JSONObject.nullable(name: String): String? = if (isNull(name)) null else getString(name)
    private companion object { val AUDIO_TYPES = setOf("audio/mpeg", "audio/aac", "audio/mp4", "audio/ogg", "audio/flac") }
}

internal object OfflineRegistry {
    @Volatile private var instance: OfflineCoordinator? = null
    fun get(context: Context) = instance ?: synchronized(this) { instance ?: OfflineCoordinator(File(context.noBackupFilesDir, "offline-media-01")).also { instance = it } }
}
