package com.listen2mobile.local

import android.content.Intent
import java.io.ByteArrayOutputStream
import java.io.InputStream

/** Pure SAF policy: grants are selected by the system picker, never supplied by JS. */
internal object LocalAudioPolicy {
    const val MAX_BATCH = 500
    const val MAX_METADATA_TEXT = 256
    const val MAX_DURATION_MS = 24 * 60 * 60 * 1000L
    const val MAX_ARTWORK_BYTES = 512 * 1024
    const val MAX_ARTWORK_DIMENSION = 2_048
    const val MAX_LRC_BYTES = 256 * 1024
    const val MAX_LRC_LINES = 5_000
    const val MAX_LRC_LINE_LENGTH = 1_024
    val acceptedMimePrefixes = setOf("audio/")

    fun pickerIntent() = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "audio/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }

    fun lyricIntent() = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "text/plain"
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }

    fun supportedMime(value: String?) = value != null && acceptedMimePrefixes.any { value.startsWith(it, ignoreCase = true) }
    /** Reads no more than the caller-authorized byte limit on every Android API level. */
    fun readAtMost(input: InputStream, maximum: Int): ByteArray {
        require(maximum >= 0)
        val output = ByteArrayOutputStream(minOf(maximum, 8192))
        val buffer = ByteArray(minOf(maximum.coerceAtLeast(1), 8192))
        while (output.size() < maximum) {
            val count = input.read(buffer, 0, minOf(buffer.size, maximum - output.size()))
            if (count <= 0) break
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }
    /** MIME is only a hint; descriptor bytes must identify a supported container. */
    fun supportedHeader(bytes: ByteArray): Boolean {
        if (bytes.size < 4) return false
        val text = bytes.toString(Charsets.ISO_8859_1)
        return text.startsWith("ID3") || (bytes[0] == 0xFF.toByte() && (bytes[1].toInt() and 0xE0) == 0xE0) || text.startsWith("fLaC") || text.startsWith("OggS") || text.startsWith("RIFF") || (bytes.size >= 12 && text.substring(4, 8) == "ftyp") || text.startsWith("\u001A\u0045\u00DF\u00A3")
    }
    fun safeText(value: String?, fallback: String) = value?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_METADATA_TEXT && it.none { char -> char.code < 32 } } ?: fallback

    /** Explicit LRC is a selected text document, never a sibling-file scan. */
    fun normalizeLrc(bytes: ByteArray): String? {
        if (bytes.isEmpty() || bytes.size > MAX_LRC_BYTES) return null
        val text = bytes.toString(Charsets.UTF_8).removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n')
        val lines = text.split('\n')
        if (lines.size > MAX_LRC_LINES || lines.any { it.length > MAX_LRC_LINE_LENGTH || it.any { char -> char.code == 0 || char.isSurrogate() } }) return null
        return lines.joinToString("\n").trim().takeIf { it.isNotEmpty() }
    }
}
