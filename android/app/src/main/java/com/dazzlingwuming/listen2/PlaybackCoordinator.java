package com.dazzlingwuming.listen2;

import java.util.concurrent.Executor;

/**
 * The only transition lane between page/session/player callbacks and the
 * semantic queue. Persistence always finishes before an ExoPlayer projection;
 * a failed projection therefore leaves the selected occurrence durable and
 * actionable instead of consuming another queue entry.
 */
public final class PlaybackCoordinator {
    static final long POSITION_CHECKPOINT_INTERVAL_MS = 15_000L;

    public interface PersistencePort {
        PersistenceResult persist(long expectedRevision, PlaybackQueueEngine.State state,
                String transitionToken, long positionMs);
    }

    public interface PlayerPort {
        void project(Projection projection);
    }

    public interface SnapshotPublisher {
        void publish(Snapshot snapshot);
    }

    public static final class PersistenceResult {
        private final boolean accepted;
        private final boolean idempotent;
        private final long revision;

        private PersistenceResult(boolean accepted, boolean idempotent, long revision) {
            this.accepted = accepted;
            this.idempotent = idempotent;
            this.revision = revision;
        }

        public static PersistenceResult accepted(long revision) {
            return new PersistenceResult(true, false, revision);
        }

        public static PersistenceResult idempotent(long revision) {
            return new PersistenceResult(true, true, revision);
        }

        public static PersistenceResult rejected(long revision) {
            return new PersistenceResult(false, false, revision);
        }
    }

    public static final class Projection {
        private final long revision;
        private final String occurrenceId;
        private final String trackHandle;
        private final boolean playWhenReady;

        Projection(long revision, String occurrenceId, String trackHandle, boolean playWhenReady) {
            this.revision = revision;
            this.occurrenceId = occurrenceId;
            this.trackHandle = trackHandle;
            this.playWhenReady = playWhenReady;
        }

        public long getRevision() { return revision; }
        public String getOccurrenceId() { return occurrenceId; }
        public String getTrackHandle() { return trackHandle; }
        public boolean isPlayWhenReady() { return playWhenReady; }
    }

    public static final class Snapshot {
        private final long revision;
        private final String currentOccurrenceId;
        private final String recoveryCode;

        Snapshot(long revision, String currentOccurrenceId, String recoveryCode) {
            this.revision = revision;
            this.currentOccurrenceId = currentOccurrenceId;
            this.recoveryCode = recoveryCode;
        }

        public long getRevision() { return revision; }
        public String getCurrentOccurrenceId() { return currentOccurrenceId; }
        public String getRecoveryCode() { return recoveryCode; }
    }

    public static final class Result {
        private final boolean accepted;
        private final boolean idempotent;
        private final long revision;
        private final Snapshot snapshot;

        Result(boolean accepted, boolean idempotent, long revision, Snapshot snapshot) {
            this.accepted = accepted;
            this.idempotent = idempotent;
            this.revision = revision;
            this.snapshot = snapshot;
        }

        public boolean isAccepted() { return accepted; }
        public boolean isIdempotent() { return idempotent; }
        public long getRevision() { return revision; }
        public Snapshot getSnapshot() { return snapshot; }
    }

    private PlaybackQueueEngine engine;
    private final PersistencePort persistence;
    private final PlayerPort player;
    private final SnapshotPublisher publisher;
    private final Executor serialExecutor;
    private final PlaybackQueueEngine.Clock clock;
    private long lastCheckpointAtMs;
    private long lastPositionMs;

    public PlaybackCoordinator(PlaybackQueueEngine engine, PersistencePort persistence, PlayerPort player,
            SnapshotPublisher publisher, Executor serialExecutor, PlaybackQueueEngine.Clock clock) {
        if (engine == null || persistence == null || player == null || publisher == null
                || serialExecutor == null || clock == null) throw new IllegalArgumentException("ports required");
        this.engine = engine;
        this.persistence = persistence;
        this.player = player;
        this.publisher = publisher;
        this.serialExecutor = serialExecutor;
        this.clock = clock;
    }

    public Result next(long expectedRevision, String token) {
        return execute(() -> engine.next(expectedRevision, token), token, true);
    }

    public Result onNaturalEnd(long expectedRevision, String token) {
        return execute(() -> engine.onNaturalEnd(expectedRevision, token), token, true);
    }

    public Result retry(long expectedRevision, String token) {
        return execute(() -> engine.retry(expectedRevision), token, true);
    }

    public Result previous(long expectedRevision, String token) {
        return execute(() -> engine.previous(expectedRevision), token, true);
    }

    public Result onSeekCompleted(long positionMs) {
        return checkpoint(positionMs, "seek-" + clock.nowMs());
    }

    public Result onPosition(long positionMs) {
        if (positionMs < 0L || clock.nowMs() - lastCheckpointAtMs < POSITION_CHECKPOINT_INTERVAL_MS) {
            return rejected();
        }
        return checkpoint(positionMs, "position-" + clock.nowMs());
    }

    private Result checkpoint(long positionMs, String token) {
        if (positionMs < 0L) return rejected();
        Result result = execute(() -> engine.retry(engine.getState().getRevision()), token, false);
        if (result.isAccepted()) {
            lastPositionMs = positionMs;
            lastCheckpointAtMs = clock.nowMs();
        }
        return result;
    }

    private Result execute(TransitionCall call, String token, boolean project) {
        Result[] result = new Result[1];
        serialExecutor.execute(() -> result[0] = executeOnLane(call, token, project));
        return result[0] == null ? rejected() : result[0];
    }

    private Result executeOnLane(TransitionCall call, String token, boolean project) {
        PlaybackQueueEngine.Checkpoint before = engine.checkpoint();
        PlaybackQueueEngine.Transition transition = call.apply();
        if (!transition.isAccepted()) return rejected();
        if (transition.isIdempotent()) {
            return new Result(true, true, transition.getRevision(), snapshot(transition.getState(), "ready"));
        }
        PersistenceResult persisted = persistence.persist(before.toState().getRevision(), transition.getState(),
                token, lastPositionMs);
        if (!persisted.accepted) {
            engine = PlaybackQueueEngine.restore(before, new PlaybackQueueEngine.IncrementingIdSource("rollback"),
                    clock, new PlaybackQueueEngine.SequenceRandom(0L));
            return rejected();
        }
        String recoveryCode = "ready";
        if (project) {
            try {
                PlaybackQueueEngine.Occurrence current = transition.getState().getCurrent();
                player.project(new Projection(transition.getRevision(), current.getOccurrenceId(),
                        current.getTrackHandle(), true));
            } catch (RuntimeException ignored) {
                recoveryCode = "projection-failed";
            }
        }
        Snapshot snapshot = snapshot(transition.getState(), recoveryCode);
        publisher.publish(snapshot);
        return new Result(true, false, transition.getRevision(), snapshot);
    }

    private Snapshot snapshot(PlaybackQueueEngine.State state, String recoveryCode) {
        return new Snapshot(state.getRevision(), state.getCurrent().getOccurrenceId(), recoveryCode);
    }

    private Result rejected() {
        PlaybackQueueEngine.State state = engine.getState();
        return new Result(false, false, state.getRevision(), snapshot(state, "rejected"));
    }

    private interface TransitionCall { PlaybackQueueEngine.Transition apply(); }
}
