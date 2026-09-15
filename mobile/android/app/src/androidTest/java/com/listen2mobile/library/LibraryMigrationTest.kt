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
        val input = LegacyLibraryInput(1, listOf(LegacyPlaylist("road", "旧歌单", 0, listOf(LegacyTrack("netease", "42", "青花瓷", "周杰伦")))), listOf(LegacyTrack("netease", "42", "青花瓷", "周杰伦")), listOf(LegacyQueueCheckpoint("q1", 0, "netease", "42")), listOf(LegacyLyricMetadata("netease", "42", "default", 120L)), listOf(LegacyLocalEntry("本地音乐", "歌手")))
        val result = migration.migrate(input, "migration-test-1")
        assertTrue(result is MigrationResult.Activated)
        val activated = (result as MigrationResult.Activated).status
        assertEquals("room", activated.backend)
        assertTrue(activated.sourceRetained)
        assertFalse(activated.cleanupEligible)
        assertTrue(migration.validateLaterStartup().cleanupEligible)
        val snapshot = LibraryRepository(database).snapshot()
        assertEquals("road", snapshot.personalPlaylists.single().playlistId)
        assertEquals("42", snapshot.personalPlaylists.single().tracks.single().trackId)
        assertEquals("42", snapshot.favorites.single().trackId)
        assertEquals("q1", snapshot.queueCheckpoint.single().occurrenceId)
        assertEquals("default", snapshot.lyricMetadata.single().selectedVariantId)
        database.close()
    }

    @Test fun disk_backed_restart_recomputes_migration_readback_before_cleanup() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val name = "migration-restart-${System.nanoTime()}.db"
        val first = Room.databaseBuilder(context, Listen2Database::class.java, name).allowMainThreadQueries().build()
        val input = LegacyLibraryInput(1, listOf(LegacyPlaylist("restart-road", "重启歌单", 0, listOf(LegacyTrack("netease", "42", "青花瓷", "周杰伦")))), emptyList(), emptyList(), emptyList(), emptyList())
        val migration = LegacyLibraryMigration(LibraryRepository(first), LibraryPreferences(context))
        assertTrue(migration.migrate(input, "migration-restart").let { it is MigrationResult.Activated })
        first.close()
        val reopened = Room.databaseBuilder(context, Listen2Database::class.java, name).allowMainThreadQueries().build()
        val afterRestart = LegacyLibraryMigration(LibraryRepository(reopened), LibraryPreferences(context)).validateLaterStartup()
        assertTrue(afterRestart.cleanupEligible)
        assertEquals("restart-road", LibraryRepository(reopened).snapshot().personalPlaylists.single().playlistId)
        reopened.close()
        context.deleteDatabase(name)
    }
}
