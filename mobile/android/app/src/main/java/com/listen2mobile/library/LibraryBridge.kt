package com.listen2mobile.library

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.runBlocking

internal object LibraryBridgeContract {
    private const val SCHEMA_VERSION = 1
    private val privateKey = Regex("(?:uri|path|file|content|cookie|token|secret|password|header|sql|grant|bookmark|url|exception|log)", RegexOption.IGNORE_CASE)

    fun parseMutation(value: Map<String, Any?>): LibraryValidation {
        if (value.keys != setOf("schemaVersion", "requestId", "expectedRevision", "operation", "payload") || hasPrivateTree(value)) return LibraryValidation.Rejected("INVALID_REQUEST")
        val schema = value["schemaVersion"] as? Number ?: return LibraryValidation.Rejected("UNSUPPORTED_SCHEMA")
        val requestId = value["requestId"] as? String ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        val revision = (value["expectedRevision"] as? Number)?.toLong() ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        val operation = value["operation"] as? String ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        val rawPayload = value["payload"] as? Map<*, *> ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        if (rawPayload.any { it.key !is String || it.value !is String }) return LibraryValidation.Rejected("INVALID_REQUEST")
        val payload = rawPayload.entries.associate { (key, item) -> key as String to item as String }
        if (schema.toInt() != SCHEMA_VERSION || schema.toDouble() != SCHEMA_VERSION.toDouble()) return LibraryValidation.Rejected("UNSUPPORTED_SCHEMA")
        if (payload.size > 4 || payload.any { it.key.length > 64 || it.value.length > LibraryLimits.MAX_TITLE }) return LibraryValidation.Rejected("INVALID_REQUEST")
        return LibraryMutationValidator.validate(requestId, revision, operation, payload)
    }

    /** Defensive recursion rejects a future caller that tries to smuggle a private native handle. */
    private fun hasPrivateTree(value: Any?, depth: Int = 0): Boolean {
        if (depth > 4) return true
        return when (value) {
            is Map<*, *> -> value.any { (key, child) -> key !is String || privateKey.containsMatchIn(key) || hasPrivateTree(child, depth + 1) }
            is Collection<*> -> value.size > 32 || value.any { hasPrivateTree(it, depth + 1) }
            is String -> value.length > LibraryLimits.MAX_TITLE
            else -> false
        }
    }
}

@ReactModule(name = LibraryBridge.NAME)
class LibraryBridge internal constructor(
    private val app: ReactApplicationContext,
    private val repository: LibraryRepository,
    private val preferences: LibraryPreferences,
    private val migration: LegacyLibraryMigration,
) : ReactContextBaseJavaModule(app) {
    companion object { const val NAME = "Listen2Library" }
    private val executor = Executors.newSingleThreadExecutor()
    private val invalidated = AtomicBoolean(false)

    override fun getName() = NAME

    @ReactMethod
    fun getSnapshot(schemaVersion: Double, promise: Promise) = execute(promise) {
        if (schemaVersion != 1.0) error("UNSUPPORTED_SCHEMA") else snapshot(repository.snapshot())
    }

    @ReactMethod
    fun applyMutation(request: ReadableMap, promise: Promise) = execute(promise) {
        when (val parsed = LibraryBridgeContract.parseMutation(readMap(request))) {
            is LibraryValidation.Accepted -> receipt(repository.apply(parsed.mutation))
            is LibraryValidation.Rejected -> error(parsed.errorCode)
        }
    }

    /** Public status exposes no legacy payload, storage handle, checksum source, or native exception. */
    @ReactMethod
    fun getMigrationStatus(promise: Promise) = execute(promise) {
        val status = runBlocking { preferences.status() }
        Arguments.createMap().apply {
            putString("backend", status.backend)
            putString("phase", status.phase)
            putBoolean("sourceRetained", status.sourceRetained)
            putBoolean("laterStartValidated", status.laterStartValidated)
        }
    }

    /** This remains native-owned; callers cannot provide a legacy payload or storage endpoint. */
    internal fun validateMigrationOnStartup() = executor.execute {
        runCatching { runBlocking { migration.validateLaterStartup() } }
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit

    override fun invalidate() {
        invalidated.set(true)
        executor.shutdownNow()
        super.invalidate()
    }

    private fun execute(promise: Promise, operation: () -> WritableMap) {
        executor.execute {
            val response = if (invalidated.get()) error("CANCELLED") else runCatching(operation).getOrElse { error("NATIVE_FAILURE") }
            if (!invalidated.get()) promise.resolve(response)
        }
    }

    private fun readMap(value: ReadableMap): Map<String, Any?> {
        val result = LinkedHashMap<String, Any?>()
        val iterator = value.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            result[key] = when (value.getType(key)) {
                ReadableType.String -> value.getString(key)
                ReadableType.Number -> value.getDouble(key)
                ReadableType.Boolean -> value.getBoolean(key)
                ReadableType.Map -> readMap(requireNotNull(value.getMap(key)))
                else -> null
            }
        }
        return result
    }

    private fun snapshot(value: LibrarySnapshot) = Arguments.createMap().apply {
        putDouble("schemaVersion", value.schemaVersion.toDouble())
        putDouble("revision", value.revision.toDouble())
        putArray("personalPlaylists", Arguments.fromList(value.personalPlaylists.map { playlist ->
            Arguments.createMap().apply {
                putString("playlistId", playlist.playlistId)
                putString("title", playlist.title)
                putInt("position", playlist.position)
            }
        }))
    }

    private fun receipt(value: LibraryReceipt) = Arguments.createMap().apply {
        putString("requestId", value.requestId)
        putString("status", value.status)
        putDouble("revision", value.revision.toDouble())
        putString("errorCode", value.errorCode)
        value.snapshot?.let { putMap("snapshot", snapshot(it)) }
    }

    private fun error(code: String) = Arguments.createMap().apply {
        putString("status", "rejected")
        putString("errorCode", code)
    }
}
