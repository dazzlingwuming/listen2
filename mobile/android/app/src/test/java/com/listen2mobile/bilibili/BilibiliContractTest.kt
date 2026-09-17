package com.listen2mobile.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class BilibiliContractTest {
    @Test fun `revocation serializes with media lease issuance and rejects a stale generation`() {
        val gate = BilibiliAccountGenerationGate()
        val requestGeneration = gate.snapshot()
        val issuanceEntered = CountDownLatch(1)
        val allowIssuance = CountDownLatch(1)
        val revocationCompleted = CountDownLatch(1)
        val issuedGeneration = AtomicReference<Long?>()

        val issuer = Thread {
            issuedGeneration.set(gate.withCurrent(requestGeneration) { generation ->
                issuanceEntered.countDown()
                assertTrue(allowIssuance.await(1, TimeUnit.SECONDS))
                generation
            })
        }
        issuer.start()
        assertTrue(issuanceEntered.await(1, TimeUnit.SECONDS))
        val revoker = Thread { gate.revoke { revocationCompleted.countDown() } }
        revoker.start()
        assertFalse(revocationCompleted.await(100, TimeUnit.MILLISECONDS))

        allowIssuance.countDown()
        issuer.join(1_000)
        revoker.join(1_000)
        assertEquals(requestGeneration, issuedGeneration.get())
        assertTrue(revocationCompleted.await(1, TimeUnit.SECONDS))
        assertNull(gate.withCurrent(requestGeneration) { it })
        assertFalse(gate.runIfCurrent(requestGeneration) { })
    }

    @Test fun `HTTP security rejection is terminal provider policy not offline`() {
        assertEquals(BilibiliPolicy.ErrorCode.PROVIDER_ERROR, BilibiliPolicy.errorForHttpStatus(412))
        assertEquals("security-policy", BilibiliPolicy.statusDiagnostic(412))
        assertEquals(BilibiliPolicy.ErrorCode.REQUEST_TIMEOUT, BilibiliPolicy.errorForHttpStatus(429))
        assertEquals(BilibiliPolicy.ErrorCode.LOGIN_REQUIRED, BilibiliPolicy.errorForHttpStatus(403))
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
        val SESSION_COOKIES = mapOf("SESSDATA" to "opaque", "bili_jct" to "csrf")
    }
    private val signedAudio = "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1700000031"

    @Test fun `semantic track identity is exact and rejects alternate cid`() {
        assertEquals(BilibiliPolicy.SemanticTrack("BV1xx411c7mD", 12L, 2L), BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD-12", 2L))
        assertNull(BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD", 1L))
        assertNull(BilibiliPolicy.parseSemanticTrack("bitrack_v_BV1xx411c7mD-0", 1L))
    }

    @Test fun `closed routes and WBI query reject unknown input`() {
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://passport.bilibili.com/x/passport-login/web/qrcode/generate"))
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD"))
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=x"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/search/type?keyword=x"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=provider-key"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("http://api.bilibili.com/x/web-interface/view"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/view/extra"))
        val query = BilibiliPolicy.buildWbiQuery(mapOf("bvid" to "BV1xx411c7mD", "cid" to "12", "qn" to "30280"), "0123456789abcdef0123456789abcdef", 1_700_000_000L)
        assertTrue(query!!.contains("bvid=BV1xx411c7mD"))
        assertTrue(query.contains("wts=1700000000"))
        assertTrue(query.matches(Regex(".*&w_rid=[0-9a-f]{32}")))
        assertNull(BilibiliPolicy.buildWbiQuery(mapOf("bvid" to "BV1xx411c7mD", "unknown" to "x"), "0123456789abcdef0123456789abcdef", 1L))
        val searchQuery = BilibiliPolicy.buildWbiSearchQuery("青花瓷", 2L, "0123456789abcdef0123456789abcdef", 1_700_000_000L)
        assertTrue(searchQuery!!.contains("keyword=%E9%9D%92%E8%8A%B1%E7%93%B7"))
        assertTrue(searchQuery.contains("page=2"))
        assertTrue(searchQuery.contains("page_size=42"))
        assertTrue(searchQuery.matches(Regex(".*&w_rid=[0-9a-f]{32}")))
        assertNull(BilibiliPolicy.buildWbiSearchQuery("x".repeat(BilibiliPolicy.MAX_SEARCH_QUERY_BYTES + 1), 1L, "0123456789abcdef0123456789abcdef", 1L))
        assertNull(BilibiliPolicy.buildWbiSearchQuery("x", 0L, "0123456789abcdef0123456789abcdef", 1L))
        val directSearch = BilibiliPolicy.buildDirectSearchQuery("青花瓷", 2L)
        assertTrue(directSearch!!.contains("keyword=%E9%9D%92%E8%8A%B1%E7%93%B7"))
        assertTrue(directSearch.contains("page=2"))
        assertFalse(directSearch.contains("w_rid"))
        assertTrue(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/search/type?$directSearch"))
        assertFalse(BilibiliPolicy.isApprovedApiRoute("https://api.bilibili.com/x/web-interface/search/type?$directSearch&attacker=1"))
    }

    @Test fun `qr urls accept current and exact legacy routes`() {
        val current = "https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=login&qrcode_key=provider-key&from="
        val legacy = "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=provider-key"
        assertTrue(BilibiliPolicy.isApprovedQrUrl(current, "provider-key"))
        assertTrue(BilibiliPolicy.isApprovedQrUrl(legacy, "provider-key"))
    }

    @Test fun `qr url validation rejects route and query mismatches`() {
        val current = "https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=login&qrcode_key=provider-key&from="
        assertFalse(BilibiliPolicy.isApprovedQrUrl(current.replace("https://", "http://"), "provider-key"))
        assertFalse(BilibiliPolicy.isApprovedQrUrl(current.replace("account.bilibili.com", "evil.example"), "provider-key"))
        assertFalse(BilibiliPolicy.isApprovedQrUrl(current.replace("/scan-web", "/scan-web/extra"), "provider-key"))
        assertFalse(BilibiliPolicy.isApprovedQrUrl("$current#fragment", "provider-key"))
        assertFalse(BilibiliPolicy.isApprovedQrUrl(current.replace("from=", "unexpected=1"), "provider-key"))
        assertFalse(BilibiliPolicy.isApprovedQrUrl(current, "different-key"))
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

    @Test fun `audio candidates require safe primary MIME codec and ignore untransported backups`() {
        val valid = BilibiliPolicy.MediaCandidate(30280L, signedAudio, "audio/mp4", "mp4a.40.2", false)
        val lower = BilibiliPolicy.MediaCandidate(30216L, signedAudio, "audio/mp4", "mp4a.40.5", false)
        assertEquals(valid, BilibiliPolicy.selectAudioCandidate(listOf(lower, valid), NOW))
        assertNull(BilibiliPolicy.selectAudioCandidate(listOf(valid.copy(mimeType = "audio/webm")), NOW))
        assertNull(BilibiliPolicy.selectAudioCandidate(listOf(valid.copy(codecs = "opus")), NOW))
        assertEquals(valid, BilibiliPolicy.selectAudioCandidate(listOf(valid, valid.copy(id = 30296L, mimeType = "audio/webm", codecs = "opus")), NOW))
        assertEquals(valid.copy(hasAlternateUrl = true), BilibiliPolicy.selectAudioCandidate(listOf(valid.copy(hasAlternateUrl = true)), NOW))
        assertNull(BilibiliPolicy.selectAudioCandidate(List(9) { valid.copy(id = it.toLong() + 1) }, NOW))
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
        val stored = BilibiliVault.SessionMaterial("old-refresh", SESSION_COOKIES, "csrf")
        val vault = FakeVault().apply { loaded = stored }
        val gateway = FakeGateway().apply {
            refreshed = BilibiliVault.SessionMaterial("new-refresh", mapOf("SESSDATA" to "new", "bili_jct" to "new-csrf"), "new-csrf")
            accountValue = BilibiliGateway.Account("listener", "https://i0.hdslb.com/avatar.png")
        }
        val state = BilibiliSession(gateway, vault, FakeQrRenderer()).restore()
        assertEquals(BilibiliSession.PublicStatus.AUTHENTICATED, state.status)
        assertEquals(listOf(stored, gateway.refreshed), gateway.restoredMaterials)
        assertEquals("new-refresh", vault.saved?.refreshMaterial)
        assertFalse(vault.provisional)
        assertFalse(state.toString().contains("new-refresh"))
    }

    @Test fun `restore failure clears vault and gateway without exposing session material`() {
        val vault = FakeVault().apply { loaded = BilibiliVault.SessionMaterial("refresh", SESSION_COOKIES, "csrf") }
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

    @Test fun `cancelling during account validation prevents session persistence and authentication`() {
        val accountStarted = CountDownLatch(1)
        val allowAccountResult = CountDownLatch(1)
        val gateway = FakeGateway().apply {
            pollResult = BilibiliSession.PollResult.Authenticated("refresh-material")
            beforeAccount = {
                accountStarted.countDown()
                assertTrue(allowAccountResult.await(2, TimeUnit.SECONDS))
            }
        }
        val vault = FakeVault()
        val session = BilibiliSession(gateway, vault, FakeQrRenderer())
        val begin = session.begin(NOW)
        val polled = AtomicReference<BilibiliSession.PublicState>()
        val worker = Thread { polled.set(session.poll(begin.attemptId, NOW + 1)) }
        worker.start()
        assertTrue(accountStarted.await(2, TimeUnit.SECONDS))
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, session.cancel(begin.attemptId).status)
        allowAccountResult.countDown()
        worker.join(2_000L)
        assertFalse(worker.isAlive)
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, polled.get().status)
        assertNull(vault.saved)
        assertFalse(session.snapshot().status == BilibiliSession.PublicStatus.AUTHENTICATED)
    }

    @Test fun `cancelling at provisional save leaves no restorable session after restart`() {
        val vault = FakeVault()
        val gateway = FakeGateway().apply {
            pollResult = BilibiliSession.PollResult.Authenticated("refresh-material")
        }
        val session = BilibiliSession(gateway, vault, FakeQrRenderer())
        val begin = session.begin(NOW)
        vault.afterProvisionalSave = { session.cancel(begin.attemptId) }
        val state = session.poll(begin.attemptId, NOW + 1)
        assertEquals(BilibiliSession.PublicStatus.CANCELLED, state.status)
        assertNull(vault.saved)
        assertEquals(
            BilibiliSession.PublicStatus.IDLE,
            BilibiliSession(FakeGateway(), vault, FakeQrRenderer()).restore().status,
        )
    }

    @Test fun `old owner revocation cannot remove a newer committed session`() {
        val vault = FakeVault()
        val old = BilibiliVault.SessionMaterial("old", SESSION_COOKIES, "csrf", "old-owner")
        val newer = BilibiliVault.SessionMaterial("new", SESSION_COOKIES, "csrf", "new-owner")
        vault.saveProvisionalSession(old)
        vault.saveCommittedSession(newer)
        vault.clearIfOwned("old-owner")
        assertEquals(newer, vault.loadSession())
    }

    @Test fun `a provisional envelope is rejected on process restart`() {
        val vault = FakeVault()
        vault.saveProvisionalSession(
            BilibiliVault.SessionMaterial("refresh", SESSION_COOKIES, "csrf", "pending-owner"),
        )
        assertEquals(
            BilibiliSession.PublicStatus.IDLE,
            BilibiliSession(FakeGateway(), vault, FakeQrRenderer()).restore().status,
        )
        assertNull(vault.saved)
    }

    @Test fun `a committed QR session remains restorable after process restart`() {
        val vault = FakeVault()
        val firstGateway = FakeGateway().apply {
            pollResult = BilibiliSession.PollResult.Authenticated("refresh-material")
        }
        val firstSession = BilibiliSession(firstGateway, vault, FakeQrRenderer())
        val begin = firstSession.begin(NOW)
        assertEquals(BilibiliSession.PublicStatus.AUTHENTICATED, firstSession.poll(begin.attemptId, NOW + 1).status)
        assertFalse(vault.provisional)
        val restarted = BilibiliSession(FakeGateway(), vault, FakeQrRenderer()).restore()
        assertEquals(BilibiliSession.PublicStatus.AUTHENTICATED, restarted.status)
        assertEquals("logout", restarted.nextAction)
    }

    private class FakeQrRenderer : BilibiliQrRendererContract {
        override fun render(value: String): String = "data:image/png;base64,AA=="
    }

    private class FakeVault : BilibiliVaultStore {
        var saved: BilibiliVault.SessionMaterial? = null
        var loaded: BilibiliVault.SessionMaterial? = null
        var cleared = false
        var loadFails = false
        var saveFails = false
        var provisional = false
        var afterProvisionalSave: (() -> Unit)? = null
        override fun isAvailable() = true
        override fun saveProvisionalSession(material: BilibiliVault.SessionMaterial) {
            if (saveFails) throw IllegalStateException("persist-failed")
            saved = material
            provisional = true
            afterProvisionalSave?.invoke()
        }
        override fun commitProvisionalSession(ownerId: String): Boolean {
            if (saved?.ownerId != ownerId || !provisional) return false
            provisional = false
            return true
        }
        override fun saveCommittedSession(material: BilibiliVault.SessionMaterial) {
            if (saveFails) throw IllegalStateException("persist-failed")
            saved = material
            provisional = false
        }
        override fun loadSession(): BilibiliVault.SessionMaterial? {
            if (loadFails) throw IllegalStateException("decrypt-failed")
            if (provisional) {
                saved?.ownerId?.let { clearIfOwned(it) }
                return null
            }
            return loaded ?: saved
        }
        override fun clearIfOwned(ownerId: String) {
            if (saved?.ownerId == ownerId) {
                saved = null
                provisional = false
                cleared = true
            }
        }
        override fun clear() { saved = null; loaded = null; provisional = false; cleared = true }
    }

    private class FakeGateway : BilibiliGateway {
        var polled = false
        var pollResult: BilibiliSession.PollResult = BilibiliSession.PollResult.Waiting
        var cancelledKeys = mutableListOf<String>()
        val restoredMaterials = mutableListOf<BilibiliVault.SessionMaterial>()
        var refreshed: BilibiliVault.SessionMaterial? = BilibiliVault.SessionMaterial("refreshed", SESSION_COOKIES, "csrf")
        var accountValue: BilibiliGateway.Account? = BilibiliGateway.Account("listener", null)
        var beforeAccount: (() -> Unit)? = null
        var loggedOut = false
        override fun beginQr() = BilibiliSession.QrChallenge("provider-key", "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=provider-key", NOW + 10_000L)
        override fun pollQr(qrKey: String): BilibiliSession.PollResult { polled = true; return pollResult }
        override fun cancelPoll(qrKey: String) { cancelledKeys += qrKey }
        override fun exportSession(refreshMaterial: String) = BilibiliVault.SessionMaterial(refreshMaterial, SESSION_COOKIES, "csrf")
        override fun restoreSession(material: BilibiliVault.SessionMaterial) { restoredMaterials += material }
        override fun refresh(material: BilibiliVault.SessionMaterial) = refreshed
        override fun logout() { loggedOut = true }
        override fun account(): BilibiliGateway.Account? {
            beforeAccount?.invoke()
            return accountValue
        }
        override fun videoDetail(bvid: String) = throw UnsupportedOperationException()
        override fun resolveAudio(track: BilibiliPolicy.SemanticTrack) = throw UnsupportedOperationException()
    }
}
