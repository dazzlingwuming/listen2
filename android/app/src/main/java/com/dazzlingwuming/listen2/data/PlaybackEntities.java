package com.dazzlingwuming.listen2.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.ForeignKey;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/** Normalized Room rows for the semantic playback checkpoint only. */
public final class PlaybackEntities {
    private PlaybackEntities() {
    }

    @Entity(tableName = "playback_checkpoint")
    public static final class CheckpointEntity {
        @PrimaryKey
        public int checkpointId;
        public final long revision;
        @NonNull public final String transitionToken;
        @NonNull public final String baseContextId;
        @NonNull public final String currentOccurrenceId;
        @NonNull public final String baseCurrentOccurrenceId;
        @NonNull public final String mode;
        @NonNull public final String modeBeforeQueue;
        public final boolean queueContextActive;
        public final int historyCursor;
        public final long positionMs;
        public final long updatedAtMs;

        public CheckpointEntity(long revision, @NonNull String transitionToken, @NonNull String baseContextId,
                @NonNull String currentOccurrenceId, @NonNull String baseCurrentOccurrenceId,
                @NonNull String mode, @NonNull String modeBeforeQueue, boolean queueContextActive,
                int historyCursor, long positionMs, long updatedAtMs) {
            this.checkpointId = 1;
            this.revision = revision;
            this.transitionToken = transitionToken;
            this.baseContextId = baseContextId;
            this.currentOccurrenceId = currentOccurrenceId;
            this.baseCurrentOccurrenceId = baseCurrentOccurrenceId;
            this.mode = mode;
            this.modeBeforeQueue = modeBeforeQueue;
            this.queueContextActive = queueContextActive;
            this.historyCursor = historyCursor;
            this.positionMs = positionMs;
            this.updatedAtMs = updatedAtMs;
        }
    }

    @Entity(tableName = "playback_occurrences", indices = {
            @Index(value = {"role", "ordinal"}),
            @Index(value = {"trackHandle"})
    })
    public static final class OccurrenceEntity {
        @PrimaryKey @NonNull public final String occurrenceId;
        @NonNull public final String trackHandle;
        @NonNull public final String role;
        public final int ordinal;
        public final boolean playable;

        public OccurrenceEntity(@NonNull String occurrenceId, @NonNull String trackHandle,
                @NonNull String role, int ordinal, boolean playable) {
            this.occurrenceId = occurrenceId;
            this.trackHandle = trackHandle;
            this.role = role;
            this.ordinal = ordinal;
            this.playable = playable;
        }
    }

    @Entity(tableName = "playback_history", foreignKeys = @ForeignKey(
            entity = OccurrenceEntity.class,
            parentColumns = "occurrenceId",
            childColumns = "occurrenceId",
            onDelete = ForeignKey.CASCADE), indices = @Index(value = {"occurrenceId"}))
    public static final class HistoryEntity {
        @PrimaryKey public final int ordinal;
        @NonNull public final String occurrenceId;
        public final long acceptedAtMs;

        public HistoryEntity(int ordinal, @NonNull String occurrenceId, long acceptedAtMs) {
            this.ordinal = ordinal;
            this.occurrenceId = occurrenceId;
            this.acceptedAtMs = acceptedAtMs;
        }
    }

    @Entity(tableName = "accepted_transition_tokens", indices = @Index(value = {"acceptedRevision"}))
    public static final class TransitionTokenEntity {
        @PrimaryKey @NonNull public final String transitionToken;
        public final long acceptedRevision;

        public TransitionTokenEntity(@NonNull String transitionToken, long acceptedRevision) {
            this.transitionToken = transitionToken;
            this.acceptedRevision = acceptedRevision;
        }
    }
}
