package com.listen2mobile.kugou

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
import com.listen2mobile.media.toWritableMap

@ReactModule(name = KugouPlaybackModule.NAME)
internal class KugouPlaybackModule(context: ReactApplicationContext, private val gateway: KugouPlaybackGateway, private val leases: MediaLeaseRegistry) : ReactContextBaseJavaModule(context) {
    companion object {
        const val NAME = "Listen2KugouPlayback"
        const val VERSION = 1
        const val PROVIDER = "kugou"
        const val MEDIA_AUTHORITY = "com.dazzlingwuming.listen2.media"
        val APPROVED_HOSTS = listOf("wwwapi.kugou.com", "sharefs.kugou.com")
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
            val keys = request.keySetIterator(); while (keys.hasNextKey()) require(keys.nextKey() in setOf("version", "requestId", "trackId"))
            require(request.getType("version") == ReadableType.Number && request.getDouble("version") == VERSION.toDouble())
            val requestId = text(request, "requestId", 96); val trackId = text(request, "trackId", 136); val resolution = gateway.resolve(requestId, trackId)
            val value = leases.register(resolution.requestId, MediaIdentity("kugou", resolution.trackId, null, 0L), MediaRendition("default", "authorized", "audio/mpeg", "mp3", "mp3", 1L, null), resolution.transport, 0L)
            promise.resolve(value.toWritableMap())
        } catch (_: Exception) { promise.resolve(Arguments.createMap().apply { putString("errorCode", "INVALID_REQUEST") }) }
    }
    @ReactMethod fun cancel(request: ReadableMap, promise: Promise) {
        try {
            val keys = request.keySetIterator(); while (keys.hasNextKey()) require(keys.nextKey() in setOf("version", "requestId"))
            require(request.getType("version") == ReadableType.Number && request.getDouble("version") == VERSION.toDouble())
            text(request, "requestId", 96)
            promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
        } catch (_: Exception) {
            promise.resolve(Arguments.createMap().apply { putString("errorCode", "INVALID_REQUEST") })
        }
    }
    private fun text(map: ReadableMap, key: String, max: Int): String { require(map.hasKey(key) && map.getType(key) == ReadableType.String); return requireNotNull(map.getString(key)).also { require(it.length in 1..max && it.none { character -> character.code <= 31 }) } }
}
