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
    companion object {
        const val NAME = "Listen2DeepSeek"
        private const val CONFIGURE_REQUEST = 39142
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val vault = DeepSeekVault(context)
    private val cache = DeepSeekTranslationCache(context)
    private val client = DeepSeekClient(vault, cache)
    private var configurePromise: Promise? = null
    private val activityListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != CONFIGURE_REQUEST) return
            val promise = configurePromise ?: return
            configurePromise = null
            val state = vault.status()
            promise.resolve(Arguments.createMap().apply {
                putString("status", if (resultCode == Activity.RESULT_OK && state.state == DeepSeekVault.State.Configured && state.errorCode == null) "configured" else "cancelled")
                putString("state", state.state.wire)
                state.errorCode?.let { putString("errorCode", it) }
            })
        }
    }

    init {
        context.addActivityEventListener(activityListener)
    }

    override fun getName() = NAME

    @ReactMethod
    fun status(promise: Promise) = complete(promise) { statusMap(vault.status()) }

    @ReactMethod
    fun configure(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null || configurePromise != null) {
            val state = vault.status()
            promise.resolve(Arguments.createMap().apply {
                putString("status", "cancelled")
                putString("state", state.state.wire)
                putString("errorCode", "CONFIGURE_UNAVAILABLE")
            })
            return
        }
        configurePromise = promise
        try {
            activity.startActivityForResult(
                Intent(activity, DeepSeekKeyActivity::class.java),
                CONFIGURE_REQUEST,
            )
        } catch (_: Exception) {
            configurePromise = null
            val state = vault.status()
            promise.resolve(Arguments.createMap().apply {
                putString("status", "cancelled")
                putString("state", state.state.wire)
                putString("errorCode", "CONFIGURE_UNAVAILABLE")
            })
        }
    }

    @ReactMethod
    fun test(promise: Promise) = complete(promise) { resultMap(client.test()) }

    @ReactMethod
    fun delete(promise: Promise) = complete(promise) {
        client.cancelAll()
        cache.clear()
        statusMap(vault.clear())
    }

    @ReactMethod
    fun cancel(request: ReadableMap, promise: Promise) {
        try {
            requireKeys(request, setOf("operationId"))
            promise.resolve(resultMap(client.cancel(text(request, "operationId", 64))))
        } catch (_: Exception) {
            promise.resolve(error("INVALID_REQUEST"))
        }
    }

    @ReactMethod
    fun translate(request: ReadableMap, promise: Promise) = complete(promise) {
        requireKeys(
            request,
            setOf(
                "operationId",
                "provider",
                "sourceTrackId",
                "lyric",
                "title",
                "artist",
                "style",
                "lyricHash",
                "trackHash",
                "revision",
                "target",
                "consent",
                "allowNetwork",
                "forceRefresh",
                "matchedProvider",
                "matchedCandidateId",
            ),
        )
        require(text(request, "target", 8) == DeepSeekPolicy.TARGET_LANGUAGE)
        val consentMap = map(request, "consent")
        requireKeys(
            consentMap,
            setOf("lyrics", "title", "artist", "possibleCost", "cancellation", "failureImpact", "acceptedAtEpochMs"),
        )
        val receipt = DeepSeekPolicy.Consent(
            bool(consentMap, "lyrics"),
            bool(consentMap, "title"),
            bool(consentMap, "artist"),
            bool(consentMap, "possibleCost"),
            bool(consentMap, "cancellation"),
            bool(consentMap, "failureImpact"),
            number(consentMap, "acceptedAtEpochMs", 1),
        )
        val input = DeepSeekPolicy.Input(
            lyricText(request, "lyric"),
            text(request, "title", DeepSeekPolicy.MAX_METADATA_CHARS),
            text(request, "artist", DeepSeekPolicy.MAX_METADATA_CHARS),
            text(request, "style", DeepSeekPolicy.MAX_STYLE_CHARS, allowEmpty = true),
            number(request, "revision", 0),
            receipt,
        )
        val value = client.translate(
            text(request, "operationId", 64),
            input,
            text(request, "provider", 16),
            text(request, "sourceTrackId", 128),
            text(request, "lyricHash", 64),
            text(request, "trackHash", 64),
            bool(request, "allowNetwork"),
            bool(request, "forceRefresh"),
            optionalText(request, "matchedProvider", 16),
            optionalText(request, "matchedCandidateId", 128),
        )
        resultMap(value)
    }

    private fun complete(promise: Promise, action: () -> WritableMap) = worker.execute {
        try {
            promise.resolve(action())
        } catch (_: Exception) {
            promise.resolve(error("INVALID_REQUEST"))
        }
    }

    private fun statusMap(value: DeepSeekVault.Status) = Arguments.createMap().apply {
        putString("state", value.state.wire)
        value.errorCode?.let { putString("errorCode", it) }
    }

    private fun resultMap(value: DeepSeekClient.Result) = Arguments.createMap().apply {
        putString("operation", value.operation)
        putString("status", value.status)
        value.errorCode?.let { putString("errorCode", it) }
        value.revision?.let { putDouble("revision", it.toDouble()) }
        value.lines?.let { lines ->
            putArray("translationLines", Arguments.createArray().apply {
                lines.forEach { line ->
                    pushMap(Arguments.createMap().apply {
                        putString("id", line.id)
                        putString("timestamp", line.timestamps)
                        putString("text", line.text)
                    })
                }
            })
        }
        value.trackHash?.let { putString("trackHash", it) }
        value.lyricHash?.let { putString("lyricHash", it) }
        putBoolean("cacheHit", value.cacheHit)
    }

    private fun error(code: String) = Arguments.createMap().apply { putString("errorCode", code) }

    private fun requireKeys(value: ReadableMap, allowed: Set<String>) {
        val keys = value.keySetIterator()
        while (keys.hasNextKey()) require(keys.nextKey() in allowed)
    }

    private fun map(value: ReadableMap, key: String): ReadableMap {
        require(value.hasKey(key) && value.getType(key) == ReadableType.Map)
        return value.getMap(key)!!
    }

    private fun text(value: ReadableMap, key: String, max: Int, allowEmpty: Boolean = false): String {
        require(value.hasKey(key) && value.getType(key) == ReadableType.String)
        return value.getString(key)?.takeIf {
            (allowEmpty || it.isNotEmpty()) && it.length <= max && it.none { char -> char.code < 32 }
        } ?: throw IllegalArgumentException()
    }

    private fun optionalText(value: ReadableMap, key: String, max: Int): String? {
        if (!value.hasKey(key) || value.isNull(key)) return null
        return text(value, key, max)
    }

    /** Timed LRC is multi-line input; only CR/LF are admitted here. */
    private fun lyricText(value: ReadableMap, key: String): String {
        require(value.hasKey(key) && value.getType(key) == ReadableType.String)
        return value.getString(key)?.takeIf {
            it.isNotEmpty() &&
                it.toByteArray(Charsets.UTF_8).size <= DeepSeekPolicy.MAX_LYRIC_BYTES &&
                it.none { char -> char.code < 32 && char != '\n' && char != '\r' }
        } ?: throw IllegalArgumentException()
    }

    private fun bool(value: ReadableMap, key: String): Boolean {
        require(value.hasKey(key) && value.getType(key) == ReadableType.Boolean)
        return value.getBoolean(key)
    }

    private fun number(value: ReadableMap, key: String, minimum: Long): Long {
        require(value.hasKey(key) && value.getType(key) == ReadableType.Number)
        val numeric = value.getDouble(key)
        require(numeric.isFinite() && numeric == numeric.toLong().toDouble())
        return numeric.toLong().takeIf { it in minimum..DeepSeekPolicy.MAX_REVISION }
            ?: throw IllegalArgumentException()
    }
}
