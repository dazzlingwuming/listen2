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

    init { coordinator().setObserver { emit(it) } }
    override fun getName() = NAME

    @ReactMethod fun listDownloads(promise: Promise) = promise.resolve(snapshot(coordinator().snapshot()))

    @ReactMethod fun enqueueDownload(request: ReadableMap, promise: Promise) {
        val allowed = setOf("source", "trackId", "title", "artist", "album", "durationMs")
        val keys = request.keySetIterator()
        while (keys.hasNextKey()) if (!allowed.contains(keys.nextKey())) {
            promise.resolve(snapshot(coordinator().snapshot()))
            return
        }
        coordinator().enqueue(
            request.getString("source") ?: "", request.getString("trackId") ?: "",
            request.getString("title") ?: "未知歌曲", request.getString("artist") ?: "未知艺人",
        )
        promise.resolve(snapshot(coordinator().snapshot()))
    }

    @ReactMethod fun cancelDownload(operationId: String, promise: Promise) {
        coordinator().cancel(operationId); promise.resolve(snapshot(coordinator().snapshot()))
    }
    @ReactMethod fun retryDownload(source: String, trackId: String, promise: Promise) {
        coordinator().retry(source, trackId); promise.resolve(snapshot(coordinator().snapshot()))
    }
    @ReactMethod fun removeDownload(source: String, trackId: String, promise: Promise) {
        coordinator().remove(source, trackId); promise.resolve(snapshot(coordinator().snapshot()))
    }
    @ReactMethod fun clearDownloads(promise: Promise) {
        coordinator().clear(); promise.resolve(snapshot(coordinator().snapshot()))
    }
    @ReactMethod fun invalidate(source: String, trackId: String, promise: Promise) {
        coordinator().remove(source, trackId); promise.resolve(snapshot(coordinator().snapshot()))
    }

    @ReactMethod fun resolveVerified(source: String, trackId: String, promise: Promise) {
        val entry = coordinator().resolve(source, trackId)
        if (entry == null) {
            promise.resolve(Arguments.createMap().apply { putString("status", "miss") })
            return
        }
        promise.resolve(Arguments.createMap().apply {
            putString("status", "hit")
            putString("uri", "content://${app.packageName}.offline-cache/${OfflinePolicy.key(source, trackId)}")
            putString("mimeType", entry.mimeType)
        })
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit
    private fun coordinator() = OfflineRegistry.get(app)
    private fun emit(entries: List<OfflineEntry>) {
        if (!app.hasActiveReactInstance()) return
        app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("catalogChanged", snapshot(entries))
    }
    private fun snapshot(entries: List<OfflineEntry>) = Arguments.createMap().apply {
        putDouble("usedBytes", entries.filter { it.status == OfflineStatus.READY }.sumOf { it.downloadedBytes }.toDouble())
        putDouble("quotaBytes", OfflineLimits.DEFAULT.totalBytes.toDouble())
        putArray("entries", Arguments.fromList(entries.map(::entry)))
    }
    private fun entry(value: OfflineEntry) = Arguments.createMap().apply {
        putString("operationId", value.operationId); putString("source", value.source); putString("trackId", value.trackId)
        putString("title", value.title); putString("artist", value.artist); putString("status", value.status.wire)
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
        val file = OfflineRegistry.get(requireNotNull(context)).file(uri.lastPathSegment) ?: throw FileNotFoundException("not-found")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun getType(uri: Uri): String? = null
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
