package com.listen2mobile.deepseek

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepSeekContractTest {
    private val lyric = "[00:01.00]First line\n[00:02.00]Second line"
    private val consent = DeepSeekPolicy.Consent.explicit(1_700_000_000_000L)

    @Test fun `fixed policy rejects incomplete consent and untimed lyrics`() {
        assertEquals(
            "CONSENT_REQUIRED",
            DeepSeekPolicy.normalize(
                DeepSeekPolicy.Input(lyric, "Title", "Artist", "", consent.copy(lyrics = false)),
            ).errorCode,
        )
        assertEquals(
            "NO_TIMED_LINES",
            DeepSeekPolicy.normalize(DeepSeekPolicy.Input("plain", "Title", "Artist", "", consent)).errorCode,
        )
    }

    @Test fun `request owns fixed endpoint model prompt and exactly four headers`() {
        val normalized = DeepSeekPolicy.normalize(DeepSeekPolicy.Input(lyric, "Title", "Artist", "", consent)).value!!
        val request = DeepSeekPolicy.translationRequest(normalized).value!!
        assertEquals("https://api.deepseek.com/chat/completions", request.endpoint)
        assertEquals("deepseek-v4-flash", request.model)
        assertEquals("deepseek-lyrics-v2", request.promptVersion)
        assertEquals(
            listOf("Authorization", "Content-Type", "Accept", "User-Agent"),
            request.headerNames,
        )
        assertTrue(request.body.contains("deepseek-v4-flash"))
    }

    @Test fun `translation response requires exact ordered unique line ids`() {
        val normalized = DeepSeekPolicy.normalize(DeepSeekPolicy.Input(lyric, "Title", "Artist", "", consent)).value!!
        val valid = """{"E0001":"第一行","E0002":"第二行"}"""
        assertTrue(DeepSeekPolicy.parseLineMap(valid, normalized).isSuccess)
        assertEquals("INVALID_ALIGNMENT", DeepSeekPolicy.parseLineMap("""{"E0002":"第二行","E0001":"第一行"}""", normalized).errorCode)
        assertEquals("INVALID_ALIGNMENT", DeepSeekPolicy.parseLineMap("""{"E0001":"one\ntwo","E0002":"第二行"}""", normalized).errorCode)
    }

    @Test fun `track hash prevents a cache hit for identical lyrics on another source identity`() {
        val lyricHash = DeepSeekPolicy.lyricHash(lyric)
        val first = DeepSeekPolicy.trackHash("netease", "netrack_1", lyricHash)
        val second = DeepSeekPolicy.trackHash("qq", "qqtrack_1", lyricHash)
        assertFalse(first == second)
        val cache = DeepSeekTranslationCache.InMemoryStore()
        cache.put(DeepSeekTranslationCache.Entry(first, lyricHash, "translation"))
        assertEquals("translation", cache.get(first, lyricHash)?.translation)
        assertNull(cache.get(second, lyricHash))
    }

    @Test fun `injectable vault does not expose a public key getter and fails closed`() {
        val vault = DeepSeekVault.forTesting(DeepSeekVault.InMemoryCiphertextStore())
        assertFalse(vault.status().hasApiKey)
        assertTrue(vault.saveFromNativeEntry("safe key").hasApiKey)
        assertEquals("safe key", vault.withApiKey { it })
        vault.clear()
        assertFalse(vault.status().hasApiKey)
    }
}
