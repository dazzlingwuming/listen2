package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public final class PlaybackQueueEngineTest {
    @Test
    public void duplicateTracksAreSeparateFifoOccurrencesAndRestoreBaseContext() {
        PlaybackQueueEngine engine = engine(base("current", "normal-next"));

        PlaybackQueueEngine.Transition firstQueued = engine.enqueueNext(0L, track("A"));
        PlaybackQueueEngine.Transition secondQueued = engine.enqueueNext(1L, track("A"));
        assertTrue(firstQueued.isAccepted());
        assertTrue(secondQueued.isAccepted());
        assertNotEquals(firstQueued.getState().getQueue().get(0).getOccurrenceId(),
                secondQueued.getState().getQueue().get(1).getOccurrenceId());

        PlaybackQueueEngine.Transition firstNext = engine.next(2L, "natural-end-1");
        PlaybackQueueEngine.Transition duplicateEnd = engine.next(3L, "natural-end-1");
        PlaybackQueueEngine.Transition secondNext = engine.next(3L, "notification-next-2");
        PlaybackQueueEngine.Transition baseNext = engine.next(4L, "page-next-3");

        assertEquals("A", firstNext.getState().getCurrent().getTrackHandle());
        assertTrue(duplicateEnd.isIdempotent());
        assertEquals(firstNext.getRevision(), duplicateEnd.getRevision());
        assertEquals("A", secondNext.getState().getCurrent().getTrackHandle());
        assertTrue(secondNext.getState().getQueue().isEmpty());
        assertEquals("normal-next", baseNext.getState().getCurrent().getTrackHandle());
        assertEquals(Arrays.asList("current", "normal-next"),
                trackHandles(baseNext.getState().getBasePlaylist()));
    }

    @Test
    public void mutationsAddressOccurrenceIdsAndRejectStaleRevisionOrIdentity() {
        PlaybackQueueEngine engine = engine(base("current"));
        engine.enqueueNext(0L, track("A"));
        engine.enqueueNext(1L, track("B"));
        List<PlaybackQueueEngine.Occurrence> queued = engine.getState().getQueue();
        String first = queued.get(0).getOccurrenceId();
        String second = queued.get(1).getOccurrenceId();

        assertEquals("STALE_REVISION", engine.remove(1L, first).getCode());
        assertEquals("UNKNOWN_OCCURRENCE", engine.remove(2L, "occ-stale").getCode());
        assertTrue(engine.reorder(2L, second, 0).isAccepted());
        assertEquals(Arrays.asList("B", "A"), trackHandles(engine.getState().getQueue()));
        assertTrue(engine.remove(3L, second).isAccepted());
        assertEquals(Arrays.asList("A"), trackHandles(engine.getState().getQueue()));
        assertTrue(engine.clear(4L).isAccepted());
        assertTrue(engine.getState().getQueue().isEmpty());
    }

    @Test
    public void finalQueueOccurrenceRestoresSavedModeWithoutChangingBasePlaylist() {
        PlaybackQueueEngine engine = engine(base("current", "normal-next"));
        assertTrue(engine.setMode(0L, PlaybackQueueEngine.Mode.REPEAT_ALL).isAccepted());
        engine.enqueueNext(1L, track("temporary"));

        PlaybackQueueEngine.Transition queued = engine.next(2L, "end-1");
        assertEquals("temporary", queued.getState().getCurrent().getTrackHandle());
        assertEquals(PlaybackQueueEngine.Mode.REPEAT_ALL, queued.getState().getMode());
        assertFalse(queued.getState().isQueueContextActive());
        assertEquals(Arrays.asList("current", "normal-next"),
                trackHandles(queued.getState().getBasePlaylist()));
    }

    private static PlaybackQueueEngine engine(List<PlaybackQueueEngine.Track> base) {
        return new PlaybackQueueEngine(base, 0, PlaybackQueueEngine.Mode.SEQUENTIAL,
                new PlaybackQueueEngine.IncrementingIdSource("test"), new FixedClock(),
                new PlaybackQueueEngine.SequenceRandom(0));
    }

    private static List<PlaybackQueueEngine.Track> base(String... handles) {
        PlaybackQueueEngine.Track[] tracks = new PlaybackQueueEngine.Track[handles.length];
        for (int index = 0; index < handles.length; index += 1) tracks[index] = track(handles[index]);
        return Arrays.asList(tracks);
    }

    private static PlaybackQueueEngine.Track track(String handle) {
        return new PlaybackQueueEngine.Track(handle, true);
    }

    private static List<String> trackHandles(List<PlaybackQueueEngine.Occurrence> occurrences) {
        String[] handles = new String[occurrences.size()];
        for (int index = 0; index < occurrences.size(); index += 1) {
            handles[index] = occurrences.get(index).getTrackHandle();
        }
        return Arrays.asList(handles);
    }

    private static final class FixedClock implements PlaybackQueueEngine.Clock {
        private long current;

        @Override
        public long nowMs() {
            current += 1L;
            return current;
        }
    }
}
