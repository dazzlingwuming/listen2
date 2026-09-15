package com.listen2mobile.offline

import android.content.Context
import com.listen2mobile.library.CacheQuotaEntity
import com.listen2mobile.library.LibraryDatabaseRegistry
import com.listen2mobile.audiofx.LoudnessAnalyzer
import java.util.concurrent.Executors
import java.io.File

/**
 * The public cache owner is Room.  [OfflineCoordinator] is retained only as a
 * bounded, credential-free transfer engine while an acquire is active; it is
 * never used to resolve playback or to report completed cache state.
 */
internal class OfflineCatalogService private constructor(context: Context) {
    private val app = context.applicationContext
    private val root = File(app.noBackupFilesDir, "offline-cache-02")
    private val repository = OfflineCatalogRepository(LibraryDatabaseRegistry.get(app), root)
    private val transfer = OfflineCoordinator(File(root, "transfers"))
    private val legacy = OfflineRegistry.get(app)
    private val analysis = Executors.newSingleThreadExecutor()
    private val listeners = mutableSetOf<(CatalogCacheSnapshot) -> Unit>()

    init {
        migrateLegacyReadyEntries()
        transfer.setObserver { entries ->
            entries.filter { it.status == OfflineStatus.READY }.forEach(::commitCompletedTransfer)
            publish()
        }
    }

    /** One-shot readback migration keeps pre-Room verified blobs playable without exposing paths to JS. */
    private fun migrateLegacyReadyEntries() {
        legacy.snapshot().filter { it.status == OfflineStatus.READY }.forEach { entry ->
            if (readyBlob(entry.source, entry.trackId) != null) return@forEach
            val staged = legacy.file(OfflinePolicy.key(entry.source, entry.trackId)) ?: return@forEach
            val digest = entry.digest ?: return@forEach
            val mime = entry.mimeType ?: return@forEach
            val result = repository.ready(
                OfflineCatalogIdentity(entry.source, entry.trackId, null, "default", "legacy"),
                digest,
                entry.downloadedBytes,
                mime,
                mime,
                staged,
                OfflineOwnerKind.EXPLICIT,
            )
            if (result.status == "READY") legacy.remove(entry.source, entry.trackId)
        }
    }

    fun observe(listener: (CatalogCacheSnapshot) -> Unit) {
        synchronized(listeners) { listeners += listener }
        listener(snapshot())
    }

    fun request(source: String, trackId: String, title: String, artist: String): CatalogCacheSnapshot {
        if (OfflinePolicy.accepted(source, trackId) && readyBlob(source, trackId) == null) {
            transfer.enqueue(source, trackId, title, artist)
        }
        return snapshot()
    }

    /** WorkManager restart path only replays semantic ids and has no URL/cookie input. */
    fun resume(source: String, trackId: String): Boolean {
        if (!OfflinePolicy.accepted(source, trackId) || readyBlob(source, trackId) != null) return false
        val active = transfer.snapshot().firstOrNull { it.source == source && it.trackId == trackId }
        if (active == null) transfer.enqueue(source, trackId, "未知歌曲", "未知艺人")
        else if (active.status in setOf(OfflineStatus.FAILED, OfflineStatus.CANCELLED)) transfer.retry(source, trackId)
        return true
    }

    fun promote(source: String, trackId: String): CatalogCacheSnapshot {
        readyBlob(source, trackId)?.let { repository.addOwner(it.blobKey, OfflineOwnerKind.EXPLICIT) }
        return snapshot()
    }

    fun setQuota(value: Long?): CatalogCacheSnapshot {
        if (value != null && OfflineQuota.parse(value) == null) return snapshot()
        val parsed = value
        val dao = LibraryDatabaseRegistry.get(app).libraryDao()
        dao.putCacheQuota(CacheQuotaEntity(quotaBytes = parsed, reservedBytes = reservedBytes(), updatedAt = System.currentTimeMillis()))
        evictToQuota()
        return snapshot()
    }

    fun action(action: String, operationId: String): CatalogCacheSnapshot {
        val active = transfer.snapshot().firstOrNull { it.operationId == operationId }
        when (action) {
            "cancel" -> active?.let { transfer.cancel(it.operationId) }
            "retry", "repair" -> active?.let { transfer.retry(it.source, it.trackId) }
            "remove" -> removeOperation(active, operationId)
            "clearEligible" -> clearEligible()
        }
        return snapshot()
    }

    fun invalidate(source: String, trackId: String): CatalogCacheSnapshot {
        transfer.remove(source, trackId)
        readyBlob(source, trackId)?.let(::removeBlob)
        return snapshot()
    }

    fun resolve(source: String, trackId: String): CatalogReady? {
        val blob = readyBlob(source, trackId) ?: return null
        val file = repository.readyFile(blob.blobKey, accountGeneration = 0L, authorized = true) ?: return null
        return CatalogReady(blob.blobKey, blob.mimeType, file)
    }

    fun normalizationGain(source: String, trackId: String): Double =
        readyBlob(source, trackId)?.let { repository.normalizationGain(it.blobKey) } ?: 1.0

    fun file(blobKey: String?): File? {
        val safe = blobKey?.takeIf { OfflinePolicy.validKey(it) } ?: return null
        return repository.readyFile(safe, accountGeneration = 0L, authorized = true)
    }

    fun snapshot(): CatalogCacheSnapshot {
        val database = LibraryDatabaseRegistry.get(app)
        val dao = database.libraryDao()
        val ready = dao.readyCacheBlobs().mapNotNull { blob ->
            val catalog = dao.cacheCatalog(blob.cacheId) ?: return@mapNotNull null
            val owners = dao.cacheOwners(blob.blobKey).map { it.kind.name.lowercase() }.distinct().sorted()
            CatalogCacheEntry(
                operationId = blob.blobKey,
                source = catalog.source,
                trackId = catalog.semanticTrackId,
                title = catalog.semanticTrackId,
                artist = "已缓存",
                owners = owners,
                status = "ready",
                downloadedBytes = blob.byteLength,
                totalBytes = blob.byteLength,
                errorCode = null,
                updatedAt = blob.lastUsedAt,
            )
        }
        val pending = transfer.snapshot().filterNot { it.status == OfflineStatus.READY }.map {
            CatalogCacheEntry(it.operationId, it.source, it.trackId, it.title, it.artist, listOf("explicit"), it.status.wire, it.downloadedBytes, it.totalBytes, it.errorCode, it.updatedAt)
        }
        val storedQuota = dao.cacheQuota()
        val quota = storedQuota?.quotaBytes ?: if (storedQuota == null) OfflineQuota.defaultBytes else null
        return CatalogCacheSnapshot(ready.sumOf { it.downloadedBytes }, reservedBytes(), quota, (pending + ready).sortedByDescending { it.updatedAt })
    }

    private fun commitCompletedTransfer(entry: OfflineEntry) {
        val key = OfflinePolicy.key(entry.source, entry.trackId)
        val staged = transfer.file(key) ?: return
        val mime = entry.mimeType ?: return
        val digest = entry.digest ?: return
        val committed = repository.ready(
            OfflineCatalogIdentity(entry.source, entry.trackId, null, "default", "legacy"),
            digest,
            entry.downloadedBytes,
            mime,
            // Analyzer identity is the exact decoded MIME codec, not a UI container label.
            mime,
            staged,
            OfflineOwnerKind.EXPLICIT,
        )
        if (committed.status == "READY") {
            scheduleAnalysis(digest)
            evictToQuota()
        }
    }

    private fun scheduleAnalysis(blobKey: String) {
        val file = repository.readyFile(blobKey, accountGeneration = 0L, authorized = true) ?: return
        analysis.execute {
            val result = LoudnessAnalyzer().analyzeCompleteFile(file, blobKey)
            if (result == null) return@execute
            // The repository binds result reuse to content hash + decoder identity.  A
            // removed/replaced blob cannot become playable from this late completion.
            repository.recordLoudness(result.first, result.second)
        }
    }

    private fun readyBlob(source: String, trackId: String) =
        LibraryDatabaseRegistry.get(app).libraryDao().cacheBlobsForTrack(source, trackId).firstOrNull()

    private fun reservedBytes() = transfer.snapshot()
        .filter { it.status == OfflineStatus.QUEUED || it.status == OfflineStatus.DOWNLOADING }
        .sumOf { maxOf(it.totalBytes, it.downloadedBytes) }

    private fun removeOperation(active: OfflineEntry?, operationId: String) {
        if (active != null) {
            transfer.remove(active.source, active.trackId)
            return
        }
        LibraryDatabaseRegistry.get(app).libraryDao().cacheBlob(operationId)?.let(::removeBlob)
    }

    private fun clearEligible() {
        val dao = LibraryDatabaseRegistry.get(app).libraryDao()
        dao.readyCacheBlobs().forEach { blob ->
            if (dao.cacheOwners(blob.blobKey).none { it.kind == OfflineOwnerKind.EXPLICIT }) removeBlob(blob)
        }
    }

    private fun evictToQuota() {
        val dao = LibraryDatabaseRegistry.get(app).libraryDao()
        val storedQuota = dao.cacheQuota()
        val quota = storedQuota?.quotaBytes ?: if (storedQuota == null) OfflineQuota.defaultBytes else null
        if (quota == null) return
        var used = dao.readyCacheBlobs().sumOf { it.byteLength }
        if (used <= quota) return
        val candidates = dao.readyCacheBlobs().map { blob ->
            OfflineEvictionCandidate(blob.blobKey, blob.lastUsedAt, dao.cacheOwners(blob.blobKey).any { it.kind == OfflineOwnerKind.EXPLICIT })
        }
        OfflineRecoveryPolicy.selectEviction(candidates, candidates.size).forEach { candidate ->
            if (used <= quota) return@forEach
            dao.cacheBlob(candidate.blobKey)?.let { blob -> removeBlob(blob); used -= blob.byteLength }
        }
    }

    private fun removeBlob(blob: com.listen2mobile.library.CacheBlobEntity) {
        val database = LibraryDatabaseRegistry.get(app)
        val dao = database.libraryDao()
        val owners = dao.cacheOwners(blob.blobKey)
        database.runInTransaction {
            owners.forEach { dao.deleteCacheOwner(blob.blobKey, it.ownerKey) }
            dao.deleteCacheBlob(blob.blobKey)
            dao.deleteCacheCatalog(blob.cacheId)
        }
        owners.forEach { File(root, it.aliasRelativeKey).delete() }
        File(root, blob.privateRelativeKey).delete()
    }

    private fun publish() {
        val next = snapshot()
        synchronized(listeners) { listeners.toList() }.forEach { it(next) }
    }

    companion object {
        @Volatile private var instance: OfflineCatalogService? = null
        fun get(context: Context): OfflineCatalogService = instance ?: synchronized(this) {
            instance ?: OfflineCatalogService(context).also { instance = it }
        }
    }
}

internal data class CatalogReady(val blobKey: String, val mimeType: String, val file: File)
internal data class CatalogCacheEntry(
    val operationId: String, val source: String, val trackId: String, val title: String, val artist: String,
    val owners: List<String>, val status: String, val downloadedBytes: Long, val totalBytes: Long,
    val errorCode: String?, val updatedAt: Long,
)
internal data class CatalogCacheSnapshot(val usedBytes: Long, val reservedBytes: Long, val quotaBytes: Long?, val entries: List<CatalogCacheEntry>)
