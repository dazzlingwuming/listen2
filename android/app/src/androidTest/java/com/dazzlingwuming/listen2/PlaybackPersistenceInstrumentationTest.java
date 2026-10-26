package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.room.Room;
import androidx.test.platform.app.InstrumentationRegistry;

import com.dazzlingwuming.listen2.data.Listen2Database;

import org.junit.Test;

import java.util.Arrays;

/** Device-level proof that semantic checkpoint writes are atomic and restart-safe. */
public final class PlaybackPersistenceInstrumentationTest {
    @Test
    public void transitionIsAtomicIdempotentAndRestoresDuplicateOccurrences() {
        Listen2Database database = Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class)
                .allowMainThreadQueries()
                .build();
        try {
            PlaybackCheckpointRepository repository = new PlaybackCheckpointRepository(database);
            PlaybackCheckpointRepository.DurableState initial = state(1L, "token-1", 40_000L);
            assertEquals(PlaybackCheckpointRepository.Status.ACCEPTED,
                    repository.applyTransition(0L, initial).getStatus());
            assertEquals(PlaybackCheckpointRepository.Status.IDEMPOTENT,
                    repository.applyTransition(0L, initial).getStatus());

            PlaybackCheckpointRepository.DurableState stale = state(2L, "token-2", 50_000L);
            assertEquals(PlaybackCheckpointRepository.Status.STALE_REVISION,
                    repository.applyTransition(0L, stale).getStatus());

            PlaybackCheckpointRepository.RestoredState restored = repository.restore();
            assertEquals(1L, restored.getRevision());
            assertEquals("occ-base-1", restored.getCurrentOccurrenceId());
            assertEquals(Arrays.asList("occ-base-1", "occ-queue-1", "occ-queue-2"),
                    restored.getOccurrenceIds());
            assertEquals(Arrays.asList("occ-queue-1", "occ-queue-2"), restored.getQueueOccurrenceIds());
            assertEquals(Arrays.asList("occ-base-1", "occ-queue-1"), restored.getHistoryOccurrenceIds());
            assertEquals(Arrays.asList("occ-base-1"), restored.getShuffleOccurrenceIds());
            assertEquals("base-context-1", restored.getBaseContextId());
            assertEquals("occ-base-1", restored.getBaseCurrentOccurrenceId());
            assertEquals(1, restored.getHistoryCursor());
            assertEquals(1, restored.getShuffleNextIndex());
            assertEquals(40_000L, restored.getPositionMs());
            assertEquals(PlaybackQueueEngine.Mode.SHUFFLE, restored.getMode());
        } finally {
            database.close();
        }
    }

    @Test
    public void failedTransitionRollsBackCheckpointQueueAndHistory() {
        Listen2Database database = Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class)
                .allowMainThreadQueries()
                .build();
        try {
            PlaybackCheckpointRepository repository = new PlaybackCheckpointRepository(database);
            assertEquals(PlaybackCheckpointRepository.Status.ACCEPTED,
                    repository.applyTransition(0L, state(1L, "token-1", 10L)).getStatus());
            PlaybackCheckpointRepository.DurableState invalid = state(2L, "token-2", 20L)
                    .withInvalidHistoryReference();
            assertEquals(PlaybackCheckpointRepository.Status.INVALID_TRANSITION,
                    repository.applyTransition(1L, invalid).getStatus());
            PlaybackCheckpointRepository.RestoredState restored = repository.restore();
            assertEquals(1L, restored.getRevision());
            assertEquals(Arrays.asList("occ-queue-1", "occ-queue-2"), restored.getQueueOccurrenceIds());
            assertEquals(10L, restored.getPositionMs());
        } finally {
            database.close();
        }
    }

    @Test
    public void restoresExactProviderDescriptorsWithoutAnyTransportFields() {
        Listen2Database database = Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class)
                .allowMainThreadQueries()
                .build();
        try {
            PlaybackCheckpointRepository repository = new PlaybackCheckpointRepository(database);
            PlaybackCheckpointRepository.DurableState state = new PlaybackCheckpointRepository.DurableState(
                    1L, "semantic-token-1", "semantic-context-1", "occ-bili", "occ-bili",
                    PlaybackQueueEngine.Mode.REPEAT_ALL, PlaybackQueueEngine.Mode.REPEAT_ALL, false, 0, 12_345L,
                    Arrays.asList(
                            occurrence("occ-bili", "track-bili", "bilibili", "BV1xx411c7mD", 7L,
                                    "Bili title", "Bili artist", 120_000L, 0),
                            occurrence("occ-netease", "track-netease", "netease", "123456", 1L,
                                    "NetEase title", "NetEase artist", 180_000L, 1),
                            occurrence("occ-local", "track-local", "local", localTrackId(), 1L,
                                    "Local title", "Local artist", 240_000L, 2)),
                    Arrays.asList(new PlaybackCheckpointRepository.HistoryState(0, "occ-bili", 1L)));
            assertEquals(PlaybackCheckpointRepository.Status.ACCEPTED,
                    repository.applyTransition(0L, state).getStatus());

            PlaybackCheckpointRepository.RestoredState restored = repository.restore();
            PlaybackCheckpointRepository.OccurrenceState netease = restored.getOccurrenceState("occ-netease");
            PlaybackCheckpointRepository.OccurrenceState local = restored.getOccurrenceState("occ-local");
            assertEquals("bilibili", restored.getOccurrenceState("occ-bili").getSource());
            assertEquals("123456", netease.getProviderTrackId());
            assertEquals(1L, netease.getProviderPartId());
            assertEquals("NetEase title", netease.getTitle());
            assertEquals("NetEase artist", netease.getArtist());
            assertEquals(180_000L, netease.getDurationMs());
            assertEquals("audio", netease.getMediaKind());
            assertEquals(localTrackId(), local.getProviderTrackId());
            assertEquals(12_345L, restored.getPositionMs());
            assertEquals(PlaybackQueueEngine.Mode.REPEAT_ALL, restored.getMode());
        } finally {
            database.close();
        }
    }

    @Test
    public void settingsAreSmallAndApplicationScoped() {
        PlaybackSettingsStore settings = new PlaybackSettingsStore(
                InstrumentationRegistry.getInstrumentation().getTargetContext());
        settings.clearForTest();
        settings.setVolumePercent(37);
        settings.setMuted(true);
        assertEquals(37, settings.getVolumePercent());
        assertTrue(settings.isMuted());
        assertFalse(settings.acceptsKey("queue"));
        assertFalse(settings.acceptsKey("authorization"));
    }

    private static PlaybackCheckpointRepository.DurableState state(long revision, String token,
            long positionMs) {
        return new PlaybackCheckpointRepository.DurableState(revision, token, "base-context-1",
                "occ-base-1", "occ-base-1", PlaybackQueueEngine.Mode.SHUFFLE,
                PlaybackQueueEngine.Mode.SHUFFLE, false, 1, positionMs,
                Arrays.asList(
                        new PlaybackCheckpointRepository.OccurrenceState("occ-base-1", "track-a", "base", 0,
                                true),
                        new PlaybackCheckpointRepository.OccurrenceState("occ-queue-1", "track-a", "queue", 0,
                                true),
                        new PlaybackCheckpointRepository.OccurrenceState("occ-queue-2", "track-a", "queue", 1,
                                true)),
                Arrays.asList(
                        new PlaybackCheckpointRepository.HistoryState(0, "occ-base-1", 100L),
                        new PlaybackCheckpointRepository.HistoryState(1, "occ-queue-1", 200L)),
                Arrays.asList("occ-base-1"), 1);
    }

    private static PlaybackCheckpointRepository.OccurrenceState occurrence(String occurrenceId, String trackHandle,
            String source, String providerTrackId, long providerPartId, String title, String artist,
            long durationMs, int ordinal) {
        return new PlaybackCheckpointRepository.OccurrenceState(occurrenceId, trackHandle, source,
                providerTrackId, providerPartId, title, artist, durationMs, "audio", "queue", ordinal, true);
    }

    private static String localTrackId() {
        return "local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
}
