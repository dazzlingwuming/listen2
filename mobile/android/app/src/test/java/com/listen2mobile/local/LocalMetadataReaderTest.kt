package com.listen2mobile.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LocalMetadataReaderTest {
    @Test fun normalizes_missing_text_and_invalid_duration() {
        val result = LocalMetadataReader.normalize(null, "", "Album", LocalAudioPolicy.MAX_DURATION_MS + 1, false)
        assertEquals("未命名音频", result.title); assertEquals("本地音频", result.artist)
        assertEquals("Album", result.album); assertNull(result.durationMs)
    }

    @Test fun bounds_control_characters_and_artwork_bytes() {
        assertEquals("未命名音频", LocalMetadataReader.normalize("bad\u0000", null, null, 1, false).title)
        assertNull(LocalMetadataReader.safeArtwork(ByteArray(LocalAudioPolicy.MAX_ARTWORK_BYTES + 1)))
    }
}
