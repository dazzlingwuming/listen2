package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Locks the durable checkpoint to provider identities, never transport-shaped data. */
public final class PlaybackCheckpointSemanticIdentityTest {
    @Test
    public void acceptsOnlyBoundedBilibiliNetEaseAndLocalSemanticIdentities() {
        assertTrue(occurrence("bilibili", "BV1xx411c7mD", 7L).isSafe());
        assertTrue(occurrence("bilibili", "9001", 1L).isSafe());
        assertTrue(occurrence("netease", "123456789", 1L).isSafe());
        assertTrue(occurrence("local", localTrackId(), 1L).isSafe());

        assertFalse(occurrence("bilibili", "https.example", 7L).isSafe());
        assertFalse(occurrence("netease", "0", 1L).isSafe());
        assertFalse(occurrence("local", localTrackId(), 2L).isSafe());
    }

    private static PlaybackCheckpointRepository.OccurrenceState occurrence(String source,
            String providerTrackId, long providerPartId) {
        return new PlaybackCheckpointRepository.OccurrenceState("occurrence-1", "track-1", source,
                providerTrackId, providerPartId, "Title", "Artist", 1_000L, "audio", "queue", 0, true);
    }

    private static String localTrackId() {
        return "local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
}
