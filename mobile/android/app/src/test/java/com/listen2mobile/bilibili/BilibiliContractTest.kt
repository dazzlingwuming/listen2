package com.listen2mobile.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BilibiliContractTest {
    private companion object { const val NOW = 1_700_000_000_000L }
    private val signedAudio = "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1700000031"

    @Test fun `semantic track identity is exact and rejects alternate cid`() {
        assertEquals(BilibiliPolicy.SemanticTrack("BV1xx411c7mD", 12L, 2L), BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD-12", 2L))
        assertNull(BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD", 1L))
        assertNull(BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD-0", 1L))
    }

    @Test fun `closed routes and WBI query reject unknown input`() {
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://passport.bilibili.com/x/passport-login/web/qrcode/generate"))
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("http://api.bilibili.com/x/web-interface/view"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/view/extra"))
        val query = BilibiliPolicy.buildWbiQuery(mapOf("bvid" to "BV1xx411c7mD", "cid" to "12", "qn" to "30280"), "0123456789abcdef0123456789abcdef", 1_700_000_000L)
        assertTrue(query!!.contains("bvid=BV1xx411c7mD"))
        assertTrue(query.contains("wts=1700000000"))
        assertTrue(query.matches(Regex(".*&w_rid=[0-9a-f]{32}")))
        assertNull(BilibiliPolicy.buildWbiQuery(mapOf("bvid" to "BV1xx411c7mD", "unknown" to "x"), "0123456789abcdef0123456789abcdef", 1L))
    }

    @Test fun `audio deadline and headers must be real and bounded`() {
        assertEquals(NOW + 31_000L, BilibiliPolicy.signedDeadline(signedAudio))
        assertTrue(BilibiliPolicy.isSafeAudioHandoff(signedAudio, mapOf("Referer" to BilibiliPolicy.FIXED_REFERER), NOW + 31_000L, NOW))
        assertFalse(BilibiliPolicy.isSafeAudioHandoff("https://example.com/audio.m4s?deadline=1700000031", mapOf("Referer" to BilibiliPolicy.FIXED_REFERER), NOW + 31_000L, NOW))
        assertFalse(BilibiliPolicy.isSafeAudioHandoff(signedAudio, mapOf("Referer" to BilibiliPolicy.FIXED_REFERER, "Cookie" to "secret"), NOW + 31_000L, NOW))
        assertFalse(BilibiliPolicy.isSafeAudioHandoff(signedAudio, mapOf("Referer" to BilibiliPolicy.FIXED_REFERER), NOW + 31_000L, NOW + 2_000L))
        assertNull(BilibiliPolicy.signedDeadline("https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1700000001&deadline=1700000031"))
        assertNull(BilibiliPolicy.signedDeadline("https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=not-a-signature"))
    }

    @Test fun `audio candidates require safe MIME codec and bounded alternatives`() {
        val valid = BilibiliPolicy.MediaCandidate(30280L, signedAudio, "audio/mp4", "mp4a.40.2", false)
        val lower = BilibiliPolicy.MediaCandidate(30216L, signedAudio, "audio/mp4", "mp4a.40.5", false)
        assertEquals(valid, BilibiliPolicy.selectAudioCandidate(listOf(lower, valid), NOW))
        assertNull(BilibiliPolicy.selectAudioCandidate(listOf(valid.copy(mimeType = "audio/webm")), NOW))
        assertNull(BilibiliPolicy.selectAudioCandidate(listOf(valid.copy(codecs = "opus")), NOW))
        assertNull(BilibiliPolicy.selectAudioCandidate(listOf(valid.copy(hasAlternateUrl = true)), NOW))
        assertNull(BilibiliPolicy.selectAudioCandidate(List(5) { valid.copy(id = it.toLong() + 1) }, NOW))
    }

    @Test fun `qr exposes waiting scanned expired authenticated and cancellation states`() {
        val gateway = FakeGateway()
        val session = BilibiliSession(gateway, FakeVault(), FakeQrRenderer())
        val begin = session.begin(NOW)
        assertEquals(BilibiliSession.PublicStatus.WAITING, begin.status)
        gateway.pollResult = BilibiliSession.PollResult.Scanned
        assertEquals(BilibiliSession.PublicStatus.SCANNED, session.poll(begin.attemptId, NOW + 1).status)
        gateway.pollResult = BilibiliSession.PollResult.Expired
        assertEquals(BilibiliSession.PublicStatus.EXPIRED, session.poll(begin.attemptId, NOW + 2).status)
        val second = session.begin(NOW + 3)
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, session.cancel(second.attemptId).status)
        assertEquals(listOf("provider-key"), gateway.cancelledKeys)
        val third = session.begin(NOW + 4)
        gateway.pollResult = BilibiliSession.PollResult.Authenticated("refresh-material")
        assertEquals(BilibiliSession.PublicStatus.AUTHENTICATED, session.poll(third.attemptId, NOW + 5).status)
    }

    @Test fun `stale and cancelled polls cannot make a late response authenticated`() {
        val gateway = FakeGateway().apply { pollResult = BilibiliSession.PollResult.Authenticated("refresh-material") }
        val session = BilibiliSession(gateway, FakeVault(), FakeQrRenderer())
        val begin = session.begin(NOW)
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, session.poll("other-attempt", NOW + 1).status)
        assertFalse(gateway.polled)
        session.cancel(begin.attemptId)
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, session.poll(begin.attemptId, NOW + 2).status)
        assertFalse(gateway.polled)
    }

    @Test fun `provider cancellation is terminal and removes the QR attempt`() {
        val gateway = FakeGateway().apply {
            pollResult = BilibiliSession.PollResult.Failed(BilibiliPolicy.ErrorCode.CANCELLED)
        }
        val session = BilibiliSession(gateway, FakeVault(), FakeQrRenderer())
        val begin = session.begin(NOW)
        val state = session.poll(begin.attemptId, NOW + 1)
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, state.status)
        assertEquals("", state.attemptId)
        assertEquals("", state.qrPngDataUri)
    }

    @Test fun `authenticated session persists native material but public state contains no secret`() {
        val gateway = FakeGateway().apply { pollResult = BilibiliSession.PollResult.Authenticated("refresh-material") }
        val vault = FakeVault()
        val session = BilibiliSession(gateway, vault, FakeQrRenderer())
        val begin = session.begin(NOW)
        val state = session.poll(begin.attemptId, NOW + 1)
        assertEquals(BilibiliSession.PublicStatus.AUTHENTICATED, state.status)
        assertEquals("refresh-material", vault.saved?.refreshMaterial)
        assertFalse(state.toString().contains("refresh-material"))
        assertEquals("logout", state.nextAction)
    }

    @Test fun `restore refreshes native vault material then validates account`() {
        val stored = BilibiliVault.SessionMaterial("old-refresh", "SESSDATA=opaque", "csrf")
        val vault = FakeVault().apply { loaded = stored }
        val gateway = FakeGateway().apply {
            refreshed = BilibiliVault.SessionMaterial("new-refresh", "SESSDATA=new", "new-csrf")
            accountValue = BilibiliGateway.Account("listener", "https://i0.hdslb.com/avatar.png")
        }
        val state = BilibiliSession(gateway, vault, FakeQrRenderer()).restore()
        assertEquals(BilibiliSession.PublicStatus.AUTHENTICATED, state.status)
        assertEquals(stored, gateway.restoredMaterial)
        assertEquals("new-refresh", vault.saved?.refreshMaterial)
        assertFalse(state.toString().contains("new-refresh"))
    }

    @Test fun `restore failure clears vault and gateway without exposing session material`() {
        val vault = FakeVault().apply { loaded = BilibiliVault.SessionMaterial("refresh", "SESSDATA=opaque", "csrf") }
        val gateway = FakeGateway().apply { refreshed = null }
        val state = BilibiliSession(gateway, vault, FakeQrRenderer()).restore()
        assertEquals(BilibiliSession.PublicStatus.IDLE, state.status)
        assertTrue(vault.cleared)
        assertTrue(gateway.loggedOut)
        assertFalse(state.toString().contains("SESSDATA"))
    }

    @Test fun `vault decrypt failure fails closed before any public session state`() {
        val vault = FakeVault().apply { loadFails = true }
        val state = BilibiliSession(FakeGateway(), vault, FakeQrRenderer()).restore()
        assertEquals(BilibiliSession.PublicStatus.IDLE, state.status)
        assertTrue(vault.cleared)
        assertFalse(state.toString().contains("refresh"))
    }

    @Test fun `vault persistence failure fails closed and logs out the native gateway`() {
        val vault = FakeVault().apply { saveFails = true }
        val gateway = FakeGateway().apply {
            pollResult = BilibiliSession.PollResult.Authenticated("refresh-material")
        }
        val session = BilibiliSession(gateway, vault, FakeQrRenderer())
        val state = session.poll(session.begin(NOW).attemptId, NOW + 1)
        assertEquals(BilibiliSession.PublicStatus.ERROR, state.status)
        assertTrue(vault.cleared)
        assertTrue(gateway.loggedOut)
    }

    private class FakeQrRenderer : BilibiliQrRenderer.Renderer {
        override fun render(value: String): String = "data:image/png;base64,AA=="
    }

    private class FakeVault : BilibiliVault.Store {
        var saved: BilibiliVault.SessionMaterial? = null
        var loaded: BilibiliVault.SessionMaterial? = null
        var cleared = false
        var loadFails = false
        var saveFails = false
        override fun isAvailable() = true
        override fun saveSession(material: BilibiliVault.SessionMaterial) {
            if (saveFails) throw IllegalStateException("persist-failed")
            saved = material
        }
        override fun loadSession(): BilibiliVault.SessionMaterial? {
            if (loadFails) throw IllegalStateException("decrypt-failed")
            return loaded
        }
        override fun clear() { saved = null; loaded = null; cleared = true }
    }

    private class FakeGateway : BilibiliGateway {
        var polled = false
        var pollResult: BilibiliSession.PollResult = BilibiliSession.PollResult.Waiting
        var cancelledKeys = mutableListOf<String>()
        var restoredMaterial: BilibiliVault.SessionMaterial? = null
        var refreshed: BilibiliVault.SessionMaterial? = BilibiliVault.SessionMaterial("refreshed", "SESSDATA=opaque", "csrf")
        var accountValue: BilibiliGateway.Account? = BilibiliGateway.Account("listener", null)
        var loggedOut = false
        override fun beginQr() = BilibiliSession.QrChallenge("provider-key", "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=provider-key", NOW + 10_000L)
        override fun pollQr(qrKey: String): BilibiliSession.PollResult { polled = true; return pollResult }
        override fun cancelPoll(qrKey: String) { cancelledKeys += qrKey }
        override fun exportSession(refreshMaterial: String) = BilibiliVault.SessionMaterial(refreshMaterial, "SESSDATA=opaque", "csrf")
        override fun restoreSession(material: BilibiliVault.SessionMaterial) { restoredMaterial = material }
        override fun refresh(material: BilibiliVault.SessionMaterial) = refreshed
        override fun logout() { loggedOut = true }
        override fun account() = accountValue
        override fun videoDetail(bvid: String) = throw UnsupportedOperationException()
        override fun resolveAudio(track: BilibiliPolicy.SemanticTrack) = throw UnsupportedOperationException()
    }
}
