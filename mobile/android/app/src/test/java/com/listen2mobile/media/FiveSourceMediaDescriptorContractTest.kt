package com.listen2mobile.media

import com.listen2mobile.kugou.KugouPlaybackGateway
import com.listen2mobile.netease.NeteasePlaybackGateway
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FiveSourceMediaDescriptorContractTest {
    @Test fun `each remote source projects the same lease backed safe descriptor`() {
        val registry = MediaLeaseRegistry("com.dazzlingwuming.listen2.media", clock = { 1_700_000_000_000L })
        val inputs = listOf(
            "bilibili" to ("bitrack_v_BV1xx411c7mD-12" to NativeTransport("https://upos.bilivideo.com/audio.m4s?deadline=1700000031", mapOf("Referer" to "https://www.bilibili.com/"))),
            "qq" to ("qqtrack_fixture" to NativeTransport("https://isure.stream.qqmusic.qq.com/fixture.mp3", mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1"), source = "qq")),
            "kuwo" to ("kwtrack_123456" to NativeTransport("https://er-sycdn.kuwo.cn/fixture.mp3", mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1"), source = "kuwo")),
            "netease" to ("netrack_123456" to NativeTransport("https://music.163.com/song/media/outer/url?id=123456.mp3", emptyMap(), source = "netease")),
            "kugou" to ("kgtrack_1234ABCD" to NativeTransport("https://sharefs.kugou.com/fixture.mp3", mapOf("Accept" to "audio/*", "User-Agent" to "Listen2Mobile/1"), source = "kugou")),
        )
        inputs.forEachIndexed { index, (source, input) ->
            val (trackId, transport) = input
            val descriptor = registry.register(
                "request-${index}123456",
                MediaIdentity(source, trackId, null, 0L),
                MediaRendition("default", "authorized", "audio/mpeg", "mp3", "mp3", 1L, null),
                transport,
                0L,
            )
            assertEquals(source, descriptor.identity.source)
            assertTrue(descriptor.isSafeForJs())
            assertFalse(descriptor.toString().contains("https://"))
        }
    }

    @Test fun `new native gateways accept only semantic source identities`() {
        assertTrue(NeteasePlaybackGateway().resolve("request-12345678", "netrack_123").transport.url.startsWith("https://music.163.com/"))
        assertTrue(KugouPlaybackGateway(object : KugouPlaybackGateway.Transport { override fun bootstrap(url: String) = "{\"play_url\":\"https://sharefs.kugou.com/fixture.mp3\"}" }).resolve("request-12345678", "kgtrack_1234ABCD").transport.url.startsWith("https://sharefs.kugou.com/"))
        assertThrows { NeteasePlaybackGateway().resolve("request-12345678", "https://attacker") }
        assertThrows { KugouPlaybackGateway().resolve("request-12345678", "kgtrack_../../secret") }
    }

    @Test fun `source policy rejects cross source candidates redirects and injected headers`() {
        assertTrue(MediaStreamPolicy.isAllowedTransport(NativeTransport("https://isure.stream.qqmusic.qq.com/a.mp3", mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1"), source = "qq")))
        assertFalse(MediaStreamPolicy.isAllowedTransport(NativeTransport("https://sharefs.kugou.com/a.mp3", mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1"), source = "qq")))
        assertFalse(MediaStreamPolicy.isAllowedTransport(NativeTransport("https://music.163.com/song/media/outer/url?id=1.mp3", mapOf("Referer" to "https://attacker/"), source = "netease")))
        assertFalse(MediaStreamPolicy.isAllowedTransport(NativeTransport("https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=ABCD1234", mapOf("Accept" to "audio/*", "User-Agent" to "Listen2Mobile/1"), source = "kugou")))
        assertFalse(MediaStreamPolicy.isAllowedTransport(NativeTransport("https://music.163.com/song/media/outer/url?id=1.mp3", emptyMap(), candidates = listOf("https://attacker.invalid/redirect"), source = "netease")))
    }

    @Test fun `native stream rejects an unapproved transport before opening any network connection`() {
        val output = ByteArrayOutputStream()
        assertEquals(
            MediaStreamPolicy.StreamOutcome.POLICY,
            MediaStreamPolicy.streamTo(
                NativeTransport(
                    "https://attacker.invalid/audio.mp3",
                    emptyMap(),
                    source = "bilibili",
                ),
                output,
            ),
        )
        assertEquals(0, output.size())
    }

    @Test fun `native stream adds only its fixed media user agent`() {
        val transport = NativeTransport(
            "https://upos.bilivideo.com/audio.m4s?deadline=1700000031",
            mapOf("Referer" to "https://www.bilibili.com/"),
        )
        assertEquals(
            mapOf(
                "Referer" to "https://www.bilibili.com/",
                "User-Agent" to "Listen2Mobile/1",
            ),
            MediaStreamPolicy.requestHeadersFor(transport),
        )
        assertEquals(
            "bytes=0-9",
            MediaStreamPolicy.requestHeadersFor(transport, "bytes=0-9")["Range"],
        )
    }

    private fun assertThrows(block: () -> Unit) {
        try { block(); throw AssertionError("expected rejection") } catch (_: IllegalArgumentException) { }
    }
}
