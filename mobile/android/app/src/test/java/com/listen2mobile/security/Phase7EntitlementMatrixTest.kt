package com.listen2mobile.security

import com.listen2mobile.bilibili.BilibiliMvPolicy
import com.listen2mobile.bilibili.BilibiliPolicy
import com.listen2mobile.media.EntitlementStatus
import com.listen2mobile.media.MediaIdentity
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaRendition
import com.listen2mobile.media.NativeTransport
import com.listen2mobile.offline.OfflinePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Phase7EntitlementMatrixTest {
    @Test fun `stale account generation blocks every remote lease before downstream transport`() {
        val registry = MediaLeaseRegistry("com.listen2mobile.media", clock = { 1_700_000_000_000L })
        val sources = listOf(
            "bilibili" to "bitrack_v_BV1xx411c7mD-12",
            "netease" to "netrack_123456",
            "kugou" to "kgtrack_1234ABCD",
            "qq" to "qqtrack_fixture",
            "kuwo" to "kwtrack_fixture",
        )
        sources.forEachIndexed { index, (source, trackId) ->
            val identity = MediaIdentity(source, trackId, null, 7L)
            val nativeTransport = when (source) {
                "bilibili" -> NativeTransport("https://upos.bilivideo.com/audio.m4s?deadline=1700000031", mapOf("Referer" to "https://www.bilibili.com/"), source = source)
                "netease" -> NativeTransport("https://music.163.com/song/media/outer/url?id=1.mp3", emptyMap(), source = source)
                "kugou" -> NativeTransport("https://sharefs.kugou.com/fixture.mp3", mapOf("Accept" to "audio/*", "User-Agent" to "Listen2Mobile/1"), source = source)
                "kuwo" -> NativeTransport("https://er-sycdn.kuwo.cn/fixture.mp3", mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1"), source = source)
                else -> NativeTransport("https://isure.stream.qqmusic.qq.com/fixture.mp3", mapOf("Accept" to "audio/*", "Range" to "bytes=0-0", "User-Agent" to "Listen2Mobile/1"), source = source)
            }
            val descriptor = registry.register(
                "request-${index}123456", identity,
                MediaRendition("default", "authorized", "audio/mpeg", "mp3", "mp3", 1L, null),
                nativeTransport,
                7L,
            )
            var downstreamCalls = 0
            val resolvedTransport = registry.transportFor(descriptor.leaseId, identity, 8L)?.also { downstreamCalls++ }
            assertNull("$source stale account must be denied", resolvedTransport)
            assertEquals("$source must not advance to transport", 0, downstreamCalls)
        }
    }

    @Test fun `only native reported part rendition and mv quality remain selectable`() {
        val part = BilibiliPolicy.AuthorizedPart(12L, 1L)
        val rendition = BilibiliPolicy.AuthorizedRendition("audio", "authorized", "audio/mp4", "mp4a.40.2")
        assertNull(BilibiliPolicy.authorizePart(listOf(part), 99L, 1L))
        assertNull(BilibiliPolicy.authorizeRendition(listOf(rendition), "member-forged"))
        assertNull(BilibiliMvPolicy.selectAuthorizedVariant(listOf(BilibiliMvPolicy.PublicVariant("80", "HD", "avc1", 1920, 1080)), "127"))
        assertTrue(OfflinePolicy.accepted("netease", "netrack_123456"))
        assertFalse(OfflinePolicy.accepted("bilibili", "bitrack_v_BV1xx411c7mD-12"))
    }

    @Test fun `denial vocabulary is bounded and non-transport bearing`() {
        EntitlementStatus.entries.filter { it != EntitlementStatus.ALLOWED }.forEach { status ->
            assertTrue(status.action in setOf("login", "membership", "unavailable", "retry", "download"))
            assertFalse(status.name.contains("URL"))
            assertFalse(status.name.contains("HEADER"))
        }
    }
}
