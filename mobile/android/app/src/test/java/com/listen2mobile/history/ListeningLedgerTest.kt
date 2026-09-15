package com.listen2mobile.history

import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ListeningLedgerTest {
    @Test fun local_history_date_uses_the_supplied_zone_at_a_day_boundary() {
        val epoch = 1_704_067_200_000L // 2024-01-01T00:00:00Z
        assertEquals(LocalHistoryDate("2023-12-31", 2023, 12), localHistoryDate(epoch, TimeZone.getTimeZone("GMT-08:00")))
        assertEquals(LocalHistoryDate("2024-01-01", 2024, 1), localHistoryDate(epoch, TimeZone.getTimeZone("GMT+08:00")))
    }

    @Test fun exact_threshold_requires_more_than_thirty_seconds_and_half_duration() {
        var session = ListeningPolicy.initial(0)
        session = ListeningPolicy.observe(session, 80_000, 1, "progress", 15_000, 15_000).session
        session = ListeningPolicy.observe(session, 80_000, 2, "progress", 30_000, 30_000).session
        assertFalse(ListeningPolicy.observe(session, 80_000, 3, "progress", 30_001, 30_001).commit)
        assertTrue(ListeningPolicy.observe(session, 80_000, 3, "progress", 40_001, 40_001).commit)
    }

    @Test fun pause_seek_buffer_and_duplicate_sequences_cannot_create_forward_evidence() {
        var session = ListeningPolicy.initial(0)
        session = ListeningPolicy.observe(session, 120_000, 1, "progress", 10_000, 10_000).session
        session = ListeningPolicy.observe(session, 120_000, 2, "pause", 10_000, 10_100).session
        session = ListeningPolicy.observe(session, 120_000, 3, "progress", 60_000, 60_100).session
        session = ListeningPolicy.observe(session, 120_000, 4, "seek", 80_000, 61_000).session
        session = ListeningPolicy.observe(session, 120_000, 5, "play", 80_000, 61_001).session
        val next = ListeningPolicy.observe(session, 120_000, 6, "progress", 90_000, 71_001)
        assertFalse(next.commit)
        assertFalse(ListeningPolicy.observe(next.session, 120_000, 6, "progress", 120_000, 101_001).commit)
    }

    @Test fun invalid_duration_and_preload_or_failure_never_commit() {
        val initial = ListeningPolicy.initial(0)
        assertFalse(ListeningPolicy.observe(initial, 0, 1, "progress", 60_000, 60_000).commit)
        assertFalse(ListeningPolicy.observe(initial, 120_000, 1, "browse", 120_000, 60_000).commit)
        assertFalse(ListeningPolicy.observe(initial, 120_000, 1, "failure", 120_000, 60_000).commit)
    }
}
