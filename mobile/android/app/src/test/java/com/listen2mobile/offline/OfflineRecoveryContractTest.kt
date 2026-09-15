package com.listen2mobile.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import com.listen2mobile.library.CacheCatalogEntity
import com.listen2mobile.library.OfflineAuthorityEntity

class OfflineRecoveryContractTest {
    @Test
    fun `quota honors exact presets unlimited and never evicts explicit owner`() {
        assertEquals(2L * OfflineQuota.GIB, OfflineQuota.defaultBytes)
        assertEquals(1L * OfflineQuota.GIB, OfflineQuota.parse(1L * OfflineQuota.GIB))
        assertEquals(null, OfflineQuota.parse(null))
        assertEquals(null, OfflineQuota.parse(3L * OfflineQuota.GIB))
        val candidates = listOf(
            OfflineEvictionCandidate("temporary", 1L, false),
            OfflineEvictionCandidate("explicit", 0L, true),
            OfflineEvictionCandidate("playlist", 2L, false),
        )
        val selected = OfflineRecoveryPolicy.selectEviction(candidates, 1)
        assertEquals(listOf("temporary"), selected.map { it.blobKey })
        assertFalse(selected.any { it.explicit })
        assertTrue(OfflineQuota.admits(1L * OfflineQuota.GIB, 512L * 1024 * 1024, 0L, 256L * 1024 * 1024))
        assertFalse(OfflineQuota.admits(1L * OfflineQuota.GIB, OfflineQuota.GIB, 0L, 1L))
        assertTrue(OfflineQuota.admits(2L * OfflineQuota.GIB, OfflineQuota.GIB, 0L, OfflineQuota.GIB))
        assertTrue(OfflineQuota.admits(null, 10L * OfflineQuota.GIB, 0L, 10L * OfflineQuota.GIB))
    }

    @Test
    fun `attempt-root and stale authorization never produce a playable route`() {
        assertFalse(OfflineRecoveryPolicy.playable("attempts/transfer.part", true, true, true))
        assertFalse(OfflineRecoveryPolicy.playable("blobs/hash", false, true, true))
        assertFalse(OfflineRecoveryPolicy.playable("blobs/hash", true, false, true))
        assertFalse(OfflineRecoveryPolicy.playable("blobs/hash", true, true, false))
        assertTrue(OfflineRecoveryPolicy.playable("blobs/hash", true, true, true))
    }

    @Test
    fun `fresh restart default generation receipt is denied until native source authority is verified`() {
        val stale = CacheCatalogEntity("cache", "netease", "netrack_1", null, "default", "revision", "ready", 10L, 0L, "unknown", 0L, 0L)
        assertFalse(OfflineAuthorizationPolicy.permits(stale, null, "netease", "netrack_1", 50L))
        // Generation zero is not anonymous merely because a provider happens to use it.
        val unclassified = stale.copy(entitlementStatus = "account-bound", authorizationIssuedAt = 10L, authorizationExpiresAt = 100L)
        val authority = OfflineAuthorityEntity("netease", 0L, "account-bound", 10L, 100L)
        assertFalse(OfflineAuthorizationPolicy.permits(unclassified, authority, "netease", "netrack_1", 50L))
    }

    @Test
    fun `source authority is isolated and account switch or logout revokes only that source`() {
        val receipt = CacheCatalogEntity("cache", "bilibili", "track_1", null, "default", "revision", "ready", 10L, 7L, "account-bound", 10L, 100L)
        val bilibili = OfflineAuthorityEntity("bilibili", 7L, "account-bound", 10L, 100L)
        val netease = OfflineAuthorityEntity("netease", 99L, "account-bound", 10L, 100L)
        assertTrue(OfflineAuthorizationPolicy.permits(receipt, bilibili, "bilibili", "track_1", 50L))
        assertFalse(OfflineAuthorizationPolicy.permits(receipt, netease, "bilibili", "track_1", 50L))
        assertFalse(OfflineAuthorizationPolicy.permits(receipt, bilibili.copy(generation = 8L), "bilibili", "track_1", 50L))
        assertFalse(OfflineAuthorizationPolicy.permits(receipt, bilibili.copy(authState = "revoked", expiresAt = 50L), "bilibili", "track_1", 50L))
    }

    @Test
    fun `only explicitly verified anonymous free descriptor survives restart until expiry`() {
        val receipt = CacheCatalogEntity("cache", "kuwo", "track_1", null, "default", "revision", "ready", 10L, 0L, "anonymous-free", 10L, 100L)
        val anonymous = OfflineAuthorityEntity("kuwo", 0L, "anonymous-free", 10L, 100L)
        assertTrue(OfflineAuthorizationPolicy.permits(receipt, anonymous, "kuwo", "track_1", 50L))
        assertFalse(OfflineAuthorizationPolicy.permits(receipt, anonymous, "kuwo", "track_1", 100L))
        assertFalse(OfflineAuthorizationPolicy.permits(receipt.copy(entitlementStatus = "drm"), anonymous, "kuwo", "track_1", 50L))
    }
}
