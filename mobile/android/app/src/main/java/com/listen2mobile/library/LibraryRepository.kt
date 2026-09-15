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
    val playlistId: String,
    val title: String,
)

internal sealed class LibraryValidation {
    data class Accepted(val mutation: LibraryMutation) : LibraryValidation()
    data class Rejected(val errorCode: String) : LibraryValidation()
}

/** Validation happens before a Room transaction and accepts only the first durable operation set. */
internal object LibraryMutationValidator {
    private val idPattern = Regex("^[A-Za-z0-9_-]{1,64}$")
    fun validate(requestId: String, expectedRevision: Long, operation: String, payload: Map<String, String>): LibraryValidation {
        if (requestId.length !in 1..LibraryLimits.MAX_REQUEST_ID || !idPattern.matches(requestId) || expectedRevision < 0) return LibraryValidation.Rejected("INVALID_REQUEST")
        if (operation != "createPlaylist" || payload.keys != setOf("playlistId", "title")) return LibraryValidation.Rejected("UNSUPPORTED_OPERATION")
        val playlistId = payload["playlistId"] ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        val title = payload["title"]?.trim() ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        if (!idPattern.matches(playlistId) || title.isEmpty() || title.length > LibraryLimits.MAX_TITLE) return LibraryValidation.Rejected("INVALID_REQUEST")
        return LibraryValidation.Accepted(LibraryMutation(requestId, expectedRevision, operation, playlistId, title))
    }
}

internal data class SafePlaylist(val playlistId: String, val title: String, val position: Int)
internal data class LibrarySnapshot(val schemaVersion: Int, val revision: Long, val personalPlaylists: List<SafePlaylist>)
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
        if (dao.playlist(mutation.playlistId) != null || dao.playlists(LibraryLimits.MAX_PLAYLISTS + 1).size >= LibraryLimits.MAX_PLAYLISTS) {
            val receipt = MutationReceiptEntity(mutation.requestId, "rejected", current.revision, "DUPLICATE_OR_LIMIT")
            dao.insertReceipt(receipt)
            return@runInTransaction LibraryReceipt(receipt.requestId, receipt.status, receipt.revision, receipt.errorCode, snapshotLocked())
        }
        val nextRevision = current.revision + 1
        dao.insertPlaylist(PersonalPlaylistEntity(mutation.playlistId, mutation.title, dao.playlists(LibraryLimits.MAX_PLAYLISTS).size))
        dao.updateMeta(LibraryMetaEntity(revision = nextRevision))
        val receipt = MutationReceiptEntity(mutation.requestId, "applied", nextRevision, null)
        dao.insertReceipt(receipt)
        LibraryReceipt(receipt.requestId, receipt.status, receipt.revision, snapshot = snapshotLocked())
    }

    private fun snapshotLocked(): LibrarySnapshot {
        val dao = database.libraryDao()
        val meta = dao.meta() ?: LibraryMetaEntity(revision = 0L)
        return LibrarySnapshot(1, meta.revision, dao.playlists(LibraryLimits.MAX_PLAYLISTS).map { SafePlaylist(it.playlistId, it.title, it.position) })
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
