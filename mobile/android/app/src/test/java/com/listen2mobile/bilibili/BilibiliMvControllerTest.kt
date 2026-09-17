package com.listen2mobile.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BilibiliMvControllerTest {
    private val now = 1_700_000_000_000L
    private val candidate = BilibiliMvPolicy.VideoCandidate(80, "HD", "https://upos-sz-mirrorcos.bilivideo.com/video.m4s?deadline=1700000031", "video/mp4", "avc1.640028", 1920, 1080, 60, "video", false)

    @Test fun `open returns opaque handle and never projects signed transport`() {
        val controller = BilibiliMvController(FakeGateway(candidate), clock = { now })
        val state = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", listOf("avc1"), false))
        assertEquals(BilibiliMvController.State.READY, state.state)
        assertFalse(state.toString().contains("bilivideo.com"))
        assertFalse(state.toString().contains("deadline"))
        assertTrue(state.handle.length >= 16)
    }

    @Test fun `stale handle cannot mutate newer generation and refresh is bounded`() {
        val controller = BilibiliMvController(FakeGateway(candidate), clock = { now })
        val first = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", listOf("avc1"), false))
        val second = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", listOf("avc1"), true))
        assertNotEquals(first.handle, second.handle)
        assertEquals(BilibiliPolicy.ErrorCode.INVALID_REQUEST, controller.sync(first.handle, "BV1xx411c7mD", 12L, 1_000L, true).errorCode)
        val refreshed = controller.refresh(second.handle)
        assertEquals(BilibiliMvController.State.READY, refreshed.state)
        assertNotEquals(second.handle, refreshed.handle)
        assertEquals(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE, controller.refresh(refreshed.handle).errorCode)
    }

    @Test fun `cancel invalidates the active handle and rejects later mutations`() {
        val controller = BilibiliMvController(FakeGateway(candidate), clock = { now })
        val opened = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", listOf("avc1"), false))
        val cancelled = controller.cancel()
        assertEquals(BilibiliMvController.State.CLOSED, cancelled.state)
        assertEquals(BilibiliPolicy.ErrorCode.CANCELLED, cancelled.errorCode)
        assertEquals(BilibiliPolicy.ErrorCode.INVALID_REQUEST, controller.sync(opened.handle, "BV1xx411c7mD", 12L, 500L, true).errorCode)
    }

    @Test fun `public variants exclude unsafe and unsupported siblings`() {
        val unsupported = candidate.copy(id = 64, codecs = "hev1.2.4.L156.90")
        val unsafe = candidate.copy(id = 32, url = "https://example.com/video.m4s?deadline=1700000031")
        val controller = BilibiliMvController(FakeGateway(listOf(candidate, unsupported, unsafe)), clock = { now })

        val state = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", listOf("avc1"), false))

        assertEquals(BilibiliMvController.State.READY, state.state)
        assertEquals(listOf("80"), state.variants.map { it.id })
    }

    private class FakeGateway(private val candidates: List<BilibiliMvPolicy.VideoCandidate>) : BilibiliGateway {
        constructor(candidate: BilibiliMvPolicy.VideoCandidate) : this(listOf(candidate))
        override fun beginQr() = throw UnsupportedOperationException()
        override fun pollQr(qrKey: String) = throw UnsupportedOperationException()
        override fun cancelPoll(qrKey: String) = Unit
        override fun exportSession(refreshMaterial: String) = throw UnsupportedOperationException()
        override fun restoreSession(material: BilibiliVault.SessionMaterial) = Unit
        override fun refresh(material: BilibiliVault.SessionMaterial) = null
        override fun logout() = Unit
        override fun account() = null
        override fun videoDetail(bvid: String) = BilibiliGateway.VideoDetail(bvid, "title", null, listOf(BilibiliGateway.VideoPart(12L, 1L, "part", null)))
        override fun resolveAudio(track: BilibiliPolicy.SemanticTrack) = throw UnsupportedOperationException()
        override fun resolveVideo(request: BilibiliMvPolicy.MvRequest) = BilibiliMvPolicy.VideoManifest(request.bvid, request.cid, candidates)
    }
}
