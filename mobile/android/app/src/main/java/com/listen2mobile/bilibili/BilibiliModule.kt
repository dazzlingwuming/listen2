package com.listen2mobile.bilibili

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.listen2mobile.MainActivity
import java.util.concurrent.Executors

/** Semantic-only React Native boundary. Every rejected value returns a stable code, never provider text. */
@ReactModule(name = BilibiliModule.NAME)
class BilibiliModule(
    context: ReactApplicationContext,
    private val gateway: BilibiliGateway,
    private val session: BilibiliSession,
    private val mvController: BilibiliMvController,
    private val mvViewManager: BilibiliMvViewManager,
) : ReactContextBaseJavaModule(context) {
    companion object { const val NAME = "Listen2Bilibili" }
    private val worker = Executors.newSingleThreadExecutor()
    override fun getName() = NAME

    @ReactMethod fun status(promise: Promise) = complete(promise) { state(session.restore()) }
    @ReactMethod fun qrBegin(promise: Promise) {
        session.cancelActiveRequest()
        complete(promise) { state(session.begin(System.currentTimeMillis())) }
    }
    @ReactMethod fun qrPoll(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("attemptId"))
        state(session.poll(requireText(request, "attemptId", 64), System.currentTimeMillis()))
    }
    @ReactMethod fun qrCancel(request: ReadableMap, promise: Promise) {
        try {
            requireKeys(request, setOf("attemptId"))
            promise.resolve(state(session.cancel(requireText(request, "attemptId", 64))))
        } catch (_: Exception) {
            promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST))
        }
    }
    @ReactMethod fun logout(promise: Promise) {
        session.cancelActiveRequest()
        complete(promise) { state(session.logout()) }
    }
    @ReactMethod fun videoDetail(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("bvid")); detail(gateway.videoDetail(requireBvid(request, "bvid")))
    }
    @ReactMethod fun resolveAudio(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("bvid", "cid"))
        val bvid = requireBvid(request, "bvid")
        val cid = requirePositive(request, "cid")
        val part = gateway.videoDetail(bvid).parts.singleOrNull { it.cid == cid }
            ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val handoff = gateway.resolveAudio(BilibiliPolicy.SemanticTrack(bvid, cid, part.page))
        if (!BilibiliPolicy.isSafeAudioHandoff(handoff.url, mapOf("Referer" to BilibiliPolicy.FIXED_REFERER), handoff.deadline, System.currentTimeMillis())) throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        Arguments.createMap().apply {
            putString("bvid", handoff.bvid); putString("cid", handoff.cid.toString()); putString("page", handoff.page.toString())
            putString("url", handoff.url); putDouble("deadline", handoff.deadline.toDouble())
            putMap("headers", Arguments.createMap().apply { putString("Referer", BilibiliPolicy.FIXED_REFERER) })
        }
    }

    @ReactMethod fun mvOpen(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("bvid", "cid", "qualityId", "preferredCodecs", "forceRefresh"))
        (currentActivity as? MainActivity)?.bindMvController(mvController)
        mvViewManager.releaseHandle(mvController.currentHandle())
        mvState(mvController.open(requireMvRequest(request)))
    }
    @ReactMethod fun mvSelectQuality(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle", "qualityId"))
        mvState(mvController.selectQuality(requireHandle(request), requireQuality(request, "qualityId")))
    }
    @ReactMethod fun mvSync(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle", "positionMs", "playIntent"))
        val position = requirePositiveOrZero(request, "positionMs")
        if (!request.hasKey("playIntent") || request.getType("playIntent") != ReadableType.Boolean) throw IllegalArgumentException()
        mvState(mvController.sync(requireHandle(request), position, request.getBoolean("playIntent")))
    }
    @ReactMethod fun mvRefresh(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle")); mvState(mvController.refresh(requireHandle(request)))
    }
    @ReactMethod fun mvClose(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle")); val handle = requireHandle(request); val state = mvController.close(handle); mvViewManager.releaseHandle(handle); mvState(state)
    }
    @ReactMethod fun mvEnterFullscreen(request: ReadableMap, promise: Promise) = completeMvUi(promise, request) { activity, handle -> activity.enterMvFullscreen(handle) }
    @ReactMethod fun mvExitFullscreen(request: ReadableMap, promise: Promise) = completeMvUi(promise, request) { activity, handle -> activity.exitMvFullscreen(handle) }
    @ReactMethod fun mvRequestPip(request: ReadableMap, promise: Promise) = completeMvUi(promise, request) { activity, handle -> activity.enterMvPip(handle) }

    private fun complete(promise: Promise, operation: () -> WritableMap) {
        worker.execute {
            try { promise.resolve(operation()) }
            catch (error: BilibiliHttpsGateway.ProviderException) { promise.resolve(error(error.code)) }
            catch (_: IllegalArgumentException) { promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST)) }
            catch (_: Exception) { promise.resolve(error(BilibiliPolicy.ErrorCode.PROVIDER_ERROR)) }
        }
    }
    private fun completeMvUi(promise: Promise, request: ReadableMap, operation: (MainActivity, String) -> Boolean) {
        try {
            requireKeys(request, setOf("handle"))
            val handle = requireHandle(request)
            val activity = currentActivity as? MainActivity
                ?: return promise.resolve(error(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE))
            activity.bindMvController(mvController)
            if (!mvController.isActiveHandle(handle)) return promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST))
            activity.runOnUiThread {
                try {
                    if (!mvController.isActiveHandle(handle)) promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST))
                    else promise.resolve(Arguments.createMap().apply { putBoolean("ok", operation(activity, handle)) })
                } catch (_: Exception) { promise.resolve(error(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)) }
            }
        } catch (_: Exception) { promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST)) }
    }

    private fun state(value: BilibiliSession.PublicState): WritableMap = Arguments.createMap().apply {
        putString("status", value.status.name.lowercase()); putString("attemptId", value.attemptId); putDouble("expiresAt", value.expiresAt.toDouble())
        putString("qrPngDataUri", value.qrPngDataUri); value.displayName?.let { putString("displayName", it) }; value.avatarUrl?.let { putString("avatarUrl", it) }
        putBoolean("retryable", value.retryable); putString("nextAction", value.nextAction); value.errorCode?.let { putString("errorCode", it.name) }
    }
    private fun detail(value: BilibiliGateway.VideoDetail): WritableMap = Arguments.createMap().apply {
        putString("bvid", value.bvid); putString("title", value.title); value.owner?.let { putString("owner", it) }
        putArray("parts", Arguments.createArray().apply { value.parts.forEach { part -> pushMap(Arguments.createMap().apply { putString("cid", part.cid.toString()); putString("page", part.page.toString()); putString("title", part.title); part.durationMs?.let { putDouble("durationMs", it.toDouble()) } }) } })
    }
    private fun mvState(value: BilibiliMvController.PublicState): WritableMap = Arguments.createMap().apply {
        putString("state", value.state.name.lowercase())
        if (value.handle.isNotBlank()) putString("handle", value.handle)
        if (value.bvid.isNotBlank()) putString("bvid", value.bvid)
        if (value.cid.isNotBlank()) putString("cid", value.cid)
        putString("qualityId", value.qualityId); putDouble("positionMs", value.positionMs.toDouble()); putBoolean("playIntent", value.playIntent)
        putBoolean("refreshing", value.refreshing)
        putArray("variants", Arguments.createArray().apply { value.variants.forEach { variant -> pushMap(Arguments.createMap().apply { putString("id", variant.id); putString("label", variant.label); putString("codec", variant.codec); putInt("width", variant.width); putInt("height", variant.height) }) })
        value.errorCode?.let { putString("errorCode", it.name) }
    }
    private fun error(code: BilibiliPolicy.ErrorCode): WritableMap = Arguments.createMap().apply { putString("errorCode", code.name) }
    private fun requireKeys(map: ReadableMap, allowed: Set<String>) { val keys = map.keySetIterator(); while (keys.hasNextKey()) if (keys.nextKey() !in allowed) throw IllegalArgumentException() }
    private fun requireText(map: ReadableMap, key: String, limit: Int): String { if (!map.hasKey(key) || map.getType(key) != ReadableType.String) throw IllegalArgumentException(); return BilibiliPolicy.safeText(map.getString(key), limit) ?: throw IllegalArgumentException() }
    private fun requireBvid(map: ReadableMap, key: String): String = requireText(map, key, 40).also { if (!BilibiliPolicy.isCanonicalBvid(it)) throw IllegalArgumentException() }
    private fun requirePositive(map: ReadableMap, key: String): Long { val value = requireText(map, key, 18); if (!BilibiliPolicy.isPositiveText(value)) throw IllegalArgumentException(); return value.toLong() }
    private fun requirePositiveOrZero(map: ReadableMap, key: String): Long { if (!map.hasKey(key) || map.getType(key) != ReadableType.Number) throw IllegalArgumentException(); return map.getDouble(key).toLong().takeIf { it >= 0L && it <= 24L * 60L * 60L * 1000L } ?: throw IllegalArgumentException() }
    private fun requireHandle(map: ReadableMap): String = requireText(map, "handle", 96).takeIf(BilibiliMvPolicy::isOpaqueHandle) ?: throw IllegalArgumentException()
    private fun requireQuality(map: ReadableMap, key: String): String = requireText(map, key, 8)
    private fun requireMvRequest(map: ReadableMap): BilibiliMvPolicy.MvRequest {
        val codecs = if (!map.hasKey("preferredCodecs") || map.isNull("preferredCodecs")) emptyList() else {
            if (map.getType("preferredCodecs") != ReadableType.Array) throw IllegalArgumentException()
            val values = map.getArray("preferredCodecs") ?: throw IllegalArgumentException()
            if (values.size() > 4) throw IllegalArgumentException()
            (0 until values.size()).map { index -> if (values.getType(index) != ReadableType.String) throw IllegalArgumentException(); requireNotNull(values.getString(index)) }
        }
        val forceRefresh = if (!map.hasKey("forceRefresh") || map.isNull("forceRefresh")) false else {
            if (map.getType("forceRefresh") != ReadableType.Boolean) throw IllegalArgumentException(); map.getBoolean("forceRefresh")
        }
        val quality = if (!map.hasKey("qualityId") || map.isNull("qualityId")) "auto" else requireQuality(map, "qualityId")
        return BilibiliMvPolicy.request(requireBvid(map, "bvid"), requirePositive(map, "cid"), quality, codecs, forceRefresh) ?: throw IllegalArgumentException()
    }
}
