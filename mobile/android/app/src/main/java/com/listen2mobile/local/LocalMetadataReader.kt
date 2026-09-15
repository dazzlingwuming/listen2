package com.listen2mobile.local

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
}
