package com.listen2mobile.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BilibiliRenditionEntitlementTest {
    @Test fun `part and rendition membership are provider owned`() {
        val part = BilibiliPolicy.AuthorizedPart(12L, 1L)
        assertEquals(part, BilibiliPolicy.authorizePart(listOf(part), 12L, 1L))
        assertNull(BilibiliPolicy.authorizePart(listOf(part), 13L, 1L))
        val rendition = BilibiliPolicy.AuthorizedRendition("30280", "high", "audio/mp4", "mp4a.40.2")
        assertEquals(rendition, BilibiliPolicy.authorizeRendition(listOf(rendition), "30280"))
        assertNull(BilibiliPolicy.authorizeRendition(listOf(rendition), "99999"))
        assertNull(BilibiliPolicy.authorizeRendition(listOf(rendition.copy(codec = "opus")), "30280"))
    }

    @Test fun `account generation invalidates an already authorized mv handle`() {
        val controller = BilibiliMvController(FakeGateway(), clock = { NOW })
        val opened = controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", listOf("avc1"), false, 0L))
        assertEquals(BilibiliMvController.State.READY, opened.state)
        assertEquals(BilibiliMvController.State.CLOSED, controller.setAccountGeneration(1L).state)
        assertEquals(BilibiliPolicy.ErrorCode.INVALID_REQUEST, controller.sync(opened.handle, "BV1xx411c7mD", 12L, 1L, true).errorCode)
        assertEquals(BilibiliPolicy.ErrorCode.CANCELLED, controller.open(BilibiliMvPolicy.MvRequest("BV1xx411c7mD", 12L, "80", emptyList(), false, 0L)).errorCode)
    }

    private class FakeGateway : BilibiliGateway {
        override fun beginQr() = throw UnsupportedOperationException()
        override fun pollQr(qrKey: String) = throw UnsupportedOperationException()
        override fun cancelPoll(qrKey: String) = Unit
        override fun exportSession(refreshMaterial: String) = throw UnsupportedOperationException()
        override fun restoreSession(material: BilibiliVault.SessionMaterial) = Unit
        override fun refresh(material: BilibiliVault.SessionMaterial) = null
        override fun logout() = Unit
        override fun account() = null
        override fun videoDetail(bvid: String) = BilibiliGateway.VideoDetail(bvid, "title", null, listOf(BilibiliGateway.VideoPart(12L, 1L, "part", null)))
        override fun resolveAudio(track: BilibiliPolicy.SemanticTrack): BilibiliPolicy.AudioHandoff = throw UnsupportedOperationException()
        override fun resolveVideo(request: BilibiliMvPolicy.MvRequest) = BilibiliMvPolicy.VideoManifest(request.bvid, request.cid, listOf(BilibiliMvPolicy.VideoCandidate(80, "HD", "https://upos-sz-mirrorcos.bilivideo.com/video.m4s?deadline=1700000031", "video/mp4", "avc1.640028", 1920, 1080, 60, "video")))
    }
    private companion object { const val NOW = 1_700_000_000_000L }
}
