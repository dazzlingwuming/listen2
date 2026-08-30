package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.Map;

import org.junit.Test;

public final class PlaybackServiceLyricContractTest {
    @Test
    public void snapshotProjectsOnlyNativeLyricIdentityAndClock() {
        PlaybackSnapshot.LyricContext lyric = new PlaybackSnapshot.LyricContext("netease", "123456",
                1L, "track-native", "occ-native", 4L, 9L, "available", "paused");
        PlaybackSnapshot snapshot = new PlaybackSnapshot(1, 7L, 9L, PlaybackSnapshot.State.PAUSED,
                new PlaybackSnapshot.Metadata("Title", "Artist", 1_000L, "bundled-placeholder"),
                200L, 1_000L, 100, false, PlaybackSnapshot.Mode.SEQUENTIAL,
                new PlaybackSnapshot.ActionAvailability(true, false, false, false, true, true),
                Collections.<PlaybackSnapshot.QueueOccurrence>emptyList(), null,
                new PlaybackSnapshot.RecoveryStatus("ready", false), lyric);
        Map<String, Object> projected = snapshot.toMap();

        assertTrue(projected.containsKey("lyric"));
        for (String forbidden : new String[] {"url", "query", "candidate", "header", "cookie", "body",
                "credential", "exception", "path"}) {
            assertFalse(projected.toString().toLowerCase().contains(forbidden));
        }
    }

    @Test
    public void foregroundCadenceRequiresAttachedMeaningfulNativeSelection() {
        PlaybackSnapshot noContext = new PlaybackSnapshot(1, 7L, 1L, PlaybackSnapshot.State.PLAYING,
                new PlaybackSnapshot.Metadata("Title", "Artist", 1_000L, "bundled-placeholder"),
                0L, 1_000L, 100, false, PlaybackSnapshot.Mode.SEQUENTIAL,
                new PlaybackSnapshot.ActionAvailability(false, true, false, false, true, true),
                Collections.<PlaybackSnapshot.QueueOccurrence>emptyList(), null,
                new PlaybackSnapshot.RecoveryStatus("ready", false));

        assertFalse(PlaybackService.shouldPublishForegroundCadence(true, noContext));
        assertFalse(PlaybackService.shouldPublishForegroundCadence(false, noContext));

        PlaybackSnapshot active = new PlaybackSnapshot(1, 7L, 2L, PlaybackSnapshot.State.PLAYING,
                new PlaybackSnapshot.Metadata("Title", "Artist", 1_000L, "bundled-placeholder"),
                100L, 1_000L, 100, false, PlaybackSnapshot.Mode.SEQUENTIAL,
                new PlaybackSnapshot.ActionAvailability(false, true, false, false, true, true),
                Collections.<PlaybackSnapshot.QueueOccurrence>emptyList(), null,
                new PlaybackSnapshot.RecoveryStatus("ready", false), new PlaybackSnapshot.LyricContext(
                        "netease", "123456", 1L, "track-native", "occ-native", 4L, 2L,
                        "available", "playing"));
        assertTrue(PlaybackService.shouldPublishForegroundCadence(true, active));
    }
}
