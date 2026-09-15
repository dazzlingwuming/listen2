package com.listen2mobile.local

import android.content.ContentValues
import android.net.Uri
import org.junit.Assert.assertNull
import org.junit.Test

/** Source-compiled provider rejection contract; device execution is reserved for Phase 8. */
class LocalMediaProviderInstrumentationTest {
    @Test fun malformed_provider_paths_never_yield_a_token() {
        assertNull(LocalMediaPolicy.tokenFrom(Uri.parse("content://app.local-media/play/../document")))
        assertNull(LocalMediaPolicy.tokenFrom(Uri.parse("content://app.local-media/query")))
        ContentValues().put("ignored", "value")
    }
}
