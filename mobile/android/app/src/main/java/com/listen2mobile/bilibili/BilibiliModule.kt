package com.listen2mobile.bilibili

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.listen2mobile.MainActivity
import com.listen2mobile.media.BridgeMediaPart
import com.listen2mobile.media.MediaIdentity
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaRendition
import com.listen2mobile.media.NativeTransport
import com.listen2mobile.media.toWritableMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Semantic-only React Native boundary. Every rejected value returns a stable code, never provider text. */
@ReactModule(name = BilibiliModule.NAME)
internal class BilibiliModule(
    context: ReactApplicationContext,
    private val gateway: BilibiliGateway,
    private val session: BilibiliSession,
    private val mvController: BilibiliMvController,
    private val mvViewManager: BilibiliMvViewManager,
    private val mediaLeases: MediaLeaseRegistry,
) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    companion object {
        const val NAME = "Listen2Bilibili"
        const val VERSION = 1
        const val MEDIA_AUTHORITY = "com.dazzlingwuming.listen2.media"
        val APPROVED_HOSTS = listOf("bilivideo.com")
    }
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var invalidated = false
    private val accountAuthority = BilibiliAccountGenerationGate()
    private val authenticationLock = Any()
    private var authenticated = false

    init { context.addLifecycleEventListener(this) }
    override fun getName() = NAME
    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "provider" to "bilibili",
        "version" to VERSION,
        "policyReady" to true,
        "mediaAuthority" to MEDIA_AUTHORITY,
        "approvedHosts" to APPROVED_HOSTS,
    )

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
        revokeAccountAuthority()
        complete(promise) { state(session.logout()) }
    }
    @ReactMethod fun search(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("query", "page"))
        searchResult(gateway.search(requireText(request, "query", BilibiliPolicy.MAX_TEXT), requireSearchPage(request, "page")))
    }
    @ReactMethod fun videoDetail(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("bvid")); detail(gateway.videoDetail(requireBvid(request, "bvid")))
    }
    @ReactMethod fun resolveAudio(request: ReadableMap, promise: Promise) {
        // Capture before this request enters the worker. A logout/account switch
        // invalidates this exact generation while provider I/O is in flight.
        val requestGeneration = accountAuthority.snapshot()
        complete(promise, requestGeneration) {
        // Fixed lifecycle markers distinguish bridge/descriptor failures from
        // provider failures without recording transport or account data.
        BilibiliDiagnostics.info("audio-resolve-request")
        var stage = "request"
        try {
            requireKeys(request, setOf("version", "requestId", "bvid", "cid"))
            require(request.getType("version") == ReadableType.Number && request.getDouble("version") == VERSION.toDouble())
            synchronizeAccountAuthority(session.snapshot())
            val requestId = requireText(request, "requestId", 96)
            val bvid = requireBvid(request, "bvid")
            val cid = requirePositive(request, "cid")
            stage = "detail"
            val detail = gateway.videoDetail(bvid)
            val part = detail.parts.singleOrNull { it.cid == cid }
                ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
            stage = "handoff"
            val handoff = gateway.resolveAudio(BilibiliPolicy.SemanticTrack(bvid, cid, part.page))
            stage = "handoff-policy"
            if (!BilibiliPolicy.isSafeAudioHandoff(handoff.url, mapOf("Referer" to BilibiliPolicy.FIXED_REFERER), handoff.deadline, System.currentTimeMillis())) throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            stage = "lease"
            val reply = accountAuthority.withCurrent(requestGeneration) { generation ->
                val descriptor = mediaLeases.register(
                    requestId,
                    MediaIdentity("bilibili", "bitrack_v_${handoff.bvid}-${handoff.cid}", handoff.cid.toString(), generation),
                    MediaRendition("audio", "authorized", "audio/mp4", "mp4", "mp4a.40.2", part.durationMs ?: 1L, null),
                    NativeTransport(handoff.url, mapOf("Referer" to BilibiliPolicy.FIXED_REFERER)),
                    generation,
                )
                stage = "descriptor"
                descriptor.toWritableMap(
                    detail.parts.map {
                        BridgeMediaPart(it.cid.toString(), it.page.toString(), it.title, it.durationMs)
                    },
                )
            } ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.CANCELLED)
            BilibiliDiagnostics.info("audio-resolved-descriptor")
            reply
        } catch (failure: BilibiliHttpsGateway.ProviderException) {
            BilibiliDiagnostics.info("audio-failed-stage=$stage-code=" + failure.code.name)
            throw failure
        }
        }
    }

    @ReactMethod fun cancelAudio(request: ReadableMap, promise: Promise) {
        try {
            requireKeys(request, setOf("version", "requestId"))
            require(request.getType("version") == ReadableType.Number && request.getDouble("version") == VERSION.toDouble())
            mediaLeases.cancel(requireText(request, "requestId", 96))
            promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
        } catch (_: Exception) {
            promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST))
        }
    }

    @ReactMethod fun mvOpen(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("bvid", "cid", "qualityId", "preferredCodecs", "forceRefresh"))
        (reactApplicationContext.currentActivity as? MainActivity)?.apply { bindMvController(mvController); discardPendingMvSnapshot() }
        mvViewManager.releaseHandle(mvController.currentHandle())
        mvState(mvController.open(requireMvRequest(request, accountAuthority.snapshot())))
    }
    @ReactMethod fun mvRestore(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("bvid", "cid"))
        val bvid = requireBvid(request, "bvid")
        val cid = requirePositive(request, "cid")
        val activity = reactApplicationContext.currentActivity as? MainActivity ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)
        activity.bindMvController(mvController)
        val snapshot = activity.takePendingMvSnapshot(bvid, cid) ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)
        mvState(mvController.restoreSemantic(snapshot))
    }
    /** One-shot semantic restore handoff for the JS root navigator. */
    @ReactMethod fun mvConsumePendingRestore(promise: Promise) = complete(promise) {
        val activity = reactApplicationContext.currentActivity as? MainActivity
            ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.NOT_READY)
        activity.bindMvController(mvController)
        val snapshot = activity.consumePendingMvSnapshot()
            ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.NOT_READY)
        Arguments.createMap().apply {
            putString("bvid", snapshot.bvid)
            putString("cid", snapshot.cid.toString())
            putString("qualityId", snapshot.qualityId)
            putDouble("positionMs", snapshot.positionMs.toDouble())
            putBoolean("playIntent", snapshot.playIntent)
        }
    }
    @ReactMethod fun mvSelectQuality(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle", "qualityId"))
        mvState(mvController.selectQuality(requireHandle(request), requireQuality(request, "qualityId")))
    }
    @ReactMethod fun mvSync(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle", "bvid", "cid", "positionMs", "playIntent"))
        val position = requirePositiveOrZero(request, "positionMs")
        if (!request.hasKey("playIntent") || request.getType("playIntent") != ReadableType.Boolean) throw IllegalArgumentException()
        val handle = requireHandle(request)
        val result = mvController.sync(handle, requireBvid(request, "bvid"), requirePositive(request, "cid"), position, request.getBoolean("playIntent"))
        if (result.errorCode == null) mvViewManager.sync(handle, position, result.playIntent)
        mvState(result)
    }
    @ReactMethod fun mvRefresh(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle")); mvState(mvController.refresh(requireHandle(request)))
    }
    @ReactMethod fun mvClose(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("handle")); val handle = requireHandle(request); val state = mvController.close(handle); mvViewManager.releaseHandle(handle); mvState(state)
    }
    @ReactMethod fun mvEnterFullscreen(request: ReadableMap, promise: Promise) = completeMvUi(promise, request) { activity, handle -> activity.enterMvFullscreen(handle) }
    @ReactMethod fun mvExitFullscreen(request: ReadableMap, promise: Promise) = completeMvUi(promise, request) { activity, handle -> activity.exitMvFullscreen(handle) }
    @ReactMethod fun mvRequestPip(request: ReadableMap, promise: Promise) = completeMvUi(promise, request, true) { activity, handle -> activity.enterMvPip(handle) }

    private fun complete(promise: Promise, requestGeneration: Long? = null, operation: () -> WritableMap) {
        try {
            if (invalidated) return promise.resolve(error(BilibiliPolicy.ErrorCode.CANCELLED))
            worker.execute {
                try {
                    val result = operation()
                    resolveReply(promise, if (invalidated) error(BilibiliPolicy.ErrorCode.CANCELLED) else result, requestGeneration)
                }
                catch (failure: BilibiliHttpsGateway.ProviderException) {
                    // Stable code only: never log provider text, signed URLs, headers, or cookies.
                    BilibiliDiagnostics.info("operation-failed=" + failure.code.name)
                    resolveReply(promise, error(if (invalidated) BilibiliPolicy.ErrorCode.CANCELLED else failure.code), requestGeneration)
                }
                catch (_: IllegalArgumentException) {
                    BilibiliDiagnostics.info("operation-failed=INVALID_REQUEST")
                    resolveReply(promise, error(if (invalidated) BilibiliPolicy.ErrorCode.CANCELLED else BilibiliPolicy.ErrorCode.INVALID_REQUEST), requestGeneration)
                }
                catch (_: Exception) {
                    BilibiliDiagnostics.info("operation-failed=PROVIDER_ERROR")
                    resolveReply(promise, error(if (invalidated) BilibiliPolicy.ErrorCode.CANCELLED else BilibiliPolicy.ErrorCode.PROVIDER_ERROR), requestGeneration)
                }
            }
        } catch (_: RejectedExecutionException) {
            promise.resolve(error(BilibiliPolicy.ErrorCode.CANCELLED))
        }
    }
    /** A stale request resolves as cancellation and never publishes its lease descriptor. */
    private fun resolveReply(promise: Promise, reply: WritableMap, requestGeneration: Long?) {
        if (requestGeneration == null) {
            promise.resolve(reply)
        } else if (!accountAuthority.runIfCurrent(requestGeneration) { promise.resolve(reply) }) {
            promise.resolve(error(BilibiliPolicy.ErrorCode.CANCELLED))
        }
    }
    private fun completeMvUi(promise: Promise, request: ReadableMap, requireSurface: Boolean = false, operation: (MainActivity, String) -> Boolean) {
        try {
            requireKeys(request, setOf("handle"))
            val handle = requireHandle(request)
            val activity = reactApplicationContext.currentActivity as? MainActivity
                ?: return promise.resolve(error(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE))
            activity.bindMvController(mvController)
            activity.setMvPipListener { activeHandle, active ->
                reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("bilibiliMvPip", Arguments.createMap().apply { putString("handle", activeHandle); putBoolean("active", active) })
            }
            if (!mvController.isActiveHandle(handle)) return promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST))
            activity.runOnUiThread {
                try {
                    if (!mvController.isActiveHandle(handle)) promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST))
                    else if (requireSurface && !mvViewManager.isSurfaceReady(handle)) promise.resolve(error(BilibiliPolicy.ErrorCode.NOT_READY))
                    else promise.resolve(Arguments.createMap().apply { putBoolean("ok", operation(activity, handle)) })
                } catch (_: Exception) { promise.resolve(error(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)) }
            }
        } catch (_: Exception) { promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST)) }
    }

    override fun onHostPause() {
        val inPip = (reactApplicationContext.currentActivity as? MainActivity)?.isInPictureInPictureMode == true
        if (!inPip) mvViewManager.pauseForBackground()
    }

    override fun onHostResume() {
        mvViewManager.resumeAfterHost()
    }

    override fun onHostDestroy() {
        mvController.cancel()
        mvViewManager.releaseAll()
    }

    override fun invalidate() {
        invalidated = true
        reactApplicationContext.removeLifecycleEventListener(this)
        session.cancelActiveRequest()
        mvController.cancel()
        mvViewManager.releaseAll()
        worker.shutdownNow()
        super.invalidate()
    }

    private fun state(value: BilibiliSession.PublicState): WritableMap = Arguments.createMap().apply {
        synchronizeAccountAuthority(value)
        putString("status", value.status.name.lowercase()); putString("attemptId", value.attemptId); putDouble("expiresAt", value.expiresAt.toDouble())
        putString("qrPngDataUri", value.qrPngDataUri); value.displayName?.let { putString("displayName", it) }; value.avatarUrl?.let { putString("avatarUrl", it) }
        putBoolean("retryable", value.retryable); putString("nextAction", value.nextAction); value.errorCode?.let { putString("errorCode", it.name) }
    }
    private fun detail(value: BilibiliGateway.VideoDetail): WritableMap = Arguments.createMap().apply {
        putString("bvid", value.bvid); putString("title", value.title); value.owner?.let { putString("owner", it) }
        putArray("parts", Arguments.createArray().apply { value.parts.forEach { part -> pushMap(Arguments.createMap().apply { putString("cid", part.cid.toString()); putString("page", part.page.toString()); putString("title", part.title); part.durationMs?.let { putDouble("durationMs", it.toDouble()) } }) } })
    }
    private fun searchResult(value: BilibiliGateway.SearchPage): WritableMap = Arguments.createMap().apply {
        putString("query", value.query)
        putInt("page", value.page.toInt())
        value.total?.let { putDouble("total", it.toDouble()) }
        putArray("results", Arguments.createArray().apply {
            value.results.forEach { result ->
                pushMap(Arguments.createMap().apply {
                    putString("bvid", result.bvid)
                    putString("title", result.title)
                    putString("artist", result.artist)
                    result.durationMs?.let { putDouble("durationMs", it.toDouble()) }
                    result.artworkUrl?.let { putString("artworkUrl", it) }
                })
            }
        })
    }
    private fun mvState(value: BilibiliMvController.PublicState): WritableMap = Arguments.createMap().apply {
        putString("state", value.state.name.lowercase())
        if (value.handle.isNotBlank()) putString("handle", value.handle)
        if (value.bvid.isNotBlank()) putString("bvid", value.bvid)
        if (value.cid.isNotBlank()) putString("cid", value.cid)
        putString("qualityId", value.qualityId); putDouble("positionMs", value.positionMs.toDouble()); putBoolean("playIntent", value.playIntent)
        putBoolean("refreshing", value.refreshing)
        putArray(
            "variants",
            Arguments.createArray().apply {
                value.variants.forEach { variant ->
                    pushMap(
                        Arguments.createMap().apply {
                            putString("id", variant.id)
                            putString("label", variant.label)
                            putString("codec", variant.codec)
                            putInt("width", variant.width)
                            putInt("height", variant.height)
                        },
                    )
                }
            },
        )
        value.errorCode?.let { putString("errorCode", it.name) }
    }
    private fun error(code: BilibiliPolicy.ErrorCode): WritableMap = Arguments.createMap().apply { putString("errorCode", code.name) }
    private fun requireKeys(map: ReadableMap, allowed: Set<String>) { val keys = map.keySetIterator(); while (keys.hasNextKey()) if (keys.nextKey() !in allowed) throw IllegalArgumentException() }
    private fun requireText(map: ReadableMap, key: String, limit: Int): String { if (!map.hasKey(key) || map.getType(key) != ReadableType.String) throw IllegalArgumentException(); return BilibiliPolicy.safeText(map.getString(key), limit) ?: throw IllegalArgumentException() }
    private fun requireBvid(map: ReadableMap, key: String): String = requireText(map, key, 40).also { if (!BilibiliPolicy.isCanonicalBvid(it)) throw IllegalArgumentException() }
    private fun requirePositive(map: ReadableMap, key: String): Long { val value = requireText(map, key, 18); if (!BilibiliPolicy.isPositiveText(value)) throw IllegalArgumentException(); return value.toLong() }
    private fun requireSearchPage(map: ReadableMap, key: String): Long {
        if (!map.hasKey(key) || map.getType(key) != ReadableType.Number) throw IllegalArgumentException()
        val value = map.getDouble(key)
        if (!value.isFinite() || value != value.toLong().toDouble()) throw IllegalArgumentException()
        return value.toLong().takeIf(BilibiliPolicy::isSearchPage) ?: throw IllegalArgumentException()
    }
    private fun requirePositiveOrZero(map: ReadableMap, key: String): Long { if (!map.hasKey(key) || map.getType(key) != ReadableType.Number) throw IllegalArgumentException(); return map.getDouble(key).toLong().takeIf { it >= 0L && it <= 24L * 60L * 60L * 1000L } ?: throw IllegalArgumentException() }
    private fun requireHandle(map: ReadableMap): String = requireText(map, "handle", 96).takeIf(BilibiliMvPolicy::isOpaqueHandle) ?: throw IllegalArgumentException()
    private fun requireQuality(map: ReadableMap, key: String): String = requireText(map, key, 8)
    private fun requireMvRequest(map: ReadableMap, generation: Long): BilibiliMvPolicy.MvRequest {
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
        return BilibiliMvPolicy.request(requireBvid(map, "bvid"), requirePositive(map, "cid"), quality, codecs, forceRefresh, generation) ?: throw IllegalArgumentException()
    }

    private fun synchronizeAccountAuthority(value: BilibiliSession.PublicState) {
        val nextAuthenticated = value.status == BilibiliSession.PublicStatus.AUTHENTICATED
        val changed = synchronized(authenticationLock) {
            if (nextAuthenticated == authenticated) false else {
                authenticated = nextAuthenticated
                true
            }
        }
        if (changed) revokeAccountAuthority()
    }
    private fun revokeAccountAuthority() {
        accountAuthority.revoke { generation ->
            mediaLeases.invalidateSource("bilibili", generation)
            mvController.setAccountGeneration(generation)
        }
    }
}

/** Serializes account transitions with native lease issuance; values contain no identity or secrets. */
internal class BilibiliAccountGenerationGate {
    private val lock = Any()
    private var generation = 0L

    fun snapshot(): Long = synchronized(lock) { generation }

    fun revoke(onRevoked: (Long) -> Unit): Long = synchronized(lock) {
        generation += 1L
        onRevoked(generation)
        generation
    }

    fun <T> withCurrent(expected: Long, action: (Long) -> T): T? = synchronized(lock) {
        if (expected != generation) null else action(generation)
    }

    fun runIfCurrent(expected: Long, action: (Long) -> Unit): Boolean = synchronized(lock) {
        if (expected != generation) false else {
            action(generation)
            true
        }
    }
}
