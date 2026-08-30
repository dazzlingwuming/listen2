package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.concurrent.Executor;

public final class PlaybackCoordinatorTest {
    @Test
    public void nextPersistsBeforeExactlyOneProjectionAndDeduplicatesToken() {
        FakePort port = new FakePort();
        PlaybackCoordinator coordinator = coordinator(port);

        PlaybackCoordinator.Result first = coordinator.next(0L, "next-1");
        PlaybackCoordinator.Result duplicate = coordinator.next(0L, "next-1");

        assertTrue(first.isAccepted());
        assertTrue(duplicate.isIdempotent());
        assertEquals(Arrays.asList("persist:1", "project:1", "publish:1"), port.events);
        assertEquals(1, port.projections);
        assertEquals(1, port.publishes);
    }

    @Test
    public void projectionFailureRetainsCurrentOccurrenceAndPublishesActionableError() {
        FakePort port = new FakePort();
        port.failProjection = true;
        PlaybackCoordinator coordinator = coordinator(port);

        PlaybackCoordinator.Result result = coordinator.retry(0L, "retry-1");

        assertTrue(result.isAccepted());
        assertEquals(1L, result.getRevision());
        assertEquals("projection-failed", result.getSnapshot().getRecoveryCode());
        assertEquals("base-id-1", result.getSnapshot().getCurrentOccurrenceId());
        assertEquals(1, port.publishes);
    }

    @Test
    public void positionCheckpointsOnlyOnSeekCompletionOrCadence() {
        FakePort port = new FakePort();
        FakeClock clock = new FakeClock();
        PlaybackCoordinator coordinator = coordinator(port, clock);

        assertFalse(coordinator.onPosition(1_000L).isAccepted());
        clock.now = PlaybackCoordinator.POSITION_CHECKPOINT_INTERVAL_MS;
        assertTrue(coordinator.onPosition(2_000L).isAccepted());
        assertTrue(coordinator.onSeekCompleted(3_000L).isAccepted());
        assertEquals(2, port.persistCount);
    }

    private static PlaybackCoordinator coordinator(FakePort port) {
        return coordinator(port, new FakeClock());
    }

    private static PlaybackCoordinator coordinator(FakePort port, FakeClock clock) {
        PlaybackQueueEngine engine = new PlaybackQueueEngine(Arrays.asList(
                new PlaybackQueueEngine.Track("track-1", true),
                new PlaybackQueueEngine.Track("track-2", true)), 0,
                PlaybackQueueEngine.Mode.SEQUENTIAL,
                new PlaybackQueueEngine.IncrementingIdSource("id"), clock,
                new PlaybackQueueEngine.SequenceRandom(7L));
        return new PlaybackCoordinator(engine, port, port, port, new DirectExecutor(), clock);
    }

    private static final class DirectExecutor implements Executor {
        @Override public void execute(Runnable runnable) { runnable.run(); }
    }

    private static final class FakeClock implements PlaybackQueueEngine.Clock {
        long now;
        @Override public long nowMs() { return now; }
    }

    private static final class FakePort implements PlaybackCoordinator.PersistencePort,
            PlaybackCoordinator.PlayerPort, PlaybackCoordinator.SnapshotPublisher {
        final java.util.List<String> events = new java.util.ArrayList<>();
        int projections;
        int publishes;
        int persistCount;
        boolean failProjection;

        @Override public PlaybackCoordinator.PersistenceResult persist(long expectedRevision,
                PlaybackQueueEngine.State state, String token, long positionMs) {
            persistCount += 1;
            events.add("persist:" + state.getRevision());
            return PlaybackCoordinator.PersistenceResult.accepted(state.getRevision());
        }
        @Override public void project(PlaybackCoordinator.Projection projection) {
            projections += 1;
            events.add("project:" + projection.getRevision());
            if (failProjection) throw new IllegalStateException("player unavailable");
        }
        @Override public void publish(PlaybackCoordinator.Snapshot snapshot) {
            publishes += 1;
            events.add("publish:" + snapshot.getRevision());
        }
    }
}
