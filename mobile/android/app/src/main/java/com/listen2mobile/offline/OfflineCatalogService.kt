package com.listen2mobile.offline

import android.content.Context
import com.listen2mobile.library.CacheQuotaEntity
import com.listen2mobile.library.LibraryDatabaseRegistry
import com.listen2mobile.audiofx.LoudnessAnalyzer
import com.listen2mobile.media.CacheAuthorization
import com.listen2mobile.media.MediaLeaseRegistryHolder
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
    private val transfer = OfflineCoordinator(
        File(root, "transfers"),
        // Room owns the user-visible quota.  The transfer engine retains only
        // its per-file safety cap and delegates every total reservation here.
        limits = OfflineLimits(128L * 1024 * 1024, Long.MAX_VALUE, 64 * 1024),
        reserveAdmission = ::admitReservation,
    )
    private val legacy = OfflineRegistry.get(app)
    private val analysis = Executors.newSingleThreadExecutor()
    private val listeners = mutableSetOf<(CatalogCacheSnapshot) -> Unit>()
    private val cacheAuthorizations = mutableMapOf<String, CacheAuthorization>()
    private val localReceiptGrants = mutableMapOf<String, Long>()
    /** A transfer may start only from a just-resolved native descriptor; it is never persisted. */
    private val transferAuthorizations = TransferAuthorizationBook()

    init {
        // A process restart has no trustworthy account/session proof. Account-bound
        // receipts remain metadata only until a source-native descriptor refreshes it.
        repository.markAccountAuthoritiesUnknown()
        MediaLeaseRegistryHolder.installOfflineAuthorityInvalidator { source, generation ->
            repository.revokeAuthority(source, generation)
            synchronized(localReceiptGrants) {
                localReceiptGrants.keys.filter { key -> repository.authorization(key)?.source == source }
                    .forEach(localReceiptGrants::remove)
            }
        }
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
            val grant = freshTransferGrant(source, trackId) ?: return snapshot()
            val active = transfer.snapshot().firstOrNull { it.source == source && it.trackId == trackId }
            if (active == null) enqueueAuthorized(source, trackId, title, artist, grant)
            else if (active.status in setOf(OfflineStatus.FAILED, OfflineStatus.CANCELLED)) retryAuthorized(active, grant)
            else transferAuthorizations.install(active, grant)
        }
        return snapshot()
    }

    /** WorkManager restart path only replays semantic ids and has no URL/cookie input. */
    fun resume(source: String, trackId: String): Boolean = resumeOutcome(source, trackId) == "requeued"

    internal fun resumeOutcome(source: String, trackId: String): String {
        if (!OfflinePolicy.accepted(source, trackId)) return "invalid"
        if (readyBlob(source, trackId) != null) return "ready"
        // Process-death recovery has no transport or authority token. The worker
        // must obtain a fresh native descriptor before requeueing.
        val grant = freshTransferGrant(source, trackId) ?: return "needs-reauthorization"
        val active = transfer.snapshot().firstOrNull { it.source == source && it.trackId == trackId }
        if (active == null) enqueueAuthorized(source, trackId, "未知歌曲", "未知艺人", grant)
        else if (active.status in setOf(OfflineStatus.FAILED, OfflineStatus.CANCELLED)) retryAuthorized(active, grant)
        else transferAuthorizations.install(active, grant)
        return "requeued"
    }

    /** Used by both the cache UI and WorkManager's notification cancel intent. */
    fun cancel(source: String, trackId: String) {
        val active = transfer.snapshot().firstOrNull { it.source == source && it.trackId == trackId }
        if (active != null) transfer.cancel(active.operationId)
        transferAuthorizations.clear(source, trackId)
        publish()
    }

    /** Worker-facing bounded wait keeps the foreground notification truthful. */
    fun awaitTerminal(source: String, trackId: String, deadlineMillis: Long): String {
        while (System.currentTimeMillis() < deadlineMillis) {
            if (readyBlob(source, trackId) != null) return "ready"
            val entry = transfer.snapshot().firstOrNull { it.source == source && it.trackId == trackId }
            if (entry == null) return "not-found"
            if (entry.status == OfflineStatus.FAILED) return "failed"
            if (entry.status == OfflineStatus.CANCELLED) return "cancelled"
            try { Thread.sleep(250) } catch (_: InterruptedException) { return "cancelled" }
        }
        return "timed-out"
    }

    fun promote(source: String, trackId: String): CatalogCacheSnapshot {
        readyBlob(source, trackId)?.let { repository.addOwner(it.blobKey, OfflineOwnerKind.EXPLICIT) }
        return snapshot()
    }

    /** Called only after RNTP accepted a cached item; it never starts a download. */
    fun markPlayed(source: String, trackId: String): CatalogCacheSnapshot {
        readyBlob(source, trackId)?.let { repository.addOwner(it.blobKey, OfflineOwnerKind.TEMPORARY) }
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
            "cancel" -> active?.let { transferAuthorizations.clear(it.source, it.trackId); transfer.cancel(it.operationId) }
            "retry" -> active?.let { resume(it.source, it.trackId) }
            "repair" -> if (active != null) resume(active.source, active.trackId) else repairReadyEntries()
            "remove" -> removeOperation(active, operationId)
            "clearEligible" -> clearEligible()
        }
        return snapshot()
    }

    fun invalidate(source: String, trackId: String): CatalogCacheSnapshot {
        transferAuthorizations.clear(source, trackId)
        transfer.remove(source, trackId)
        readyBlob(source, trackId)?.let(::removeBlob)
        return snapshot()
    }

    fun resolve(source: String, trackId: String): CatalogReady? {
        val blob = readyBlob(source, trackId) ?: return null
        if (!isAuthorized(blob.blobKey)) return null
        val file = repository.readyFile(blob.blobKey) ?: return null
        return CatalogReady(blob.blobKey, blob.mimeType, file)
    }

    fun normalizationGain(source: String, trackId: String): Double =
        readyBlob(source, trackId)?.let { repository.normalizationGain(it.blobKey) } ?: 1.0

    fun file(blobKey: String?): File? {
        val safe = blobKey?.takeIf { OfflinePolicy.validKey(it) } ?: return null
        if (!isAuthorized(safe)) return null
        return repository.readyFile(safe)
    }

    /** Cache access inherits the authoritative source descriptor; no JS value can manufacture it. */
    fun authorize(source: String, trackId: String, requestId: String): Boolean {
        val blob = readyBlob(source, trackId) ?: return false
        val grant = MediaLeaseRegistryHolder.current()?.cacheAuthorization(requestId, source, trackId) ?: return false
        repository.recordAuthorization(
            blob.blobKey,
            grant.accountGeneration,
            grant.entitlementClass.wire,
            System.currentTimeMillis() + RECEIPT_TTL_MILLIS,
        )
        synchronized(cacheAuthorizations) { cacheAuthorizations[blob.blobKey] = grant }
        return true
    }

    /** Offline-first uses the source-scoped durable native receipt; no transport lease is required. */
    fun authorizeLocal(source: String, trackId: String): Boolean {
        val blob = readyBlob(source, trackId) ?: return false
        val receipt = repository.authorization(blob.blobKey) ?: return false
        val now = System.currentTimeMillis()
        val authority = repository.authority(source)
        if (!OfflineAuthorizationPolicy.permits(receipt, authority, source, trackId, now) || repository.readyFile(blob.blobKey) == null) return false
        synchronized(localReceiptGrants) { localReceiptGrants[blob.blobKey] = receipt.authorizationExpiresAt }
        return true
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
        val grant = transferAuthorizations.consume(entry)
        if (grant == null || MediaLeaseRegistryHolder.current()?.isCurrentCacheAuthorization(grant) != true ||
            grant.identity.source != entry.source || grant.identity.trackId != entry.trackId
        ) {
            // Do not turn a transfer completed after logout/expiry into a durable
            // cache object. A fresh native descriptor must re-admit it.
            if (!transferAuthorizations.hasBinding(entry.source, entry.trackId)) transfer.remove(entry.source, entry.trackId)
            return
        }
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
            repository.recordAuthorization(
                committed.blobKey ?: return,
                grant.accountGeneration,
                grant.entitlementClass.wire,
                System.currentTimeMillis() + RECEIPT_TTL_MILLIS,
            )
            scheduleAnalysis(digest)
            evictToQuota()
        }
    }

    /** Native grant admission is checked before a coordinator task can observe its operation id. */
    private fun freshTransferGrant(source: String, trackId: String): CacheAuthorization? {
        val grant = MediaLeaseRegistryHolder.current()?.localCacheAuthorization(source, trackId) ?: return null
        if (grant.accountGeneration == 0L && grant.entitlementClass.wire != "anonymous-free") return null
        return grant.takeIf { MediaLeaseRegistryHolder.current()?.isCurrentCacheAuthorization(it) == true }
    }

    private fun enqueueAuthorized(source: String, trackId: String, title: String, artist: String, grant: CacheAuthorization): OfflineEntry =
        transfer.enqueue(source, trackId, title, artist) { created -> transferAuthorizations.install(created, grant) }

    private fun retryAuthorized(prior: OfflineEntry, grant: CacheAuthorization): OfflineEntry? {
        transferAuthorizations.clear(prior.source, prior.trackId)
        return transfer.retry(prior.source, prior.trackId) { created -> transferAuthorizations.install(created, grant) }
    }

    private fun scheduleAnalysis(blobKey: String) {
        val file = repository.readyFile(blobKey) ?: return
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

    /** Reservation uses committed Room bytes plus other in-flight semantic transfers. */
    private fun admitReservation(identityKey: String, requestedBytes: Long): Boolean {
        if (requestedBytes < 0) return false
        val dao = LibraryDatabaseRegistry.get(app).libraryDao()
        val stored = dao.cacheQuota()
        val quota = stored?.quotaBytes ?: if (stored == null) OfflineQuota.defaultBytes else null
        if (quota == null) return true
        val otherReservations = transfer.snapshot()
            .filter { OfflinePolicy.key(it.source, it.trackId) != identityKey }
            .filter { it.status == OfflineStatus.QUEUED || it.status == OfflineStatus.DOWNLOADING }
            .sumOf { maxOf(it.totalBytes, it.downloadedBytes) }
        return OfflineQuota.admits(quota, dao.readyCacheBlobs().sumOf { it.byteLength }, otherReservations, requestedBytes)
    }

    private fun removeOperation(active: OfflineEntry?, operationId: String) {
        if (active != null) {
            transferAuthorizations.clear(active.source, active.trackId)
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

    /** A corrupt/missing ready file is never kept as a false cache hit. */
    private fun repairReadyEntries() {
        val dao = LibraryDatabaseRegistry.get(app).libraryDao()
        dao.readyCacheBlobs().forEach { blob ->
            if (repository.readyFile(blob.blobKey) == null) removeBlob(blob)
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
        File(root, blob.privateRelativeKey).delete()
        synchronized(cacheAuthorizations) { cacheAuthorizations.remove(blob.blobKey) }
        synchronized(localReceiptGrants) { localReceiptGrants.remove(blob.blobKey) }
    }

    private fun isAuthorized(blobKey: String): Boolean {
        val localExpiry = synchronized(localReceiptGrants) { localReceiptGrants[blobKey] }
        if (localExpiry != null) {
            val receipt = repository.authorization(blobKey)
            if (receipt != null && OfflineAuthorizationPolicy.permits(
                    receipt,
                    repository.authority(receipt.source),
                    receipt.source,
                    receipt.semanticTrackId,
                    System.currentTimeMillis(),
                ) && receipt.authorizationExpiresAt == localExpiry) return true
            synchronized(localReceiptGrants) { localReceiptGrants.remove(blobKey) }
        }
        val grant = synchronized(cacheAuthorizations) { cacheAuthorizations[blobKey] } ?: return false
        val current = MediaLeaseRegistryHolder.current()?.isCurrentCacheAuthorization(grant) == true
        if (!current) synchronized(cacheAuthorizations) { cacheAuthorizations.remove(blobKey) }
        return current
    }

    private fun publish() {
        val next = snapshot()
        synchronized(listeners) { listeners.toList() }.forEach { it(next) }
    }

    companion object {
        private const val RECEIPT_TTL_MILLIS = 7L * 24 * 60 * 60 * 1000
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

/**
 * Process-local, operation-bound authorization book. A replacement attempt cannot consume a
 * late completion's authority because [consume] removes only an identical operation id.
 */
internal class TransferAuthorizationBook {
    private data class Binding(val operationId: String, val grant: CacheAuthorization)
    private val bindings = mutableMapOf<String, Binding>()

    @Synchronized fun install(entry: OfflineEntry, grant: CacheAuthorization): Boolean {
        if (entry.source != grant.identity.source || entry.trackId != grant.identity.trackId) return false
        bindings[OfflinePolicy.key(entry.source, entry.trackId)] = Binding(entry.operationId, grant)
        return true
    }

    @Synchronized fun consume(entry: OfflineEntry): CacheAuthorization? {
        val key = OfflinePolicy.key(entry.source, entry.trackId)
        val binding = bindings[key] ?: return null
        if (binding.operationId != entry.operationId) return null
        bindings.remove(key)
        return binding.grant
    }

    @Synchronized fun clear(source: String, trackId: String) { bindings.remove(OfflinePolicy.key(source, trackId)) }
    @Synchronized fun hasBinding(source: String, trackId: String): Boolean = bindings.containsKey(OfflinePolicy.key(source, trackId))
}

/** Durable receipt policy is pure so reopen/TTL/account fixtures do not need a transport. */
internal object OfflineAuthorizationPolicy {
    fun permits(
        receipt: com.listen2mobile.library.CacheCatalogEntity,
        authority: com.listen2mobile.library.OfflineAuthorityEntity?,
        source: String,
        trackId: String,
        now: Long,
    ): Boolean {
        if (receipt.source != source || receipt.semanticTrackId != trackId || authority?.source != source ||
            receipt.authorizationIssuedAt > now || receipt.authorizationExpiresAt <= now || authority.expiresAt <= now
        ) return false
        return when (receipt.entitlementStatus) {
            "anonymous-free" -> receipt.accountGeneration == 0L && authority.authState == "anonymous-free" && authority.generation == 0L
            "account-bound" -> receipt.accountGeneration > 0L && authority.authState == "account-bound" && authority.generation == receipt.accountGeneration
            else -> false
        }
    }
}
