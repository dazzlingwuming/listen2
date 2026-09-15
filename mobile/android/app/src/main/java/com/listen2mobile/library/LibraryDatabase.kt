package com.listen2mobile.library

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

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
        MutationReceiptEntity::class,
        MigrationJournalEntity::class,
        CacheCatalogEntity::class,
    ],
    version = 1,
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
data class LocalRecordEntity(@PrimaryKey val localRecordId: String, val title: String, val artist: String, val accessState: String)

@Entity(tableName = "history_evidence")
data class HistoryEvidenceEntity(@PrimaryKey val occurrenceId: String, val source: String, val semanticTrackId: String, val committedAtEpochDay: Long)

@Entity(tableName = "history_aggregates", primaryKeys = ["year", "source", "semanticTrackId"])
data class HistoryAggregateEntity(val year: Int, val source: String, val semanticTrackId: String, val playCount: Int)

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
    @Query("DELETE FROM personal_playlists WHERE playlistId = :playlistId") fun deletePlaylist(playlistId: String)
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertQueue(value: QueueCheckpointEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putFavorite(value: FavoriteEntity)
    @Query("SELECT * FROM favorites ORDER BY source ASC, semanticTrackId ASC") fun favorites(): List<FavoriteEntity>
    @Query("SELECT * FROM favorites WHERE source = :source AND semanticTrackId = :trackId") fun favorite(source: String, trackId: String): FavoriteEntity?
    @Query("DELETE FROM favorites WHERE source = :source AND semanticTrackId = :trackId") fun deleteFavorite(source: String, trackId: String)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putRemoteCollection(value: RemoteCollectionEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putLocalRecord(value: LocalRecordEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putLyricMetadata(value: LyricMetadataEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putMigrationJournal(value: MigrationJournalEntity)
    @Query("SELECT * FROM migration_journal WHERE attemptId = :attemptId") fun migrationJournal(attemptId: String): MigrationJournalEntity?
    @Query("DELETE FROM personal_playlists WHERE playlistId LIKE :prefix || '%'") fun deleteStagedPlaylists(prefix: String)
    @Query("DELETE FROM local_records WHERE localRecordId LIKE :prefix || '%'") fun deleteStagedLocalRecords(prefix: String)
}
