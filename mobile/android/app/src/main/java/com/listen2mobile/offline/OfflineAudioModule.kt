package com.listen2mobile.offline

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import java.io.FileNotFoundException

@ReactModule(name = OfflineAudioModule.NAME)
class OfflineAudioModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
    companion object { const val NAME = "Listen2OfflineAudio" }

    init { service().observe(::emit) }
    override fun getName() = NAME

    @ReactMethod fun listDownloads(promise: Promise) = promise.resolve(snapshot(service().snapshot()))
    /** v2 semantic catalog surface; it never returns paths, attempts, transport or bytes. */
    @ReactMethod fun cacheSnapshot(promise: Promise) = promise.resolve(snapshot(service().snapshot()))

    @ReactMethod fun requestExplicitCache(request: ReadableMap, promise: Promise) {
        val source = request.getString("source") ?: ""; val trackId = request.getString("trackId") ?: ""
        val next = service().request(source, trackId, request.getString("title") ?: "未知歌曲", request.getString("artist") ?: "未知艺人")
        OfflineDurableWork.enqueue(app, source, trackId, 0L); promise.resolve(snapshot(next))
    }
    @ReactMethod fun promoteCache(source: String, trackId: String, promise: Promise) { promise.resolve(snapshot(service().promote(source, trackId))) }
    @ReactMethod fun setCacheQuota(bytes: Double?, promise: Promise) {
        if (bytes != null && (!bytes.isFinite() || bytes < 0 || bytes != bytes.toLong().toDouble())) {
            promise.resolve(snapshot(service().snapshot()))
            return
        }
        val exact = bytes?.toLong()
        promise.resolve(snapshot(service().setQuota(exact)))
    }
    @ReactMethod fun cacheAction(action: String, operationId: String, promise: Promise) {
        promise.resolve(snapshot(service().action(action, operationId)))
    }

    @ReactMethod fun enqueueDownload(request: ReadableMap, promise: Promise) {
        val allowed = setOf("source", "trackId", "title", "artist", "album", "durationMs")
        val keys = request.keySetIterator()
        while (keys.hasNextKey()) if (!allowed.contains(keys.nextKey())) {
            promise.resolve(snapshot(service().snapshot()))
            return
        }
        val next = service().request(
            request.getString("source") ?: "", request.getString("trackId") ?: "",
            request.getString("title") ?: "未知歌曲", request.getString("artist") ?: "未知艺人",
        )
        OfflineDurableWork.enqueue(app, request.getString("source") ?: "", request.getString("trackId") ?: "", 0L)
        promise.resolve(snapshot(next))
    }

    @ReactMethod fun cancelDownload(operationId: String, promise: Promise) {
        service().snapshot().entries.firstOrNull { it.operationId == operationId }?.let { OfflineDurableWork.cancel(app, it.source, it.trackId) }
        promise.resolve(snapshot(service().action("cancel", operationId)))
    }
    @ReactMethod fun retryDownload(source: String, trackId: String, promise: Promise) {
        service().resume(source, trackId); promise.resolve(snapshot(service().snapshot()))
    }
    @ReactMethod fun removeDownload(source: String, trackId: String, promise: Promise) {
        OfflineDurableWork.cancel(app, source, trackId); promise.resolve(snapshot(service().invalidate(source, trackId)))
    }
    @ReactMethod fun clearDownloads(promise: Promise) {
        promise.resolve(snapshot(service().action("clearEligible", "")))
    }
    @ReactMethod fun invalidate(source: String, trackId: String, promise: Promise) {
        OfflineDurableWork.cancel(app, source, trackId); promise.resolve(snapshot(service().invalidate(source, trackId)))
    }

    @ReactMethod fun resolveVerified(source: String, trackId: String, promise: Promise) {
        val entry = service().resolve(source, trackId)
        if (entry == null) {
            promise.resolve(Arguments.createMap().apply { putString("status", "miss") })
            return
        }
        promise.resolve(Arguments.createMap().apply {
            putString("status", "hit")
            putString("uri", "content://${app.packageName}.offline-cache/${entry.blobKey}")
            putString("mimeType", entry.mimeType)
        })
    }

    /** Completed cache only; absent, stale, or unsupported analysis deliberately returns unity. */
    @ReactMethod fun normalizationGain(source: String, trackId: String, promise: Promise) {
        val gain = service().normalizationGain(source, trackId)
        promise.resolve(Arguments.createMap().apply { putDouble("gain", if (gain.isFinite()) gain.coerceIn(0.0, 4.0) else 1.0) })
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit
    private fun service() = OfflineCatalogService.get(app)
    private fun emit(entries: CatalogCacheSnapshot) {
        if (!app.hasActiveReactInstance()) return
        app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("catalogChanged", snapshot(entries))
    }
    private fun snapshot(entries: CatalogCacheSnapshot) = Arguments.createMap().apply {
        putDouble("usedBytes", entries.usedBytes.toDouble())
        putDouble("reservedBytes", entries.reservedBytes.toDouble())
        if (entries.quotaBytes == null) putNull("quotaBytes") else putDouble("quotaBytes", entries.quotaBytes.toDouble())
        putArray("entries", Arguments.fromList(entries.entries.map(::entry)))
    }
    private fun entry(value: CatalogCacheEntry) = Arguments.createMap().apply {
        putString("operationId", value.operationId); putString("source", value.source); putString("trackId", value.trackId)
        putString("title", value.title); putString("artist", value.artist); putString("status", value.status)
        putArray("owners", Arguments.fromList(value.owners))
        putDouble("downloadedBytes", value.downloadedBytes.toDouble()); putDouble("totalBytes", value.totalBytes.toDouble())
        putString("errorCode", value.errorCode); putDouble("updatedAt", value.updatedAt.toDouble())
    }
}

class OfflineAudioPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) = listOf(OfflineAudioModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class OfflineAudioProvider : ContentProvider() {
    override fun onCreate() = true
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r" || uri.pathSegments.size != 1) throw FileNotFoundException("not-found")
        val file = OfflineCatalogService.get(requireNotNull(context)).file(uri.lastPathSegment) ?: throw FileNotFoundException("not-found")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun getType(uri: Uri): String? = null
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
