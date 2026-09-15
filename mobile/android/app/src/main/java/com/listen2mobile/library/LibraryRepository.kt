package com.listen2mobile.library

import android.content.Context
import androidx.room.Room
import java.security.MessageDigest
import java.util.UUID

internal object LibraryLimits {
    const val MAX_REQUEST_ID = 96
    const val MAX_TITLE = 128
    const val MAX_PLAYLISTS = 2_000
}

internal object LibraryIdentity {
    fun sameTrack(leftSource: String, leftTrackId: String, rightSource: String, rightTrackId: String) =
        leftSource == rightSource && leftTrackId == rightTrackId
}

internal data class LibraryMutation(
    val requestId: String,
    val expectedRevision: Long,
    val operation: String,
    val payload: Map<String, String>,
) {
    val playlistId: String get() = payload["playlistId"] ?: ""
    val title: String get() = payload["title"] ?: ""
    constructor(requestId: String, expectedRevision: Long, operation: String, playlistId: String, title: String) : this(
        requestId, expectedRevision, operation, mapOf("playlistId" to playlistId, "title" to title),
    )
}

internal sealed class LibraryValidation {
    data class Accepted(val mutation: LibraryMutation) : LibraryValidation()
    data class Rejected(val errorCode: String) : LibraryValidation()
}

/** Validation happens before a Room transaction and accepts only the first durable operation set. */
internal object LibraryMutationValidator {
    private val idPattern = Regex("^[A-Za-z0-9_-]{1,64}$")
    fun validate(requestId: String, expectedRevision: Long, operation: String, payload: Map<String, String>): LibraryValidation {
        if (requestId.length !in 1..LibraryLimits.MAX_REQUEST_ID || !idPattern.matches(requestId) || expectedRevision < 0) return LibraryValidation.Rejected("INVALID_REQUEST")
        val playlistId = payload["playlistId"]
        val trackId = payload["trackId"]
        val source = payload["source"]
        val title = payload["title"]?.trim()
        val artist = payload["artist"]?.trim()
        val valid = when (operation) {
            "createPlaylist", "renamePlaylist" -> payload.keys == setOf("playlistId", "title") && playlistId != null && idPattern.matches(playlistId) && !title.isNullOrEmpty() && title.length <= LibraryLimits.MAX_TITLE
            "deletePlaylist" -> payload.keys == setOf("playlistId") && playlistId != null && idPattern.matches(playlistId)
            "movePlaylist" -> payload.keys == setOf("playlistId", "direction") && playlistId != null && idPattern.matches(playlistId) && payload["direction"] in setOf("up", "down")
            "addTrack", "removeTrack", "favorite", "unfavorite" -> playlistId?.let(idPattern::matches) != null && source in (if (operation in setOf("addTrack", "removeTrack")) setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") else setOf("netease", "kugou", "kuwo", "qq", "bilibili")) && trackId?.let(idPattern::matches) != null && when (operation) {
                "addTrack", "favorite" -> payload.keys == setOf("playlistId", "source", "trackId", "title", "artist") && !title.isNullOrEmpty() && !artist.isNullOrEmpty() && title.length <= LibraryLimits.MAX_TITLE && artist.length <= LibraryLimits.MAX_TITLE
                else -> payload.keys == setOf("playlistId", "source", "trackId")
            }
            else -> false
        }
        if (!valid) return LibraryValidation.Rejected(if (operation in setOf("createPlaylist", "renamePlaylist", "deletePlaylist", "movePlaylist", "addTrack", "removeTrack", "favorite", "unfavorite")) "INVALID_REQUEST" else "UNSUPPORTED_OPERATION")
        return LibraryValidation.Accepted(LibraryMutation(requestId, expectedRevision, operation, payload))
    }
}

internal data class SafeTrack(val source: String, val trackId: String, val title: String, val artist: String)
internal data class SafePlaylist(val playlistId: String, val title: String, val position: Int, val tracks: List<SafeTrack>)
internal data class SafeRemoteCollection(val collectionId: String, val source: String, val title: String, val syncState: String)
internal data class LibrarySnapshot(val schemaVersion: Int, val revision: Long, val personalPlaylists: List<SafePlaylist>, val favorites: List<SafeTrack>, val localRecords: List<SafeLocalRecord>, val remoteCollections: List<SafeRemoteCollection> = emptyList())
internal data class LibraryReceipt(val requestId: String, val status: String, val revision: Long, val errorCode: String? = null, val snapshot: LibrarySnapshot? = null)
internal data class SafeLocalRecord(
    val recordId: String,
    val title: String,
    val artist: String,
    val availability: String,
    val album: String? = null,
    val durationMs: Long? = null,
    val hasArtwork: Boolean = false,
    val lyricState: String = "none",
)
internal data class BackupPlaylistInput(val playlistId: String, val title: String, val tracks: List<SafeTrack>)
internal data class BackupInput(val expectedRevision: Long, val mode: String, val favorites: List<SafeTrack>, val playlists: List<BackupPlaylistInput>)
internal data class BackupPreview(val status: String, val token: String?, val checksum: String?, val baseRevision: Long, val addedFavorites: Int, val addedPlaylists: Int, val skippedPlaylists: Int, val conflictedPlaylists: Int, val errorCode: String? = null)
private data class PendingBackup(val checksum: String, val baseRevision: Long, val mode: String, val input: BackupInput, val createdAt: Long)
private data class PlannedBackup(val input: BackupInput, val addedFavorites: Int, val addedPlaylists: Int, val skippedPlaylists: Int, val conflictedPlaylists: Int)

/** All writes are serialized by Room's transaction. Replaying a request id returns its original receipt. */
internal class LibraryRepository internal constructor(private val database: Listen2Database) {
    private val pendingBackups = LinkedHashMap<String, PendingBackup>()
    fun snapshot(): LibrarySnapshot = database.runInTransaction<LibrarySnapshot> { snapshotLocked() }

    /** URI/grant association remains outside Room; Room receives only the opaque display record. */
    internal fun insertLocalRecords(records: List<SafeLocalRecord>): Pair<Int, Long> = database.runInTransaction<Pair<Int, Long>> {
        val dao = database.libraryDao()
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        val known = dao.localRecords().map { it.localRecordId }.toSet()
        records.filter { it.recordId !in known }.forEach { record ->
            dao.putLocalRecord(LocalRecordEntity(record.recordId, record.title, record.artist, record.availability, record.album, record.durationMs, record.hasArtwork, record.lyricState))
        }
        val added = records.count { it.recordId !in known }
        if (added > 0) dao.updateMeta(LibraryMetaEntity(revision = current.revision + 1))
        added to (if (added > 0) current.revision + 1 else current.revision)
    }

    /** LRC bytes live in native-private storage; Room retains only the safe attachment state. */
    internal fun attachExplicitLyric(recordId: String): Boolean = database.runInTransaction<Boolean> {
        val dao = database.libraryDao()
        val record = dao.localRecord(recordId) ?: return@runInTransaction false
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        dao.putLocalRecord(record.copy(lyricState = "attached"))
        dao.updateMeta(LibraryMetaEntity(revision = current.revision + 1))
        true
    }

    internal fun localRecord(recordId: String): SafeLocalRecord? = database.libraryDao().localRecord(recordId)?.let { record ->
        SafeLocalRecord(record.localRecordId, record.title, record.artist, record.accessState, record.album, record.durationMs, record.hasArtwork, record.lyricState)
    }

    internal fun repairLocalRecord(recordId: String, replacement: SafeLocalRecord): Boolean = database.runInTransaction<Boolean> {
        val dao = database.libraryDao(); val existing = dao.localRecord(recordId) ?: return@runInTransaction false
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        dao.putLocalRecord(existing.copy(title = replacement.title, artist = replacement.artist, album = replacement.album, durationMs = replacement.durationMs, hasArtwork = replacement.hasArtwork, accessState = "available"))
        dao.updateMeta(LibraryMetaEntity(revision = current.revision + 1)); true
    }

    /** Access failures retain the semantic record and its relations for a future repair. */
    internal fun markLocalAvailability(recordId: String, availability: String): Boolean = database.runInTransaction<Boolean> {
        if (availability !in setOf("needs-repair", "revoked", "unreadable", "unsupported")) return@runInTransaction false
        val dao = database.libraryDao(); val existing = dao.localRecord(recordId) ?: return@runInTransaction false
        if (existing.accessState == availability) return@runInTransaction true
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        dao.putLocalRecord(existing.copy(accessState = availability))
        dao.updateMeta(LibraryMetaEntity(revision = current.revision + 1)); true
    }

    internal fun removeLocalRecord(recordId: String): Boolean = database.runInTransaction<Boolean> {
        val dao = database.libraryDao(); if (dao.localRecord(recordId) == null) return@runInTransaction false
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        dao.deleteLocalMemberships(recordId); dao.deleteLocalFavorite(recordId); dao.deleteLocalQueueEntries(recordId)
        dao.deleteLocalLyricMetadata(recordId); dao.deleteLocalRecord(recordId)
        dao.updateMeta(LibraryMetaEntity(revision = current.revision + 1)); true
    }

    fun apply(mutation: LibraryMutation): LibraryReceipt = database.runInTransaction<LibraryReceipt> {
        val dao = database.libraryDao()
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        dao.receipt(mutation.requestId)?.let { return@runInTransaction LibraryReceipt(it.requestId, it.status, it.revision, it.errorCode, snapshotLocked()) }
        if (mutation.expectedRevision != current.revision) {
            return@runInTransaction LibraryReceipt(mutation.requestId, "stale", current.revision, "STALE_REVISION", snapshotLocked())
        }
        val payload = mutation.payload
        val playlistId = payload["playlistId"]!!
        val rejected = { code: String ->
            val receipt = MutationReceiptEntity(mutation.requestId, "rejected", current.revision, code)
            dao.insertReceipt(receipt)
            LibraryReceipt(receipt.requestId, receipt.status, receipt.revision, receipt.errorCode, snapshotLocked())
        }
        when (mutation.operation) {
            "createPlaylist" -> {
                if (dao.playlist(playlistId) != null || dao.playlists(LibraryLimits.MAX_PLAYLISTS + 1).size >= LibraryLimits.MAX_PLAYLISTS) return@runInTransaction rejected("DUPLICATE_OR_LIMIT")
                dao.insertPlaylist(PersonalPlaylistEntity(playlistId, payload["title"]!!, dao.playlists(LibraryLimits.MAX_PLAYLISTS).size))
            }
            "renamePlaylist" -> {
                val existing = dao.playlist(playlistId) ?: return@runInTransaction rejected("NOT_FOUND")
                dao.insertPlaylist(existing.copy(title = payload["title"]!!))
            }
            "deletePlaylist" -> {
                if (dao.playlist(playlistId) == null) return@runInTransaction rejected("NOT_FOUND")
                dao.deleteMemberships(playlistId)
                dao.deletePlaylist(playlistId)
            }
            "movePlaylist" -> {
                val ordered = dao.playlists(LibraryLimits.MAX_PLAYLISTS).toMutableList()
                val index = ordered.indexOfFirst { it.playlistId == playlistId }
                val target = if (payload["direction"] == "up") index - 1 else index + 1
                if (index < 0) return@runInTransaction rejected("NOT_FOUND")
                if (target !in ordered.indices) return@runInTransaction rejected("ORDER_BOUNDARY")
                val moved = ordered.removeAt(index); ordered.add(target, moved)
                ordered.forEachIndexed { position, item -> dao.insertPlaylist(item.copy(position = position)) }
            }
            "addTrack" -> {
                if (dao.playlist(playlistId) == null) return@runInTransaction rejected("NOT_FOUND")
                val source = payload["source"]!!; val trackId = payload["trackId"]!!
                if (dao.membership(playlistId, source, trackId) != null) return@runInTransaction rejected("DUPLICATE_TRACK")
                dao.insertMembership(PlaylistMembershipEntity(playlistId, source, trackId, dao.memberships(playlistId).size, payload["title"]!!, payload["artist"]!!))
            }
            "removeTrack" -> {
                val source = payload["source"]!!; val trackId = payload["trackId"]!!
                if (dao.membership(playlistId, source, trackId) == null) return@runInTransaction rejected("NOT_FOUND")
                dao.deleteMembership(playlistId, source, trackId)
                dao.memberships(playlistId).forEachIndexed { position, membership ->
                    dao.putMembership(membership.copy(position = position))
                }
            }
            "favorite" -> {
                val source = payload["source"]!!; val trackId = payload["trackId"]!!
                dao.putFavorite(FavoriteEntity(source, trackId, payload["title"]!!, payload["artist"]!!))
            }
            "unfavorite" -> {
                val source = payload["source"]!!; val trackId = payload["trackId"]!!
                if (dao.favorite(source, trackId) == null) return@runInTransaction rejected("NOT_FOUND")
                dao.deleteFavorite(source, trackId)
            }
            else -> return@runInTransaction rejected("UNSUPPORTED_OPERATION")
        }
        val nextRevision = current.revision + 1
        dao.updateMeta(LibraryMetaEntity(revision = nextRevision))
        val receipt = MutationReceiptEntity(mutation.requestId, "applied", nextRevision, null)
        dao.insertReceipt(receipt)
        LibraryReceipt(receipt.requestId, receipt.status, receipt.revision, snapshot = snapshotLocked())
    }

    /** Backup import never receives local/queue/history/cache/session entities, only safe semantic library rows. */
    fun previewBackup(input: BackupInput): BackupPreview = database.runInTransaction<BackupPreview> {
        val dao = database.libraryDao()
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        if (input.expectedRevision != current.revision) return@runInTransaction BackupPreview("stale", null, null, current.revision, 0, 0, 0, 0, "STALE_REVISION")
        if (!validBackup(input)) return@runInTransaction BackupPreview("rejected", null, null, current.revision, 0, 0, 0, 0, "INVALID_BACKUP")
        val planned = planBackup(input)
        val checksum = backupChecksum(planned.input)
        val token = UUID.randomUUID().toString().replace("-", "")
        while (pendingBackups.size >= 8) pendingBackups.remove(pendingBackups.entries.first().key)
        pendingBackups[token] = PendingBackup(checksum, current.revision, input.mode, planned.input, System.currentTimeMillis())
        BackupPreview("ready", token, checksum, current.revision, planned.addedFavorites, planned.addedPlaylists, planned.skippedPlaylists, planned.conflictedPlaylists)
    }

    fun applyBackup(token: String, checksum: String, expectedRevision: Long): LibraryReceipt = database.runInTransaction<LibraryReceipt> {
        val dao = database.libraryDao()
        val current = dao.meta() ?: LibraryMetaEntity(revision = 0L).also(dao::insertMeta)
        val pending = pendingBackups.remove(token)
            ?: return@runInTransaction LibraryReceipt(token, "rejected", current.revision, "PREVIEW_EXPIRED", snapshotLocked())
        if (pending.createdAt + 5 * 60_000L < System.currentTimeMillis() || pending.checksum != checksum || pending.baseRevision != expectedRevision || current.revision != expectedRevision)
            return@runInTransaction LibraryReceipt(token, "stale", current.revision, "STALE_REVISION", snapshotLocked())
        if (pending.mode == "overwrite") {
            dao.deleteAllMemberships(); dao.deleteAllPlaylists(); dao.deleteAllFavorites()
        }
        val existingIds = dao.playlists(LibraryLimits.MAX_PLAYLISTS).map { it.playlistId }.toMutableSet()
        pending.input.favorites.forEach { dao.putFavorite(FavoriteEntity(it.source, it.trackId, it.title, it.artist)) }
        pending.input.playlists.forEach { playlist ->
            // Preview normally remints merge collisions. Keep apply defensive so a
            // valid preview can never fail a transaction with a Room UNIQUE error.
            if (playlist.playlistId in existingIds && pending.mode == "merge") return@forEach
            if (playlist.playlistId in existingIds)
                return@runInTransaction LibraryReceipt(token, "rejected", current.revision, "DUPLICATE_PLAYLIST", snapshotLocked())
            dao.insertPlaylist(PersonalPlaylistEntity(playlist.playlistId, playlist.title, dao.playlists(LibraryLimits.MAX_PLAYLISTS).size))
            playlist.tracks.forEachIndexed { position, track -> dao.putMembership(PlaylistMembershipEntity(playlist.playlistId, track.source, track.trackId, position, track.title, track.artist)) }
            existingIds += playlist.playlistId
        }
        dao.playlists(LibraryLimits.MAX_PLAYLISTS).forEachIndexed { position, playlist -> dao.insertPlaylist(playlist.copy(position = position)) }
        val nextRevision = current.revision + 1
        dao.updateMeta(LibraryMetaEntity(revision = nextRevision))
        LibraryReceipt(token, "applied", nextRevision, snapshot = snapshotLocked())
    }

    private fun validBackup(input: BackupInput): Boolean = input.expectedRevision >= 0 && input.mode in setOf("merge", "overwrite") && input.playlists.size <= LibraryLimits.MAX_PLAYLISTS && input.playlists.map { it.playlistId }.distinct().size == input.playlists.size && input.favorites.size <= 50_000 &&
        (input.favorites + input.playlists.flatMap { it.tracks }).all { it.source in setOf("netease", "kugou", "kuwo", "qq", "bilibili") && it.trackId.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) && it.title.isNotBlank() && it.title.length <= LibraryLimits.MAX_TITLE && it.artist.isNotBlank() && it.artist.length <= LibraryLimits.MAX_TITLE } &&
        input.playlists.all { it.playlistId.matches(Regex("^[A-Za-z0-9_-]{1,64}$")) && it.title.isNotBlank() && it.title.length <= LibraryLimits.MAX_TITLE && it.tracks.size <= 5_000 && it.tracks.distinctBy { track -> "${track.source}:${track.trackId}" }.size == it.tracks.size }

    private fun planBackup(input: BackupInput): PlannedBackup {
        if (input.mode == "overwrite") return PlannedBackup(input, input.favorites.size, input.playlists.size, 0, 0)
        val existing = snapshotLocked()
        val existingFavoriteKeys = existing.favorites.map { "${it.source}:${it.trackId}" }.toSet()
        val incomingFavorites = input.favorites.distinctBy { "${it.source}:${it.trackId}" }
        val favorites = (existing.favorites + incomingFavorites).distinctBy { "${it.source}:${it.trackId}" }
        val usedIds = existing.personalPlaylists.map { it.playlistId }.toMutableSet()
        var skipped = 0
        var conflicted = 0
        val extra = input.playlists.filter { candidate ->
            existing.personalPlaylists.none { it.playlistId == candidate.playlistId && it.title == candidate.title && it.tracks == candidate.tracks }
        }.map { candidate ->
            var id = candidate.playlistId
            var suffix = 0
            if (id in usedIds) conflicted += 1
            while (id in usedIds) { suffix += 1; id = "myplaylist_import_${candidate.playlistId.take(48)}_$suffix" }
            usedIds += id
            candidate.copy(playlistId = id)
        }
        skipped = input.playlists.size - extra.size
        return PlannedBackup(BackupInput(input.expectedRevision, input.mode, favorites, extra), incomingFavorites.count { "${it.source}:${it.trackId}" !in existingFavoriteKeys }, extra.size, skipped, conflicted)
    }

    private fun backupChecksum(input: BackupInput): String {
        val stable = buildString {
            append(input.mode).append('|')
            input.favorites.sortedBy { "${it.source}:${it.trackId}" }.forEach { append(it.source).append(':').append(it.trackId).append(':').append(it.title).append(':').append(it.artist).append('|') }
            input.playlists.forEach { playlist -> append(playlist.playlistId).append(':').append(playlist.title).append('|'); playlist.tracks.forEach { append(it.source).append(':').append(it.trackId).append('|') } }
        }
        return MessageDigest.getInstance("SHA-256").digest(stable.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private fun snapshotLocked(): LibrarySnapshot {
        val dao = database.libraryDao()
        val meta = dao.meta() ?: LibraryMetaEntity(revision = 0L)
        val playlists = dao.playlists(LibraryLimits.MAX_PLAYLISTS).map { playlist ->
            SafePlaylist(playlist.playlistId, playlist.title, playlist.position, dao.memberships(playlist.playlistId).map { SafeTrack(it.source, it.semanticTrackId, it.title, it.artist) })
        }
        val locals = dao.localRecords().map { record ->
            SafeLocalRecord(record.localRecordId, record.title, record.artist, record.accessState, record.album, record.durationMs, record.hasArtwork, record.lyricState)
        }
        val remote = dao.remoteCollections().map { SafeRemoteCollection(it.collectionId, it.source, it.title, it.syncState) }
        return LibrarySnapshot(1, meta.revision, playlists, dao.favorites().map { SafeTrack(it.source, it.semanticTrackId, it.title, it.artist) }, locals, remote)
    }

    /** Internal migration entry point. It is deliberately not a React Native bridge capability. */
    internal fun stageLegacyCopy(attemptId: String, playlists: List<SafeLegacyPlaylist>, localRecords: List<SafeLegacyLocalRecord>, checksum: String): MigrationJournalEntity =
        database.runInTransaction<MigrationJournalEntity> {
            val dao = database.libraryDao()
            val prefix = "migration-$attemptId-"
            dao.deleteStagedPlaylists(prefix)
            dao.deleteStagedLocalRecords(prefix)
            playlists.forEachIndexed { index, item ->
                dao.insertPlaylist(PersonalPlaylistEntity("$prefix$index", item.title, index))
            }
            localRecords.forEachIndexed { index, item ->
                dao.putLocalRecord(LocalRecordEntity("$prefix$index", item.title, item.artist, "needs-repair"))
            }
            MigrationJournalEntity(attemptId, "validated", checksum, sourceRetained = true).also(dao::putMigrationJournal)
        }

    internal fun migrationJournal(attemptId: String): MigrationJournalEntity? = database.libraryDao().migrationJournal(attemptId)
    /** Native-only composition hook; no Room entity is exposed through the React bridge. */
    internal fun historyDatabase(): Listen2Database = database

    companion object {
        fun open(context: Context): LibraryRepository = LibraryRepository(
            Room.databaseBuilder(context.applicationContext, Listen2Database::class.java, "listen2-library-01.db").addMigrations(LIBRARY_MIGRATION_1_2, LIBRARY_MIGRATION_2_3).build(),
        )
    }
}
