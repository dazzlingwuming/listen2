package com.dazzlingwuming.listen2.data;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface Listen2Dao {
    @Query("SELECT * FROM playlists ORDER BY ordinal ASC, playlistId ASC")
    List<DurableRecordEntities.PlaylistEntity> getPlaylists();

    @Query("SELECT * FROM playlists WHERE playlistId = :playlistId")
    DurableRecordEntities.PlaylistEntity getPlaylist(String playlistId);

    @Query("SELECT * FROM playlist_tracks WHERE playlistId = :playlistId ORDER BY ordinal ASC")
    List<DurableRecordEntities.PlaylistTrackEntity> getPlaylistTracks(String playlistId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertPlaylist(DurableRecordEntities.PlaylistEntity entity);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertPlaylistTracks(List<DurableRecordEntities.PlaylistTrackEntity> entities);

    @Query("DELETE FROM playlists WHERE playlistId = :playlistId")
    void deletePlaylist(String playlistId);

    @Query("DELETE FROM playlist_tracks WHERE playlistId = :playlistId")
    void deletePlaylistTracks(String playlistId);

    @Query("SELECT * FROM favorites ORDER BY addedAtMs DESC, favoriteId ASC")
    List<DurableRecordEntities.FavoriteEntity> getFavorites();

    @Query("SELECT * FROM favorites WHERE source = :source AND providerTrackId = :providerTrackId LIMIT 1")
    DurableRecordEntities.FavoriteEntity getFavorite(String source, String providerTrackId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertFavorite(DurableRecordEntities.FavoriteEntity entity);

    @Query("DELETE FROM favorites WHERE source = :source AND providerTrackId = :providerTrackId")
    void deleteFavorite(String source, String providerTrackId);

    @Query("DELETE FROM favorites")
    void clearFavorites();

    @Query("SELECT * FROM saf_references ORDER BY updatedAtMs DESC")
    List<DurableRecordEntities.SafReferenceEntity> getSafReferences();

    @Query("SELECT * FROM saf_references WHERE referenceId = :referenceId")
    DurableRecordEntities.SafReferenceEntity getSafReference(String referenceId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertSafReference(DurableRecordEntities.SafReferenceEntity entity);

    @Query("SELECT * FROM local_media_tracks WHERE grantReferenceId = :grantReferenceId ORDER BY displayName ASC, localTrackId ASC")
    List<DurableRecordEntities.LocalMediaTrackEntity> getLocalMediaTracks(String grantReferenceId);

    @Query("SELECT * FROM local_media_tracks ORDER BY displayName ASC, localTrackId ASC")
    List<DurableRecordEntities.LocalMediaTrackEntity> getAllLocalMediaTracks();

    @Query("SELECT * FROM local_media_tracks WHERE opaqueReference = :opaqueReference LIMIT 1")
    DurableRecordEntities.LocalMediaTrackEntity getLocalMediaTrackByOpaqueReference(String opaqueReference);

    @Query("SELECT * FROM local_media_tracks WHERE localTrackId = :localTrackId LIMIT 1")
    DurableRecordEntities.LocalMediaTrackEntity getLocalMediaTrack(String localTrackId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertLocalMediaTracks(List<DurableRecordEntities.LocalMediaTrackEntity> entities);

    @Query("DELETE FROM local_media_tracks WHERE grantReferenceId = :grantReferenceId")
    void deleteLocalMediaTracksForGrant(String grantReferenceId);

    @Query("SELECT * FROM listening_history WHERE entryId = :entryId")
    DurableRecordEntities.ListeningHistoryEntity getListeningHistory(String entryId);

    @Query("SELECT * FROM listening_history WHERE listenedAtMs >= :fromMs AND listenedAtMs < :untilMs")
    List<DurableRecordEntities.ListeningHistoryEntity> getListeningHistoryBetween(long fromMs, long untilMs);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertListeningHistory(DurableRecordEntities.ListeningHistoryEntity entity);

    @Query("DELETE FROM listening_history")
    void clearListeningHistory();

    @Query("SELECT * FROM cache_catalog ORDER BY lastAccessedAtMs ASC, cacheId ASC")
    List<DurableRecordEntities.CacheCatalogEntity> getCacheEntriesByLru();

    @Query("SELECT * FROM cache_catalog WHERE cacheId = :cacheId")
    DurableRecordEntities.CacheCatalogEntity getCacheEntry(String cacheId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertCacheEntry(DurableRecordEntities.CacheCatalogEntity entity);

    @Query("DELETE FROM cache_catalog WHERE cacheId = :cacheId")
    void deleteCacheEntry(String cacheId);

    @Query("SELECT * FROM local_settings WHERE settingKey = :key")
    DurableRecordEntities.SettingEntity getSetting(String key);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertSetting(DurableRecordEntities.SettingEntity entity);
    @Query("SELECT * FROM playback_checkpoint WHERE checkpointId = 1")
    PlaybackEntities.CheckpointEntity getCheckpoint();

    @Query("SELECT * FROM playback_occurrences ORDER BY role ASC, ordinal ASC")
    List<PlaybackEntities.OccurrenceEntity> getOccurrences();

    @Query("SELECT * FROM playback_occurrences WHERE role = 'queue' ORDER BY ordinal ASC")
    List<PlaybackEntities.OccurrenceEntity> getQueueOccurrences();

    @Query("SELECT * FROM playback_history ORDER BY ordinal ASC")
    List<PlaybackEntities.HistoryEntity> getHistory();

    @Query("SELECT * FROM playback_shuffle_order ORDER BY ordinal ASC")
    List<PlaybackEntities.ShuffleEntity> getShuffleOrder();

    @Query("SELECT * FROM accepted_transition_tokens WHERE transitionToken = :token")
    PlaybackEntities.TransitionTokenEntity getTransitionToken(String token);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertCheckpoint(PlaybackEntities.CheckpointEntity checkpoint);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    void insertOccurrences(List<PlaybackEntities.OccurrenceEntity> occurrences);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    void insertHistory(List<PlaybackEntities.HistoryEntity> history);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    void insertShuffleOrder(List<PlaybackEntities.ShuffleEntity> shuffleOrder);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    void insertTransitionToken(PlaybackEntities.TransitionTokenEntity token);

    @Query("DELETE FROM playback_history")
    void deletePlaybackHistory();

    @Query("DELETE FROM playback_shuffle_order")
    void deleteShuffleOrder();

    @Query("DELETE FROM playback_checkpoint")
    void deleteCheckpoint();

    @Query("DELETE FROM playback_occurrences")
    void deletePlaybackOccurrences();

    @Query("DELETE FROM accepted_transition_tokens")
    void deleteTransitionTokens();

    @Query("DELETE FROM accepted_transition_tokens WHERE transitionToken NOT IN "
            + "(SELECT transitionToken FROM accepted_transition_tokens "
            + "ORDER BY acceptedRevision DESC LIMIT 64)")
    void trimTransitionTokens();
}
