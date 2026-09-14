package com.listen2mobile.bilibili

import android.os.Handler
import android.os.Looper
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** The package injects a single controller; this manager never creates transport/session state. */
class BilibiliMvViewManager(private val controller: BilibiliMvController) : SimpleViewManager<BilibiliMvView>() {
    private val views = LinkedHashSet<BilibiliMvView>()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName() = "Listen2BilibiliMvView"
    override fun createViewInstance(context: ThemedReactContext) = BilibiliMvView(context, controller).also { views += it }

    @ReactProp(name = "handle")
    fun setHandle(view: BilibiliMvView, handle: String?) = view.setOpaqueHandle(handle)

    fun releaseHandle(handle: String?) {
        val release = { views.toList().forEach { it.releaseHandle(handle) } }
        if (Looper.myLooper() == Looper.getMainLooper()) release() else mainHandler.post(release)
    }
    fun sync(handle: String?, positionMs: Long, playIntent: Boolean) {
        val apply = { views.toList().forEach { it.sync(handle, positionMs, playIntent) } }
        if (Looper.myLooper() == Looper.getMainLooper()) apply() else mainHandler.post(apply)
    }
    fun pauseForBackground() {
        val pause = { views.toList().forEach(BilibiliMvView::pauseForBackground) }
        if (Looper.myLooper() == Looper.getMainLooper()) pause() else mainHandler.post(pause)
    }

    override fun onDropViewInstance(view: BilibiliMvView) {
        views.remove(view)
        view.detach()
        super.onDropViewInstance(view)
    }
}
