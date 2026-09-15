package com.listen2mobile.library

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Version one is intentionally exported. New versions must add an explicit migration; this
 * database is the sole relational owner and never uses destructive fallback.
 */
@Database(
    entities = [
        LibraryMetaEntity::class,
        PersonalPlaylistEntity::class,
        PlaylistMembershipEntity::class,
        FavoriteEntity::class,
        RemoteCollectionEntity::class,
        QueueCheckpointEntity::class,
        LyricMetadataEntity::class,
        LocalRecordEntity::class,
        HistoryEvidenceEntity::class,
        HistoryAggregateEntity::class,
        HistoryStateEntity::class,
        HistorySessionEntity::class,
        HistoryEventEntity::class,
        MutationReceiptEntity::class,
        MigrationJournalEntity::class,
        CacheCatalogEntity::class,
    ],
    version = 3,
    exportSchema = true,
)
abstract class Listen2Database : RoomDatabase() {
    abstract fun libraryDao(): LibraryDao
}

@Entity(tableName = "library_meta")
data class LibraryMetaEntity(@PrimaryKey val id: Int = 1, val revision: Long)

@Entity(tableName = "personal_playlists")
data class PersonalPlaylistEntity(
    @PrimaryKey val playlistId: String,
    val title: String,
    val position: Int,
)

/** A playlist cannot contain the same provider semantic track twice; queue rows deliberately can. */
@Entity(tableName = "playlist_memberships", primaryKeys = ["playlistId", "source", "semanticTrackId"])
data class PlaylistMembershipEntity(
    val playlistId: String,
    val source: String,
    val semanticTrackId: String,
    val position: Int,
    val title: String,
    val artist: String,
)

@Entity(tableName = "favorites", primaryKeys = ["source", "semanticTrackId"])
data class FavoriteEntity(val source: String, val semanticTrackId: String, val title: String, val artist: String)

@Entity(tableName = "remote_collections")
data class RemoteCollectionEntity(@PrimaryKey val collectionId: String, val source: String, val title: String, val syncState: String)

@Entity(tableName = "queue_checkpoint")
data class QueueCheckpointEntity(@PrimaryKey val occurrenceId: String, val position: Int, val source: String, val semanticTrackId: String)

@Entity(tableName = "lyric_metadata", primaryKeys = ["source", "semanticTrackId"])
data class LyricMetadataEntity(val source: String, val semanticTrackId: String, val selectedVariantId: String?, val offsetMillis: Long)

/** Never stores a third-party content URI, path, grant, bookmark, or playable media URL. */
@Entity(tableName = "local_records")
data class LocalRecordEntity(
    @PrimaryKey val localRecordId: String,
    val title: String,
    val artist: String,
    val accessState: String,
    val album: String? = null,
    val durationMs: Long? = null,
    val hasArtwork: Boolean = false,
    val lyricState: String = "none",
)

@Entity(tableName = "history_evidence")
data class HistoryEvidenceEntity(@PrimaryKey val occurrenceId: String, val source: String, val semanticTrackId: String, val committedAtEpochDay: Long)

@Entity(tableName = "history_aggregates", primaryKeys = ["year", "source", "semanticTrackId"])
data class HistoryAggregateEntity(
    val year: Int,
    val source: String,
    val semanticTrackId: String,
    val playCount: Int,
    val title: String = "",
    val artist: String = "",
)

/** These rows contain only semantic listening evidence, never URLs, handles, sessions, or media bytes. */
@Entity(tableName = "history_state")
data class HistoryStateEntity(@PrimaryKey val id: Int = 1, val clearGeneration: Long, val revision: Long)

@Entity(tableName = "history_sessions", primaryKeys = ["playbackInstanceId", "clearGeneration"])
data class HistorySessionEntity(
    val playbackInstanceId: String,
    val clearGeneration: Long,
    val source: String,
    val semanticTrackId: String,
    val title: String,
    val artist: String,
    val durationMs: Long,
    val startedElapsedMs: Long,
    val lastSequence: Long,
    val lastPositionMs: Long,
    val lastElapsedMs: Long,
    val listenedForwardMs: Long,
    val tracking: Boolean,
)

@Entity(tableName = "history_events")
data class HistoryEventEntity(
    @PrimaryKey val eventId: String,
    val playbackInstanceId: String,
    val clearGeneration: Long,
    val source: String,
    val semanticTrackId: String,
    val title: String,
    val artist: String,
    val committedLocalDate: String,
    val committedLocalYear: Int,
    val committedLocalMonth: Int,
    val listenedForwardMs: Long,
    val thresholdMs: Long,
)

@Entity(tableName = "mutation_receipts")
data class MutationReceiptEntity(@PrimaryKey val requestId: String, val status: String, val revision: Long, val errorCode: String?)

@Entity(tableName = "migration_journal")
data class MigrationJournalEntity(@PrimaryKey val attemptId: String, val phase: String, val checksum: String?, val sourceRetained: Boolean)

/** Schema only in Phase 6; media bytes, quota, download, eviction and offline behavior are Phase 7. */
@Entity(tableName = "cache_catalog")
data class CacheCatalogEntity(@PrimaryKey val cacheId: String, val source: String, val semanticTrackId: String, val state: String)

@Dao
interface LibraryDao {
    @Query("SELECT * FROM library_meta WHERE id = 1") fun meta(): LibraryMetaEntity?
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertMeta(value: LibraryMetaEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun updateMeta(value: LibraryMetaEntity)
    @Query("SELECT * FROM mutation_receipts WHERE requestId = :requestId") fun receipt(requestId: String): MutationReceiptEntity?
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertReceipt(value: MutationReceiptEntity)
    @Query("SELECT * FROM personal_playlists WHERE playlistId = :playlistId") fun playlist(playlistId: String): PersonalPlaylistEntity?
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertPlaylist(value: PersonalPlaylistEntity)
    @Query("SELECT * FROM personal_playlists ORDER BY position ASC, playlistId ASC LIMIT :limit") fun playlists(limit: Int): List<PersonalPlaylistEntity>
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertMembership(value: PlaylistMembershipEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putMembership(value: PlaylistMembershipEntity)
    @Query("SELECT * FROM playlist_memberships WHERE playlistId = :playlistId ORDER BY position ASC, semanticTrackId ASC") fun memberships(playlistId: String): List<PlaylistMembershipEntity>
    @Query("SELECT * FROM playlist_memberships WHERE playlistId = :playlistId AND source = :source AND semanticTrackId = :trackId") fun membership(playlistId: String, source: String, trackId: String): PlaylistMembershipEntity?
    @Query("DELETE FROM playlist_memberships WHERE playlistId = :playlistId AND source = :source AND semanticTrackId = :trackId") fun deleteMembership(playlistId: String, source: String, trackId: String)
    @Query("DELETE FROM playlist_memberships WHERE playlistId = :playlistId") fun deleteMemberships(playlistId: String)
    @Query("DELETE FROM playlist_memberships") fun deleteAllMemberships()
    @Query("DELETE FROM personal_playlists WHERE playlistId = :playlistId") fun deletePlaylist(playlistId: String)
    @Query("DELETE FROM personal_playlists") fun deleteAllPlaylists()
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertQueue(value: QueueCheckpointEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putQueue(value: QueueCheckpointEntity)
    @Query("SELECT * FROM queue_checkpoint WHERE occurrenceId = :occurrenceId") fun queue(occurrenceId: String): QueueCheckpointEntity?
    @Query("SELECT * FROM queue_checkpoint ORDER BY position ASC, occurrenceId ASC") fun queueCheckpoint(): List<QueueCheckpointEntity>
    @Query("DELETE FROM queue_checkpoint") fun deleteAllQueue()
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putFavorite(value: FavoriteEntity)
    @Query("SELECT * FROM favorites ORDER BY source ASC, semanticTrackId ASC") fun favorites(): List<FavoriteEntity>
    @Query("SELECT * FROM favorites WHERE source = :source AND semanticTrackId = :trackId") fun favorite(source: String, trackId: String): FavoriteEntity?
    @Query("DELETE FROM favorites WHERE source = :source AND semanticTrackId = :trackId") fun deleteFavorite(source: String, trackId: String)
    @Query("DELETE FROM favorites") fun deleteAllFavorites()
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putRemoteCollection(value: RemoteCollectionEntity)
    @Query("SELECT * FROM remote_collections ORDER BY source ASC, title ASC, collectionId ASC") fun remoteCollections(): List<RemoteCollectionEntity>
    @Query("DELETE FROM remote_collections") fun deleteAllRemoteCollections()
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putLocalRecord(value: LocalRecordEntity)
    @Query("SELECT * FROM local_records WHERE localRecordId = :recordId") fun localRecord(recordId: String): LocalRecordEntity?
    @Query("DELETE FROM local_records WHERE localRecordId = :recordId") fun deleteLocalRecord(recordId: String)
    @Query("DELETE FROM playlist_memberships WHERE source = 'local' AND semanticTrackId = :recordId") fun deleteLocalMemberships(recordId: String)
    @Query("DELETE FROM favorites WHERE source = 'local' AND semanticTrackId = :recordId") fun deleteLocalFavorite(recordId: String)
    @Query("DELETE FROM queue_checkpoint WHERE source = 'local' AND semanticTrackId = :recordId") fun deleteLocalQueueEntries(recordId: String)
    @Query("DELETE FROM lyric_metadata WHERE source = 'local' AND semanticTrackId = :recordId") fun deleteLocalLyricMetadata(recordId: String)
    @Query("SELECT * FROM local_records ORDER BY localRecordId ASC") fun localRecords(): List<LocalRecordEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putLyricMetadata(value: LyricMetadataEntity)
    @Query("SELECT * FROM lyric_metadata ORDER BY source ASC, semanticTrackId ASC") fun lyricMetadata(): List<LyricMetadataEntity>
    @Query("DELETE FROM lyric_metadata") fun deleteAllLyricMetadata()
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putMigrationJournal(value: MigrationJournalEntity)
    @Query("SELECT * FROM migration_journal WHERE attemptId = :attemptId") fun migrationJournal(attemptId: String): MigrationJournalEntity?
    @Query("DELETE FROM personal_playlists WHERE playlistId LIKE :prefix || '%'") fun deleteStagedPlaylists(prefix: String)
    @Query("DELETE FROM local_records WHERE localRecordId LIKE :prefix || '%'") fun deleteStagedLocalRecords(prefix: String)
    @Query("SELECT * FROM local_records WHERE localRecordId LIKE :prefix || '%' ORDER BY localRecordId ASC") fun localRecordsByPrefix(prefix: String): List<LocalRecordEntity>
    @Query("SELECT * FROM history_state WHERE id = 1") fun historyState(): HistoryStateEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putHistoryState(value: HistoryStateEntity)
    @Query("SELECT * FROM history_sessions WHERE playbackInstanceId = :instanceId AND clearGeneration = :generation") fun historySession(instanceId: String, generation: Long): HistorySessionEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putHistorySession(value: HistorySessionEntity)
    @Query("DELETE FROM history_sessions WHERE playbackInstanceId = :instanceId AND clearGeneration = :generation") fun deleteHistorySession(instanceId: String, generation: Long)
    @Query("SELECT * FROM history_events WHERE playbackInstanceId = :instanceId AND clearGeneration = :generation LIMIT 1") fun historyEventForSession(instanceId: String, generation: Long): HistoryEventEntity?
    @Query("SELECT * FROM history_events WHERE committedLocalYear = :year ORDER BY committedLocalDate ASC, eventId ASC LIMIT :limit") fun historyEventsForYear(year: Int, limit: Int): List<HistoryEventEntity>
    @Query("SELECT * FROM history_events ORDER BY committedLocalDate DESC, eventId DESC LIMIT :limit") fun historyEvents(limit: Int): List<HistoryEventEntity>
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertHistoryEvent(value: HistoryEventEntity)
    @Query("SELECT * FROM history_aggregates WHERE year = :year AND source = :source AND semanticTrackId = :trackId") fun historyAggregate(year: Int, source: String, trackId: String): HistoryAggregateEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putHistoryAggregate(value: HistoryAggregateEntity)
    @Query("DELETE FROM history_sessions") fun clearHistorySessions()
    @Query("DELETE FROM history_events") fun clearHistoryEvents()
    @Query("DELETE FROM history_aggregates") fun clearHistoryAggregates()
}

internal val LIBRARY_MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE local_records ADD COLUMN album TEXT")
        database.execSQL("ALTER TABLE local_records ADD COLUMN durationMs INTEGER")
        database.execSQL("ALTER TABLE local_records ADD COLUMN hasArtwork INTEGER NOT NULL DEFAULT 0")
        database.execSQL("ALTER TABLE local_records ADD COLUMN lyricState TEXT NOT NULL DEFAULT 'none'")
    }
}

internal val LIBRARY_MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE history_aggregates ADD COLUMN title TEXT NOT NULL DEFAULT ''")
        database.execSQL("ALTER TABLE history_aggregates ADD COLUMN artist TEXT NOT NULL DEFAULT ''")
        database.execSQL("CREATE TABLE IF NOT EXISTS history_state (id INTEGER NOT NULL, clearGeneration INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(id))")
        database.execSQL("CREATE TABLE IF NOT EXISTS history_sessions (playbackInstanceId TEXT NOT NULL, clearGeneration INTEGER NOT NULL, source TEXT NOT NULL, semanticTrackId TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, durationMs INTEGER NOT NULL, startedElapsedMs INTEGER NOT NULL, lastSequence INTEGER NOT NULL, lastPositionMs INTEGER NOT NULL, lastElapsedMs INTEGER NOT NULL, listenedForwardMs INTEGER NOT NULL, tracking INTEGER NOT NULL, PRIMARY KEY(playbackInstanceId, clearGeneration))")
        database.execSQL("CREATE TABLE IF NOT EXISTS history_events (eventId TEXT NOT NULL, playbackInstanceId TEXT NOT NULL, clearGeneration INTEGER NOT NULL, source TEXT NOT NULL, semanticTrackId TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, committedLocalDate TEXT NOT NULL, committedLocalYear INTEGER NOT NULL, committedLocalMonth INTEGER NOT NULL, listenedForwardMs INTEGER NOT NULL, thresholdMs INTEGER NOT NULL, PRIMARY KEY(eventId))")
    }
}
