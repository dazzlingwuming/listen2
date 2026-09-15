package com.listen2mobile.library

import android.content.Context
import androidx.room.Room

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
            "addTrack", "removeTrack", "favorite", "unfavorite" -> playlistId?.let(idPattern::matches) != null && source in setOf("netease", "kugou", "kuwo", "qq", "bilibili") && trackId?.let(idPattern::matches) != null && when (operation) {
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
internal data class LibrarySnapshot(val schemaVersion: Int, val revision: Long, val personalPlaylists: List<SafePlaylist>, val favorites: List<SafeTrack>)
internal data class LibraryReceipt(val requestId: String, val status: String, val revision: Long, val errorCode: String? = null, val snapshot: LibrarySnapshot? = null)

/** All writes are serialized by Room's transaction. Replaying a request id returns its original receipt. */
internal class LibraryRepository internal constructor(private val database: Listen2Database) {
    fun snapshot(): LibrarySnapshot = database.runInTransaction<LibrarySnapshot> { snapshotLocked() }

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

    private fun snapshotLocked(): LibrarySnapshot {
        val dao = database.libraryDao()
        val meta = dao.meta() ?: LibraryMetaEntity(revision = 0L)
        val playlists = dao.playlists(LibraryLimits.MAX_PLAYLISTS).map { playlist ->
            SafePlaylist(playlist.playlistId, playlist.title, playlist.position, dao.memberships(playlist.playlistId).map { SafeTrack(it.source, it.semanticTrackId, it.title, it.artist) })
        }
        return LibrarySnapshot(1, meta.revision, playlists, dao.favorites().map { SafeTrack(it.source, it.semanticTrackId, it.title, it.artist) })
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

    companion object {
        fun open(context: Context): LibraryRepository = LibraryRepository(
            Room.databaseBuilder(context.applicationContext, Listen2Database::class.java, "listen2-library-01.db").build(),
        )
    }
}
