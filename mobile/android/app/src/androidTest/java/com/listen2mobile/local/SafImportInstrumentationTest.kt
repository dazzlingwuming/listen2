package com.listen2mobile.local

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Compile-time device-suite contract: actual provider execution remains Phase 8 acceptance. */
class SafImportInstrumentationTest {
    @Test fun system_picker_is_openable_multi_select_and_persistable_only() {
        val intent = LocalAudioPolicy.pickerIntent()
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
        assertTrue(intent.categories?.contains(Intent.CATEGORY_OPENABLE) == true)
        assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(intent.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0)
    }

    @Test fun explicit_lyric_picker_is_single_openable_document() {
        val intent = LocalAudioPolicy.lyricIntent()
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
        assertEquals("text/plain", intent.type)
        assertTrue(intent.categories?.contains(Intent.CATEGORY_OPENABLE) == true)
    }
}
