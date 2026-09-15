package com.listen2mobile.kuwo

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.module.annotations.ReactModule
import com.listen2mobile.media.MediaDescriptor
import com.listen2mobile.media.MediaIdentity
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaRendition
import com.listen2mobile.media.OfflineEntitlementClass
import com.listen2mobile.media.NativeTransport
import com.listen2mobile.media.toWritableMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Closed semantic-only RN boundary. No cookie, Secret, URL, or request controls cross it. */
@ReactModule(name = KuwoPlaybackModule.NAME)
internal class KuwoPlaybackModule(
    context: ReactApplicationContext,
    private val gateway: KuwoPlaybackGateway = KuwoPlaybackGateway(),
    private val mediaLeases: MediaLeaseRegistry,
) : ReactContextBaseJavaModule(context) {
    companion object {
        const val NAME = "Listen2KuwoPlayback"
        const val PROVIDER = KuwoPlaybackPolicy.PROVIDER
        const val CONTRACT_VERSION = KuwoPlaybackPolicy.CONTRACT_VERSION
        const val MEDIA_AUTHORITY = "com.dazzlingwuming.listen2.media"
        val POLICY_READY: Boolean get() = KuwoPlaybackPolicy.policyReady()
        val APPROVED_HOSTS: List<String> get() = if (POLICY_READY) listOf("er-sycdn.kuwo.cn") else emptyList()
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val ledger = KuwoPlaybackPolicy.RequestLedger()
    @Volatile private var invalidated = false

    override fun getName() = NAME

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "provider" to PROVIDER,
        "version" to CONTRACT_VERSION,
        "policyReady" to POLICY_READY,
        "approvedHosts" to APPROVED_HOSTS,
        "mediaAuthority" to MEDIA_AUTHORITY,
    )

    @ReactMethod
    fun resolveAudio(request: ReadableMap, promise: Promise) {
        val parsed = try { parseRequest(request) } catch (_: Exception) {
            return promise.resolve(error(KuwoPlaybackPolicy.ErrorCode.INVALID_REQUEST))
        }
        val lease = if (invalidated) null else ledger.claim(parsed.requestId)
        if (lease == null) return promise.resolve(error(if (invalidated) KuwoPlaybackPolicy.ErrorCode.CANCELLED else KuwoPlaybackPolicy.ErrorCode.INVALID_REQUEST))
        try {
            worker.execute {
                val result = try {
                    if (!ledger.isCurrent(lease) || invalidated) error(KuwoPlaybackPolicy.ErrorCode.CANCELLED)
                    else descriptor(gateway.resolve(parsed.requestId, parsed.track) { !ledger.isCurrent(lease) || invalidated })
                } catch (failure: KuwoPlaybackPolicy.ProviderException) {
                    error(if (!ledger.isCurrent(lease) || invalidated) KuwoPlaybackPolicy.ErrorCode.CANCELLED else failure.code)
                } catch (_: Exception) {
                    error(if (!ledger.isCurrent(lease) || invalidated) KuwoPlaybackPolicy.ErrorCode.CANCELLED else KuwoPlaybackPolicy.ErrorCode.INVALID_RESPONSE)
                }
                ledger.complete(lease)
                promise.resolve(if (lease.cancelled.get() || invalidated) error(KuwoPlaybackPolicy.ErrorCode.CANCELLED) else result)
            }
        } catch (_: RejectedExecutionException) {
            ledger.complete(lease)
            promise.resolve(error(KuwoPlaybackPolicy.ErrorCode.CANCELLED))
        }
    }

    @ReactMethod
    fun cancel(request: ReadableMap, promise: Promise) {
        val requestId = try {
            requireKeys(request, setOf("version", "requestId"))
            require(request.getType("version") == ReadableType.Number && KuwoPlaybackPolicy.isContractVersion(request.getDouble("version")))
            requireRequestId(request)
        } catch (_: Exception) { return promise.resolve(error(KuwoPlaybackPolicy.ErrorCode.INVALID_REQUEST)) }
        // Resolver cancellation alone leaves a previously registered content lease
        // readable until its TTL.  Always revoke it by the same request identity.
        mediaLeases.cancel(requestId)
        if (ledger.cancel(requestId) != null) gateway.cancel(requestId)
        promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
    }

    override fun invalidate() {
        invalidated = true
        ledger.cancelAll().forEach {
            mediaLeases.cancel(it.requestId)
            gateway.cancel(it.requestId)
        }
        gateway.clearSession()
        worker.shutdownNow()
        super.invalidate()
    }

    private data class Request(val requestId: String, val track: KuwoPlaybackPolicy.SemanticTrack)
    private fun parseRequest(request: ReadableMap): Request {
        requireKeys(request, setOf("version", "requestId", "trackId"))
        require(request.getType("version") == ReadableType.Number && KuwoPlaybackPolicy.isContractVersion(request.getDouble("version")))
        val id = requireTrackId(request)
        return Request(requireRequestId(request), KuwoPlaybackPolicy.parseSemanticTrack(id) ?: throw IllegalArgumentException())
    }
    private fun requireKeys(map: ReadableMap, allowed: Set<String>) { val keys = map.keySetIterator(); while (keys.hasNextKey()) require(keys.nextKey() in allowed) }
    private fun requireRequestId(map: ReadableMap): String {
        require(map.hasKey("requestId") && map.getType("requestId") == ReadableType.String)
        return map.getString("requestId")?.takeIf(KuwoPlaybackPolicy::isRequestId) ?: throw IllegalArgumentException()
    }
    private fun requireTrackId(map: ReadableMap): String {
        require(map.hasKey("trackId") && map.getType("trackId") == ReadableType.String)
        return map.getString("trackId")?.takeIf { it.length <= 136 && it.none { char -> char.code <= 31 } } ?: throw IllegalArgumentException()
    }
    /** Cookie and Secret remain inside the gateway; this emits only the common descriptor. */
    private fun descriptor(value: KuwoPlaybackPolicy.Descriptor): com.facebook.react.bridge.WritableMap {
        val descriptor = mediaLeases.register(
            value.requestId, MediaIdentity(value.source, value.trackId, null, 0L),
            MediaRendition("default", "authorized", value.mimeType, if (value.mimeType == "audio/mpeg") "mp3" else "mp4", if (value.mimeType == "audio/mpeg") "mp3" else "aac", 1L, value.sizeBytes),
            NativeTransport(value.url, KuwoPlaybackPolicy.fixedProbeHeaders(), source = "kuwo"), 0L,
            OfflineEntitlementClass.ANONYMOUS_FREE,
        )
        return descriptor.toWritableMap()
    }
    private fun error(code: KuwoPlaybackPolicy.ErrorCode) = Arguments.createMap().apply { putString("errorCode", code.name) }
}
