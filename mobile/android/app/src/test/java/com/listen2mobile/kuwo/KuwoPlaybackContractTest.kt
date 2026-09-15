package com.listen2mobile.kuwo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom

class KuwoPlaybackContractTest {
    private companion object {
        const val COOKIE = "Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324"
        const val TRACK_ID = "kwtrack_123456"
        const val REQUEST_ID = "kuwo-request-1"
        const val NOW = 1_700_000_000_000L
    }

    @Test
    fun secretUsesDecimalNumericNonceAndFixedRoute() {
        assertEquals(
            "452fda90010b117cb165a7af6d0012d687",
            KuwoPlaybackPolicy.secret("fixture-token", COOKIE, 1_234_567L),
        )
        assertEquals("0012d687", KuwoPlaybackPolicy.nonceHex(1_234_567L))
        assertEquals(null, KuwoPlaybackPolicy.nonceHex(-1))
        assertEquals(null, KuwoPlaybackPolicy.nonceHex(4_294_967_296L))
        repeat(16) {
            val nonce = KuwoPlaybackPolicy.secureNonce(SecureRandom())
            assertTrue(nonce in 0L..0xffffffffL)
            assertTrue(requireNotNull(KuwoPlaybackPolicy.nonceHex(nonce)).matches(Regex("[0-9a-f]{8}")))
        }
        assertEquals("123456", KuwoPlaybackPolicy.parseSemanticTrack(TRACK_ID)?.mid)

        val transport = FixtureTransport()
        val descriptor = KuwoPlaybackGateway(transport, clock = { NOW }, nonce = { 1_234_567L })
            .resolve(REQUEST_ID, requireNotNull(KuwoPlaybackPolicy.parseSemanticTrack(TRACK_ID)))

        assertEquals("https://www.kuwo.cn/", transport.home.url)
        assertEquals(
            "https://www.kuwo.cn/api/v1/www/music/playUrl?mid=123456&type=music&httpsStatus=1&reqId=&plat=web_www&from=",
            transport.play.url,
        )
        assertEquals("452fda90010b117cb165a7af6d0012d687", transport.play.headers["Secret"])
        assertEquals("Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324=fixture-token", transport.play.headers["Cookie"])
        assertEquals("bytes=0-0", transport.probe.headers["Range"])
        assertEquals("audio/mpeg", descriptor.mimeType)
        assertEquals(4096L, descriptor.sizeBytes)
        assertEquals(NOW + 60_000L, descriptor.expiresAt)
    }

    @Test
    fun refreshesSessionOnlyOnceAndKeepsSessionMaterialOutOfFailures() {
        val refresh = FixtureTransport().apply { denyFirst = true }
        KuwoPlaybackGateway(refresh, nonce = { 1_234_567L }).resolve(
            REQUEST_ID,
            requireNotNull(KuwoPlaybackPolicy.parseSemanticTrack(TRACK_ID)),
        )
        assertEquals(2, refresh.homeCalls)
        assertEquals(2, refresh.playCalls)

        val denied = FixtureTransport().apply { denyAlways = true }
        assertCode(KuwoPlaybackPolicy.ErrorCode.PLAYBACK_UNAVAILABLE) {
            KuwoPlaybackGateway(denied, nonce = { 1_234_567L }).resolve(
                REQUEST_ID,
                requireNotNull(KuwoPlaybackPolicy.parseSemanticTrack(TRACK_ID)),
            )
        }
        assertEquals(2, denied.homeCalls)
        assertEquals(2, denied.playCalls)
    }

    @Test
    fun hostAndProbePolicyFailClosed() {
        assertEquals("kuwo", KuwoPlaybackModule.PROVIDER)
        assertEquals(1, KuwoPlaybackModule.CONTRACT_VERSION)
        assertTrue(KuwoPlaybackModule.POLICY_READY)
        assertEquals(listOf("er-sycdn.kuwo.cn"), KuwoPlaybackModule.APPROVED_HOSTS)
        assertFalse(KuwoPlaybackPolicy.isApprovedMediaUrl("http://er-sycdn.kuwo.cn/a.mp3"))
        assertFalse(KuwoPlaybackPolicy.isApprovedMediaUrl("https://wrong.kuwo.cn/a.mp3"))
        assertFalse(KuwoPlaybackPolicy.isApprovedMediaUrl("https://user@er-sycdn.kuwo.cn/a.mp3"))
        assertFalse(KuwoPlaybackPolicy.isApprovedMediaUrl("https://er-sycdn.kuwo.cn:8443/a.mp3"))
        assertFalse(KuwoPlaybackPolicy.isApprovedMediaUrl("https://er-sycdn.kuwo.cn/a.mp3#part"))
        assertCode(KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE) {
            KuwoPlaybackPolicy.validateProbe(302, emptyMap())
        }
    }

    @Test
    fun `fractional bridge versions fail before Kuwo resolver transport can start`() {
        assertTrue(KuwoPlaybackPolicy.isContractVersion(1.0))
        assertFalse(KuwoPlaybackPolicy.isContractVersion(1.5))
        assertFalse(KuwoPlaybackPolicy.isContractVersion(1.999))
        assertFalse(KuwoPlaybackPolicy.isContractVersion(Double.NaN))
    }

    @Test
    fun ledgerRejectsDuplicateIdsAndCancellationMakesLateCompletionStale() {
        val ledger = KuwoPlaybackPolicy.RequestLedger()
        val first = requireNotNull(ledger.claim(REQUEST_ID))
        assertEquals(null, ledger.claim(REQUEST_ID))
        assertTrue(ledger.isCurrent(first))
        assertEquals(first, ledger.cancel(REQUEST_ID))
        assertFalse(ledger.isCurrent(first))
        ledger.complete(first)
        val second = requireNotNull(ledger.claim(REQUEST_ID))
        assertTrue(ledger.isCurrent(second))
        ledger.cancelAll()
        assertFalse(ledger.isCurrent(second))
    }

    private fun assertCode(code: KuwoPlaybackPolicy.ErrorCode, block: () -> Unit) {
        try {
            block()
            throw AssertionError("expected $code")
        } catch (failure: KuwoPlaybackPolicy.ProviderException) {
            assertEquals(code, failure.code)
            assertFalse(failure.message.orEmpty().contains("fixture-token"))
            assertFalse(failure.message.orEmpty().contains("452f"))
        }
    }

    private class FixtureTransport : KuwoPlaybackGateway.Transport {
        data class Request(val url: String, val headers: Map<String, String>, val maxBytes: Int)
        lateinit var home: Request
        lateinit var play: Request
        lateinit var probe: Request
        var homeCalls = 0
        var playCalls = 0
        var denyFirst = false
        var denyAlways = false

        override fun homepage(request: KuwoPlaybackGateway.HomeRequest): KuwoPlaybackGateway.HttpResponse {
            homeCalls += 1
            home = Request(request.url, request.headers, request.maxBytes)
            return KuwoPlaybackGateway.HttpResponse(200, "", mapOf("Set-Cookie" to listOf("$COOKIE=fixture-token; Path=/; Secure")))
        }

        override fun playUrl(request: KuwoPlaybackGateway.PlayRequest): KuwoPlaybackGateway.HttpResponse {
            playCalls += 1
            play = Request(request.url, request.headers, request.maxBytes)
            val denied = denyAlways || (denyFirst && playCalls == 1)
            return KuwoPlaybackGateway.HttpResponse(
                200,
                if (denied) "{\"success\":false}" else "{\"success\":true,\"data\":{\"url\":\"https://er-sycdn.kuwo.cn/fixture.mp3\"}}",
                emptyMap(),
            )
        }

        override fun probe(request: KuwoPlaybackGateway.ProbeRequest): KuwoPlaybackGateway.HttpResponse {
            probe = Request(request.url, request.headers, request.maxBytes)
            return KuwoPlaybackGateway.HttpResponse(206, "x", mapOf("Content-Type" to listOf("audio/mpeg"), "Content-Range" to listOf("bytes 0-0/4096")))
        }
        override fun cancel(requestId: String) = Unit
    }
}
