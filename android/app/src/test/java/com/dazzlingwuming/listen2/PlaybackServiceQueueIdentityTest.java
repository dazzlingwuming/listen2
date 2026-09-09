package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Ensures semantic navigation uses page occurrence identities, not resolver handles. */
public final class PlaybackServiceQueueIdentityTest {
    @Test
    public void nextAndPreviousWalkTwoQueuedPageOccurrences() {
        List<PlaybackSnapshot.QueueOccurrence> queue = Arrays.asList(
                occurrence("page-current", "track-current"),
                occurrence("page-next", "track-next"));
        Set<String> playable = new LinkedHashSet<>(Arrays.asList("page-current", "page-next"));

        assertEquals("page-next", PlaybackService.nextSemanticOccurrenceId(queue, 0, "page-current",
                playable, PlaybackSnapshot.Mode.SEQUENTIAL));
        assertEquals("page-current", PlaybackService.previousSemanticOccurrenceId(
                Arrays.asList("page-current", "page-next"), 1, playable));
        assertNull(PlaybackService.nextSemanticOccurrenceId(queue, 1, "page-next", playable,
                PlaybackSnapshot.Mode.SEQUENTIAL));
    }

    private static PlaybackSnapshot.QueueOccurrence occurrence(String occurrenceId, String trackHandle) {
        return new PlaybackSnapshot.QueueOccurrence(occurrenceId, trackHandle, "Title", "Artist", 1_000L);
    }
}
