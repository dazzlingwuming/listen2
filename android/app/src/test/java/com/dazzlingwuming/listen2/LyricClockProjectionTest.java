package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class LyricClockProjectionTest {
    @Test
    public void media3ClockIsMonotonicUntilAnAcceptedSeekOrSelectionChange() {
        LyricClockProjection.Identity bilibili = new LyricClockProjection.Identity("bilibili",
                "BV1xx411c7mD", 42L, "track-native", "occ-native", 3L);
        LyricClockProjection.Projection playing = LyricClockProjection.project(null, bilibili, 8L,
                1_000L, 10_000L, PlaybackSnapshot.State.PLAYING, "available",
                LyricClockProjection.Event.TRANSITION);
        LyricClockProjection.Projection cadence = LyricClockProjection.project(playing, bilibili, 9L,
                900L, 10_000L, PlaybackSnapshot.State.PLAYING, "available",
                LyricClockProjection.Event.CADENCE);
        LyricClockProjection.Projection seek = LyricClockProjection.project(cadence, bilibili, 10L,
                250L, 10_000L, PlaybackSnapshot.State.PLAYING, "available",
                LyricClockProjection.Event.SEEK);

        assertEquals(1_000L, cadence.getPositionMs());
        assertEquals(250L, seek.getPositionMs());
        assertEquals(10L, seek.getPlaybackRevision());
        assertTrue(seek.toLyricContext().toMap().containsKey("selectionGeneration"));
    }

    @Test
    public void sourceChangeResetsClockAndAllowsOnlySanitizedIdentity() {
        LyricClockProjection.Identity netease = new LyricClockProjection.Identity("netease", "123456",
                1L, "track-native", "occ-native", 4L);
        LyricClockProjection.Projection projection = LyricClockProjection.project(null, netease, 12L,
                0L, 3_000L, PlaybackSnapshot.State.PAUSED, "available",
                LyricClockProjection.Event.RESTORE);

        assertEquals("netease", projection.toLyricContext().toMap().get("source"));
        assertFalse(projection.toLyricContext().toMap().toString().contains("url"));
        assertFalse(projection.toLyricContext().toMap().toString().contains("candidate"));
    }

    @Test
    public void staleRevisionCannotReplaceCurrentSelectionAfterTransitionOrRestore() {
        LyricClockProjection.Identity current = new LyricClockProjection.Identity("netease", "123456",
                1L, "track-current", "occ-current", 7L);
        LyricClockProjection.Projection accepted = LyricClockProjection.project(null, current, 20L,
                600L, 3_000L, PlaybackSnapshot.State.PLAYING, "available",
                LyricClockProjection.Event.TRANSITION);
        LyricClockProjection.Identity stale = new LyricClockProjection.Identity("bilibili", "BV1xx411c7mD",
                1L, "track-stale", "occ-stale", 6L);
        LyricClockProjection.Projection rejected = LyricClockProjection.project(accepted, stale, 19L,
                10L, 3_000L, PlaybackSnapshot.State.PAUSED, "available",
                LyricClockProjection.Event.RESTORE);

        assertEquals(20L, rejected.getPlaybackRevision());
        assertEquals(600L, rejected.getPositionMs());
        assertEquals("netease", rejected.toLyricContext().toMap().get("source"));
    }
}
