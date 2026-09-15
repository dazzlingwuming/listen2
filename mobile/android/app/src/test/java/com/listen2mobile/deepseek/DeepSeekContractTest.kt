package com.listen2mobile.deepseek

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepSeekContractTest {
    private val lyric = "[00:01.00]First line\n[00:02.00]Second line"
    private val consent = DeepSeekPolicy.Consent.explicit(1_700_000_000_000L)
    private val revision = 7L

    private fun input(value: String = lyric, revision: Long = this.revision) = DeepSeekPolicy.Input(
        value,
        "Title",
        "Artist",
        "",
        revision,
        consent,
    )

    private fun validProjection(revision: Long = this.revision) = """
        {"schema":"${DeepSeekPolicy.RESPONSE_SCHEMA}","revision":$revision,"complete":true,"lines":[
          {"id":"E0001","timestamp":"[00:01.00]","text":"第一行"},
          {"id":"E0002","timestamp":"[00:02.00]","text":"第二行"}
        ]}
    """.trimIndent().replace("\n", "")

    @Test
    fun fixedPolicyRejectsIncompleteConsentAndUntimedLyrics() {
        assertEquals(
            "CONSENT_REQUIRED",
            DeepSeekPolicy.normalize(
                input().copy(consent = consent.copy(lyrics = false)),
                requireConsent = true,
            ).errorCode,
        )
        assertEquals(
            "NO_TIMED_LINES",
            DeepSeekPolicy.normalize(input("plain"), requireConsent = false).errorCode,
        )
    }

    @Test
    fun requestOwnsFixedEndpointModelPromptAndHeaders() {
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        val request = DeepSeekPolicy.translationRequest(normalized).value!!
        assertEquals(DeepSeekPolicy.ENDPOINT, request.endpoint)
        assertEquals(DeepSeekPolicy.MODEL, request.model)
        assertEquals(DeepSeekPolicy.PROMPT_VERSION, request.promptVersion)
        assertEquals(
            listOf("Authorization", "Content-Type", "Accept", "User-Agent"),
            request.headerNames,
        )
        assertTrue(request.body.contains(DeepSeekPolicy.RESPONSE_SCHEMA))
        assertTrue(request.body.contains("revision $revision"))
    }

    @Test
    fun translationResponseRequiresExactSchemaOrderAndTimeline() {
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        assertTrue(DeepSeekPolicy.parseLineMap(validProjection(), normalized).isSuccess)
        assertEquals(
            "INVALID_ALIGNMENT",
            DeepSeekPolicy.parseLineMap(
                validProjection().replace("E0001", "E0002", ignoreCase = false),
                normalized,
            ).errorCode,
        )
        assertEquals(
            "INVALID_ALIGNMENT",
            DeepSeekPolicy.parseLineMap(
                validProjection().replace("\"timestamp\":\"[00:02.00]\"", "\"timestamp\":\"[00:03.00]\""),
                normalized,
            ).errorCode,
        )
        assertEquals(
            "STALE_REVISION",
            DeepSeekPolicy.parseLineMap(validProjection(8), normalized).errorCode,
        )
        assertEquals(
            "INVALID_ALIGNMENT",
            DeepSeekPolicy.parseLineMap(
                validProjection().replace("\"complete\":true", "\"complete\":false"),
                normalized,
            ).errorCode,
        )
    }

    @Test
    fun trackHashPreventsCacheHitForAnotherSourceOrRevision() {
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        val first = DeepSeekPolicy.trackHash("netease", "netrack_1", normalized.lyricHash)
        val second = DeepSeekPolicy.trackHash("qq", "qqtrack_1", normalized.lyricHash)
        val lines = listOf(
            DeepSeekPolicy.TranslationLine("E0001", "[00:01.00]", "第一行"),
            DeepSeekPolicy.TranslationLine("E0002", "[00:02.00]", "第二行"),
        )
        val cache = DeepSeekTranslationCache.InMemoryStore()
        cache.put(DeepSeekTranslationCache.Entry(first, normalized.lyricHash, revision, lines, "Title", "Artist", promptFingerprint = normalized.promptFingerprint))
        assertEquals(2, cache.get(first, normalized.lyricHash, revision, "Title", "Artist", normalized.promptFingerprint)!!.lines.size)
        assertNull(cache.get(second, normalized.lyricHash, revision, "Title", "Artist", normalized.promptFingerprint))
        assertNull(cache.get(first, normalized.lyricHash, revision + 1, "Title", "Artist", normalized.promptFingerprint))
        assertFalse(cache.get(first, normalized.lyricHash, revision, "Other title", "Artist", normalized.promptFingerprint) != null)
    }

    @Test
    fun injectableVaultUsesEncryptedTestProtectorOnly() {
        val store = DeepSeekVault.InMemoryCiphertextStore()
        val vault = DeepSeekVault.forTesting(store)
        val marker = "marker-secret-for-vault"
        assertEquals(DeepSeekVault.State.NotConfigured, vault.status().state)
        assertEquals(DeepSeekVault.State.Configured, vault.saveFromNativeEntry(marker).state)
        assertTrue(store.read()!!.startsWith("v2:"))
        assertFalse(store.read()!!.contains(marker))
        assertEquals(marker, vault.withApiKey { it })
        assertEquals(DeepSeekVault.State.NotConfigured, vault.clear().state)
        assertNull(store.read())
    }

    @Test
    fun vaultEnvelopeIsCompactAndRoundTripsWithoutPadding() {
        val store = DeepSeekVault.InMemoryCiphertextStore()
        val vault = DeepSeekVault.forTesting(store)
        assertEquals(DeepSeekVault.State.Configured, vault.saveFromNativeEntry("x").state)
        val envelope = requireNotNull(store.read())
        assertTrue(envelope.startsWith("v2:"))
        assertFalse(envelope.removePrefix("v2:").contains('='))
        assertEquals("x", vault.withApiKey { it })
    }
}
