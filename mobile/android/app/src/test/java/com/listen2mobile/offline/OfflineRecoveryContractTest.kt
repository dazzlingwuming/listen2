package com.listen2mobile.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

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
}
