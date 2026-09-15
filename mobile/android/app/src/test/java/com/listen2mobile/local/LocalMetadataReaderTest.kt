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
}
