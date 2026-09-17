package com.listen2mobile.bilibili

import android.util.Log

/** Fixed, bounded diagnostics only; provider payloads and transport values are never accepted. */
internal object BilibiliDiagnostics {
    private const val TAG = "Listen2Bilibili"
    private val SAFE_MARKER = Regex("[A-Za-z0-9=_-]{1,160}")

    fun info(marker: String) {
        if (!SAFE_MARKER.matches(marker)) return
        try {
            Log.i(TAG, marker)
        } catch (_: RuntimeException) {
            // android.util.Log is intentionally absent from local JVM tests.
        }
    }
}
