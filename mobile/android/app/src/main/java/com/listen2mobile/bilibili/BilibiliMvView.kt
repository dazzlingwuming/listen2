package com.listen2mobile.bilibili

import android.content.Context
import android.widget.FrameLayout

/** Injection-only surface seam. Task 3 binds Media3 video here; it never owns an audio session. */
class BilibiliMvView(context: Context, private val controller: BilibiliMvController) : FrameLayout(context) {
    private var handle: String? = null

    fun setOpaqueHandle(value: String?) {
        handle = value?.takeIf(BilibiliMvPolicy::isOpaqueHandle)
    }

    fun detach() {
        handle = null
    }

    fun activeHandle(): String? = handle
}
