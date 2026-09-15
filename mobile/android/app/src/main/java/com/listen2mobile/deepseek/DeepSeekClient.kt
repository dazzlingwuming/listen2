package com.listen2mobile.deepseek

import java.io.ByteArrayOutputStream
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

/**
 * Fixed HTTPS client. Request construction, authorization, raw body parsing,
 * and provider response text remain inside this native transaction.
 */
class DeepSeekClient(
    private val vault: DeepSeekVault,
    private val cache: DeepSeekTranslationCache,
    private val transport: Transport = HttpsTransport(),
) {
    interface Transport {
        fun post(
            spec: DeepSeekPolicy.RequestSpec,
            apiKey: String,
            cancelled: AtomicBoolean,
        ): Response
    }

    data class Response(
        val code: Int,
        val body: String,
        val oversized: Boolean = false,
    )

    /** Exact bounded bridge projection; raw provider data never appears here. */
    data class Result(
        val status: String,
        val errorCode: String? = null,
        val lines: List<DeepSeekPolicy.TranslationLine>? = null,
        val revision: Long? = null,
        val trackHash: String? = null,
        val lyricHash: String? = null,
        val cacheHit: Boolean = false,
        val operation: String = "translate",
    )

    private data class Operation(
        val cancelled: AtomicBoolean,
        val identity: String,
        val revision: Long,
    )

    private val operations = ConcurrentHashMap<String, Operation>()
    private val currentIdentities = ConcurrentHashMap<String, CurrentIdentity>()
    private val usedOperationIds = Collections.synchronizedSet(LinkedHashSet<String>())

    private data class CurrentIdentity(
        val revision: Long,
        val lyricHash: String,
        val trackHash: String,
    )

    /** Cancellation is safe for unknown/finished operations and exposes no details. */
    fun cancel(operationId: String): Result {
        operations[operationId]?.cancelled?.set(true)
        return Result("cancelled")
    }

    /** Used by the native delete operation before key/ciphertext removal. */
    fun cancelAll() {
        operations.values.forEach { it.cancelled.set(true) }
    }

    fun test(): Result {
        val operationId = "test-${System.nanoTime()}"
        return execute(operationId, "test", "", 0, false) { operation ->
            val response = try {
                vault.withApiKey { key ->
                    transport.post(DeepSeekPolicy.testRequest(), key, operation.cancelled)
                }
            } catch (error: DeepSeekVault.VaultException) {
                return@execute Result("error", safeVaultError(error.code), operation = "test")
            }
            when {
                operation.cancelled.get() -> Result("cancelled", operation = "test")
                response.oversized -> Result("error", "RESPONSE_TOO_LARGE", operation = "test")
                response.code in 200..299 -> Result("ok", operation = "test")
                response.code == 401 || response.code == 403 -> Result("error", "INVALID_KEY", operation = "test")
                response.code == 429 -> Result("error", "RATE_LIMITED", operation = "test")
                response.code >= 500 -> Result("error", "SERVICE_UNAVAILABLE", operation = "test")
                else -> Result("error", "PROVIDER_ERROR", operation = "test")
            }
        }
    }

    fun translate(
        operationId: String,
        input: DeepSeekPolicy.Input,
        provider: String,
        sourceTrackId: String,
        suppliedLyricHash: String,
        suppliedTrackHash: String,
        allowNetwork: Boolean,
        forceRefresh: Boolean,
        matchedProvider: String? = null,
        matchedCandidateId: String? = null,
    ): Result {
        val operation = begin(operationId, "", input.revision)
            ?: return Result("error", "OPERATION_REUSED")
        try {
            val normalized = DeepSeekPolicy.normalize(input, requireConsent = allowNetwork)
            val value = normalized.value ?: return Result("error", normalized.errorCode)
            if (forceRefresh && !allowNetwork) return Result("error", "INVALID_REQUEST")
            val trackHash = DeepSeekPolicy.trackHash(provider, sourceTrackId, value.lyricHash)
            val identity = identityKey(provider, sourceTrackId)
            val current = CurrentIdentity(value.revision, value.lyricHash, trackHash)
            val prior = currentIdentities[identity]
            if (prior != null && value.revision < prior.revision) return Result("error", "STALE_REVISION")
            if (value.lyricHash != suppliedLyricHash || trackHash != suppliedTrackHash) return Result("error", "STALE_IDENTITY")
            if (!DeepSeekPolicy.isEligibleProvider(provider, sourceTrackId, matchedProvider, matchedCandidateId)) return Result("error", "LYRIC_UNAVAILABLE")
            currentIdentities[identity] = current
            val boundOperation = operation.copy(identity = identity, revision = value.revision)
            operations[operationId] = boundOperation

            if (!forceRefresh) {
                cache.get(trackHash, value.lyricHash, value.revision, value.title, value.artist, value.promptFingerprint)?.let {
                    return Result(
                        "ok",
                        lines = it.lines,
                        revision = it.revision,
                        trackHash = trackHash,
                        lyricHash = value.lyricHash,
                        cacheHit = true,
                    )
                }
            }
            if (!allowNetwork) return Result("not-cached", "NOT_CACHED", revision = value.revision, trackHash = trackHash, lyricHash = value.lyricHash)
            val spec = DeepSeekPolicy.translationRequest(value)
            val request = spec.value ?: return Result("error", spec.errorCode, revision = value.revision, trackHash = trackHash, lyricHash = value.lyricHash)
            return runNetwork(boundOperation, value, request, trackHash)
        } catch (error: DeepSeekVault.VaultException) {
            return Result("error", safeVaultError(error.code))
        } catch (_: java.net.SocketTimeoutException) {
            return Result("error", "TIMEOUT")
        } catch (_: Exception) {
            return Result("error", "PROVIDER_ERROR")
        } finally {
            operations.remove(operationId)
        }
    }

    private fun runNetwork(
        operation: Operation,
        input: DeepSeekPolicy.Normalized,
        request: DeepSeekPolicy.RequestSpec,
        trackHash: String,
    ): Result {
        val response = try {
            vault.withApiKey { key -> transport.post(request, key, operation.cancelled) }
        } catch (error: DeepSeekVault.VaultException) {
            return Result("error", safeVaultError(error.code))
        }
        if (operation.cancelled.get()) return Result("cancelled", "CANCELLED")
        when {
            response.oversized -> return Result("error", "RESPONSE_TOO_LARGE")
            response.code == 401 || response.code == 403 -> return Result("error", "INVALID_KEY")
            response.code == 429 -> return Result("error", "RATE_LIMITED")
            response.code >= 500 -> return Result("error", "SERVICE_UNAVAILABLE")
            response.code !in 200..299 -> return Result("error", "PROVIDER_ERROR")
        }
        val content = try {
            org.json.JSONObject(response.body)
                .getJSONArray("choices")
                .getJSONObject(0)
                .getJSONObject("message")
                .getString("content")
        } catch (_: Exception) {
            return Result("error", "INVALID_RESPONSE")
        }
        val parsed = DeepSeekPolicy.parseLineMap(content, input)
        val translation = parsed.value ?: return Result("error", parsed.errorCode)
        // These checks happen immediately before the private cache transaction.
        if (operation.cancelled.get()) return Result("cancelled", "CANCELLED")
        val current = currentIdentities[operation.identity]
        if (
            current == null ||
            current.revision != input.revision ||
            current.lyricHash != input.lyricHash ||
            current.trackHash != trackHash
        ) return Result("error", "STALE_REVISION")
        when (vault.status().state) {
            DeepSeekVault.State.Configured -> Unit
            DeepSeekVault.State.CorruptCleared -> return Result("error", "CORRUPT_CLEARED")
            DeepSeekVault.State.KeystoreUnavailable -> return Result("error", "KEYSTORE_UNAVAILABLE")
            DeepSeekVault.State.NotConfigured -> return Result("error", "MISSING_KEY")
        }
        if (
            operation.cancelled.get() ||
            currentIdentities[operation.identity] != current
        ) return Result("cancelled", "CANCELLED")
        val entry = DeepSeekTranslationCache.Entry(
            trackHash = trackHash,
            lyricHash = input.lyricHash,
            revision = translation.revision,
            lines = translation.lines,
            title = input.title,
            artist = input.artist,
            promptFingerprint = input.promptFingerprint,
        )
        if (!cache.put(entry)) return Result("error", "CACHE_WRITE_FAILED")
        return Result(
            "ok",
            lines = entry.lines,
            revision = entry.revision,
            trackHash = trackHash,
            lyricHash = input.lyricHash,
        )
    }

    private fun begin(operationId: String, identity: String, revision: Long): Operation? {
        if (operationId.isBlank() || operationId.length > 64 || !OPERATION_ID.matches(operationId)) return null
        synchronized(usedOperationIds) {
            if (usedOperationIds.contains(operationId)) return null
            usedOperationIds += operationId
            while (usedOperationIds.size > MAX_USED_OPERATIONS) usedOperationIds.remove(usedOperationIds.first())
        }
        val operation = Operation(AtomicBoolean(false), identity, revision)
        operations[operationId] = operation
        return operation
    }

    private fun execute(
        operationId: String,
        operation: String,
        identity: String,
        revision: Long,
        retain: Boolean,
        block: (Operation) -> Result,
    ): Result {
        val current = begin(operationId, identity, revision) ?: return Result("error", "OPERATION_REUSED", operation = operation)
        return try {
            block(current)
        } catch (error: DeepSeekVault.VaultException) {
            Result("error", safeVaultError(error.code), operation = operation)
        } catch (_: java.net.SocketTimeoutException) {
            Result("error", "TIMEOUT", operation = operation)
        } catch (_: Exception) {
            Result("error", "PROVIDER_ERROR", operation = operation)
        } finally {
            if (!retain) operations.remove(operationId)
        }
    }

    private class HttpsTransport : Transport {
        override fun post(
            spec: DeepSeekPolicy.RequestSpec,
            apiKey: String,
            cancelled: AtomicBoolean,
        ): Response {
            if (cancelled.get()) return Response(499, "")
            val connection = URL(spec.endpoint).openConnection() as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.requestMethod = "POST"
                connection.doOutput = true
                DeepSeekPolicy.fixedHeaders(apiKey).forEach { (name, value) -> connection.setRequestProperty(name, value) }
                connection.outputStream.use { it.write(spec.body.toByteArray(StandardCharsets.UTF_8)) }
                if (cancelled.get()) return Response(499, "")
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val bounded = stream?.use { readBounded(it) } ?: BoundedBody("", false)
                return Response(code, bounded.body, bounded.oversized)
            } finally {
                connection.disconnect()
            }
        }

        private fun readBounded(stream: java.io.InputStream): BoundedBody {
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            var total = 0
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                total += read
                if (total > DeepSeekPolicy.MAX_RESPONSE_BYTES) return BoundedBody("", true)
                output.write(buffer, 0, read)
            }
            return BoundedBody(output.toString(StandardCharsets.UTF_8.name()), false)
        }

        private data class BoundedBody(val body: String, val oversized: Boolean)
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 12_000
        const val READ_TIMEOUT_MS = 20_000
        const val MAX_USED_OPERATIONS = 256
        val OPERATION_ID = Regex("[A-Za-z0-9_-]{1,64}")
        fun identityKey(provider: String, sourceTrackId: String) = "$provider\n$sourceTrackId"
        fun safeVaultError(code: String) = when (code) {
            "keystore-unavailable" -> "KEYSTORE_UNAVAILABLE"
            "corrupt-cleared" -> "CORRUPT_CLEARED"
            "missing-key" -> "MISSING_KEY"
            else -> "PROVIDER_ERROR"
        }
    }
}
