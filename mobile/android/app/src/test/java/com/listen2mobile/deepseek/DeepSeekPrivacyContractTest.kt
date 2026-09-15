package com.listen2mobile.deepseek

import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Focused privacy matrix for the 07-04 Keystore and native transaction boundary. */
class DeepSeekPrivacyContractTest {
    private val lyric = "[00:01.00]First line\n[00:02.00]Second line"
    private val revision = 11L
    private val consent = DeepSeekPolicy.Consent.explicit(1_700_000_000_000L)

    private fun input(value: String = lyric, currentRevision: Long = revision) = DeepSeekPolicy.Input(
        value,
        "Title",
        "Artist",
        "",
        currentRevision,
        consent,
    )

    private fun projection(currentRevision: Long = revision, text: String = "第一行", second: String = "第二行") = """
        {"schema":"${DeepSeekPolicy.RESPONSE_SCHEMA}","revision":$currentRevision,"complete":true,"lines":[
          {"id":"E0001","timestamp":"[00:01.00]","text":"$text"},
          {"id":"E0002","timestamp":"[00:02.00]","text":"$second"}
        ]}
    """.trimIndent().replace("\n", "")

    private class FakeTransport(
        var responseBody: String,
        private val onPost: ((AtomicBoolean) -> Unit)? = null,
        private val responseCode: Int = 200,
    ) : DeepSeekClient.Transport {
        var calls = 0
        var receivedKey: String? = null
        var receivedSpec: DeepSeekPolicy.RequestSpec? = null

        override fun post(
            spec: DeepSeekPolicy.RequestSpec,
            apiKey: String,
            cancelled: AtomicBoolean,
        ): DeepSeekClient.Response {
            calls += 1
            receivedKey = apiKey
            receivedSpec = spec
            onPost?.invoke(cancelled)
            return DeepSeekClient.Response(responseCode, responseBody)
        }
    }

    private fun providerBody(value: String) = """
        {"choices":[{"message":{"content":${org.json.JSONObject.quote(value)}}}]}
    """.trimIndent().replace("\n", "")

    private fun client(
        vault: DeepSeekVault,
        cache: DeepSeekTranslationCache.InMemoryStore = DeepSeekTranslationCache.InMemoryStore(),
        transport: DeepSeekClient.Transport,
    ): Pair<DeepSeekClient, DeepSeekTranslationCache.InMemoryStore> {
        // The production cache class owns Android Context; the test seam is
        // intentionally private to this package and never uses AsyncStorage.
        val nativeCache = DeepSeekTranslationCache.forTesting(cache)
        return DeepSeekClient(vault, nativeCache, transport) to cache
    }

    @Test
    fun vaultEncryptsAndNeverStoresMarkerSecret() {
        val store = DeepSeekVault.InMemoryCiphertextStore()
        val vault = DeepSeekVault.forTesting(store)
        val marker = "vault-marker-secret-07-04"

        assertEquals(DeepSeekVault.State.NotConfigured, vault.status().state)
        assertEquals(DeepSeekVault.State.Configured, vault.saveFromNativeEntry(marker).state)
        val envelope = store.read()
        assertNotNull(envelope)
        assertTrue(envelope!!.startsWith("v2:"))
        assertFalse(envelope.contains(marker))
        assertEquals(marker, vault.withApiKey { it })
        assertEquals(DeepSeekVault.State.NotConfigured, vault.clear().state)
        assertNull(store.read())
        assertEquals(DeepSeekVault.State.NotConfigured, vault.status().state)
    }

    @Test
    fun vaultKeystoreFailureFailsClosedWithoutWritingOrCallingProvider() {
        val store = DeepSeekVault.InMemoryCiphertextStore()
        val vault = DeepSeekVault.forTesting(store, DeepSeekVault.FailingKeyProtector())
        val marker = "keystore-failure-marker"
        assertEquals(DeepSeekVault.State.KeystoreUnavailable, vault.status().state)
        assertEquals(DeepSeekVault.State.KeystoreUnavailable, vault.saveFromNativeEntry(marker).state)
        assertNull(store.read())

        val transport = FakeTransport(providerBody(projection()))
        val (client, cache) = client(vault, transport = transport)
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        val trackHash = DeepSeekPolicy.trackHash("netease", "netrack_1", normalized.lyricHash)
        val result = client.translate(
            "keystore-failure",
            input(),
            "netease",
            "netrack_1",
            normalized.lyricHash,
            trackHash,
            allowNetwork = true,
            forceRefresh = true,
        )
        assertEquals("error", result.status)
        assertEquals("KEYSTORE_UNAVAILABLE", result.errorCode)
        assertEquals(0, transport.calls)
        assertEquals(0, cache.size())
    }

    @Test
    fun vaultCorruptCiphertextIsClearedAndStatusContainsNoExceptionMaterial() {
        val store = DeepSeekVault.InMemoryCiphertextStore()
        store.write("legacy-plaintext-marker")
        val vault = DeepSeekVault.forTesting(store)
        val status = vault.status()
        assertEquals(DeepSeekVault.State.CorruptCleared, status.state)
        assertNull(store.read())
        assertFalse(status.toString().contains("legacy-plaintext-marker"))
    }

    @Test
    fun vaultInvalidationClearsCiphertextBeforeAnyUse() {
        val store = DeepSeekVault.InMemoryCiphertextStore()
        val protector = DeepSeekVault.InMemoryKeyProtector()
        val vault = DeepSeekVault.forTesting(store, protector)
        assertEquals(DeepSeekVault.State.Configured, vault.saveFromNativeEntry("invalidation-marker").state)
        protector.delete()
        assertEquals(DeepSeekVault.State.CorruptCleared, vault.status().state)
        assertNull(store.read())
    }

    @Test
    fun transactionValidatesSchemaTimelineRevisionAndCommitsProjectionOnly() {
        val store = DeepSeekVault.InMemoryCiphertextStore()
        val vault = DeepSeekVault.forTesting(store)
        vault.saveFromNativeEntry("transaction-marker")
        val transport = FakeTransport(providerBody(projection()))
        val (client, cache) = client(vault, transport = transport)
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        val trackHash = DeepSeekPolicy.trackHash("netease", "netrack_1", normalized.lyricHash)
        val result = client.translate(
            "transaction-valid",
            input(),
            "netease",
            "netrack_1",
            normalized.lyricHash,
            trackHash,
            allowNetwork = true,
            forceRefresh = true,
        )
        assertEquals("error=${result.errorCode}", "ok", result.status)
        assertEquals(revision, result.revision)
        assertEquals(2, result.lines!!.size)
        assertEquals(1, cache.size())
        assertFalse(result.toString().contains("transaction-marker"))
        assertFalse(result.toString().contains("choices"))
        assertFalse(result.toString().contains(DeepSeekPolicy.RESPONSE_SCHEMA))
        assertEquals(DeepSeekPolicy.ENDPOINT, transport.receivedSpec!!.endpoint)
        assertEquals("transaction-marker", transport.receivedKey)
    }

    @Test
    fun transactionInvalidOutputAndProviderFailureHaveNoCacheSideEffect() {
        val invalidBodies = listOf(
            projection().replace("E0002", "E0001"),
            projection().replace("[00:02.00]", "[00:03.00]"),
            projection().replace("第二行", "…"),
            projection().replace("\"complete\":true", "\"complete\":false"),
            "{\"schema\":\"${DeepSeekPolicy.RESPONSE_SCHEMA}\",\"revision\":$revision,\"complete\":true,\"lines\":[]}",
        )
        invalidBodies.forEachIndexed { index, body ->
            val vault = DeepSeekVault.forTesting(DeepSeekVault.InMemoryCiphertextStore())
            vault.saveFromNativeEntry("invalid-$index")
            val transport = FakeTransport(providerBody(body))
            val (client, cache) = client(vault, transport = transport)
            val normalized = DeepSeekPolicy.normalize(input()).value!!
            val trackHash = DeepSeekPolicy.trackHash("netease", "netrack_1", normalized.lyricHash)
            val result = client.translate(
                "transaction-invalid-$index",
                input(),
                "netease",
                "netrack_1",
                normalized.lyricHash,
                trackHash,
                allowNetwork = true,
                forceRefresh = true,
            )
            assertEquals("error", result.status)
            assertEquals(0, cache.size())
            assertFalse(result.toString().contains(body))
        }

        val vault = DeepSeekVault.forTesting(DeepSeekVault.InMemoryCiphertextStore())
        vault.saveFromNativeEntry("provider-error")
        val transport = FakeTransport("provider-marker", responseCode = 500)
        val (client, cache) = client(vault, transport = transport)
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        val trackHash = DeepSeekPolicy.trackHash("netease", "netrack_1", normalized.lyricHash)
        val result = client.translate("transaction-provider-error", input(), "netease", "netrack_1", normalized.lyricHash, trackHash, true, true)
        assertEquals("SERVICE_UNAVAILABLE", result.errorCode)
        assertEquals(0, cache.size())
        assertFalse(result.toString().contains("provider-marker"))
    }

    @Test
    fun transactionCancelAndKeyLossBeforeCommitAreSideEffectFree() {
        val vault = DeepSeekVault.forTesting(DeepSeekVault.InMemoryCiphertextStore())
        vault.saveFromNativeEntry("cancel-marker")
        val cancelledTransport = FakeTransport(
            providerBody(projection()),
            onPost = { cancelled -> cancelled.set(true) },
        )
        val (cancelledClient, cancelledCache) = client(vault, transport = cancelledTransport)
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        val trackHash = DeepSeekPolicy.trackHash("netease", "netrack_1", normalized.lyricHash)
        val cancelled = cancelledClient.translate("transaction-cancel", input(), "netease", "netrack_1", normalized.lyricHash, trackHash, true, true)
        assertEquals("cancelled", cancelled.status)
        assertEquals(0, cancelledCache.size())

        val keyLossVault = DeepSeekVault.forTesting(DeepSeekVault.InMemoryCiphertextStore())
        keyLossVault.saveFromNativeEntry("key-loss-marker")
        val keyLossTransport = FakeTransport(
            providerBody(projection()),
            onPost = { keyLossVault.clear() },
        )
        val (keyLossClient, keyLossCache) = client(keyLossVault, transport = keyLossTransport)
        val keyLossResult = keyLossClient.translate("transaction-key-loss", input(), "netease", "netrack_1", normalized.lyricHash, trackHash, true, true)
        assertEquals("error", keyLossResult.status)
        assertTrue(
            "code=${keyLossResult.errorCode}" ,
            keyLossResult.errorCode == "MISSING_KEY" || keyLossResult.errorCode == "KEYSTORE_UNAVAILABLE",
        )
        assertEquals(0, keyLossCache.size())
    }

    @Test
    fun transactionCacheHitRequiresExactRevisionAndUsesNoProviderCall() {
        val vault = DeepSeekVault.forTesting(DeepSeekVault.InMemoryCiphertextStore())
        vault.saveFromNativeEntry("cache-marker")
        val cache = DeepSeekTranslationCache.InMemoryStore()
        val normalized = DeepSeekPolicy.normalize(input()).value!!
        val trackHash = DeepSeekPolicy.trackHash("netease", "netrack_1", normalized.lyricHash)
        val lines = listOf(
            DeepSeekPolicy.TranslationLine("E0001", "[00:01.00]", "第一行"),
            DeepSeekPolicy.TranslationLine("E0002", "[00:02.00]", "第二行"),
        )
        assertTrue(cache.put(DeepSeekTranslationCache.Entry(trackHash, normalized.lyricHash, revision, lines, "Title", "Artist", promptFingerprint = normalized.promptFingerprint)))
        val transport = FakeTransport("must-not-call")
        val (client, nativeCache) = client(vault, cache, transport)
        val result = client.translate("transaction-cache-hit", input(), "netease", "netrack_1", normalized.lyricHash, trackHash, true, false)
        assertEquals("ok", result.status)
        assertTrue(result.cacheHit)
        assertEquals(0, transport.calls)
        assertEquals(1, nativeCache.size())
        val stale = client.translate("transaction-cache-stale", input(currentRevision = revision - 1), "netease", "netrack_1", normalized.lyricHash, trackHash, false, false)
        assertEquals("error", stale.status)
        assertEquals("STALE_REVISION", stale.errorCode)
    }
}
