package com.listen2mobile.audiofx
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
class AudioEffectsContractTest { @Test fun `invalid session remains unavailable and fixed gain is bounded`() { assertEquals("unavailable", AudioEffectsPolicy.status(0, true)); assertEquals(1.0, AudioEffectsPolicy.gain(Double.NaN), 0.0); assertEquals(1.0, AudioEffectsPolicy.gain(2.0), 0.0); assertTrue(AudioEffectsPolicy.presets.contains("neutral")) } }
