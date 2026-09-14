package com.listen2mobile.deepseek

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors

/** Allow-listed semantic module: status, configure, test, delete, translate and cancel only. */
@ReactModule(name = DeepSeekModule.NAME)
class DeepSeekModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object { const val NAME = "Listen2DeepSeek" }
    private val worker = Executors.newSingleThreadExecutor()
    private val vault = DeepSeekVault(context)
    private val client = DeepSeekClient(vault, DeepSeekTranslationCache(context))
    private var configurePromise: Promise? = null
    private val activityListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != CONFIGURE_REQUEST) return
            configurePromise?.resolve(Arguments.createMap().apply {
                putString("status", if (resultCode == Activity.RESULT_OK) "configured" else "cancelled")
                val current = vault.status()
                putBoolean("secureStorageAvailable", current.secureStorageAvailable)
                putBoolean("hasApiKey", current.hasApiKey)
                current.errorCode?.let { putString("errorCode", it) }
            })
            configurePromise = null
        }
    }
    init { context.addActivityEventListener(activityListener) }
    override fun getName() = NAME
    @ReactMethod fun status(promise: Promise) = promise.resolve(statusMap(vault.status()))
    @ReactMethod fun configure(promise: Promise) {
        val activity = currentActivity
        if (activity == null || configurePromise != null) {
            promise.resolve(error("CONFIGURE_UNAVAILABLE"))
            return
        }
        configurePromise = promise
        try { activity.startActivityForResult(Intent(activity, DeepSeekKeyActivity::class.java), CONFIGURE_REQUEST) }
        catch (_: Exception) { configurePromise = null; promise.resolve(error("CONFIGURE_UNAVAILABLE")) }
    }
    @ReactMethod fun test(promise: Promise) = complete(promise) { result(client.test()) }
    @ReactMethod fun delete(promise: Promise) = promise.resolve(statusMap(vault.clear()))
    @ReactMethod fun cancel(request: ReadableMap, promise: Promise) { try { requireKeys(request, setOf("operationId")); promise.resolve(result(client.cancel(text(request, "operationId", 64)))) } catch (_: Exception) { promise.resolve(error("INVALID_REQUEST")) } }
    @ReactMethod fun translate(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(request, setOf("operationId", "provider", "sourceTrackId", "lyric", "title", "artist", "style", "lyricHash", "trackHash", "target", "consent", "allowNetwork", "forceRefresh", "matchedProvider", "matchedCandidateId"))
        require(text(request, "target", 8) == DeepSeekPolicy.TARGET_LANGUAGE)
        val consent = map(request, "consent")
        val receipt = DeepSeekPolicy.Consent(bool(consent, "lyrics"), bool(consent, "title"), bool(consent, "artist"), bool(consent, "possibleCost"), bool(consent, "cancellation"), bool(consent, "failureImpact"), number(consent, "acceptedAtEpochMs"))
        val input = DeepSeekPolicy.Input(lyricText(request, "lyric"), text(request, "title", DeepSeekPolicy.MAX_METADATA_CHARS), text(request, "artist", DeepSeekPolicy.MAX_METADATA_CHARS), text(request, "style", DeepSeekPolicy.MAX_STYLE_CHARS), receipt)
        result(client.translate(text(request, "operationId", 64), input, text(request, "provider", 16), text(request, "sourceTrackId", 128), text(request, "lyricHash", 64), text(request, "trackHash", 64), bool(request, "allowNetwork"), bool(request, "forceRefresh"), optionalText(request, "matchedProvider", 16), optionalText(request, "matchedCandidateId", 128)).also { require(it.trackHash == null || it.trackHash == text(request, "trackHash", 64)) })
    }
    private fun complete(promise: Promise, action: () -> WritableMap) = worker.execute { try { promise.resolve(action()) } catch (_: Exception) { promise.resolve(error("INVALID_REQUEST")) } }
    private fun statusMap(value: DeepSeekVault.Status) = Arguments.createMap().apply { putBoolean("secureStorageAvailable", value.secureStorageAvailable); putBoolean("hasApiKey", value.hasApiKey); value.errorCode?.let { putString("errorCode", it) } }
    private fun result(value: DeepSeekClient.Result) = Arguments.createMap().apply { putString("operation", value.operation); putString("status", value.status); value.errorCode?.let { putString("errorCode", it) }; value.translation?.let { putString("translation", it) }; value.trackHash?.let { putString("trackHash", it) }; value.lyricHash?.let { putString("lyricHash", it) }; putBoolean("cacheHit", value.cacheHit) }
    private fun error(code: String) = Arguments.createMap().apply { putString("errorCode", code) }
    private fun requireKeys(value: ReadableMap, allowed: Set<String>) { val keys = value.keySetIterator(); while (keys.hasNextKey()) require(keys.nextKey() in allowed) }
    private fun map(value: ReadableMap, key: String): ReadableMap { require(value.hasKey(key) && value.getType(key) == ReadableType.Map); return value.getMap(key)!! }
    private fun text(value: ReadableMap, key: String, max: Int): String { require(value.hasKey(key) && value.getType(key) == ReadableType.String); return value.getString(key)?.takeIf { it.length <= max && it.none { char -> char.code < 32 } } ?: throw IllegalArgumentException() }
    private fun optionalText(value: ReadableMap, key: String, max: Int): String? { if (!value.hasKey(key) || value.isNull(key)) return null; return text(value, key, max) }
    /** Timed LRC is multi-line input; only CR/LF are admitted here and policy validates each line. */
    private fun lyricText(value: ReadableMap, key: String): String { require(value.hasKey(key) && value.getType(key) == ReadableType.String); return value.getString(key)?.takeIf { it.toByteArray(Charsets.UTF_8).size <= DeepSeekPolicy.MAX_LYRIC_BYTES && it.none { char -> char.code < 32 && char != '\n' && char != '\r' } } ?: throw IllegalArgumentException() }
    private fun bool(value: ReadableMap, key: String): Boolean { require(value.hasKey(key) && value.getType(key) == ReadableType.Boolean); return value.getBoolean(key) }
    private fun number(value: ReadableMap, key: String): Long { require(value.hasKey(key) && value.getType(key) == ReadableType.Number); return value.getDouble(key).toLong().takeIf { it > 0 } ?: throw IllegalArgumentException() }

    private companion object { const val CONFIGURE_REQUEST = 39142 }
}
