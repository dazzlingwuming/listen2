package com.listen2mobile.qq

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        assertEquals("https://isure.stream.qqmusic.qq.com/fixture.mp3?sig=opaque", descriptor.url)
        assertEquals("audio/mpeg", descriptor.mimeType)
        assertEquals(4096L, descriptor.sizeBytes)
        assertEquals(NOW + 60_000L, descriptor.expiresAt)
    }

    private class FixtureTransport : QqPlaybackGateway.Transport {
        lateinit var metadata: QqPlaybackGateway.MetadataRequest
        lateinit var probe: QqPlaybackGateway.ProbeRequest

        override fun metadata(request: QqPlaybackGateway.MetadataRequest): QqPlaybackGateway.HttpResponse {
            metadata = request
            return QqPlaybackGateway.HttpResponse(
                200,
                """{"req_1":{"data":{"sip":["https://isure.stream.qqmusic.qq.com/"],"midurlinfo":[{"purl":"fixture.mp3?sig=opaque"}]}}}""",
                mapOf("Set-Cookie" to listOf("ignored=value")),
            )
        }

        override fun probe(request: QqPlaybackGateway.ProbeRequest): QqPlaybackGateway.HttpResponse {
            probe = request
            return QqPlaybackGateway.HttpResponse(
                206,
                "x",
                mapOf("Content-Type" to listOf("audio/mpeg"), "Content-Range" to listOf("bytes 0-0/4096")),
            )
        }

        override fun cancel(requestId: String) = Unit
    }
}
