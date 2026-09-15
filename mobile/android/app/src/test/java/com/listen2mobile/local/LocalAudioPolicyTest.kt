package com.listen2mobile.local

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalAudioPolicyTest {
    @Test fun accepts_only_container_signatures_not_mime_hints() {
        assertTrue(LocalAudioPolicy.supportedHeader("ID3x".toByteArray()))
        assertTrue(LocalAudioPolicy.supportedHeader("fLaC".toByteArray()))
        assertFalse(LocalAudioPolicy.supportedHeader("text".toByteArray()))
    }
}
