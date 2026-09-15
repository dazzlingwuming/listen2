package com.listen2mobile.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaDescriptorContractTest {
    private val now = 1_700_000_000_000L

    @Test fun `descriptor has a package owned uri and no transport fields`() {
        val registry = MediaLeaseRegistry("com.dazzlingwuming.listen2.media", clock = { now })
        val descriptor = registry.register(
            requestId = "request-12345678",
            identity = MediaIdentity("bilibili", "bitrack_v_BV1xx411c7mD-12", "12", 4L),
            rendition = MediaRendition("30280", "high", "audio/mp4", "mp4", "mp4a.40.2", 180_000L, 4096L),
            transport = NativeTransport("https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1700000031", mapOf("Referer" to "https://www.bilibili.com/")),
            accountGeneration = 7L,
        )

        assertEquals("content://com.dazzlingwuming.listen2.media/lease/${descriptor.leaseId}", descriptor.playableUri)
        assertTrue(descriptor.isSafeForJs())
        assertFalse(descriptor.toString().contains("bilivideo"))
        assertEquals(LeaseStatus.ACTIVE, registry.validate(descriptor.leaseId, descriptor.identity, 7L))
    }

    @Test fun `expired cancelled forged or account mismatched lease fails closed`() {
        var clock = now
        val registry = MediaLeaseRegistry("com.dazzlingwuming.listen2.media", clock = { clock })
        val descriptor = registry.register(
            "request-12345678", MediaIdentity("bilibili", "bitrack_v_BV1xx411c7mD-12", "12", 4L),
            MediaRendition("30280", "high", "audio/mp4", "mp4", "mp4a.40.2", 180_000L, 4096L),
            NativeTransport("https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1700000031", mapOf("Referer" to "https://www.bilibili.com/")), 7L,
        )
        assertEquals(LeaseStatus.IDENTITY_MISMATCH, registry.validate(descriptor.leaseId, descriptor.identity.copy(trackId = "other"), 7L))
        assertEquals(LeaseStatus.ACCOUNT_CHANGED, registry.validate(descriptor.leaseId, descriptor.identity, 8L))
        registry.cancel("request-12345678")
        assertEquals(LeaseStatus.CANCELLED, registry.validate(descriptor.leaseId, descriptor.identity, 7L))
        assertNull(registry.transportFor("wrong", descriptor.identity, 7L))

        val expired = registry.register(
            "request-12345679", descriptor.identity, requireNotNull(descriptor.selectedRendition),
            NativeTransport("https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1700000031", mapOf("Referer" to "https://www.bilibili.com/")), 7L,
        )
        clock += MediaLeaseRegistry.MAX_TTL_MS + 1L
        assertEquals(LeaseStatus.EXPIRED, registry.validate(expired.leaseId, expired.identity, 7L))
    }

    @Test fun `api 24 only permits complete verified local playback`() {
        val remote = MediaDescriptor.downloadFirst(MediaIdentity("bilibili", "track", null, 1L))
        assertEquals(EntitlementStatus.DOWNLOAD_FIRST, remote.entitlement)
        assertNull(remote.playableUri)
        assertTrue(MediaDescriptor.verifiedLocal(MediaIdentity("bilibili", "track", null, 1L), "content://com.dazzlingwuming.listen2.media/local/key", "audio/mpeg", "mp3", "mp3", 1L).isSafeForJs())
    }

    @Test fun `proxy range policy rejects unbounded offsets and reads`() {
        assertTrue(MediaStreamPolicy.isAllowedRange(0L, 1024, 1024))
        assertFalse(MediaStreamPolicy.isAllowedRange(-1L, 1, 1))
        assertFalse(MediaStreamPolicy.isAllowedRange(0L, 256 * 1024 + 1, 256 * 1024 + 1))
        assertFalse(MediaStreamPolicy.isAllowedRange(0L, 2, 1))
    }
}
