package com.dazzlingwuming.listen2;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.data.Listen2Dao;
import com.dazzlingwuming.listen2.data.Listen2Database;
import com.dazzlingwuming.listen2.data.PlaybackEntities;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Transaction boundary for recoverable playback semantics. The repository stores
 * only native-issued logical identifiers; candidate URLs, headers, cookies and
 * provider response bodies have no input field here.
 */
public final class PlaybackCheckpointRepository {
    private static final int MAX_OCCURRENCES = 1_500;
    private static final int MAX_HISTORY = 2_000;
    private static final long MAX_POSITION_MS = 28_800_000L;

    public enum Status { ACCEPTED, IDEMPOTENT, STALE_REVISION, INVALID_TRANSITION }

    private final Listen2Database database;
    private final Listen2Dao dao;

    public PlaybackCheckpointRepository(@NonNull Listen2Database database) {
        this.database = database;
        this.dao = database.listen2Dao();
    }

    /** Applies exactly one accepted logical transition, or leaves every durable row unchanged. */
    public Result applyTransition(long expectedRevision, @NonNull DurableState nextState) {
        if (expectedRevision < 0L || !nextState.hasSafeShape()) return Result.invalid();
        final Result[] result = new Result[1];
        try {
            database.runInTransaction(() -> {
                PlaybackEntities.TransitionTokenEntity replay = dao.getTransitionToken(nextState.transitionToken);
                if (replay != null) {
                    result[0] = Result.idempotent(replay.acceptedRevision);
                    return;
                }
                PlaybackEntities.CheckpointEntity current = dao.getCheckpoint();
                long currentRevision = current == null ? 0L : current.revision;
                if (currentRevision != expectedRevision) {
                    result[0] = Result.stale(currentRevision);
                    return;
                }
                if (nextState.revision != currentRevision + 1L) throw new InvalidTransitionException();

                // Clear/rewrite is intentional: a state transition is all-or-nothing and
                // preserves occurrence identities rather than collapsing duplicate tracks.
                dao.deletePlaybackHistory();
                dao.deletePlaybackOccurrences();
                dao.insertOccurrences(nextState.toOccurrenceEntities());
                nextState.requireHistoryReferences();
                dao.insertHistory(nextState.toHistoryEntities());
                dao.insertCheckpoint(nextState.toCheckpointEntity());
                dao.insertTransitionToken(new PlaybackEntities.TransitionTokenEntity(
                        nextState.transitionToken, nextState.revision));
                dao.trimTransitionTokens();
                result[0] = Result.accepted(nextState.revision);
            });
        } catch (InvalidTransitionException exception) {
            return Result.invalid();
        }
        return result[0] == null ? Result.invalid() : result[0];
    }

    /** Reads the smallest complete state needed to reconstruct the queue engine after process death. */
    public RestoredState restore() {
        PlaybackEntities.CheckpointEntity checkpoint = dao.getCheckpoint();
        if (checkpoint == null) return RestoredState.empty();
        List<String> occurrences = new ArrayList<>();
        for (PlaybackEntities.OccurrenceEntity occurrence : dao.getOccurrences()) {
            occurrences.add(occurrence.occurrenceId);
        }
        List<String> queue = new ArrayList<>();
        for (PlaybackEntities.OccurrenceEntity occurrence : dao.getQueueOccurrences()) {
            queue.add(occurrence.occurrenceId);
        }
        return new RestoredState(checkpoint.revision, checkpoint.currentOccurrenceId, occurrences, queue,
                checkpoint.positionMs, PlaybackQueueEngine.Mode.valueOf(checkpoint.mode),
                PlaybackQueueEngine.Mode.valueOf(checkpoint.modeBeforeQueue), checkpoint.historyCursor,
                checkpoint.queueContextActive);
    }

    public static final class Result {
        private final Status status;
        private final long revision;

        private Result(Status status, long revision) {
            this.status = status;
            this.revision = revision;
        }

        static Result accepted(long revision) { return new Result(Status.ACCEPTED, revision); }
        static Result idempotent(long revision) { return new Result(Status.IDEMPOTENT, revision); }
        static Result stale(long revision) { return new Result(Status.STALE_REVISION, revision); }
        static Result invalid() { return new Result(Status.INVALID_TRANSITION, -1L); }

        public Status getStatus() { return status; }
        public long getRevision() { return revision; }
    }

    /** Bounded semantic checkpoint supplied by the serialized playback coordinator. */
    public static final class DurableState {
        private final long revision;
        private final String transitionToken;
        private final String baseContextId;
        private final String currentOccurrenceId;
        private final String baseCurrentOccurrenceId;
        private final PlaybackQueueEngine.Mode mode;
        private final PlaybackQueueEngine.Mode modeBeforeQueue;
        private final boolean queueContextActive;
        private final int historyCursor;
        private final long positionMs;
        private final List<OccurrenceState> occurrences;
        private final List<HistoryState> history;

        public DurableState(long revision, @NonNull String transitionToken, @NonNull String baseContextId,
                @NonNull String currentOccurrenceId, @NonNull String baseCurrentOccurrenceId,
                @NonNull PlaybackQueueEngine.Mode mode, @NonNull PlaybackQueueEngine.Mode modeBeforeQueue,
                boolean queueContextActive, int historyCursor, long positionMs,
                @NonNull List<OccurrenceState> occurrences, @NonNull List<HistoryState> history) {
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
            this.occurrences = Collections.unmodifiableList(new ArrayList<>(occurrences));
            this.history = Collections.unmodifiableList(new ArrayList<>(history));
        }

        public DurableState withInvalidHistoryReference() {
            return new DurableState(revision, transitionToken, baseContextId, currentOccurrenceId,
                    baseCurrentOccurrenceId, mode, modeBeforeQueue, queueContextActive, historyCursor,
                    positionMs, occurrences, Arrays.asList(new HistoryState(0, "missing-occurrence", 1L)));
        }

        private boolean hasSafeShape() {
            if (revision <= 0L || !isLogicalId(transitionToken) || !isLogicalId(baseContextId)
                    || !isLogicalId(currentOccurrenceId) || !isLogicalId(baseCurrentOccurrenceId)
                    || mode == null || modeBeforeQueue == null || historyCursor < 0 || historyCursor > MAX_HISTORY
                    || positionMs < 0L || positionMs > MAX_POSITION_MS || occurrences.isEmpty()
                    || occurrences.size() > MAX_OCCURRENCES || history.size() > MAX_HISTORY) return false;
            Set<String> occurrenceIds = new HashSet<>();
            for (OccurrenceState occurrence : occurrences) {
                if (occurrence == null || !occurrence.isSafe() || !occurrenceIds.add(occurrence.occurrenceId)) {
                    return false;
                }
            }
            return occurrenceIds.contains(currentOccurrenceId) && occurrenceIds.contains(baseCurrentOccurrenceId);
        }

        private List<PlaybackEntities.OccurrenceEntity> toOccurrenceEntities() {
            List<PlaybackEntities.OccurrenceEntity> rows = new ArrayList<>();
            for (OccurrenceState occurrence : occurrences) rows.add(occurrence.toEntity());
            return rows;
        }

        private List<PlaybackEntities.HistoryEntity> toHistoryEntities() {
            List<PlaybackEntities.HistoryEntity> rows = new ArrayList<>();
            for (HistoryState entry : history) rows.add(entry.toEntity());
            return rows;
        }

        private void requireHistoryReferences() {
            Set<String> occurrenceIds = new HashSet<>();
            for (OccurrenceState occurrence : occurrences) occurrenceIds.add(occurrence.occurrenceId);
            int expectedOrdinal = 0;
            for (HistoryState entry : history) {
                if (entry == null || !entry.isSafe() || entry.ordinal != expectedOrdinal
                        || !occurrenceIds.contains(entry.occurrenceId)) throw new InvalidTransitionException();
                expectedOrdinal += 1;
            }
            if (!history.isEmpty() && historyCursor >= history.size()) throw new InvalidTransitionException();
        }

        private PlaybackEntities.CheckpointEntity toCheckpointEntity() {
            return new PlaybackEntities.CheckpointEntity(revision, transitionToken, baseContextId,
                    currentOccurrenceId, baseCurrentOccurrenceId, mode.name(), modeBeforeQueue.name(),
                    queueContextActive, historyCursor, positionMs, System.currentTimeMillis());
        }
    }

    public static final class OccurrenceState {
        private final String occurrenceId;
        private final String trackHandle;
        private final String role;
        private final int ordinal;
        private final boolean playable;

        public OccurrenceState(@NonNull String occurrenceId, @NonNull String trackHandle, @NonNull String role,
                int ordinal, boolean playable) {
            this.occurrenceId = occurrenceId;
            this.trackHandle = trackHandle;
            this.role = role;
            this.ordinal = ordinal;
            this.playable = playable;
        }

        private boolean isSafe() {
            return isLogicalId(occurrenceId) && isLogicalId(trackHandle)
                    && ("base".equals(role) || "queue".equals(role) || "shuffle".equals(role))
                    && ordinal >= 0;
        }

        private PlaybackEntities.OccurrenceEntity toEntity() {
            return new PlaybackEntities.OccurrenceEntity(occurrenceId, trackHandle, role, ordinal, playable);
        }
    }

    public static final class HistoryState {
        private final int ordinal;
        private final String occurrenceId;
        private final long acceptedAtMs;

        public HistoryState(int ordinal, @NonNull String occurrenceId, long acceptedAtMs) {
            this.ordinal = ordinal;
            this.occurrenceId = occurrenceId;
            this.acceptedAtMs = acceptedAtMs;
        }

        private boolean isSafe() {
            return ordinal >= 0 && isLogicalId(occurrenceId) && acceptedAtMs >= 0L;
        }

        private PlaybackEntities.HistoryEntity toEntity() {
            return new PlaybackEntities.HistoryEntity(ordinal, occurrenceId, acceptedAtMs);
        }
    }

    public static final class RestoredState {
        private final long revision;
        private final String currentOccurrenceId;
        private final List<String> occurrenceIds;
        private final List<String> queueOccurrenceIds;
        private final long positionMs;
        private final PlaybackQueueEngine.Mode mode;
        private final PlaybackQueueEngine.Mode modeBeforeQueue;
        private final int historyCursor;
        private final boolean queueContextActive;

        RestoredState(long revision, String currentOccurrenceId, List<String> occurrenceIds,
                List<String> queueOccurrenceIds, long positionMs, PlaybackQueueEngine.Mode mode,
                PlaybackQueueEngine.Mode modeBeforeQueue, int historyCursor, boolean queueContextActive) {
            this.revision = revision;
            this.currentOccurrenceId = currentOccurrenceId;
            this.occurrenceIds = Collections.unmodifiableList(new ArrayList<>(occurrenceIds));
            this.queueOccurrenceIds = Collections.unmodifiableList(new ArrayList<>(queueOccurrenceIds));
            this.positionMs = positionMs;
            this.mode = mode;
            this.modeBeforeQueue = modeBeforeQueue;
            this.historyCursor = historyCursor;
            this.queueContextActive = queueContextActive;
        }

        static RestoredState empty() {
            return new RestoredState(0L, "", Collections.emptyList(), Collections.emptyList(), 0L,
                    PlaybackQueueEngine.Mode.SEQUENTIAL, PlaybackQueueEngine.Mode.SEQUENTIAL, 0, false);
        }

        public long getRevision() { return revision; }
        public String getCurrentOccurrenceId() { return currentOccurrenceId; }
        public List<String> getOccurrenceIds() { return occurrenceIds; }
        public List<String> getQueueOccurrenceIds() { return queueOccurrenceIds; }
        public long getPositionMs() { return positionMs; }
        public PlaybackQueueEngine.Mode getMode() { return mode; }
        public PlaybackQueueEngine.Mode getModeBeforeQueue() { return modeBeforeQueue; }
        public int getHistoryCursor() { return historyCursor; }
        public boolean isQueueContextActive() { return queueContextActive; }
    }

    private static boolean isLogicalId(String value) {
        if (value == null || value.length() == 0 || value.length() > 128) return false;
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (!((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z')
                    || (character >= '0' && character <= '9') || character == '-' || character == '_'
                    || character == '.')) return false;
        }
        return true;
    }

    private static final class InvalidTransitionException extends RuntimeException {
    }
}
