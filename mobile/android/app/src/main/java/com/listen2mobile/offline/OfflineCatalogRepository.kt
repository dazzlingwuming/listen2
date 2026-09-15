package com.listen2mobile.offline

import android.content.Context
import com.listen2mobile.library.CacheBlobEntity
import com.listen2mobile.library.CacheCatalogEntity
import com.listen2mobile.library.CacheOwnerEntity
import com.listen2mobile.library.Listen2Database
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import androidx.sqlite.db.SimpleSQLiteQuery
import com.listen2mobile.audiofx.LoudnessPolicy
import kotlin.math.pow

enum class OfflineOwnerKind { TEMPORARY, PLAYLIST, EXPLICIT }

/** Stable semantic identity; it deliberately excludes URLs, cookies, local paths and account data. */
data class OfflineCatalogIdentity(
    val source: String,
    val semanticTrackId: String,
    val partId: String?,
    val renditionId: String,
    val mediaRevision: String,
) {
    fun cacheId() = sha256(listOf(source, semanticTrackId, partId ?: "", renditionId, mediaRevision).joinToString("\u0000"))
    private fun sha256(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}

internal data class OfflineCatalogResult(val status: String, val blobKey: String? = null)

/**
 * Room is authoritative. Files are private relative keys only: a partial is never placed below an
 * owner root, so the provider cannot accidentally turn an interrupted transfer into media.
 */
internal class OfflineCatalogRepository(private val database: Listen2Database, private val root: File, private val now: () -> Long = { System.currentTimeMillis() }) {
    init { listOf("blobs", "attempts", "owners/temporary", "owners/playlist", "owners/explicit").forEach { File(root, it).mkdirs() } }

    fun ready(identity: OfflineCatalogIdentity, expectedHash: String, expectedLength: Long, mimeType: String, codec: String, staged: File, owner: OfflineOwnerKind, playlistId: String? = null): OfflineCatalogResult {
        if (expectedHash.length != 64 || expectedLength <= 0 || !staged.isFile || staged.length() != expectedLength || hash(staged) != expectedHash || !mediaSignature(staged)) return OfflineCatalogResult("VERIFY_FAILED")
        val blob = CacheBlobEntity.ready(identity, expectedHash, expectedLength, mimeType, codec)
        val destination = File(root, blob.privateRelativeKey)
        destination.parentFile?.mkdirs()
        try { if (!destination.exists()) atomicMove(staged, destination) else staged.delete() } catch (_: IOException) { return OfflineCatalogResult("STORAGE_FAILED") }
        if (!destination.isFile || destination.length() != expectedLength || !canRead(destination)) return OfflineCatalogResult("VERIFY_FAILED")
        database.runInTransaction {
            val dao = database.libraryDao()
            dao.putCacheCatalog(CacheCatalogEntity(identity.cacheId(), identity.source, identity.semanticTrackId, identity.partId, identity.renditionId, identity.mediaRevision, "ready", now()))
            dao.putCacheBlob(blob.copy(lastUsedAt = now(), verifiedAt = now()))
            val row = when (owner) { OfflineOwnerKind.TEMPORARY -> CacheOwnerEntity.temporary(blob.blobKey, now()); OfflineOwnerKind.EXPLICIT -> CacheOwnerEntity.explicit(blob.blobKey, now()); OfflineOwnerKind.PLAYLIST -> CacheOwnerEntity.playlist(blob.blobKey, playlistId ?: return@runInTransaction, now()) }
            dao.putCacheOwner(row)
        }
        val ownerRow = database.libraryDao().cacheOwners(blob.blobKey).firstOrNull { it.kind == owner && (owner != OfflineOwnerKind.PLAYLIST || it.ownerKey == "playlist:$playlistId") } ?: return OfflineCatalogResult("OWNER_FAILED")
        val alias = File(root, ownerRow.aliasRelativeKey); alias.parentFile?.mkdirs(); if (!alias.exists()) destination.copyTo(alias)
        return OfflineCatalogResult("READY", blob.blobKey)
    }

    fun addOwner(blobKey: String, owner: OfflineOwnerKind, playlistId: String? = null): OfflineCatalogResult {
        val blob = database.libraryDao().cacheBlob(blobKey) ?: return OfflineCatalogResult("NOT_FOUND")
        if (blob.state != "ready" || !canRead(File(root, blob.privateRelativeKey))) return OfflineCatalogResult("REPAIR_REQUIRED")
        val row = when (owner) { OfflineOwnerKind.TEMPORARY -> CacheOwnerEntity.temporary(blobKey, now()); OfflineOwnerKind.EXPLICIT -> CacheOwnerEntity.explicit(blobKey, now()); OfflineOwnerKind.PLAYLIST -> CacheOwnerEntity.playlist(blobKey, playlistId ?: return OfflineCatalogResult("INVALID_REQUEST"), now()) }
        database.libraryDao().putCacheOwner(row)
        val alias = File(root, row.aliasRelativeKey); alias.parentFile?.mkdirs(); File(root, blob.privateRelativeKey).copyTo(alias, overwrite = true)
        return OfflineCatalogResult("READY", blobKey)
    }

    fun removeOwner(blobKey: String, ownerKey: String): OfflineCatalogResult {
        val dao = database.libraryDao(); val owner = dao.cacheOwners(blobKey).firstOrNull { it.ownerKey == ownerKey } ?: return OfflineCatalogResult("NOT_FOUND")
        database.runInTransaction { dao.deleteCacheOwner(blobKey, ownerKey) }
        File(root, owner.aliasRelativeKey).delete()
        return OfflineCatalogResult("REMOVED", blobKey)
    }

    fun readyFile(blobKey: String, accountGeneration: Long, authorized: Boolean): File? {
        if (!authorized || accountGeneration < 0) return null
        val blob = database.libraryDao().cacheBlob(blobKey) ?: return null
        if (blob.state != "ready" || database.libraryDao().cacheOwners(blobKey).isEmpty()) return null
        val file = File(root, blob.privateRelativeKey)
        return file.takeIf { canRead(it) && it.length() == blob.byteLength && hash(it) == blob.contentHash }
    }

    /** A metric may cross the cache boundary only when every content identity component matches. */
    fun normalizationGain(blobKey: String, sampleRate: Int, codec: String): Double {
        val blob = database.libraryDao().cacheBlob(blobKey) ?: return 1.0
        val identity = LoudnessPolicy.Identity(blob.contentHash, sampleRate, codec)
        if (!identity.isValid()) return 1.0
        database.openHelper.readableDatabase.query(SimpleSQLiteQuery(
            "SELECT sampleRate, codec, gainDb, status FROM cache_analysis WHERE contentHash = ? AND analyzerVersion = ? LIMIT 1",
            arrayOf<Any>(blob.contentHash, LoudnessPolicy.ANALYZER_VERSION),
        )).use { cursor ->
            if (!cursor.moveToFirst() || cursor.getString(3) != "complete") return 1.0
            val stored = LoudnessPolicy.Identity(blob.contentHash, cursor.getInt(0), cursor.getString(1))
            if (!LoudnessPolicy.reusable(stored, identity) || cursor.isNull(2)) return 1.0
            val gain = 10.0.pow(cursor.getDouble(2) / 20.0)
            return if (gain.isFinite()) gain.coerceIn(0.0, 4.0) else 1.0
        }
    }

    /** Lookup remains content-addressed: a stored codec/sample-rate pair must still match this blob. */
    fun normalizationGain(blobKey: String): Double {
        val blob = database.libraryDao().cacheBlob(blobKey) ?: return 1.0
        database.openHelper.readableDatabase.query(
            SimpleSQLiteQuery(
                "SELECT sampleRate, codec FROM cache_analysis WHERE contentHash = ? AND analyzerVersion = ? AND status = 'complete' LIMIT 1",
                arrayOf<Any>(blob.contentHash, LoudnessPolicy.ANALYZER_VERSION),
            ),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return 1.0
            return normalizationGain(blobKey, cursor.getInt(0), cursor.getString(1))
        }
    }

    /** Persist only bounded numeric results; decoded samples never enter Room or JS. */
    fun recordLoudness(identity: LoudnessPolicy.Identity, metrics: LoudnessPolicy.Metrics?) {
        if (!identity.isValid()) return
        val status = if (metrics == null) "failed" else "complete"
        val db = database.openHelper.writableDatabase
        db.execSQL(
            "INSERT OR REPLACE INTO cache_analysis(contentHash, analyzerVersion, sampleRate, codec, lufs, dbtp, gainDb, status, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            arrayOf<Any?>(identity.contentHash, identity.analyzerVersion, identity.sampleRate, identity.codec, metrics?.lufs, metrics?.truePeakDbtp, metrics?.gainDb, status, now()),
        )
    }

    private fun canRead(file: File) = try { FileInputStream(file).use { it.read() >= 0 } } catch (_: IOException) { false }
    private fun hash(file: File) = FileInputStream(file).use { input -> val digest = MessageDigest.getInstance("SHA-256"); val bytes = ByteArray(8192); while (true) { val count = input.read(bytes); if (count < 0) break; digest.update(bytes, 0, count) }; digest.digest().joinToString("") { "%02x".format(it) } }
    private fun mediaSignature(file: File) = FileInputStream(file).use { input -> val header = ByteArray(12); val count = input.read(header); count >= 3 && ((header[0].toInt() == 'I'.code && header[1].toInt() == 'D'.code && header[2].toInt() == '3'.code) || (header[0].toInt() and 0xff == 0xff)) }
    private fun atomicMove(from: File, to: File) { FileOutputStream(from, true).fd.sync(); if (!from.renameTo(to)) throw IOException("ATOMIC_MOVE_FAILED") }
}
