package com.listen2mobile.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.Before
import org.junit.Assert.assertThrows
import java.io.FileNotFoundException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class LocalMediaPolicyTest {
    @org.junit.Test fun `local read probe requires persisted ownership before opening and fails closed`() {
        var opens = 0
        org.junit.Assert.assertFalse(LocalPlaybackAccessPolicy.readable({ false }, { opens += 1; true }))
        org.junit.Assert.assertEquals(0, opens)
        org.junit.Assert.assertFalse(LocalPlaybackAccessPolicy.readable({ throw SecurityException() }, { opens += 1; true }))
        org.junit.Assert.assertEquals(0, opens)
        org.junit.Assert.assertFalse(LocalPlaybackAccessPolicy.readable({ true }, { throw java.io.FileNotFoundException() }))
        org.junit.Assert.assertFalse(LocalPlaybackAccessPolicy.readable({ true }, { false }))
        org.junit.Assert.assertTrue(LocalPlaybackAccessPolicy.readable({ true }, { opens += 1; true }))
        org.junit.Assert.assertEquals(1, opens)
    }

    private val id = "11111111-1111-4111-8111-111111111111"
    private fun <T : Any> open(token: String, now: Long, authorized: (String) -> T): T? =
        LocalPlaybackTokens.open(token, { now }, {}, authorized)
    @Before fun clearLeases() { LocalPlaybackTokens.endActive(); LocalPlaybackTokens.clearRecord(id) }
    @Test fun accepts_only_exact_token_path_and_read_mode() {
        val token = "A".repeat(32)
        assertEquals(token, LocalMediaPolicy.tokenFromSegments(listOf("play", token)))
        assertNull(LocalMediaPolicy.tokenFromSegments(listOf("play", token, "extra")))
        assertFalse(LocalMediaPolicy.validReadMode("rw")); assertTrue(LocalMediaPolicy.validReadMode("r"))
    }
    @Test fun bootstrap_expires_but_authorized_playback_reopens_past_bootstrap_deadline() {
        val token = requireNotNull(LocalPlaybackTokens.issue(id, "load_1", 10))
        var opens = 0
        assertEquals(id, open(token, 11) { opens += 1; it })
        assertEquals(id, open(token, 12 + LocalMediaPolicy.TOKEN_TTL_MS) { opens += 1; it })
        assertEquals(id, open(token, 600_000) { opens += 1; it })
        assertEquals(3, opens)
        val expired = requireNotNull(LocalPlaybackTokens.issue(id, "never_loaded", 600_000))
        assertNull(open(expired, 600_000 + LocalMediaPolicy.TOKEN_TTL_MS) { opens += 1; it })
        assertEquals(3, opens)
    }
    @Test fun reopens_never_extend_the_hard_playback_deadline() {
        val token = requireNotNull(LocalPlaybackTokens.issue(id, "hard_limit", 10))
        assertEquals(id, open(token, 11) { it })
        val deadline = 11 + LocalMediaPolicy.ACTIVE_PLAYBACK_TTL_MS
        assertEquals(id, open(token, deadline - 1) { it })
        var opens = 0
        assertNull(open(token, deadline) { opens += 1; it })
        assertEquals(0, opens)
    }
    @Test fun pending_resolutions_do_not_replace_active_and_reset_preserves_pending_bootstrap() {
        val active = requireNotNull(LocalPlaybackTokens.issue(id, "active", 10))
        assertEquals(id, open(active, 11) { it })
        val pending = requireNotNull(LocalPlaybackTokens.issue(id, "next", 12))
        assertEquals(id, open(active, 13) { it })
        LocalPlaybackTokens.endActive("next")
        assertNull(open(active, 14) { it })
        assertEquals(id, open(pending, 14) { it })
    }
    @Test fun ending_without_an_exact_replacement_revokes_unopened_pending_handles() {
        val pending = requireNotNull(LocalPlaybackTokens.issue(id, "pending", 10))
        LocalPlaybackTokens.endActive()
        var opens = 0
        assertNull(open(pending, 11) { opens += 1; it })
        val invalid = requireNotNull(LocalPlaybackTokens.issue(id, "invalid_preserve", 12))
        LocalPlaybackTokens.endActive("unsafe:/document")
        assertNull(open(invalid, 13) { opens += 1; it })
        assertEquals(0, opens)
    }
    @Test fun reset_preserves_only_the_latest_exact_replacement_and_rejects_older_pending_first_opens() {
        val active = requireNotNull(LocalPlaybackTokens.issue(id, "active", 10))
        assertEquals(id, open(active, 11) { it })
        val old = requireNotNull(LocalPlaybackTokens.issue(id, "old_pending", 12))
        val next = requireNotNull(LocalPlaybackTokens.issue(id, "next_pending", 13))
        LocalPlaybackTokens.endActive("next_pending")
        assertNull(open(active, 14) { it })
        assertNull(open(old, 14) { it })
        assertEquals(id, open(next, 14) { it })
    }
    @Test fun reset_during_an_old_open_can_preserve_new_pending_without_publishing_the_old_descriptor() {
        var next = ""
        var closes = 0
        val old = requireNotNull(LocalPlaybackTokens.issue(id, "old", 10))
        assertNull(LocalPlaybackTokens.open(old, { 11L }, { _: String -> closes += 1 }) {
            next = requireNotNull(LocalPlaybackTokens.issue(id, "new", 11))
            LocalPlaybackTokens.endActive("new")
            "old-descriptor"
        })
        assertEquals(1, closes)
        assertEquals(id, open(next, 12) { it })
    }
    @Test fun successful_replacement_and_record_removal_revoke_old_handles() {
        val old = requireNotNull(LocalPlaybackTokens.issue(id, "old", 10))
        assertEquals(id, open(old, 11) { it })
        val next = requireNotNull(LocalPlaybackTokens.issue(id, "next", 12))
        assertEquals(id, open(next, 13) { it })
        assertNull(open(old, 14) { it })
        LocalPlaybackTokens.clearRecord(id)
        assertNull(open(next, 15) { it })
    }
    @Test fun every_reopen_checks_current_record_mapping_and_grant_before_descriptor_access() {
        var available = true
        var grant = true
        var opens = 0
        val token = requireNotNull(LocalPlaybackTokens.issue(id, "revoked", 10))
        fun open(now: Long) = open(token, now) {
            LocalPlaybackReadPolicy.open({ available }, { grant }, { opens += 1; it }) ?: throw FileNotFoundException("not-found")
        }
        assertEquals(id, open(11))
        grant = false
        assertThrows(FileNotFoundException::class.java) { open(12) }
        assertEquals(1, opens)
        grant = true
        assertNull(open(13)) // A failed authorization cannot revive its old lease.
        available = false
        assertNull(LocalPlaybackReadPolicy.open({ available }, { grant }, { opens += 1; id }))
        assertNull(LocalPlaybackReadPolicy.open({ true }, { throw SecurityException() }, { opens += 1; id }))
        assertNull(LocalPlaybackReadPolicy.open({ true }, { true }, { throw FileNotFoundException() }))
        assertEquals(1, opens)
    }
    @Test fun failed_new_open_does_not_revoke_the_existing_playback() {
        val active = requireNotNull(LocalPlaybackTokens.issue(id, "active", 10))
        assertEquals(id, open(active, 11) { it })
        val pending = requireNotNull(LocalPlaybackTokens.issue(id, "failed", 12))
        assertThrows(FileNotFoundException::class.java) { open(pending, 13) { throw FileNotFoundException() } }
        assertEquals(id, open(active, 14) { it })
    }
    @Test fun bounded_pending_storage_cannot_evict_the_active_playback() {
        val active = requireNotNull(LocalPlaybackTokens.issue(id, "active", 10))
        assertEquals(id, open(active, 11) { it })
        val abandoned = requireNotNull(LocalPlaybackTokens.issue(id, "abandoned", 12))
        repeat(LocalMediaPolicy.MAX_TOKENS * 2) { LocalPlaybackTokens.issue(id, "pending_$it", 13) }
        assertNull(open(abandoned, 14) { it })
        assertEquals(id, open(active, 14) { it })
    }
    @Test fun slow_open_rechecks_bootstrap_and_active_deadlines_and_closes_rejected_descriptors() {
        var now = 10L
        var closes = 0
        val bootstrap = requireNotNull(LocalPlaybackTokens.issue(id, "slow_bootstrap", now))
        assertNull(LocalPlaybackTokens.open(bootstrap, { now }, { _: String -> closes += 1 }) {
            now += LocalMediaPolicy.TOKEN_TTL_MS
            "descriptor"
        })
        assertEquals(1, closes)
        val active = requireNotNull(LocalPlaybackTokens.issue(id, "slow_reopen", now))
        assertEquals(id, open(active, now) { it })
        now += LocalMediaPolicy.ACTIVE_PLAYBACK_TTL_MS - 1
        assertNull(LocalPlaybackTokens.open(active, { now }, { _: String -> closes += 1 }) {
            now += 1
            "descriptor"
        })
        assertEquals(2, closes)
    }
    @Test fun revoke_or_reset_during_open_prevents_publication_and_closes_the_new_descriptor() {
        var closes = 0
        val deleted = requireNotNull(LocalPlaybackTokens.issue(id, "deleted", 10))
        assertNull(LocalPlaybackTokens.open(deleted, { 11L }, { _: String -> closes += 1 }) {
            LocalPlaybackTokens.clearRecord(id)
            "descriptor"
        })
        val reset = requireNotNull(LocalPlaybackTokens.issue(id, "reset", 12))
        assertNull(LocalPlaybackTokens.open(reset, { 13L }, { _: String -> closes += 1 }) {
            LocalPlaybackTokens.endActive()
            "descriptor"
        })
        assertEquals(2, closes)
    }
    @Test fun a_late_pending_open_cannot_replace_a_newer_activated_playback() {
        var closes = 0
        var next = ""
        val old = requireNotNull(LocalPlaybackTokens.issue(id, "old_pending", 10))
        assertNull(LocalPlaybackTokens.open(old, { 11L }, { _: String -> closes += 1 }) {
            next = requireNotNull(LocalPlaybackTokens.issue(id, "new_pending", 11))
            assertEquals(id, open(next, 12) { it })
            "old-descriptor"
        })
        assertEquals(1, closes)
        assertEquals(id, open(next, 13) { it })
        assertNull(open(old, 13) { it })
    }
    @Test fun revocation_finishes_while_external_open_is_still_waiting() {
        val token = requireNotNull(LocalPlaybackTokens.issue(id, "blocked_io", 10))
        val entered = CountDownLatch(1)
        val resume = CountDownLatch(1)
        val result = AtomicReference<String?>("not-completed")
        val closes = AtomicInteger()
        val reader = Thread {
            result.set(LocalPlaybackTokens.open(token, { 11L }, { _: String -> closes.incrementAndGet() }) {
                entered.countDown()
                check(resume.await(2, TimeUnit.SECONDS))
                "descriptor"
            })
        }
        reader.start()
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        LocalPlaybackTokens.clearRecord(id)
        resume.countDown()
        reader.join(2_000)
        assertFalse(reader.isAlive)
        assertNull(result.get())
        assertEquals(1, closes.get())
    }
    @Test fun issued_tokens_are_url_safe_entropy_values() {
        val token = requireNotNull(LocalPlaybackTokens.issue(id, "load_3", 10))
        assertEquals(48, token.length)
        assertTrue(LocalMediaPolicy.validToken(token))
        assertFalse(token.contains('='))
        assertTrue(token.matches(Regex("[0-9a-f]{48}")))
    }
}
