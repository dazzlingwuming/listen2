package com.listen2mobile.qq

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QqPlaybackContractTest {
    private companion object {
        const val NOW = 1_700_000_000_000L
        const val TRACK_ID = "qqtrack_003fixtureMid"
        const val REQUEST_ID = "qq-request-1"
    }

    @Test
    fun `qqSemanticMidBuildsFixedCookieFreeRequestAndVettedDescriptor`() {
        val transport = FixtureTransport()
        val gateway = QqPlaybackGateway(transport, clock = { NOW })

        val descriptor = gateway.resolve(
            REQUEST_ID,
            requireNotNull(QqPlaybackPolicy.parseSemanticTrack(TRACK_ID)),
        )

        assertEquals("https://u.y.qq.com/cgi-bin/musicu.fcg", transport.metadata.url)
        assertEquals("POST", transport.metadata.method)
        assertEquals("application/json; charset=UTF-8", transport.metadata.headers["Content-Type"])
        assertFalse(transport.metadata.headers.keys.any { it.equals("Cookie", true) })
        val body = JSONObject(transport.metadata.body)
        val req = body.getJSONObject("req_1")
        assertEquals("vkey.GetVkeyServer", req.getString("module"))
        assertEquals("CgiGetVkey", req.getString("method"))
        val param = req.getJSONObject("param")
        assertEquals("003fixtureMid", param.getJSONArray("songmid").getString(0))
        assertEquals("M500003fixtureMid003fixtureMid.mp3", param.getJSONArray("filename").getString(0))
        assertEquals("10000", param.getString("guid"))
        assertEquals("0", param.getString("uin"))
        assertEquals(1, param.getInt("loginflag"))
        assertEquals("20", param.getString("platform"))
        assertEquals("0", body.getString("loginUin"))
        assertEquals("0", body.getJSONObject("comm").getString("uin"))
        assertEquals("json", body.getJSONObject("comm").getString("format"))
        assertEquals(24, body.getJSONObject("comm").getInt("ct"))
        assertEquals(0, body.getJSONObject("comm").getInt("cv"))

        assertEquals("bytes=0-0", transport.probe.headers["Range"])
        assertFalse(transport.probe.headers.keys.any { it.equals("Cookie", true) })
        assertEquals(1, transport.probe.maxBytes)
        assertEquals(0, transport.probe.maxRedirects)
        assertEquals(1, descriptor.version)
        assertEquals(REQUEST_ID, descriptor.requestId)
        assertEquals(TRACK_ID, descriptor.trackId)
        assertEquals("qq", descriptor.source)
        assertEquals("audio/mpeg", descriptor.mimeType)
        assertEquals(4096L, descriptor.sizeBytes)
        assertEquals(NOW + 60_000L, descriptor.expiresAt)
    }

    @Test
    fun `invalid input and explicit restrictions fail closed before descriptor release`() {
        assertEquals("qq", QqPlaybackModule.PROVIDER)
        assertEquals(1, QqPlaybackModule.CONTRACT_VERSION)
        assertTrue(QqPlaybackModule.POLICY_READY)
        assertEquals(null, QqPlaybackPolicy.parseSemanticTrack("qqtrack_"))
        assertEquals(null, QqPlaybackPolicy.parseSemanticTrack("netrack_3"))
        assertFalse(QqPlaybackPolicy.isRequestId("cookie=secret"))
        assertFalse(QqPlaybackPolicy.policyReady(emptySet()))
        assertCode(QqPlaybackPolicy.ErrorCode.LOGIN_REQUIRED) {
            QqPlaybackPolicy.resolveMediaUrl("""{"req_1":{"listen2_error":"LOGIN_REQUIRED"}}""")
        }
        assertCode(QqPlaybackPolicy.ErrorCode.MEMBERSHIP_REQUIRED) {
            QqPlaybackPolicy.resolveMediaUrl("""{"req_1":{"listen2_error":"MEMBERSHIP_REQUIRED"}}""")
        }
        assertCode(QqPlaybackPolicy.ErrorCode.DRM_RESTRICTED) {
            QqPlaybackPolicy.resolveMediaUrl("""{"req_1":{"listen2_error":"DRM_RESTRICTED"}}""")
        }
        assertCode(QqPlaybackPolicy.ErrorCode.REGION_RESTRICTED) {
            QqPlaybackPolicy.resolveMediaUrl("""{"req_1":{"listen2_error":"REGION_RESTRICTED"}}""")
        }
        assertCode(QqPlaybackPolicy.ErrorCode.PLAYBACK_UNAVAILABLE) {
            QqPlaybackPolicy.resolveMediaUrl("""{"req_1":{"data":{"sip":["https://isure.stream.qqmusic.qq.com/"],"midurlinfo":[{"purl":""}]}}}""")
        }
        assertFalse(QqPlaybackPolicy.isApprovedMediaUrl("https://other.qqmusic.qq.com/fixture.mp3"))
        assertFalse(QqPlaybackPolicy.isApprovedMediaUrl("http://isure.stream.qqmusic.qq.com/fixture.mp3"))
        assertFalse(QqPlaybackPolicy.isApprovedMediaUrl("https://user@isure.stream.qqmusic.qq.com/fixture.mp3"))
        assertFalse(QqPlaybackPolicy.isApprovedMediaUrl("https://isure.stream.qqmusic.qq.com:8443/fixture.mp3"))
        assertFalse(QqPlaybackPolicy.isApprovedMediaUrl("https://isure.stream.qqmusic.qq.com/fixture.mp3#fragment"))
        assertCode(QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE) {
            QqPlaybackPolicy.validateProbe(302, emptyMap())
        }
        assertCode(QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE) {
            QqPlaybackPolicy.validateProbe(206, mapOf("Content-Type" to listOf("text/html"), "Content-Range" to listOf("bytes 0-0/3")))
        }
        assertCode(QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE) {
            QqPlaybackPolicy.validateProbe(206, mapOf("Content-Type" to listOf("audio/mpeg"), "Content-Range" to listOf("bytes 0-0/536870913")))
        }
    }

    @Test
    fun `fractional bridge versions fail before QQ resolver transport can start`() {
        assertTrue(QqPlaybackPolicy.isContractVersion(1.0))
        assertFalse(QqPlaybackPolicy.isContractVersion(1.5))
        assertFalse(QqPlaybackPolicy.isContractVersion(1.999))
        assertFalse(QqPlaybackPolicy.isContractVersion(Double.NaN))
    }

    @Test
    fun `cancelled resolver disconnects and suppresses late success`() {
        val transport = FixtureTransport().apply { cancelDuringMetadata = true }
        val gateway = QqPlaybackGateway(transport, clock = { NOW })
        assertCode(QqPlaybackPolicy.ErrorCode.CANCELLED) {
            gateway.resolve(REQUEST_ID, requireNotNull(QqPlaybackPolicy.parseSemanticTrack(TRACK_ID))) { transport.cancelled }
        }
        assertEquals(listOf(REQUEST_ID), transport.cancelledRequestIds)
        assertFalse(transport.probeCalled)
    }

    @Test
    fun `timeout and oversized metadata remain sanitized and cookie free across requests`() {
        val timeout = object : QqPlaybackGateway.Transport {
            override fun metadata(request: QqPlaybackGateway.MetadataRequest): QqPlaybackGateway.HttpResponse =
                throw QqPlaybackPolicy.ProviderException(QqPlaybackPolicy.ErrorCode.REQUEST_TIMEOUT)
            override fun probe(request: QqPlaybackGateway.ProbeRequest): QqPlaybackGateway.HttpResponse = error("unreachable")
            override fun cancel(requestId: String) = Unit
        }
        assertCode(QqPlaybackPolicy.ErrorCode.REQUEST_TIMEOUT) {
            QqPlaybackGateway(timeout).resolve(REQUEST_ID, requireNotNull(QqPlaybackPolicy.parseSemanticTrack(TRACK_ID)))
        }
        val oversized = FixtureTransport().apply { metadataBody = "x".repeat(QqPlaybackPolicy.MAX_METADATA_BYTES + 1) }
        assertCode(QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE) {
            QqPlaybackGateway(oversized).resolve(REQUEST_ID, requireNotNull(QqPlaybackPolicy.parseSemanticTrack(TRACK_ID)))
        }
        val fresh = FixtureTransport()
        QqPlaybackGateway(fresh, clock = { NOW }).resolve(REQUEST_ID, requireNotNull(QqPlaybackPolicy.parseSemanticTrack(TRACK_ID)))
        assertFalse(fresh.metadata.headers.keys.any { it.equals("Cookie", true) })
        assertFalse(fresh.probe.headers.keys.any { it.equals("Cookie", true) })
    }

    @Test
    fun `active request IDs reject collisions and stale generations cannot succeed`() {
        val ledger = QqPlaybackPolicy.RequestLedger()
        val first = requireNotNull(ledger.claim(REQUEST_ID))
        assertEquals(null, ledger.claim(REQUEST_ID))
        assertTrue(ledger.isCurrent(first))
        assertEquals(first, ledger.cancel(REQUEST_ID))
        assertFalse(ledger.isCurrent(first))
        ledger.complete(first)
        val second = requireNotNull(ledger.claim(REQUEST_ID))
        assertFalse(ledger.isCurrent(first))
        assertTrue(ledger.isCurrent(second))
        ledger.cancelAll()
        assertFalse(ledger.isCurrent(second))
    }

    private fun assertCode(code: QqPlaybackPolicy.ErrorCode, block: () -> Unit) {
        try {
            block()
            throw AssertionError("expected $code")
        } catch (failure: QqPlaybackPolicy.ProviderException) {
            assertEquals(code, failure.code)
            assertFalse(failure.message.orEmpty().contains("secret"))
            assertFalse(failure.message.orEmpty().contains("sig="))
        }
    }

    private class FixtureTransport : QqPlaybackGateway.Transport {
        lateinit var metadata: QqPlaybackGateway.MetadataRequest
        lateinit var probe: QqPlaybackGateway.ProbeRequest
        var metadataBody = """{"req_1":{"data":{"sip":["https://isure.stream.qqmusic.qq.com/"],"midurlinfo":[{"purl":"fixture.mp3?sig=opaque"}]}}}"""
        var cancelDuringMetadata = false
        var cancelled = false
        var probeCalled = false
        val cancelledRequestIds = mutableListOf<String>()

        override fun metadata(request: QqPlaybackGateway.MetadataRequest): QqPlaybackGateway.HttpResponse {
            metadata = request
            if (cancelDuringMetadata) cancelled = true
            return QqPlaybackGateway.HttpResponse(200, metadataBody, mapOf("Set-Cookie" to listOf("ignored=value")))
        }

        override fun probe(request: QqPlaybackGateway.ProbeRequest): QqPlaybackGateway.HttpResponse {
            probeCalled = true
            probe = request
            return QqPlaybackGateway.HttpResponse(
                206,
                "x",
                mapOf("Content-Type" to listOf("audio/mpeg"), "Content-Range" to listOf("bytes 0-0/4096")),
            )
        }

        override fun cancel(requestId: String) { cancelled = true; cancelledRequestIds += requestId }
    }
}
