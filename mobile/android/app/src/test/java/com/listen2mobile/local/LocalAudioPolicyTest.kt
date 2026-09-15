package com.listen2mobile.local

import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Assert.assertEquals
import org.junit.Test

class LocalAudioPolicyTest {
    @Test fun reads_only_the_authorized_prefix_at_and_around_the_limit() {
        assertArrayEquals(byteArrayOf(1, 2, 3), LocalAudioPolicy.readAtMost(ByteArrayInputStream(byteArrayOf(1, 2, 3)), 4))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), LocalAudioPolicy.readAtMost(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)), 4))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), LocalAudioPolicy.readAtMost(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4, 5)), 4))
        assertEquals(0, LocalAudioPolicy.readAtMost(ByteArrayInputStream(byteArrayOf(1)), 0).size)
    }

    @Test fun accepts_only_container_signatures_not_mime_hints() {
        assertTrue(LocalAudioPolicy.supportedHeader("ID3x".toByteArray()))
        assertTrue(LocalAudioPolicy.supportedHeader("fLaC".toByteArray()))
        assertFalse(LocalAudioPolicy.supportedHeader("text".toByteArray()))
    }

    @Test fun normalizes_only_bounded_explicit_lrc() {
        assertEquals("[00:01] text\n[00:02] next", LocalAudioPolicy.normalizeLrc("\uFEFF[00:01] text\r\n[00:02] next".toByteArray()))
        assertNull(LocalAudioPolicy.normalizeLrc(ByteArray(LocalAudioPolicy.MAX_LRC_BYTES + 1)))
    }
}
