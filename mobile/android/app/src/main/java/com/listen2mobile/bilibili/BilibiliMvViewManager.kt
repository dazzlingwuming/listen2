package com.listen2mobile.bilibili

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** The package injects a single controller; this manager never creates transport/session state. */
class BilibiliMvViewManager(private val controller: BilibiliMvController) : SimpleViewManager<BilibiliMvView>() {
    override fun getName() = "Listen2BilibiliMvView"
    override fun createViewInstance(context: ThemedReactContext) = BilibiliMvView(context, controller)

    @ReactProp(name = "handle")
    fun setHandle(view: BilibiliMvView, handle: String?) = view.setOpaqueHandle(handle)

    override fun onDropViewInstance(view: BilibiliMvView) {
        view.detach()
        super.onDropViewInstance(view)
    }
}
