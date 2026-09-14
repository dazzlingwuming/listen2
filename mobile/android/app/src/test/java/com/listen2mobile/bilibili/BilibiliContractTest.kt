package com.listen2mobile.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BilibiliContractTest {
    @Test fun `semantic track identity is exact and rejects alternate cid`() {
        assertEquals(
            BilibiliPolicy.SemanticTrack("BV1xx411c7mD", 12L, 2L),
            BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD-12", 2L),
        )
        assertNull(BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD", 1L))
        assertNull(BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD-0", 1L))
    }

    @Test fun `fixed policy accepts only closed api routes`() {
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://passport.bilibili.com/x/passport-login/web/qrcode/generate"))
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("http://api.bilibili.com/x/web-interface/view"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/view/extra"))
    }

    @Test fun `audio handoff is bounded and does not permit credential headers`() {
        val now = 1_000_000L
        assertTrue(BilibiliPolicy.isSafeAudioHandoff(
            "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s",
            mapOf("Referer" to "https://www.bilibili.com/"), now + 30_001L, now,
        ))
        assertFalse(BilibiliPolicy.isSafeAudioHandoff(
            "https://example.com/audio.m4s", mapOf("Referer" to "https://www.bilibili.com/"), now + 60_000L, now,
        ))
        assertFalse(BilibiliPolicy.isSafeAudioHandoff(
            "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s", mapOf("Cookie" to "x"), now + 60_000L, now,
        ))
        assertFalse(BilibiliPolicy.isSafeAudioHandoff(
            "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s", mapOf("Referer" to "https://www.bilibili.com/"), now + 1_000L, now,
        ))
    }

    @Test fun `session suppresses stale poll and clears terminal qr material`() {
        val gateway = FakeGateway()
        val vault = FakeVault()
        val session = BilibiliSession(gateway, vault, FakeQrRenderer())
        val begin = session.begin(100L)
        assertEquals(BilibiliSession.PublicStatus.WAITING, begin.status)
        assertTrue(begin.attemptId.isNotBlank())
        assertTrue(begin.qrPngDataUri.startsWith("data:image/png;base64,"))
        val stale = session.poll("other-attempt", 101L)
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, stale.status)
        assertEquals("", stale.qrPngDataUri)
        assertFalse(gateway.polled)
    }

    @Test fun `successful poll persists only native refresh material and hides it`() {
        val gateway = FakeGateway().apply { pollResult = BilibiliSession.PollResult.Authenticated("refresh-material") }
        val vault = FakeVault()
        val session = BilibiliSession(gateway, vault, FakeQrRenderer())
        val begin = session.begin(100L)
        val state = session.poll(begin.attemptId, 101L)
        assertEquals(BilibiliSession.PublicStatus.AUTHENTICATED, state.status)
        assertEquals("refresh-material", vault.saved)
        assertEquals("", state.attemptId)
        assertEquals("", state.qrPngDataUri)
    }

    private class FakeQrRenderer : BilibiliQrRenderer.Renderer {
        override fun render(value: String): String = "data:image/png;base64,AA=="
    }

    private class FakeVault : BilibiliVault.Store {
        var saved: String? = null
        override fun isAvailable() = true
        override fun saveRefreshMaterial(value: String) { saved = value }
        override fun clear() { saved = null }
    }

    private class FakeGateway : BilibiliGateway {
        var polled = false
        var pollResult: BilibiliSession.PollResult = BilibiliSession.PollResult.Waiting
        override fun beginQr() = BilibiliSession.QrChallenge("provider-key", "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=provider-key", 10_000L)
        override fun pollQr(qrKey: String): BilibiliSession.PollResult { polled = true; return pollResult }
        override fun logout() = Unit
        override fun account() = null
        override fun videoDetail(bvid: String) = throw UnsupportedOperationException()
        override fun resolveAudio(track: BilibiliPolicy.SemanticTrack) = throw UnsupportedOperationException()
    }
}
