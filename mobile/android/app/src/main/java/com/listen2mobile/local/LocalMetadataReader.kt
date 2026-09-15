package com.listen2mobile.local

import android.graphics.BitmapFactory

internal data class LocalMetadata(val title: String, val artist: String, val album: String?, val durationMs: Long?, val hasArtwork: Boolean)

/** Metadata is bounded before it becomes an opaque record's display state. */
internal object LocalMetadataReader {
    fun normalize(title: String?, artist: String?, album: String?, durationMs: Long?, hasArtwork: Boolean) = LocalMetadata(
        LocalAudioPolicy.safeText(title, "未命名音频"),
        LocalAudioPolicy.safeText(artist, "本地音频"),
        album?.let { LocalAudioPolicy.safeText(it, "") }.takeIf { !it.isNullOrEmpty() },
        durationMs?.takeIf { it in 0..LocalAudioPolicy.MAX_DURATION_MS },
        hasArtwork,
    )

    /** Decodes headers only; the returned display bytes remain bounded before crossing RN. */
    fun safeArtwork(bytes: ByteArray?): ByteArray? {
        if (bytes == null || bytes.isEmpty() || bytes.size > LocalAudioPolicy.MAX_ARTWORK_BYTES) return null
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        if (options.outWidth !in 1..LocalAudioPolicy.MAX_ARTWORK_DIMENSION || options.outHeight !in 1..LocalAudioPolicy.MAX_ARTWORK_DIMENSION) return null
        return bytes.copyOf()
    }
}
