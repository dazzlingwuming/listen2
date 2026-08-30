package com.dazzlingwuming.listen2.data;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface Listen2Dao {
    @Query("SELECT * FROM playback_checkpoint WHERE checkpointId = 1")
    PlaybackEntities.CheckpointEntity getCheckpoint();

    @Query("SELECT * FROM playback_occurrences ORDER BY role ASC, ordinal ASC")
    List<PlaybackEntities.OccurrenceEntity> getOccurrences();

    @Query("SELECT * FROM playback_occurrences WHERE role = 'queue' ORDER BY ordinal ASC")
    List<PlaybackEntities.OccurrenceEntity> getQueueOccurrences();

    @Query("SELECT * FROM playback_history ORDER BY ordinal ASC")
    List<PlaybackEntities.HistoryEntity> getHistory();

    @Query("SELECT * FROM accepted_transition_tokens WHERE transitionToken = :token")
    PlaybackEntities.TransitionTokenEntity getTransitionToken(String token);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertCheckpoint(PlaybackEntities.CheckpointEntity checkpoint);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    void insertOccurrences(List<PlaybackEntities.OccurrenceEntity> occurrences);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    void insertHistory(List<PlaybackEntities.HistoryEntity> history);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    void insertTransitionToken(PlaybackEntities.TransitionTokenEntity token);

    @Query("DELETE FROM playback_history")
    void deletePlaybackHistory();

    @Query("DELETE FROM playback_occurrences")
    void deletePlaybackOccurrences();

    @Query("DELETE FROM accepted_transition_tokens WHERE transitionToken NOT IN "
            + "(SELECT transitionToken FROM accepted_transition_tokens "
            + "ORDER BY acceptedRevision DESC LIMIT 64)")
    void trimTransitionTokens();
}
