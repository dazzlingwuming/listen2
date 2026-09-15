package com.listen2mobile.local

import android.content.Intent

/** Pure SAF policy: grants are selected by the system picker, never supplied by JS. */
internal object LocalAudioPolicy {
    const val MAX_BATCH = 500
    const val MAX_METADATA_TEXT = 256
    const val MAX_DURATION_MS = 24 * 60 * 60 * 1000L
    val acceptedMimePrefixes = setOf("audio/")

    fun pickerIntent() = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "audio/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }

    fun supportedMime(value: String?) = value != null && acceptedMimePrefixes.any { value.startsWith(it, ignoreCase = true) }
    fun safeText(value: String?, fallback: String) = value?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_METADATA_TEXT && it.none { char -> char.code < 32 } } ?: fallback
}
