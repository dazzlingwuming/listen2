package com.listen2mobile.deepseek

import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

/** Fixed HTTPS client. The only Authorization construction is adjacent to native vault use. */
class DeepSeekClient(private val vault: DeepSeekVault, private val cache: DeepSeekTranslationCache, private val transport: Transport = HttpsTransport()) {
    interface Transport { fun post(spec: DeepSeekPolicy.RequestSpec, apiKey: String, cancelled: AtomicBoolean): Response }
    data class Response(val code: Int, val body: String)
    data class Result(val status: String, val errorCode: String? = null, val translation: String? = null, val trackHash: String? = null, val lyricHash: String? = null, val cacheHit: Boolean = false)
    private val cancellations = ConcurrentHashMap<String, AtomicBoolean>()

    fun cancel(operationId: String): Result { cancellations[operationId]?.set(true); return Result("cancelled") }
    fun test(): Result = execute("test", false) { cancelled ->
        val response = vault.withApiKey { key -> transport.post(DeepSeekPolicy.testRequest(), key, cancelled) }
        when { cancelled.get() -> Result("error", "CANCELLED"); response.code in 200..299 -> Result("ok"); response.code == 401 || response.code == 403 -> Result("error", "INVALID_KEY"); response.code == 429 -> Result("error", "RATE_LIMITED"); response.code >= 500 -> Result("error", "SERVICE_UNAVAILABLE"); else -> Result("error", "PROVIDER_ERROR") }
    }

    fun translate(operationId: String, input: DeepSeekPolicy.Input, provider: String, sourceTrackId: String, suppliedLyricHash: String, suppliedTrackHash: String, allowNetwork: Boolean, forceRefresh: Boolean): Result {
        if (!DeepSeekPolicy.isEligibleProvider(provider)) return Result("error", "LYRIC_UNAVAILABLE")
        val normalized = DeepSeekPolicy.normalize(input)
        val value = normalized.value ?: return Result("error", normalized.errorCode)
        val trackHash = DeepSeekPolicy.trackHash(provider, sourceTrackId, value.lyricHash)
        if (value.lyricHash != suppliedLyricHash || trackHash != suppliedTrackHash) return Result("error", "STALE_IDENTITY")
        if (!forceRefresh) cache.get(trackHash, value.lyricHash)?.let { return Result("ok", translation = it.translation, trackHash = trackHash, lyricHash = value.lyricHash, cacheHit = true) }
        if (!allowNetwork) return Result("not-cached", "NOT_CACHED", trackHash = trackHash, lyricHash = value.lyricHash)
        val spec = DeepSeekPolicy.translationRequest(value)
        val request = spec.value ?: return Result("error", spec.errorCode)
        return execute(operationId, true) { cancelled ->
            val response = try { vault.withApiKey { key -> transport.post(request, key, cancelled) } } catch (error: DeepSeekVault.VaultException) { return@execute Result("error", error.code) }
            if (cancelled.get()) return@execute Result("error", "CANCELLED")
            when {
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
                val body = stream?.bufferedReader()?.use { it.readText().take(DeepSeekPolicy.MAX_RESPONSE_BYTES + 1) } ?: ""
                return Response(code, body)
            } finally { connection.disconnect() }
        }
    }
}
