package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import androidx.media3.common.PlaybackException;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Ensures semantic navigation uses page occurrence identities, not resolver handles. */
public final class PlaybackServiceQueueIdentityTest {
    @Test
    public void failedResolutionProjectsErrorInsteadOfEmptyPlayerIdleAndRemainsRetryable() {
        assertEquals(PlaybackSnapshot.State.ERROR, PlaybackService.projectPlaybackState(true, false, 1));
        assertEquals(PlaybackSnapshot.State.IDLE, PlaybackService.projectPlaybackState(false, false, 1));
        assertEquals(PlaybackSnapshot.State.PLAYING, PlaybackService.projectPlaybackState(false, true, 3));
        assertTrue(PlaybackService.isRetryableRecovery("bilibili-manifest-map-identity-mismatch"));
        assertTrue(PlaybackService.isRetryableRecovery("bilibili-detail-http-412"));
        assertTrue(PlaybackService.isRetryableRecovery("candidate-rejected"));
    }

    @Test
    public void approvedCandidateFallbackIsBoundedAndRejectsStaleSelectionOrUnsafeFailureClass() {
        PlaybackService.CandidateFallback plan = new PlaybackService.CandidateFallback(7L, "occ-a", 9);
        int network = PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED;
        assertEquals(-1, plan.advance(network, true, 8L, "occ-a", "occ-a"));
        assertEquals(-1, plan.advance(network, true, 7L, "occ-b", "occ-b"));
        assertEquals(-1, plan.advance(network, true, 7L, "occ-a", "old-media"));
        assertEquals(-1, plan.advance(network, false, 7L, "occ-a", "occ-a"));
        assertEquals(-1, plan.advance(PlaybackException.ERROR_CODE_IO_NO_PERMISSION,
                true, 7L, "occ-a", "occ-a"));
        assertEquals(-1, plan.advance(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
                true, 7L, "occ-a", "occ-a"));
        assertEquals(-1, plan.advance(PlaybackException.ERROR_CODE_DECODING_FAILED,
                true, 7L, "occ-a", "occ-a"));
        assertEquals(1, plan.advance(network, true, 7L, "occ-a", "occ-a"));
        assertEquals(2, plan.advance(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                true, 7L, "occ-a", "occ-a"));
        assertEquals(3, plan.advance(PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
                true, 7L, "occ-a", "occ-a"));
        assertEquals(-1, plan.advance(network, true, 7L, "occ-a", "occ-a"));
        assertEquals(-1, plan.advance(network, true, 7L, "occ-a", "occ-a"));
        assertFalse(plan.matches(8L, "occ-a", "occ-a"));
        PlaybackService.CandidateFallback single = new PlaybackService.CandidateFallback(8L, "occ-b", 1);
        assertEquals(-1, single.advance(network, true, 8L, "occ-b", "occ-b"));
    }

    @Test
    public void exhaustedNetworkErrorSurvivesIdleReadyAndIsExplicitlyRetryable() {
        String failure = "media-network-unavailable";
        assertEquals(failure, PlaybackService.projectRecoveryCode(failure, "ready"));
        assertEquals(failure, PlaybackService.projectRecoveryCode(failure, "interrupted"));
        assertEquals(PlaybackSnapshot.State.ERROR, PlaybackService.projectPlaybackState(true, false, 1));
        assertTrue(PlaybackService.isRetryableRecovery(failure));
        assertEquals("ready", PlaybackService.projectRecoveryCode("", "ready"));
    }

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
