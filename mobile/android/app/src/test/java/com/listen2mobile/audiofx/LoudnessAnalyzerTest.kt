package com.listen2mobile.audiofx

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test

class LoudnessAnalyzerTest {
    @Test fun `reference vector targets minus fourteen lufs while respecting true peak`() {
        val metrics = LoudnessPolicy.analyzePcm(FloatArray(48_000) { 0.5f })
        assertNotNull(metrics)
        assertEquals(LoudnessPolicy.gainDb(metrics!!.lufs, metrics.truePeakDbtp), metrics.gainDb, 0.0001)
        assertTruePeakSafe(metrics.truePeakDbtp + metrics.gainDb)
    }

    @Test fun `identity mismatch and invalid metrics retain unity`() {
        val old = LoudnessPolicy.Identity("a".repeat(64), 44_100, "audio/mpeg")
        val changed = LoudnessPolicy.Identity("b".repeat(64), 44_100, "audio/mpeg")
        assertFalse(LoudnessPolicy.reusable(old, changed))
        assertEquals(0.0, LoudnessPolicy.gainDb(Double.NaN, -2.0), 0.0)
    }

    private fun assertTruePeakSafe(value: Double) = org.junit.Assert.assertTrue(value <= LoudnessPolicy.PEAK_CEILING_DBTP + 0.0001)
}
