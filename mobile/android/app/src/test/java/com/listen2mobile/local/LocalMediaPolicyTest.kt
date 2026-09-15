package com.listen2mobile.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalMediaPolicyTest {
    private val id = "11111111-1111-4111-8111-111111111111"
    @Test fun accepts_only_exact_token_path_and_read_mode() {
        val token = "A".repeat(32)
        assertEquals(token, LocalMediaPolicy.tokenFromSegments(listOf("play", token)))
        assertNull(LocalMediaPolicy.tokenFromSegments(listOf("play", token, "extra")))
        assertFalse(LocalMediaPolicy.validReadMode("rw")); assertTrue(LocalMediaPolicy.validReadMode("r"))
    }
    @Test fun token_is_single_use_and_expiring() {
        val token = requireNotNull(LocalPlaybackTokens.issue(id, "load_1", 10))
        assertEquals(id, LocalPlaybackTokens.consume(token, 11))
        assertNull(LocalPlaybackTokens.consume(token, 11))
        val expired = requireNotNull(LocalPlaybackTokens.issue(id, "load_2", 10))
        assertNull(LocalPlaybackTokens.consume(expired, 10 + LocalMediaPolicy.TOKEN_TTL_MS))
    }
    @Test fun issued_tokens_are_url_safe_entropy_values() {
        val token = requireNotNull(LocalPlaybackTokens.issue(id, "load_3", 10))
        assertEquals(48, token.length)
        assertTrue(LocalMediaPolicy.validToken(token))
        assertFalse(token.contains('='))
        assertTrue(token.matches(Regex("[0-9a-f]{48}")))
    }
}
