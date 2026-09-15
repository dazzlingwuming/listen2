package com.listen2mobile.qq

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Unregistered semantic-only RN boundary. Plan 05-05 owns runtime registration and capability activation. */
@ReactModule(name = QqPlaybackModule.NAME)
internal class QqPlaybackModule(
    context: ReactApplicationContext,
    private val gateway: QqPlaybackGateway = QqPlaybackGateway(),
) : ReactContextBaseJavaModule(context) {
    companion object {
        const val NAME = "Listen2QqPlayback"
        const val PROVIDER = QqPlaybackPolicy.PROVIDER
        const val CONTRACT_VERSION = QqPlaybackPolicy.CONTRACT_VERSION
        val POLICY_READY: Boolean get() = QqPlaybackPolicy.policyReady()
        val APPROVED_HOSTS: List<String> get() = if (POLICY_READY) listOf("isure.stream.qqmusic.qq.com") else emptyList()
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val ledger = QqPlaybackPolicy.RequestLedger()
    @Volatile private var invalidated = false

    override fun getName() = NAME

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "provider" to PROVIDER,
        "version" to CONTRACT_VERSION,
        "policyReady" to POLICY_READY,
        "approvedHosts" to APPROVED_HOSTS,
    )

    @ReactMethod
    fun resolveAudio(request: ReadableMap, promise: Promise) {
        val parsed = try { parseRequest(request) } catch (_: Exception) {
            return promise.resolve(error(QqPlaybackPolicy.ErrorCode.INVALID_REQUEST))
        }
        val lease = if (invalidated) null else ledger.claim(parsed.requestId)
        if (lease == null) {
            return promise.resolve(error(if (invalidated) QqPlaybackPolicy.ErrorCode.CANCELLED else QqPlaybackPolicy.ErrorCode.INVALID_REQUEST))
        }
        try {
            worker.execute {
                val result = try {
                    if (!ledger.isCurrent(lease) || invalidated) {
                        error(QqPlaybackPolicy.ErrorCode.CANCELLED)
                    } else {
                        descriptor(gateway.resolve(parsed.requestId, parsed.track) {
                            !ledger.isCurrent(lease) || invalidated
                        })
                    }
                } catch (failure: QqPlaybackPolicy.ProviderException) {
                    error(if (!ledger.isCurrent(lease) || invalidated) QqPlaybackPolicy.ErrorCode.CANCELLED else failure.code)
                } catch (_: Exception) {
                    error(if (!ledger.isCurrent(lease) || invalidated) QqPlaybackPolicy.ErrorCode.CANCELLED else QqPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
                }
                ledger.complete(lease)
                if (lease.cancelled.get() || invalidated) {
                    promise.resolve(error(QqPlaybackPolicy.ErrorCode.CANCELLED))
                } else {
                    promise.resolve(result)
                }
            }
        } catch (_: RejectedExecutionException) {
            ledger.complete(lease)
            promise.resolve(error(QqPlaybackPolicy.ErrorCode.CANCELLED))
        }
    }

    @ReactMethod
    fun cancel(request: ReadableMap, promise: Promise) {
        val requestId = try {
            requireKeys(request, setOf("version", "requestId"))
            require(request.getType("version") == ReadableType.Number && QqPlaybackPolicy.isContractVersion(request.getDouble("version")))
            requireRequestId(request, "requestId")
        } catch (_: Exception) { return promise.resolve(error(QqPlaybackPolicy.ErrorCode.INVALID_REQUEST)) }
        if (ledger.cancel(requestId) != null) gateway.cancel(requestId)
        promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
    }

    override fun invalidate() {
        invalidated = true
        ledger.cancelAll().forEach { gateway.cancel(it.requestId) }
        worker.shutdownNow()
        super.invalidate()
    }

    private data class Request(val requestId: String, val track: QqPlaybackPolicy.SemanticTrack)
    private fun parseRequest(request: ReadableMap): Request {
        requireKeys(request, setOf("version", "requestId", "trackId"))
        require(request.getType("version") == ReadableType.Number && QqPlaybackPolicy.isContractVersion(request.getDouble("version")))
        return Request(
            requireRequestId(request, "requestId"),
            QqPlaybackPolicy.parseSemanticTrack(requireTrackId(request, "trackId")) ?: throw IllegalArgumentException(),
        )
    }
    private fun requireKeys(map: ReadableMap, allowed: Set<String>) { val keys = map.keySetIterator(); while (keys.hasNextKey()) require(keys.nextKey() in allowed) }
    private fun requireRequestId(map: ReadableMap, key: String): String {
        require(map.hasKey(key) && map.getType(key) == ReadableType.String)
        return map.getString(key)?.takeIf(QqPlaybackPolicy::isRequestId) ?: throw IllegalArgumentException()
    }
    private fun requireTrackId(map: ReadableMap, key: String): String {
        require(map.hasKey(key) && map.getType(key) == ReadableType.String)
        return map.getString(key)?.takeIf { it.length <= 136 && it.none { character -> character.code <= 31 } } ?: throw IllegalArgumentException()
    }
    private fun descriptor(value: QqPlaybackPolicy.Descriptor) = Arguments.createMap().apply {
        putInt("version", value.version); putString("requestId", value.requestId); putString("trackId", value.trackId); putString("source", value.source)
        putString("url", value.url); putString("mimeType", value.mimeType); putDouble("sizeBytes", value.sizeBytes.toDouble()); putDouble("expiresAt", value.expiresAt.toDouble())
    }
    private fun error(code: QqPlaybackPolicy.ErrorCode) = Arguments.createMap().apply { putString("errorCode", code.name) }
}
