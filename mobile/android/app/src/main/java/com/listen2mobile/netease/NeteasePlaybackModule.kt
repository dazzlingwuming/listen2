package com.listen2mobile.netease

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.module.annotations.ReactModule
import com.listen2mobile.media.MediaIdentity
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaRendition
import com.listen2mobile.media.OfflineEntitlementClass
import com.listen2mobile.media.toWritableMap

@ReactModule(name = NeteasePlaybackModule.NAME)
internal class NeteasePlaybackModule(
    context: ReactApplicationContext,
    private val gateway: NeteasePlaybackGateway,
    private val leases: MediaLeaseRegistry,
) : ReactContextBaseJavaModule(context) {
    companion object {
        const val NAME = "Listen2NeteasePlayback"
        const val VERSION = 1
        const val PROVIDER = "netease"
        const val MEDIA_AUTHORITY = "com.dazzlingwuming.listen2.media"
        val APPROVED_HOSTS = listOf("music.163.com")
    }
    override fun getName() = NAME
    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "provider" to PROVIDER,
        "version" to VERSION,
        "policyReady" to true,
        "mediaAuthority" to MEDIA_AUTHORITY,
        "approvedHosts" to APPROVED_HOSTS,
    )

    @ReactMethod fun resolveAudio(request: ReadableMap, promise: Promise) {
        try {
            requireExact(request, setOf("version", "requestId", "trackId"))
            require(request.getType("version") == ReadableType.Number && request.getDouble("version") == VERSION.toDouble())
            val requestId = requireText(request, "requestId", 96)
            val trackId = requireText(request, "trackId", 136)
            val resolution = gateway.resolve(requestId, trackId)
            val value = leases.register(
                resolution.requestId, MediaIdentity("netease", resolution.trackId, null, 0L),
                MediaRendition("default", "authorized", "audio/mpeg", "mp3", "mp3", 1L, null), resolution.transport, 0L,
                OfflineEntitlementClass.ANONYMOUS_FREE,
            )
            promise.resolve(value.toWritableMap())
        } catch (_: Exception) { promise.resolve(Arguments.createMap().apply { putString("errorCode", "INVALID_REQUEST") }) }
    }
    @ReactMethod fun cancel(request: ReadableMap, promise: Promise) {
        try {
            requireExact(request, setOf("version", "requestId"))
            require(request.getType("version") == ReadableType.Number && request.getDouble("version") == VERSION.toDouble())
            // A descriptor can have been returned before JS observes an abort.  Revoking
            // by request id closes that already-issued content lease as well as making
            // cancellation idempotent when resolution never reached registration.
            leases.cancel(requireText(request, "requestId", 96))
            promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
        } catch (_: Exception) {
            promise.resolve(Arguments.createMap().apply { putString("errorCode", "INVALID_REQUEST") })
        }
    }

    private fun requireExact(map: ReadableMap, allowed: Set<String>) { val keys = map.keySetIterator(); while (keys.hasNextKey()) require(keys.nextKey() in allowed) }
    private fun requireText(map: ReadableMap, key: String, max: Int): String { require(map.hasKey(key) && map.getType(key) == ReadableType.String); return requireNotNull(map.getString(key)).also { require(it.length in 1..max && it.none { character -> character.code <= 31 }) } }
}
