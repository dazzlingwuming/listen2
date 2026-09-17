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
import com.listen2mobile.offline.OfflineOwnerKind

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
        CacheBlobEntity::class,
        CacheOwnerEntity::class,
        CacheAttemptEntity::class,
        CacheRangeEntity::class,
        CacheQuotaEntity::class,
        CacheAnalysisEntity::class,
        OfflineAuthorityEntity::class,
    ],
    version = 6,
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

/** Projection rows used by the annual recap; they never materialize the event history. */
data class HistoryTotalsRow(
    val totalListenedMs: Long,
    val playCount: Long,
    val distinctTracks: Long,
    val distinctArtists: Long,
)

data class HistoryTrackAggregateRow(
    val source: String,
    val semanticTrackId: String,
    val title: String,
    val artist: String,
    val playCount: Long,
)

data class HistoryArtistAggregateRow(val artist: String, val playCount: Long)

data class HistoryMonthAggregateRow(val month: Int, val listenedForwardMs: Long, val playCount: Long)

@Entity(tableName = "mutation_receipts")
data class MutationReceiptEntity(@PrimaryKey val requestId: String, val status: String, val revision: Long, val errorCode: String?)

@Entity(tableName = "migration_journal")
data class MigrationJournalEntity(@PrimaryKey val attemptId: String, val phase: String, val checksum: String?, val sourceRetained: Boolean)

/** Identity rows retain semantic metadata only; paths, URLs and handles never enter Room. */
@Entity(tableName = "cache_catalog")
data class CacheCatalogEntity(
    @PrimaryKey val cacheId: String,
    val source: String,
    val semanticTrackId: String,
    val partId: String?,
    val renditionId: String,
    val mediaRevision: String,
    val state: String,
    val updatedAt: Long,
    val accountGeneration: Long = 0L,
    val entitlementStatus: String = "unknown",
    val authorizationIssuedAt: Long = 0L,
    val authorizationExpiresAt: Long = 0L,
)

/** Per-provider, non-sensitive offline authority state. Never stores a session, URL, or cookie. */
@Entity(tableName = "offline_authorities")
data class OfflineAuthorityEntity(
    @PrimaryKey val source: String,
    val generation: Long,
    /** unknown, anonymous-free, account-bound, or revoked. */
    val authState: String,
    val updatedAt: Long,
    val expiresAt: Long,
)

@Entity(tableName = "cache_blobs")
data class CacheBlobEntity(
    @PrimaryKey val blobKey: String,
    val cacheId: String,
    val contentHash: String,
    val byteLength: Long,
    val mimeType: String,
    val codec: String,
    val state: String,
    val privateRelativeKey: String,
    val verifiedAt: Long,
    val lastUsedAt: Long,
) {
    companion object {
        fun ready(identity: com.listen2mobile.offline.OfflineCatalogIdentity, contentHash: String, byteLength: Long, mimeType: String, codec: String) =
            CacheBlobEntity(contentHash, identity.cacheId(), contentHash, byteLength, mimeType, codec, "ready", "blobs/$contentHash", 0L, 0L)
    }
}

@Entity(tableName = "cache_owners", primaryKeys = ["blobKey", "ownerKey"])
data class CacheOwnerEntity(
    val blobKey: String,
    val ownerKey: String,
    val kind: OfflineOwnerKind,
    val aliasRelativeKey: String,
    val createdAt: Long,
    val updatedAt: Long,
) {
    companion object {
        fun temporary(blobKey: String, now: Long) = CacheOwnerEntity(blobKey, "temporary", OfflineOwnerKind.TEMPORARY, "owners/temporary/$blobKey", now, now)
        fun explicit(blobKey: String, now: Long) = CacheOwnerEntity(blobKey, "explicit", OfflineOwnerKind.EXPLICIT, "owners/explicit/$blobKey", now, now)
        fun playlist(blobKey: String, playlistId: String, now: Long) = CacheOwnerEntity(blobKey, "playlist:$playlistId", OfflineOwnerKind.PLAYLIST, "owners/playlist/$playlistId/$blobKey", now, now)
    }
}

@Entity(tableName = "cache_attempts")
data class CacheAttemptEntity(
    @PrimaryKey val attemptId: String,
    val cacheId: String,
    val state: String,
    val expectedLength: Long?,
    val validator: String?,
    val accountGeneration: Long,
    val privateRelativeKey: String,
    val reservedBytes: Long,
    val cancellationGeneration: Long,
    val updatedAt: Long,
)

@Entity(tableName = "cache_ranges", primaryKeys = ["attemptId", "rangeStart"])
data class CacheRangeEntity(val attemptId: String, val rangeStart: Long, val rangeEndExclusive: Long, val verified: Boolean)

@Entity(tableName = "cache_quota")
data class CacheQuotaEntity(@PrimaryKey val id: Int = 1, val quotaBytes: Long?, val reservedBytes: Long, val updatedAt: Long)

@Entity(tableName = "cache_analysis", primaryKeys = ["contentHash", "analyzerVersion"])
data class CacheAnalysisEntity(val contentHash: String, val analyzerVersion: Int, val sampleRate: Int, val codec: String, val lufs: Double?, val dbtp: Double?, val gainDb: Double?, val status: String, val updatedAt: Long)

@Dao
interface LibraryDao {
    @Query("SELECT * FROM library_meta WHERE id = 1") fun meta(): LibraryMetaEntity?
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertMeta(value: LibraryMetaEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun updateMeta(value: LibraryMetaEntity)
    @Query("SELECT * FROM mutation_receipts WHERE requestId = :requestId") fun receipt(requestId: String): MutationReceiptEntity?
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertReceipt(value: MutationReceiptEntity)
    @Query("SELECT * FROM personal_playlists WHERE playlistId = :playlistId") fun playlist(playlistId: String): PersonalPlaylistEntity?
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertPlaylist(value: PersonalPlaylistEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putPlaylist(value: PersonalPlaylistEntity)
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
    @Query("SELECT * FROM remote_collections WHERE collectionId = :collectionId") fun remoteCollection(collectionId: String): RemoteCollectionEntity?
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
    @Query("SELECT * FROM lyric_metadata WHERE source = :source AND semanticTrackId = :trackId") fun lyricMetadataForTrack(source: String, trackId: String): LyricMetadataEntity?
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
    @Query("SELECT COALESCE(SUM(listenedForwardMs), 0) AS totalListenedMs, COUNT(*) AS playCount, COUNT(DISTINCT source || ':' || semanticTrackId) AS distinctTracks, COUNT(DISTINCT artist) AS distinctArtists FROM history_events WHERE committedLocalYear = :year") fun historyTotalsForYear(year: Int): HistoryTotalsRow
    @Query("SELECT source, semanticTrackId, MAX(title) AS title, MAX(artist) AS artist, COUNT(*) AS playCount FROM history_events WHERE committedLocalYear = :year GROUP BY source, semanticTrackId ORDER BY playCount DESC, title ASC, artist ASC, source ASC, semanticTrackId ASC LIMIT 5") fun historyTopTracksForYear(year: Int): List<HistoryTrackAggregateRow>
    @Query("SELECT artist, COUNT(*) AS playCount FROM history_events WHERE committedLocalYear = :year GROUP BY artist ORDER BY playCount DESC, artist ASC LIMIT 5") fun historyTopArtistsForYear(year: Int): List<HistoryArtistAggregateRow>
    @Query("SELECT committedLocalMonth AS month, COALESCE(SUM(listenedForwardMs), 0) AS listenedForwardMs, COUNT(*) AS playCount FROM history_events WHERE committedLocalYear = :year GROUP BY committedLocalMonth") fun historyMonthsForYear(year: Int): List<HistoryMonthAggregateRow>
    @Insert(onConflict = OnConflictStrategy.ABORT) fun insertHistoryEvent(value: HistoryEventEntity)
    @Query("SELECT * FROM history_aggregates WHERE year = :year AND source = :source AND semanticTrackId = :trackId") fun historyAggregate(year: Int, source: String, trackId: String): HistoryAggregateEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putHistoryAggregate(value: HistoryAggregateEntity)
    @Query("DELETE FROM history_sessions") fun clearHistorySessions()
    @Query("DELETE FROM history_events") fun clearHistoryEvents()
    @Query("DELETE FROM history_aggregates") fun clearHistoryAggregates()
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putCacheCatalog(value: CacheCatalogEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putOfflineAuthority(value: OfflineAuthorityEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putCacheBlob(value: CacheBlobEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putCacheOwner(value: CacheOwnerEntity)
    @Query("SELECT * FROM cache_blobs WHERE blobKey = :blobKey") fun cacheBlob(blobKey: String): CacheBlobEntity?
    @Query("SELECT * FROM cache_blobs WHERE state = 'ready' ORDER BY lastUsedAt DESC, blobKey ASC") fun readyCacheBlobs(): List<CacheBlobEntity>
    @Query("SELECT * FROM cache_catalog WHERE cacheId = :cacheId") fun cacheCatalog(cacheId: String): CacheCatalogEntity?
    @Query("SELECT * FROM offline_authorities WHERE source = :source") fun offlineAuthority(source: String): OfflineAuthorityEntity?
    @Query("UPDATE offline_authorities SET authState = 'unknown', updatedAt = :now WHERE authState = 'account-bound'") fun markAccountAuthoritiesUnknown(now: Long)
    @Query("UPDATE offline_authorities SET generation = :generation, authState = 'revoked', updatedAt = :now, expiresAt = :now WHERE source = :source") fun revokeOfflineAuthority(source: String, generation: Long, now: Long)
    @Query("SELECT * FROM cache_owners WHERE blobKey = :blobKey ORDER BY ownerKey ASC") fun cacheOwners(blobKey: String): List<CacheOwnerEntity>
    @Query("SELECT b.* FROM cache_blobs b INNER JOIN cache_catalog c ON b.cacheId = c.cacheId WHERE c.source = :source AND c.semanticTrackId = :trackId AND b.state = 'ready'") fun cacheBlobsForTrack(source: String, trackId: String): List<CacheBlobEntity>
    @Query("SELECT o.* FROM cache_owners o WHERE o.ownerKey = :ownerKey") fun cacheOwnersByOwnerKey(ownerKey: String): List<CacheOwnerEntity>
    @Query("DELETE FROM cache_owners WHERE blobKey = :blobKey AND ownerKey = :ownerKey") fun deleteCacheOwner(blobKey: String, ownerKey: String)
    @Query("DELETE FROM cache_owners WHERE ownerKey = :ownerKey") fun deleteCacheOwnersByOwnerKey(ownerKey: String)
    @Query("SELECT * FROM cache_quota WHERE id = 1") fun cacheQuota(): CacheQuotaEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putCacheQuota(value: CacheQuotaEntity)
    @Query("DELETE FROM cache_blobs WHERE blobKey = :blobKey") fun deleteCacheBlob(blobKey: String)
    @Query("DELETE FROM cache_catalog WHERE cacheId = :cacheId") fun deleteCacheCatalog(cacheId: String)
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

/** v4 keeps every v3 table and normalizes cache state into identity/blob/owner/attempt records. */
internal val LIBRARY_MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN partId TEXT")
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN renditionId TEXT NOT NULL DEFAULT 'default'")
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN mediaRevision TEXT NOT NULL DEFAULT 'legacy'")
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0")
        database.execSQL("CREATE TABLE IF NOT EXISTS cache_blobs (blobKey TEXT NOT NULL, cacheId TEXT NOT NULL, contentHash TEXT NOT NULL, byteLength INTEGER NOT NULL, mimeType TEXT NOT NULL, codec TEXT NOT NULL, state TEXT NOT NULL, privateRelativeKey TEXT NOT NULL, verifiedAt INTEGER NOT NULL, lastUsedAt INTEGER NOT NULL, PRIMARY KEY(blobKey))")
        database.execSQL("CREATE TABLE IF NOT EXISTS cache_owners (blobKey TEXT NOT NULL, ownerKey TEXT NOT NULL, kind TEXT NOT NULL, aliasRelativeKey TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(blobKey, ownerKey))")
        database.execSQL("CREATE TABLE IF NOT EXISTS cache_attempts (attemptId TEXT NOT NULL, cacheId TEXT NOT NULL, state TEXT NOT NULL, expectedLength INTEGER, validator TEXT, accountGeneration INTEGER NOT NULL, privateRelativeKey TEXT NOT NULL, reservedBytes INTEGER NOT NULL, cancellationGeneration INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(attemptId))")
        database.execSQL("CREATE TABLE IF NOT EXISTS cache_ranges (attemptId TEXT NOT NULL, rangeStart INTEGER NOT NULL, rangeEndExclusive INTEGER NOT NULL, verified INTEGER NOT NULL, PRIMARY KEY(attemptId, rangeStart))")
        database.execSQL("CREATE TABLE IF NOT EXISTS cache_quota (id INTEGER NOT NULL, quotaBytes INTEGER, reservedBytes INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(id))")
        database.execSQL("CREATE TABLE IF NOT EXISTS cache_analysis (contentHash TEXT NOT NULL, analyzerVersion INTEGER NOT NULL, sampleRate INTEGER NOT NULL, codec TEXT NOT NULL, lufs REAL, dbtp REAL, gainDb REAL, status TEXT NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(contentHash, analyzerVersion))")
        database.execSQL("INSERT OR IGNORE INTO cache_quota(id, quotaBytes, reservedBytes, updatedAt) VALUES(1, 2147483648, 0, 0)")
    }
}

/** v5 stores only bounded entitlement metadata, never transport credentials or URLs. */
internal val LIBRARY_MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN accountGeneration INTEGER NOT NULL DEFAULT 0")
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN entitlementStatus TEXT NOT NULL DEFAULT 'allowed'")
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN authorizationIssuedAt INTEGER NOT NULL DEFAULT 0")
        database.execSQL("ALTER TABLE cache_catalog ADD COLUMN authorizationExpiresAt INTEGER NOT NULL DEFAULT 0")
    }
}

/** v6 makes authority source-scoped and defaults legacy receipts to fail closed. */
internal val LIBRARY_MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("UPDATE cache_catalog SET entitlementStatus = 'unknown', authorizationIssuedAt = 0, authorizationExpiresAt = 0")
        database.execSQL("CREATE TABLE IF NOT EXISTS offline_authorities (source TEXT NOT NULL, generation INTEGER NOT NULL, authState TEXT NOT NULL, updatedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, PRIMARY KEY(source))")
    }
}
