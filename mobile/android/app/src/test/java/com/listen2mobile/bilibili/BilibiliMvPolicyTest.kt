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
        assertEquals(candidate, BilibiliMvPolicy.selectVideoCandidate(listOf(candidate), listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(listOf(candidate.copy(role = "combined")), listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(listOf(candidate.copy(mimeType = "video/webm")), listOf("avc1"), now))
        assertNull(BilibiliMvPolicy.selectVideoCandidate(List(5) { candidate.copy(id = 16 + it) }, listOf("avc1"), now))
        assertFalse(BilibiliMvPolicy.isSafeVideoUrl("https://example.com/video.m4s?deadline=1700000031", now))
    }
}
