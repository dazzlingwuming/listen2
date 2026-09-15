package com.listen2mobile.history

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryBridgeContractTest {
    @Test fun exposes_only_the_named_safe_history_methods() {
        assertEquals(setOf("beginPlayback", "observePlayback", "getHistory", "getRecap", "getRecordingPreference", "setRecordingPreference", "exportSafeHistory", "clearHistory"), HistoryModule.NAMED_METHODS)
        assertFalse(HistoryModule.NAMED_METHODS.any { it.contains("url", true) || it.contains("cache", true) || it.contains("session", true) })
    }
    @Test fun policy_bounds_years_and_observation_kinds() {
        assertTrue(ListeningPolicy.validKind("progress"))
        assertFalse(ListeningPolicy.validKind("rawCallback"))
        assertTrue(ListeningPolicy.threshold(480_000) == 240_000L)
    }
}
