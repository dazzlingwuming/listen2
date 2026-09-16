package com.listen2mobile.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryRecordIdsTest {
    @Test fun `native snapshot projects old underscore id and resolves it back to the stored row`() {
        val stored = LocalRecordEntity(
            localRecordId = "migration-boot_abc123-0",
            title = "本地音乐",
            artist = "歌手",
            accessState = "needs-repair",
        )

        val projected = localRecordSnapshot(stored)

        assertEquals("migration-boot-abc123-0", projected.recordId)
        assertTrue(LibraryRecordIds.isValid(projected.recordId))
        assertEquals(stored, resolveLocalRecord(listOf(stored), projected.recordId))
        assertEquals(0, LibraryRecordIds.migrationIndex(stored.localRecordId, "boot_abc123"))
    }

    @Test fun `new migration ids remain bounded and round trip for boot and long attempts`() {
        val bootId = LibraryRecordIds.forMigration("boot_abc123", 0)
        assertEquals("migration-boot-abc123-0", bootId)
        assertTrue(LibraryRecordIds.isValid(bootId))
        assertEquals(bootId, LibraryRecordIds.publicId(bootId))
        assertEquals(0, LibraryRecordIds.migrationIndex(bootId, "boot_abc123"))

        val longAttempt = "x".repeat(64)
        val boundedId = LibraryRecordIds.forMigration(longAttempt, LibraryLimits.MAX_PLAYLISTS - 1)
        assertTrue(LibraryRecordIds.isValid(boundedId))
        assertTrue(boundedId.length <= 64)
        assertFalse(boundedId.contains('_'))
        assertEquals(LibraryLimits.MAX_PLAYLISTS - 1, LibraryRecordIds.migrationIndex(boundedId, longAttempt))

        val oldLongId = "migration-$longAttempt-${LibraryLimits.MAX_PLAYLISTS - 1}"
        assertEquals(boundedId, LibraryRecordIds.publicId(oldLongId))
        assertEquals(LibraryLimits.MAX_PLAYLISTS - 1, LibraryRecordIds.migrationIndex(oldLongId, longAttempt))
    }
}
