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
        val revision = (value["expectedRevision"] as? Number)?.let(::exactLong) ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        val operation = value["operation"] as? String ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        val rawPayload = value["payload"] as? Map<*, *> ?: return LibraryValidation.Rejected("INVALID_REQUEST")
        if (rawPayload.any { it.key !is String || it.value !is String }) return LibraryValidation.Rejected("INVALID_REQUEST")
        val payload = rawPayload.entries.associate { (key, item) -> key as String to item as String }
        if (exactInt(schema) != SCHEMA_VERSION) return LibraryValidation.Rejected("UNSUPPORTED_SCHEMA")
        if (payload.size > 5 || payload.any { it.key.length > 64 || it.value.length > LibraryLimits.MAX_TITLE }) return LibraryValidation.Rejected("INVALID_REQUEST")
        return LibraryMutationValidator.validate(requestId, revision, operation, payload)
    }

    fun parseLegacyMigration(value: Map<String, Any?>): Pair<LegacyLibraryInput, Pair<String, String>>? {
        if (value.keys != setOf("schemaVersion", "attemptId", "checksum", "playlists", "favorites", "queueCheckpoint", "lyricMetadata", "localEntries") || hasPrivateTree(value)) return null
        val schemaVersion = (value["schemaVersion"] as? Number)?.let(::exactInt) ?: return null
        val attemptId = value["attemptId"] as? String ?: return null
        val checksum = value["checksum"] as? String ?: return null
        val playlists = value["playlists"] as? List<*> ?: return null
        val favorites = value["favorites"] as? List<*> ?: return null
        val queue = value["queueCheckpoint"] as? List<*> ?: return null
        val lyrics = value["lyricMetadata"] as? List<*> ?: return null
        val localEntries = value["localEntries"] as? List<*> ?: return null
        if (schemaVersion != SCHEMA_VERSION || attemptId.length !in 1..64 || !attemptId.matches(Regex("^[A-Za-z0-9_-]+$")) || !checksum.matches(Regex("^[0-9a-f]{64}$")) || playlists.size > LibraryLimits.MAX_PLAYLISTS || localEntries.size > LibraryLimits.MAX_PLAYLISTS) return null
        val safePlaylists = playlists.map { item ->
            val entry = item as? Map<*, *> ?: return null
            if (entry.keys != setOf("playlistId", "title", "position", "tracks")) return null
            val tracks = (entry["tracks"] as? List<*>)?.map { parseLegacyTrack(it) ?: return null } ?: return null
            LegacyPlaylist(entry["playlistId"] as? String ?: return null, entry["title"] as? String ?: return null, (entry["position"] as? Number)?.let(::exactInt) ?: return null, tracks)
        }
        val safeFavorites = favorites.map { parseLegacyTrack(it) ?: return null }
        val safeQueue = queue.map { item ->
            val entry = item as? Map<*, *> ?: return null
            if (entry.keys != setOf("occurrenceId", "position", "source", "trackId")) return null
            LegacyQueueCheckpoint(entry["occurrenceId"] as? String ?: return null, (entry["position"] as? Number)?.let(::exactInt) ?: return null, entry["source"] as? String ?: return null, entry["trackId"] as? String ?: return null)
        }
        val safeLyrics = lyrics.map { item ->
            val entry = item as? Map<*, *> ?: return null
            if (entry.keys != setOf("source", "trackId", "selectedVariantId", "offsetMillis")) return null
            LegacyLyricMetadata(entry["source"] as? String ?: return null, entry["trackId"] as? String ?: return null, entry["selectedVariantId"] as? String, (entry["offsetMillis"] as? Number)?.let(::exactLong) ?: return null)
        }
        val safeLocalEntries = localEntries.map { item ->
            val entry = item as? Map<*, *> ?: return null
            if (entry.keys != setOf("title", "artist")) return null
            LegacyLocalEntry(entry["title"] as? String ?: return null, entry["artist"] as? String ?: return null)
        }
        return LegacyLibraryInput(schemaVersion, safePlaylists, safeFavorites, safeQueue, safeLyrics, safeLocalEntries) to (attemptId to checksum)
    }

    private fun parseLegacyTrack(raw: Any?): LegacyTrack? {
        val entry = raw as? Map<*, *> ?: return null
        if (entry.keys != setOf("source", "trackId", "title", "artist")) return null
        return LegacyTrack(entry["source"] as? String ?: return null, entry["trackId"] as? String ?: return null, entry["title"] as? String ?: return null, entry["artist"] as? String ?: return null)
    }

    fun parseBackup(value: Map<String, Any?>): BackupInput? {
        if (value.keys != setOf("schemaVersion", "expectedRevision", "mode", "favorites", "playlists") || hasPrivateTree(value)) return null
        if ((value["schemaVersion"] as? Number)?.let(::exactInt) != SCHEMA_VERSION) return null
        val revision = (value["expectedRevision"] as? Number)?.let(::exactLong) ?: return null
        val mode = value["mode"] as? String ?: return null
        val favorites = (value["favorites"] as? List<*>)?.map { parseTrack(it) ?: return null } ?: return null
        val playlists = (value["playlists"] as? List<*>)?.map { raw ->
            val item = raw as? Map<*, *> ?: return null
            if (item.keys != setOf("playlistId", "title", "tracks")) return null
            val id = item["playlistId"] as? String ?: return null
            val title = item["title"] as? String ?: return null
            val tracks = (item["tracks"] as? List<*>)?.map { parseTrack(it) ?: return null } ?: return null
            BackupPlaylistInput(id, title, tracks)
        } ?: return null
        return BackupInput(revision, mode, favorites, playlists)
    }

    fun parseRemoteRefresh(value: Map<String, Any?>): List<SafeRemoteCollection>? {
        if (value.keys != setOf("schemaVersion", "collections") || hasPrivateTree(value) || (value["schemaVersion"] as? Number)?.let(::exactInt) != SCHEMA_VERSION) return null
        return (value["collections"] as? List<*>)?.map { raw ->
            val item = raw as? Map<*, *> ?: return null
            if (item.keys != setOf("collectionId", "source", "title", "syncState")) return null
            SafeRemoteCollection(item["collectionId"] as? String ?: return null, item["source"] as? String ?: return null, item["title"] as? String ?: return null, item["syncState"] as? String ?: return null)
        }
    }

    fun parseContinuity(value: Map<String, Any?>): Pair<List<SafeQueueCheckpoint>, List<SafeLyricMetadata>>? {
        if (value.keys != setOf("schemaVersion", "queueCheckpoint", "lyricMetadata") || hasPrivateTree(value) || (value["schemaVersion"] as? Number)?.let(::exactInt) != SCHEMA_VERSION) return null
        val queue = (value["queueCheckpoint"] as? List<*>)?.map { raw ->
            val item = raw as? Map<*, *> ?: return null
            if (item.keys != setOf("occurrenceId", "position", "source", "trackId")) return null
            SafeQueueCheckpoint(item["occurrenceId"] as? String ?: return null, (item["position"] as? Number)?.let(::exactInt) ?: return null, item["source"] as? String ?: return null, item["trackId"] as? String ?: return null)
        } ?: return null
        val lyrics = (value["lyricMetadata"] as? List<*>)?.map { raw ->
            val item = raw as? Map<*, *> ?: return null
            if (item.keys != setOf("source", "trackId", "selectedVariantId", "offsetMillis")) return null
            SafeLyricMetadata(item["source"] as? String ?: return null, item["trackId"] as? String ?: return null, item["selectedVariantId"] as? String, (item["offsetMillis"] as? Number)?.let(::exactLong) ?: return null)
        } ?: return null
        return queue to lyrics
    }

    private fun parseTrack(raw: Any?): SafeTrack? {
        val item = raw as? Map<*, *> ?: return null
        if (item.keys != setOf("source", "trackId", "title", "artist")) return null
        return SafeTrack(item["source"] as? String ?: return null, item["trackId"] as? String ?: return null, item["title"] as? String ?: return null, item["artist"] as? String ?: return null)
    }

    /** React Native transports JS numbers as doubles, so every durable revision must be exact. */
    private fun exactLong(value: Number): Long? {
        val decimal = value.toDouble()
        return if (decimal.isFinite() && decimal == decimal.toLong().toDouble()) decimal.toLong() else null
    }

    private fun exactInt(value: Number): Int? {
        val decimal = value.toDouble()
        return if (decimal.isFinite() && decimal == decimal.toInt().toDouble()) decimal.toInt() else null
    }

    /** Defensive recursion rejects a future caller that tries to smuggle a private native handle. */
    private fun hasPrivateTree(value: Any?, depth: Int = 0): Boolean {
        // A migrated playlist legitimately nests list → playlist → tracks → track fields.
        // Keep recursion bounded while allowing that fixed semantic DTO shape.
        if (depth > 6) return true
        return when (value) {
            is Map<*, *> -> value.any { (key, child) -> key !is String || privateKey.containsMatchIn(key) || hasPrivateTree(child, depth + 1) }
            // Backup preview is bounded separately (2,000 playlists / 50,000
            // tracks). Do not accidentally impose the old generic bridge's 32
            // item cap before that contract can validate it.
            is Collection<*> -> value.size > 50_000 || value.any { hasPrivateTree(it, depth + 1) }
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
        val raw = readMap(request)
        when (val parsed = LibraryBridgeContract.parseMutation(raw)) {
            is LibraryValidation.Accepted -> receipt(repository.apply(parsed.mutation))
            is LibraryValidation.Rejected -> rejectedMutationReceipt(raw, parsed.errorCode)
        }
    }

    /** Narrow, native-owned backup handoff. It accepts only allow-listed semantic library DTOs. */
    @ReactMethod
    fun previewBackup(request: ReadableMap, promise: Promise) = execute(promise) {
        val parsed = LibraryBridgeContract.parseBackup(readMap(request)) ?: return@execute error("INVALID_BACKUP")
        backupPreview(repository.previewBackup(parsed))
    }

    @ReactMethod
    fun applyBackup(token: String, checksum: String, expectedRevision: Double, promise: Promise) = execute(promise) {
        if (!token.matches(Regex("^[A-Za-z0-9]{16,64}$")) || !checksum.matches(Regex("^[a-f0-9]{64}$")) || !expectedRevision.isFinite() || expectedRevision < 0 || expectedRevision != expectedRevision.toLong().toDouble()) return@execute error("INVALID_BACKUP")
        receipt(repository.applyBackup(token, checksum, expectedRevision.toLong()))
    }

    /** Public status exposes no legacy payload, storage handle, checksum source, or native exception. */
    @ReactMethod
    fun getMigrationStatus(promise: Promise) = execute(promise) {
        // A separate process/startup validates the active Room readback before
        // cleanup ever becomes eligible; this call has no legacy payload access.
        runBlocking { migration.validateLaterStartup() }
        val status = runBlocking { preferences.status() }
        migrationStatus(status)
    }

    /** Explicit migration DTO only; this is not a generic import or storage bridge. */
    @ReactMethod
    fun beginLegacyMigration(request: ReadableMap, promise: Promise) = execute(promise) {
        val parsed = LibraryBridgeContract.parseLegacyMigration(readMap(request))
            ?: return@execute migrationFailure("INVALID_LEGACY_DATA", null, null)
        val (input, correlation) = parsed
        when (val result = runBlocking { migration.migrate(input, correlation.first, correlation.second) }) {
            is MigrationResult.Activated -> migrationStatus(result.status)
            is MigrationResult.Rejected -> migrationFailure(result.errorCode, correlation.first, correlation.second)
        }
    }

    /** A provider refresh submits only a bounded semantic collection projection. Invalid refreshes retain prior rows. */
    @ReactMethod fun replaceRemoteCollections(request: ReadableMap, promise: Promise) = execute(promise) {
        val parsed = LibraryBridgeContract.parseRemoteRefresh(readMap(request)) ?: return@execute error("INVALID_REMOTE_COLLECTIONS")
        repository.replaceRemoteCollections(parsed)?.let(::snapshot) ?: error("INVALID_REMOTE_COLLECTIONS")
    }

    @ReactMethod fun replaceContinuityMetadata(request: ReadableMap, promise: Promise) = execute(promise) {
        val parsed = LibraryBridgeContract.parseContinuity(readMap(request)) ?: return@execute error("INVALID_CONTINUITY_METADATA")
        repository.replaceContinuityMetadata(parsed.first, parsed.second)?.let(::snapshot) ?: error("INVALID_CONTINUITY_METADATA")
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
                ReadableType.Array -> readArray(requireNotNull(value.getArray(key)))
                else -> null
            }
        }
        return result
    }

    private fun readArray(value: com.facebook.react.bridge.ReadableArray): List<Any?> =
        (0 until value.size()).map { index ->
            when (value.getType(index)) {
                ReadableType.String -> value.getString(index)
                ReadableType.Number -> value.getDouble(index)
                ReadableType.Boolean -> value.getBoolean(index)
                ReadableType.Map -> readMap(requireNotNull(value.getMap(index)))
                ReadableType.Array -> readArray(requireNotNull(value.getArray(index)))
                else -> null
            }
        }

    private fun migrationStatus(status: MigrationStatus) = Arguments.createMap().apply {
        putString("backend", "Room")
        putString("phase", when (status.phase) {
            "idle" -> "not-started"
            "staging" -> "copying"
            "active" -> "complete"
            else -> "failed"
        })
        putBoolean("sourceRetained", status.sourceRetained)
        putBoolean("laterStartValidated", status.laterStartValidated)
        putString("attemptId", status.attemptId)
        putString("checksum", status.checksum)
    }

    private fun migrationFailure(code: String, attemptId: String?, checksum: String?) = Arguments.createMap().apply {
        putString("backend", "Room")
        putString("phase", "failed")
        putBoolean("sourceRetained", true)
        putBoolean("laterStartValidated", false)
        putString("attemptId", attemptId)
        putString("checksum", checksum)
    }

    private fun snapshot(value: LibrarySnapshot) = Arguments.createMap().apply {
        putDouble("schemaVersion", value.schemaVersion.toDouble())
        putDouble("revision", value.revision.toDouble())
        putArray("personalPlaylists", Arguments.fromList(value.personalPlaylists.map { playlist ->
            Arguments.createMap().apply {
                putString("playlistId", playlist.playlistId)
                putString("title", playlist.title)
                putInt("position", playlist.position)
                putArray("tracks", Arguments.fromList(playlist.tracks.map(::track)))
            }
        }))
        putArray("favorites", Arguments.fromList(value.favorites.map(::track)))
        putArray("remoteCollections", Arguments.fromList(value.remoteCollections.map { collection ->
            Arguments.createMap().apply {
                putString("collectionId", collection.collectionId)
                putString("source", collection.source)
                putString("title", collection.title)
                putString("syncState", collection.syncState)
            }
        }))
        putArray("queueCheckpoint", Arguments.fromList(value.queueCheckpoint.map { checkpoint ->
            Arguments.createMap().apply { putString("occurrenceId", checkpoint.occurrenceId); putInt("position", checkpoint.position); putString("source", checkpoint.source); putString("trackId", checkpoint.trackId) }
        }))
        putArray("lyricMetadata", Arguments.fromList(value.lyricMetadata.map { metadata ->
            Arguments.createMap().apply { putString("source", metadata.source); putString("trackId", metadata.trackId); putString("selectedVariantId", metadata.selectedVariantId); putDouble("offsetMillis", metadata.offsetMillis.toDouble()) }
        }))
        putArray("localRecords", Arguments.fromList(value.localRecords.map { record ->
            Arguments.createMap().apply {
                putString("recordId", record.recordId)
                putString("title", record.title)
                putString("artist", record.artist)
                putString("album", record.album)
                record.durationMs?.let { putDouble("durationMs", it.toDouble()) } ?: putNull("durationMs")
                putBoolean("hasArtwork", record.hasArtwork)
                putString("lyricState", record.lyricState)
                putString("availability", record.availability)
                putArray("capabilities", Arguments.fromList(listOf("playlist", "queue", "lyrics")))
            }
        }))
    }

    private fun track(value: SafeTrack) = Arguments.createMap().apply {
        putString("source", value.source)
        putString("trackId", value.trackId)
        putString("title", value.title)
        putString("artist", value.artist)
    }

    private fun receipt(value: LibraryReceipt) = Arguments.createMap().apply {
        putString("requestId", value.requestId)
        putString("status", value.status)
        putDouble("revision", value.revision.toDouble())
        putString("errorCode", value.errorCode)
        value.snapshot?.let { putMap("snapshot", snapshot(it)) }
    }

    /** A syntactically correlated mutation failure still has the receipt shape the
     * JS client validates, so rejected requests retain the last confirmed snapshot. */
    private fun rejectedMutationReceipt(raw: Map<String, Any?>, code: String): WritableMap {
        val requestId = raw["requestId"] as? String
        val revision = (raw["expectedRevision"] as? Number)?.let { number ->
            val decimal = number.toDouble()
            if (decimal.isFinite() && decimal >= 0 && decimal == decimal.toLong().toDouble()) decimal.toLong() else null
        }
        return if (requestId != null && requestId.matches(Regex("^[A-Za-z0-9._:-]{1,96}$")) && revision != null)
            receipt(LibraryReceipt(requestId, "rejected", repository.snapshot().revision, code, repository.snapshot()))
        else error(code)
    }

    private fun backupPreview(value: BackupPreview) = Arguments.createMap().apply {
        putString("status", value.status)
        putString("token", value.token)
        putString("checksum", value.checksum)
        putDouble("baseRevision", value.baseRevision.toDouble())
        putInt("addedFavorites", value.addedFavorites)
        putInt("addedPlaylists", value.addedPlaylists)
        putInt("skippedPlaylists", value.skippedPlaylists)
        putInt("conflictedPlaylists", value.conflictedPlaylists)
        putString("errorCode", value.errorCode)
    }

    private fun error(code: String) = Arguments.createMap().apply {
        putString("status", "rejected")
        putString("errorCode", code)
    }
}
