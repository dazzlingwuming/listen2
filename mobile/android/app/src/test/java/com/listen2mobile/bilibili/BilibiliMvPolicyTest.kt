package com.listen2mobile.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BilibiliMvPolicyTest {
    private val now = 1_700_000_000_000L
    private val safeUrl = "https://upos-sz-mirrorcos.bilivideo.com/video.m4s?deadline=1700000031"

    @Test fun `semantic request accepts only exact BVID CID quality and codec values`() {
        val request = BilibiliMvPolicy.request("BV1xx411c7mD", 12L, "80", listOf("avc1"), false)
        assertEquals("BV1xx411c7mD", request?.bvid)
        assertEquals(12L, request?.cid)
        assertNull(BilibiliMvPolicy.request("BV1xx411c7mD", 0L, "80", listOf("avc1"), false))
        assertNull(BilibiliMvPolicy.request("BV1xx411c7mD", 12L, "999", listOf("avc1"), false))
        assertNull(BilibiliMvPolicy.request("BV1xx411c7mD", 12L, "80", listOf("vp9"), false))
    }

    @Test fun `video candidates require isolated MP4 video and a bounded signed deadline`() {
        val candidate = BilibiliMvPolicy.VideoCandidate(80, "HD", safeUrl, "video/mp4", "avc1.640028", 1920, 1080, 60, "video", false)
        assertEquals(candidate, BilibiliMvPolicy.selectVideoCandidate(listOf(candidate), "80", listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(listOf(candidate.copy(role = "combined")), "80", listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(listOf(candidate.copy(codecs = "avc1evil")), "80", listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(listOf(candidate.copy(mimeType = "video/webm")), "80", listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(List(5) { candidate.copy(id = 16 + it) }, "auto", listOf("avc1"), now))
        assertFalse(BilibiliMvPolicy.isSafeVideoUrl("https://example.com/video.m4s?deadline=1700000031", now))
    }

    @Test fun `semantic snapshot rejects positions beyond one day`() {
        assertNull(BilibiliMvPolicy.safeSnapshot("BV1xx411c7mD", 12L, "80", 24L * 60L * 60L * 1000L + 1L, true))
    }

    @Test fun `opaque random encodings are lowercase hex and JVM safe`() {
        val first = BilibiliRandom.randomHex(24)
        val second = BilibiliRandom.randomHex(24)
        assertTrue(first.matches(Regex("[0-9a-f]{48}")))
        assertFalse(first == second)
        assertEquals("00ff10", BilibiliRandom.lowercaseHex(byteArrayOf(0, -1, 16)))
        assertTrue(BilibiliMvPolicy.isOpaqueHandle(BilibiliMvPolicy.opaqueHandle(ByteArray(32) { it.toByte() })))
    }

    @Test fun `rational frame rate and explicit quality remain bounded`() {
        assertEquals(30, BilibiliMvPolicy.parseFrameRate("30000/1001"))
        assertEquals(16, BilibiliMvPolicy.parseFrameRate("16000/1000"))
        assertNull(BilibiliMvPolicy.parseFrameRate("30000/0"))
        assertNull(BilibiliMvPolicy.parseFrameRate("999999999/1"))
        val low = BilibiliMvPolicy.VideoCandidate(64, "low", safeUrl, "video/mp4", "avc1.640028", 640, 360, 30, "video", false)
        val high = low.copy(id = 80)
        assertEquals(low, BilibiliMvPolicy.selectVideoCandidate(listOf(low, high), "64", listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(listOf(high), "64", listOf("avc1"), now))
    }
}
