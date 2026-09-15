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
    /** MIME is only a hint; descriptor bytes must identify a supported container. */
    fun supportedHeader(bytes: ByteArray): Boolean {
        if (bytes.size < 4) return false
        val text = bytes.toString(Charsets.ISO_8859_1)
        return text.startsWith("ID3") || (bytes[0] == 0xFF.toByte() && (bytes[1].toInt() and 0xE0) == 0xE0) || text.startsWith("fLaC") || text.startsWith("OggS") || text.startsWith("RIFF") || (bytes.size >= 12 && text.substring(4, 8) == "ftyp") || text.startsWith("\u001A\u0045\u00DF\u00A3")
    }
    fun safeText(value: String?, fallback: String) = value?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_METADATA_TEXT && it.none { char -> char.code < 32 } } ?: fallback
}
