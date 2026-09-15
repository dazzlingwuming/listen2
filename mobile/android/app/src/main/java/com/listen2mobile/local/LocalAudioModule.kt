package com.listen2mobile.local

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.util.UUID

@ReactModule(name = LocalAudioModule.NAME)
class LocalAudioModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app), ActivityEventListener {
    companion object { const val NAME = "Listen2LocalAudio"; private const val REQUEST_CODE = 7314 }
    private var pending: Pair<String, Promise>? = null
    init { app.addActivityEventListener(this) }
    override fun getName() = NAME
    @ReactMethod fun importAudio(requestId: String, promise: Promise) {
        if (!requestId.matches(Regex("^[A-Za-z0-9_-]{1,96}$")) || pending != null) { promise.resolve(receipt(requestId, "rejected")); return }
        val activity = app.currentActivity ?: run { promise.resolve(receipt(requestId, "unavailable")); return }
        pending = requestId to promise; activity.startActivityForResult(LocalAudioPolicy.pickerIntent(), REQUEST_CODE)
    }
    @ReactMethod fun cancelLocalRequest(requestId: String, promise: Promise) { if (pending?.first == requestId) { pending = null; promise.resolve(receipt(requestId, "cancelled")) } else promise.resolve(receipt(requestId, "cancelled")) }
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return
        val current = pending ?: return; pending = null
        if (resultCode != Activity.RESULT_OK || data == null) { current.second.resolve(receipt(current.first, "cancelled")); return }
        val uris = buildList { data.data?.let(::add); data.clipData?.let { clip -> for (i in 0 until minOf(clip.itemCount, LocalAudioPolicy.MAX_BATCH)) add(clip.getItemAt(i).uri) } }.distinct()
        var imported = 0; var unsupported = 0
        uris.forEach { uri -> try { app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); if (LocalAudioPolicy.supportedMime(app.contentResolver.getType(uri))) imported++ else unsupported++ } catch (_: Exception) { unsupported++ } }
        current.second.resolve(receipt(current.first, if (imported > 0) "success" else "rejected", imported, unsupported))
    }
    override fun onNewIntent(intent: Intent) = Unit
    private fun receipt(id: String, status: String, imported: Int = 0, unsupported: Int = 0) = Arguments.createMap().apply { putString("requestId", id); putString("status", status); putInt("imported", imported); putInt("duplicates", 0); putInt("unsupported", unsupported); putInt("unreadable", 0); putInt("cancelled", if (status == "cancelled") 1 else 0); putArray("records", Arguments.createArray()) }
}
