package com.listen2mobile.history

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.listen2mobile.library.LibraryPreferences
import com.listen2mobile.library.LibraryRepository
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking

/** Thin asynchronous semantic bridge. It intentionally has no player, URL, or storage-handle API. */
@ReactModule(name = HistoryModule.NAME)
class HistoryModule internal constructor(app: ReactApplicationContext, private val ledger: ListeningLedger, private val preferences: LibraryPreferences) : ReactContextBaseJavaModule(app) {
    companion object {
        const val NAME = "Listen2History"
        val NAMED_METHODS = setOf("beginPlayback", "observePlayback", "getHistory", "getRecap", "getRecordingPreference", "setRecordingPreference", "exportSafeHistory", "clearHistory")
        private const val MAX_QUEUE = 64
    }
    private val executor = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(MAX_QUEUE), ThreadPoolExecutor.AbortPolicy())
    @Volatile private var closed = false
    override fun getName() = NAME

    @ReactMethod fun beginPlayback(value: ReadableMap, promise: Promise) = submit(promise) {
        if (!runBlocking { preferences.recordingEnabled() }) return@submit
        parseStart(value)?.let(ledger::begin)
    }
    @ReactMethod fun observePlayback(value: ReadableMap, promise: Promise) = submit(promise) {
        if (!runBlocking { preferences.recordingEnabled() }) return@submit
        parseObservation(value)?.let(ledger::observe)
    }
    @ReactMethod fun getRecordingPreference(promise: Promise) = submitResult(promise) { mapOf("recordingEnabled" to runBlocking { preferences.recordingEnabled() }) }
    @ReactMethod fun setRecordingPreference(enabled: Boolean, promise: Promise) = submitResult(promise) { runBlocking { preferences.setRecordingEnabled(enabled) }; mapOf("recordingEnabled" to enabled) }
    @ReactMethod fun clearHistory(promise: Promise) = submitResult(promise) { mapOf("clearGeneration" to ledger.clear()) }
    @ReactMethod fun getHistory(limit: Int, promise: Promise) = submitResult(promise) { safeEvents(null, limit) }
    @ReactMethod fun getRecap(year: Int, promise: Promise) = submitResult(promise) {
        val safeYear = year.takeIf { it in 1970..9999 } ?: java.time.Year.now().value
        val recap = ledger.recap(safeYear)
        mapOf(
            "year" to recap.year,
            "totalListenedMs" to recap.totalListenedMs,
            "playCount" to recap.playCount,
            "distinctTracks" to recap.distinctTracks,
            "distinctArtists" to recap.distinctArtists,
            "topTracks" to recap.topTracks,
            "topArtists" to recap.topArtists,
            "monthly" to recap.monthly,
        )
    }
    @ReactMethod fun exportSafeHistory(year: Int, limit: Int, promise: Promise) = submitResult(promise) { if (year !in 1970..9999) emptyList<Map<String, Any>>() else safeEvents(year, limit.coerceIn(1, 500)) }

    private fun submit(promise: Promise, work: () -> Unit) {
        if (closed) { promise.resolve(status("unavailable")); return }
        try {
            executor.execute { runCatching(work) }
            // Recording is deliberately fire-and-forget: a slow Room transaction cannot hold up
            // the RNTP callback path or expose an internal failure detail.
            promise.resolve(status("accepted"))
        } catch (_: Exception) { promise.resolve(status("busy")) }
    }
    private fun submitResult(promise: Promise, work: () -> Any) {
        if (closed) { promise.resolve(status("unavailable")); return }
        try { executor.execute { promise.resolve(Arguments.makeNativeMap(mapOf("status" to "success", "data" to work()))) } } catch (_: Exception) { promise.resolve(status("busy")) }
    }
    private fun status(value: String) = Arguments.createMap().apply { putString("status", value) }
    private fun safeEvents(year: Int?, limit: Int) = ledger.events(year, limit.coerceIn(1, 500)).map { event -> mapOf("eventId" to event.eventId, "source" to event.source, "trackId" to event.semanticTrackId, "title" to event.title, "artist" to event.artist, "date" to event.committedLocalDate, "year" to event.committedLocalYear, "month" to event.committedLocalMonth, "listenedForwardMs" to event.listenedForwardMs) }

    private fun parseStart(map: ReadableMap): PlaybackStart? {
        if (!keys(map, setOf("playbackInstanceId", "clearGeneration", "source", "trackId", "title", "artist", "durationMs", "startedElapsedMs"))) return null
        return try { PlaybackStart(map.getString("playbackInstanceId") ?: return null, map.getDouble("clearGeneration").toLong(), SafeHistoryTrack(map.getString("source") ?: return null, map.getString("trackId") ?: return null, safeText(map.getString("title")) ?: return null, safeText(map.getString("artist")) ?: return null), map.getDouble("durationMs").toLong(), map.getDouble("startedElapsedMs").toLong()) } catch (_: Exception) { null }
    }
    private fun parseObservation(map: ReadableMap): PlaybackObservation? {
        if (!keys(map, setOf("playbackInstanceId", "clearGeneration", "sequence", "kind", "positionMs", "observedElapsedMs"))) return null
        return try { PlaybackObservation(map.getString("playbackInstanceId") ?: return null, map.getDouble("clearGeneration").toLong(), map.getDouble("sequence").toLong(), map.getString("kind") ?: return null, if (map.isNull("positionMs")) null else map.getDouble("positionMs").toLong(), map.getDouble("observedElapsedMs").toLong()) } catch (_: Exception) { null }
    }
    private fun keys(map: ReadableMap, expected: Set<String>) = map.entryIterator.asSequence().map { entry -> entry.key }.toSet() == expected
    private fun safeText(value: String?) = value?.takeIf { it.isNotBlank() && it.length <= 160 && !it.contains("://") && !it.contains("content:") && !it.contains("file:") }
    override fun invalidate() { closed = true; executor.shutdownNow(); super.invalidate() }
}
