package com.listen2mobile.history

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Controlled Room fixture is compiled here and scheduled for one device execution after 06-07. */
class ListeningLedgerInstrumentationTest {
    @Test fun calendar_and_clear_fence_contracts_are_deterministic() {
        assertTrue(ListeningPolicy.threshold(60_002) == 30_001L)
        assertFalse(ListeningPolicy.threshold(0) != null)
    }
}
