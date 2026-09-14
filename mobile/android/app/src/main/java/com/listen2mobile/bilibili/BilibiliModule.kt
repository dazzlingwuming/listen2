package com.listen2mobile.bilibili

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReactModuleWithSpec
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors

/** Semantic-only React Native boundary. Every rejected value returns a stable code, never provider text. */
@ReactModule(name = BilibiliModule.NAME)
class BilibiliModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object { const val NAME = "Listen2Bilibili" }
    private val worker = Executors.newSingleThreadExecutor()
    private val gateway = BilibiliHttpsGateway()
    private val session = BilibiliSession(gateway, BilibiliVault(context), BilibiliQrRenderer())
    override fun getName() = NAME

    @ReactMethod fun status(promise: Promise) = complete(promise) { state(session.snapshot()) }
    @ReactMethod fun qrBegin(promise: Promise) = complete(promise) { state(session.begin(System.currentTimeMillis())) }
    @ReactMethod fun qrPoll(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("attemptId"))
        state(session.poll(requireText(request, "attemptId", 64), System.currentTimeMillis()))
    }
    @ReactMethod fun qrCancel(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("attemptId"))
        state(session.cancel(requireText(request, "attemptId", 64)))
    }
    @ReactMethod fun logout(promise: Promise) = complete(promise) { state(session.logout()) }
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

    private fun complete(promise: Promise, operation: () -> WritableMap) {
        worker.execute {
            try { promise.resolve(operation()) }
            catch (error: BilibiliHttpsGateway.ProviderException) { promise.resolve(error(error.code)) }
            catch (_: IllegalArgumentException) { promise.resolve(error(BilibiliPolicy.ErrorCode.INVALID_REQUEST)) }
            catch (_: Exception) { promise.resolve(error(BilibiliPolicy.ErrorCode.PROVIDER_ERROR)) }
        }
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
    private fun error(code: BilibiliPolicy.ErrorCode): WritableMap = Arguments.createMap().apply { putString("errorCode", code.name) }
    private fun requireKeys(map: ReadableMap, allowed: Set<String>) { val keys = map.keySetIterator(); while (keys.hasNextKey()) if (keys.nextKey() !in allowed) throw IllegalArgumentException() }
    private fun requireText(map: ReadableMap, key: String, limit: Int): String { if (!map.hasKey(key) || map.getType(key) != ReadableType.String) throw IllegalArgumentException(); return BilibiliPolicy.safeText(map.getString(key), limit) ?: throw IllegalArgumentException() }
    private fun requireBvid(map: ReadableMap, key: String): String = requireText(map, key, 40).also { if (!BilibiliPolicy.isCanonicalBvid(it)) throw IllegalArgumentException() }
    private fun requirePositive(map: ReadableMap, key: String): Long { val value = requireText(map, key, 18); if (!BilibiliPolicy.isPositiveText(value)) throw IllegalArgumentException(); return value.toLong() }
}
