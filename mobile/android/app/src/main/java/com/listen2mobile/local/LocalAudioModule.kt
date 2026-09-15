package com.listen2mobile.local

import android.app.Activity
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.listen2mobile.library.LibraryRepository
import com.listen2mobile.library.SafeLocalRecord
import java.util.UUID
import java.util.concurrent.Executors

/** Narrow local-only SAF bridge. Document handles never leave this native module. */
@ReactModule(name = LocalAudioModule.NAME)
class LocalAudioModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app), ActivityEventListener {
    companion object {
        const val NAME = "Listen2LocalAudio"
        private const val REQUEST_CODE = 7314
        private const val LRC_REQUEST_CODE = 7315
        private val REQUEST_ID = Regex("^[A-Za-z0-9_-]{1,96}$")
        private val RECORD_ID = Regex("^[A-Za-z0-9-]{16,64}$")
        private val UNSUPPORTED = SafeLocalRecord("", "", "", "")
        private val DUPLICATE = SafeLocalRecord("duplicate", "", "", "")
    }

    private class Pending(val requestId: String, val promise: Promise, val recordId: String? = null) { @Volatile var active = true }
    private val worker = Executors.newSingleThreadExecutor()
    private val privateStore = LocalPrivateStore(app)
    private var pending: Pending? = null
    private var inFlight: Pending? = null

    init { app.addActivityEventListener(this) }
    override fun getName() = NAME

    @ReactMethod
    fun importAudio(requestId: String, promise: Promise) {
        if (!REQUEST_ID.matches(requestId) || pending != null || inFlight != null) { promise.resolve(receipt(requestId, "rejected")); return }
        val activity = app.currentActivity ?: run { promise.resolve(receipt(requestId, "unavailable")); return }
        pending = Pending(requestId, promise)
        activity.runOnUiThread { activity.startActivityForResult(LocalAudioPolicy.pickerIntent(), REQUEST_CODE) }
    }

    @ReactMethod
    fun attachExplicitLrc(recordId: String, requestId: String, promise: Promise) {
        if (!RECORD_ID.matches(recordId) || !REQUEST_ID.matches(requestId) || pending != null || inFlight != null) { promise.resolve(receipt(requestId, "rejected")); return }
        val activity = app.currentActivity ?: run { promise.resolve(receipt(requestId, "unavailable")); return }
        pending = Pending(requestId, promise, recordId)
        activity.runOnUiThread { activity.startActivityForResult(LocalAudioPolicy.lyricIntent(), LRC_REQUEST_CODE) }
    }

    @ReactMethod
    fun cancelLocalRequest(requestId: String, promise: Promise) {
        val current = pending ?: inFlight
        if (current?.requestId == requestId) { current.active = false; if (pending === current) pending = null }
        promise.resolve(receipt(requestId, "cancelled"))
    }

    @ReactMethod
    fun loadArtwork(recordId: String, promise: Promise) {
        if (!RECORD_ID.matches(recordId)) { promise.resolve(artwork(recordId, "rejected", null)); return }
        worker.execute {
            val bytes = privateStore.document(recordId)?.let(::extractArtwork)
            promise.resolve(artwork(recordId, if (bytes == null) "unavailable" else "success", bytes))
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        val current = pending ?: return
        if (requestCode != REQUEST_CODE && requestCode != LRC_REQUEST_CODE) return
        pending = null
        if (resultCode != Activity.RESULT_OK || data == null) { current.promise.resolve(receipt(current.requestId, "cancelled")); return }
        if (requestCode == LRC_REQUEST_CODE) {
            val recordId = current.recordId ?: run { current.promise.resolve(receipt(current.requestId, "rejected")); return }
            val uri = data.data ?: run { current.promise.resolve(receipt(current.requestId, "rejected")); return }
            inFlight = current; worker.execute { try { attachLyric(current, recordId, uri, data.flags) } finally { if (inFlight === current) inFlight = null } }
            return
        }
        val uris = buildList {
            data.data?.let(::add)
            data.clipData?.let { clip -> for (index in 0 until minOf(clip.itemCount, LocalAudioPolicy.MAX_BATCH)) add(clip.getItemAt(index).uri) }
        }.distinct()
        inFlight = current; worker.execute { try { importDocuments(current, uris, data.flags) } finally { if (inFlight === current) inFlight = null } }
    }

    private fun importDocuments(current: Pending, uris: List<android.net.Uri>, resultFlags: Int) {
        var unsupported = 0
        var unreadable = 0
        var duplicates = 0
        val accepted = ArrayList<SafeLocalRecord>()
        val acceptedUris = LinkedHashMap<String, android.net.Uri>()
        uris.forEach { uri ->
            when (val record = inspectAudio(uri, resultFlags)) {
                null -> unreadable += 1
                UNSUPPORTED -> unsupported += 1
                DUPLICATE -> duplicates += 1
                else -> { accepted += record; acceptedUris[record.recordId] = uri }
            }
        }
        if (!current.active) return
        val imported = if (accepted.isEmpty()) 0 else LibraryRepository.open(app).insertLocalRecords(accepted).first
        if (imported > 0 && current.active) acceptedUris.forEach { (recordId, uri) -> privateStore.rememberDocument(recordId, uri) }
        if (current.active) current.promise.resolve(receipt(current.requestId, if (imported > 0) "success" else "rejected", imported, duplicates, unsupported, unreadable))
    }

    private fun inspectAudio(uri: android.net.Uri, resultFlags: Int): SafeLocalRecord? {
        val required = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        if ((resultFlags and required) != required) return null
        try { app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) { return null }
        if (privateStore.hasDocument(uri)) return DUPLICATE
        val header = try { app.contentResolver.openInputStream(uri)?.use { it.readNBytes(16) } } catch (_: Exception) { null } ?: return null
        if (!LocalAudioPolicy.supportedMime(app.contentResolver.getType(uri)) || !LocalAudioPolicy.supportedHeader(header)) return UNSUPPORTED
        val metadata = readMetadata(uri)
        val id = UUID.randomUUID().toString()
        return SafeLocalRecord(id, metadata.title, metadata.artist, "available", metadata.album, metadata.durationMs, metadata.hasArtwork)
    }

    private fun attachLyric(current: Pending, recordId: String, uri: android.net.Uri, resultFlags: Int) {
        val required = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        if ((resultFlags and required) != required) { current.promise.resolve(receipt(current.requestId, "rejected")); return }
        try { app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) { current.promise.resolve(receipt(current.requestId, "rejected")); return }
        val normalized = try { app.contentResolver.openInputStream(uri)?.use { LocalAudioPolicy.normalizeLrc(it.readNBytes(LocalAudioPolicy.MAX_LRC_BYTES + 1)) } } catch (_: Exception) { null }
        if (!current.active) return
        if (normalized == null || !LibraryRepository.open(app).attachExplicitLyric(recordId)) { if (current.active) current.promise.resolve(receipt(current.requestId, "rejected")); return }
        if (!current.active) return
        privateStore.rememberLyric(recordId, normalized)
        current.promise.resolve(receipt(current.requestId, "success"))
    }

    private fun readMetadata(uri: android.net.Uri): LocalMetadata {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(app, uri)
            val artwork = LocalMetadataReader.safeArtwork(retriever.embeddedPicture)
            LocalMetadataReader.normalize(
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST),
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM),
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull(),
                artwork != null,
            )
        } catch (_: Exception) { LocalMetadataReader.normalize(null, null, null, null, false) } finally { runCatching { retriever.release() } }
    }

    private fun extractArtwork(uri: android.net.Uri): ByteArray? {
        val retriever = MediaMetadataRetriever()
        return try { retriever.setDataSource(app, uri); LocalMetadataReader.safeArtwork(retriever.embeddedPicture) } catch (_: Exception) { null } finally { runCatching { retriever.release() } }
    }

    private fun artwork(recordId: String, status: String, bytes: ByteArray?) = Arguments.createMap().apply {
        putString("recordId", recordId); putString("status", status)
        if (bytes == null) putNull("data") else putString("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
    }
    private fun receipt(id: String, status: String, imported: Int = 0, duplicates: Int = 0, unsupported: Int = 0, unreadable: Int = 0) = Arguments.createMap().apply {
        putString("requestId", id); putString("status", status); putInt("imported", imported); putInt("duplicates", duplicates); putInt("unsupported", unsupported); putInt("unreadable", unreadable); putInt("cancelled", if (status == "cancelled") 1 else 0); putArray("records", Arguments.createArray())
    }

    override fun onNewIntent(intent: Intent) = Unit
    override fun invalidate() { pending = null; worker.shutdownNow(); super.invalidate() }
}
