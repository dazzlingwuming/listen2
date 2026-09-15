package com.listen2mobile.offline

import com.listen2mobile.library.CacheBlobEntity
import com.listen2mobile.library.CacheOwnerEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class OfflineCatalogMigrationTest {
    @Test
    fun `catalog identity deduplicates bytes but retains distinct owners`() {
        val identity = OfflineCatalogIdentity(
            source = "netease",
            semanticTrackId = "netrack_1",
            partId = null,
            renditionId = "standard",
            mediaRevision = "revision-1",
        )

        val blob = CacheBlobEntity.ready(identity, "a".repeat(64), 1024L, "audio/mpeg", "mp3")
        val temporary = CacheOwnerEntity.temporary(blob.blobKey, 7L)
        val explicit = CacheOwnerEntity.explicit(blob.blobKey, 8L)

        assertEquals(blob.blobKey, temporary.blobKey)
        assertEquals(blob.blobKey, explicit.blobKey)
        assertNotEquals(temporary.ownerKey, explicit.ownerKey)
        assertEquals(OfflineOwnerKind.EXPLICIT, explicit.kind)
    }
}
