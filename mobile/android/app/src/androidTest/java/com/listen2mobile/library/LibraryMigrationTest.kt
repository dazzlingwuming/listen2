package com.listen2mobile.library

import androidx.room.Room
import androidx.test.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryMigrationTest {
    @Test fun copy_validate_activate_retains_source_until_later_startup() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val migration = LegacyLibraryMigration(LibraryRepository(database), LibraryPreferences(context))
        val input = LegacyLibraryInput(0, listOf(LegacyPlaylist("旧歌单")), listOf(LegacyLocalEntry("本地音乐", "歌手")))
        val result = migration.migrate(input, "migration-test-1")
        assertTrue(result is MigrationResult.Activated)
        val activated = (result as MigrationResult.Activated).status
        assertEquals("room", activated.backend)
        assertTrue(activated.sourceRetained)
        assertFalse(activated.cleanupEligible)
        assertTrue(migration.validateLaterStartup().cleanupEligible)
        database.close()
    }
}
