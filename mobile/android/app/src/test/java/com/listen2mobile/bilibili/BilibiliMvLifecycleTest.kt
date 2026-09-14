package com.listen2mobile.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class BilibiliMvLifecycleTest {
    private val now = 1_700_000_000_000L
    private val candidate = BilibiliMvPolicy.VideoCandidate(80, "HD", "https://upos-sz-mirrorcos.bilivideo.com/video.m4s?deadline=1700000031", "video/mp4", "avc1.640028", 1920, 1080, 60, "video", false)

    @Test fun `detach snapshot and recreation retain semantic identity but not opaque transport`() {
        val controller = BilibiliMvController(FakeGateway(candidate), clock = { now })
        val opened = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", listOf("avc1"), false))
        controller.sync(opened.handle, 7_000L, true)
        val snapshot = controller.semanticSnapshot()!!
        assertFalse(snapshot.toString().contains(opened.handle))
        assertFalse(snapshot.toString().contains("bilivideo.com"))
        assertNotNull(controller.surfaceBinding(opened.handle))
        val recreated = controller.restoreSemantic(snapshot)
        assertNotEquals(opened.handle, recreated.handle)
        assertEquals("BV1xx411c7mD", recreated.bvid)
        assertEquals("12", recreated.cid)
    }

    @Test fun `close or surface error clears signed candidate without touching audio controller`() {
        val controller = BilibiliMvController(FakeGateway(candidate), clock = { now })
        val opened = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", emptyList(), false))
        val failed = controller.surfaceFailed(opened.handle)
        assertNull(controller.surfaceBinding(opened.handle))
        assertEquals(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE, failed.errorCode)
    }

    private class FakeGateway(private val candidate: BilibiliMvPolicy.VideoCandidate) : BilibiliGateway {
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
        override fun resolveVideo(request: BilibiliMvPolicy.MvRequest) = BilibiliMvPolicy.VideoManifest(request.bvid, request.cid, listOf(candidate))
    }
}
