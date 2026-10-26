package com.dazzlingwuming.listen2;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class ListeningHistoryAccumulatorTest {
    @Test
    public void countsNormalPlaybackButNotSeekDistance() {
        ListeningHistoryAccumulator subject = new ListeningHistoryAccumulator();
        subject.begin("session.1", "netease", "123", "Song", "Artist", 180_000L, 1_000L);

        subject.observe(0L, true, 1_000L);
        ListeningHistoryAccumulator.Sample played = subject.observe(1_000L, true, 2_000L);
        assertNotNull(played);
        assertEquals(1_000L, played.cumulativePlayedMs);

        ListeningHistoryAccumulator.Sample sought = subject.observe(90_000L, true, 3_000L);
        assertEquals(1_000L, sought.cumulativePlayedMs);
        ListeningHistoryAccumulator.Sample resumed = subject.observe(91_000L, true, 4_000L);
        assertEquals(2_000L, resumed.cumulativePlayedMs);
    }

    @Test
    public void ignoresLifecycleGapAndCountsAfterNewBaseline() {
        ListeningHistoryAccumulator subject = new ListeningHistoryAccumulator();
        subject.begin("session.2", "bilibili", "BV1", "Video", "UP", 120_000L, 2_000L);
        subject.observe(0L, true, 2_000L);

        ListeningHistoryAccumulator.Sample afterGap = subject.observe(30_000L, true, 32_000L);
        assertEquals(0L, afterGap.cumulativePlayedMs);
        ListeningHistoryAccumulator.Sample resumed = subject.observe(31_000L, true, 33_000L);
        assertEquals(1_000L, resumed.cumulativePlayedMs);
    }

    @Test
    public void inactiveOrClearedSelectionHasNoSample() {
        ListeningHistoryAccumulator subject = new ListeningHistoryAccumulator();
        subject.begin("short", "netease", "1", "Short", "Artist", 30_000L, 1L);
        assertNull(subject.snapshot());
        subject.begin("session.3", "netease", "2", "Song", "Artist", 60_000L, 1L);
        assertNotNull(subject.snapshot());
        subject.clear();
        assertNull(subject.snapshot());
    }

    @Test
    public void emitsBoundedCumulativePersistenceSamples() {
        ListeningHistoryAccumulator subject = new ListeningHistoryAccumulator();
        subject.begin("session.4", "netease", "4", "Song", "Artist", 180_000L, 1L);
        subject.observe(0L, true, 0L);
        for (int second = 1; second <= 14; second += 1) {
            subject.observe(second * 1_000L, true, second * 1_000L);
        }
        assertNull(subject.drainForPersistence(false));
        subject.observe(15_000L, true, 15_000L);
        assertEquals(15_000L, subject.drainForPersistence(false).cumulativePlayedMs);
        assertNull(subject.drainForPersistence(true));
        subject.observe(16_000L, false, 16_000L);
        assertEquals(16_000L, subject.drainForPersistence(true).cumulativePlayedMs);
    }

    @Test
    public void acceptsNativeDurationAfterInitiallyUnknownMetadata() {
        ListeningHistoryAccumulator subject = new ListeningHistoryAccumulator();
        subject.begin("session.5", "local", "local.track." + "a".repeat(64),
                "Local", "Artist", 0L, 1L);
        assertNull(subject.snapshot());
        subject.updateDuration(90_000L);
        assertNotNull(subject.snapshot());
    }
}
