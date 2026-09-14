package com.listen2mobile.deepseek

import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

/** Fixed HTTPS client. The only Authorization construction is adjacent to native vault use. */
class DeepSeekClient(private val vault: DeepSeekVault, private val cache: DeepSeekTranslationCache, private val transport: Transport = HttpsTransport()) {
    interface Transport { fun post(spec: DeepSeekPolicy.RequestSpec, apiKey: String, cancelled: AtomicBoolean): Response }
    data class Response(val code: Int, val body: String, val oversized: Boolean = false)
    data class Result(val status: String, val errorCode: String? = null, val translation: String? = null, val trackHash: String? = null, val lyricHash: String? = null, val cacheHit: Boolean = false, val operation: String = "translate")
    private val cancellations = ConcurrentHashMap<String, AtomicBoolean>()

    fun cancel(operationId: String): Result { cancellations[operationId]?.set(true); return Result("cancelled") }
    fun test(): Result = execute("test", false) { cancelled ->
        val response = try { vault.withApiKey { key -> transport.post(DeepSeekPolicy.testRequest(), key, cancelled) } } catch (error: DeepSeekVault.VaultException) { return@execute Result("error", error.code, operation = "test") }
        when { cancelled.get() -> Result("error", "CANCELLED", operation = "test"); response.oversized -> Result("error", "RESPONSE_TOO_LARGE", operation = "test"); response.code in 200..299 -> Result("ok", operation = "test"); response.code == 401 || response.code == 403 -> Result("error", "INVALID_KEY", operation = "test"); response.code == 429 -> Result("error", "RATE_LIMITED", operation = "test"); response.code >= 500 -> Result("error", "SERVICE_UNAVAILABLE", operation = "test"); else -> Result("error", "PROVIDER_ERROR", operation = "test") }
    }

    fun translate(operationId: String, input: DeepSeekPolicy.Input, provider: String, sourceTrackId: String, suppliedLyricHash: String, suppliedTrackHash: String, allowNetwork: Boolean, forceRefresh: Boolean): Result {
        if (!DeepSeekPolicy.isEligibleProvider(provider)) return Result("error", "LYRIC_UNAVAILABLE")
        val normalized = DeepSeekPolicy.normalize(input, requireConsent = false)
        val value = normalized.value ?: return Result("error", normalized.errorCode)
        val trackHash = DeepSeekPolicy.trackHash(provider, sourceTrackId, value.lyricHash)
        if (value.lyricHash != suppliedLyricHash || trackHash != suppliedTrackHash) return Result("error", "STALE_IDENTITY")
        if (!forceRefresh) cache.get(trackHash, value.lyricHash, value.promptFingerprint)?.let { return Result("ok", translation = it.translation, trackHash = trackHash, lyricHash = value.lyricHash, cacheHit = true) }
        if (!allowNetwork) return Result("not-cached", "NOT_CACHED", trackHash = trackHash, lyricHash = value.lyricHash)
        if (!input.consent.complete()) return Result("error", "CONSENT_REQUIRED")
        val spec = DeepSeekPolicy.translationRequest(value)
        val request = spec.value ?: return Result("error", spec.errorCode)
        return execute(operationId, true) { cancelled ->
            val response = try { vault.withApiKey { key -> transport.post(request, key, cancelled) } } catch (error: DeepSeekVault.VaultException) { return@execute Result("error", error.code) }
            if (cancelled.get()) return@execute Result("error", "CANCELLED")
            when {
                response.oversized -> Result("error", "RESPONSE_TOO_LARGE")
                response.code == 401 || response.code == 403 -> Result("error", "INVALID_KEY")
                response.code == 429 -> Result("error", "RATE_LIMITED")
                response.code >= 500 -> Result("error", "SERVICE_UNAVAILABLE")
                response.code !in 200..299 -> Result("error", "PROVIDER_ERROR")
                else -> {
                    val content = try { org.json.JSONObject(response.body).getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content") } catch (_: Exception) { return@execute Result("error", "INVALID_RESPONSE") }
                    val parsed = DeepSeekPolicy.parseLineMap(content, value)
                    val translation = parsed.value ?: return@execute Result("error", parsed.errorCode)
                    if (cancelled.get() || trackHash != suppliedTrackHash) Result("error", "CANCELLED") else {
                        if (!cache.put(DeepSeekTranslationCache.Entry(trackHash, value.lyricHash, translation.translation, promptFingerprint = value.promptFingerprint))) Result("error", "CACHE_WRITE_FAILED") else Result("ok", translation = translation.translation, trackHash = trackHash, lyricHash = value.lyricHash)
                    }
                }
            }
        }
    }

    private fun execute(operationId: String, removeOnFinish: Boolean, block: (AtomicBoolean) -> Result): Result {
        val cancelled = AtomicBoolean(false); cancellations[operationId] = cancelled
        return try { block(cancelled) } catch (_: java.net.SocketTimeoutException) { Result("error", "TIMEOUT") } catch (_: Exception) { Result("error", "PROVIDER_ERROR") } finally { if (removeOnFinish || operationId == "test") cancellations.remove(operationId) }
    }

    private class HttpsTransport : Transport {
        override fun post(spec: DeepSeekPolicy.RequestSpec, apiKey: String, cancelled: AtomicBoolean): Response {
            if (cancelled.get()) return Response(499, "")
            val connection = URL(spec.endpoint).openConnection() as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 12_000
                connection.readTimeout = 20_000
                connection.requestMethod = "POST"
                connection.doOutput = true
                DeepSeekPolicy.fixedHeaders(apiKey).forEach { (name, value) -> connection.setRequestProperty(name, value) }
                connection.outputStream.use { it.write(spec.body.toByteArray()) }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.use { readBounded(it) } ?: ""
                return Response(code, body, body.length > DeepSeekPolicy.MAX_RESPONSE_BYTES)
            } finally { connection.disconnect() }
        }
        private fun readBounded(stream: java.io.InputStream): String { val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096); var total = 0; while (true) { val read = stream.read(buffer); if (read < 0) break; total += read; if (total > DeepSeekPolicy.MAX_RESPONSE_BYTES) return "x".repeat(DeepSeekPolicy.MAX_RESPONSE_BYTES + 1); output.write(buffer, 0, read) }; return output.toString(Charsets.UTF_8.name()) }
    }
}
