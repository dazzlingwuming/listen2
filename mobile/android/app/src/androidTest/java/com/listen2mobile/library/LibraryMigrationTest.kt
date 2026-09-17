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

    @Test fun disk_backed_restart_recomputes_migration_readback_before_cleanup() {
        runBlocking {
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

    @Test fun readback_ignores_unrelated_room_rows_before_and_after_legacy_copy() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        val dao = database.libraryDao()
        dao.insertPlaylist(PersonalPlaylistEntity("baseline-road", "已有歌单", 0))
        dao.insertMembership(PlaylistMembershipEntity("baseline-road", "qq", "baseline-track", 0, "已有歌曲", "已有歌手"))
        dao.putFavorite(FavoriteEntity("qq", "baseline-track", "已有歌曲", "已有歌手"))
        dao.putRemoteCollection(RemoteCollectionEntity("baseline-remote", "qq", "已有来源", "ready"))
        dao.insertQueue(QueueCheckpointEntity("baseline-queue", 0, "qq", "baseline-track"))
        dao.putLyricMetadata(LyricMetadataEntity("qq", "baseline-track", "baseline", 0L))
        val input = LegacyLibraryInput(
            1,
            listOf(LegacyPlaylist("legacy-road", "旧版歌单", 0, listOf(LegacyTrack("netease", "legacy-track", "旧版歌曲", "旧版歌手")))),
            listOf(LegacyTrack("netease", "legacy-track", "旧版歌曲", "旧版歌手")),
            listOf(LegacyQueueCheckpoint("legacy-queue", 0, "netease", "legacy-track")),
            listOf(LegacyLyricMetadata("netease", "legacy-track", "legacy", 20L)),
            listOf(LegacyLocalEntry("旧版本地音乐", "旧版歌手")),
            listOf(SafeRemoteCollection("legacy-remote", "netease", "旧版来源", "ready")),
        )
        val migration = LegacyLibraryMigration(repository, LibraryPreferences(context))

        assertTrue(migration.migrate(input, "subset-readback").let { it is MigrationResult.Activated })
        dao.putFavorite(FavoriteEntity("bilibili", "later-track", "后来收藏", "后来歌手"))
        dao.putRemoteCollection(RemoteCollectionEntity("later-remote", "bilibili", "后来来源", "ready"))
        dao.insertQueue(QueueCheckpointEntity("later-queue", 9, "bilibili", "later-track"))
        dao.putLyricMetadata(LyricMetadataEntity("bilibili", "later-track", "later", 10L))
        dao.insertPlaylist(PersonalPlaylistEntity("later-road", "后来歌单", 9))

        val status = migration.validateLaterStartup()

        assertTrue(status.cleanupEligible)
        assertTrue(status.sourceRetained)
        assertEquals("旧版歌单", repository.snapshot().personalPlaylists.first { it.playlistId == "legacy-road" }.title)
        assertEquals("已有歌曲", repository.snapshot().favorites.first { it.trackId == "baseline-track" }.title)
        assertEquals("后来收藏", repository.snapshot().favorites.first { it.trackId == "later-track" }.title)
        database.close()
    }

    @Test fun readback_keeps_source_when_a_migrated_record_changes() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        val input = LegacyLibraryInput(
            1,
            emptyList(),
            listOf(LegacyTrack("netease", "legacy-track", "旧版歌曲", "旧版歌手")),
            emptyList(), emptyList(), emptyList(),
        )
        val migration = LegacyLibraryMigration(repository, LibraryPreferences(context))

        assertTrue(migration.migrate(input, "changed-migrated-row").let { it is MigrationResult.Activated })
        database.libraryDao().putFavorite(FavoriteEntity("netease", "legacy-track", "被修改的歌曲", "旧版歌手"))

        val status = migration.validateLaterStartup()

        assertFalse(status.cleanupEligible)
        assertTrue(status.sourceRetained)
        assertEquals("被修改的歌曲", repository.snapshot().favorites.single().title)
        database.close()
    }

    @Test fun identical_residual_playlist_and_queue_are_an_idempotent_retry() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        val dao = database.libraryDao()
        dao.insertPlaylist(PersonalPlaylistEntity("road", "旧歌单", 0))
        dao.insertMembership(PlaylistMembershipEntity("road", "netease", "42", 0, "青花瓷", "周杰伦"))
        dao.insertQueue(QueueCheckpointEntity("q1", 0, "netease", "42"))
        val input = LegacyLibraryInput(
            1,
            listOf(LegacyPlaylist("road", "旧歌单", 0, listOf(LegacyTrack("netease", "42", "青花瓷", "周杰伦")))),
            emptyList(),
            listOf(LegacyQueueCheckpoint("q1", 0, "netease", "42")),
            emptyList(),
            emptyList(),
        )

        val result = LegacyLibraryMigration(repository, LibraryPreferences(context)).migrate(input, "retry-identical")

        assertTrue(result is MigrationResult.Activated)
        assertEquals(1, repository.snapshot().personalPlaylists.size)
        assertEquals(1, repository.snapshot().queueCheckpoint.size)
        database.close()
    }

    @Test fun conflicting_residual_playlist_is_rejected_without_overwrite() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        database.libraryDao().insertPlaylist(PersonalPlaylistEntity("road", "手机现有歌单", 0))
        val input = LegacyLibraryInput(
            1,
            listOf(LegacyPlaylist("road", "旧版歌单", 0, emptyList())),
            emptyList(), emptyList(), emptyList(), emptyList(),
        )

        val result = LegacyLibraryMigration(repository, LibraryPreferences(context)).migrate(input, "retry-conflict")

        assertTrue(result is MigrationResult.Rejected)
        assertEquals("MIGRATION_WRITE_FAILED", (result as MigrationResult.Rejected).errorCode)
        assertEquals("手机现有歌单", repository.snapshot().personalPlaylists.single().title)
        database.close()
    }

    @Test fun conflicting_residual_metadata_is_rejected_without_overwrite() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        val dao = database.libraryDao()
        dao.putFavorite(FavoriteEntity("netease", "42", "手机收藏", "手机歌手"))
        dao.putRemoteCollection(RemoteCollectionEntity("charts", "netease", "手机来源歌单", "ready"))
        dao.putLyricMetadata(LyricMetadataEntity("netease", "42", "phone", 99L))
        val input = LegacyLibraryInput(
            1,
            emptyList(),
            listOf(LegacyTrack("netease", "42", "旧版收藏", "旧版歌手")),
            emptyList(),
            listOf(LegacyLyricMetadata("netease", "42", "legacy", 120L)),
            emptyList(),
            listOf(SafeRemoteCollection("charts", "netease", "旧版来源歌单", "ready")),
        )

        val result = LegacyLibraryMigration(repository, LibraryPreferences(context)).migrate(input, "metadata-conflict")

        assertTrue(result is MigrationResult.Rejected)
        assertEquals("MIGRATION_WRITE_FAILED", (result as MigrationResult.Rejected).errorCode)
        val snapshot = repository.snapshot()
        assertEquals("手机收藏", snapshot.favorites.single().title)
        assertEquals("手机来源歌单", snapshot.remoteCollections.single().title)
        assertEquals("phone", snapshot.lyricMetadata.single().selectedVariantId)
        database.close()
    }

    @Test fun validated_room_copy_recovers_a_staging_cutover_after_restart() = runBlocking {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        val preferences = LibraryPreferences(context)
        val attemptId = "staging-recovery"
        val safeInput = SafeLegacyInput(
            playlists = listOf(SafeLegacyPlaylist("recovered", "恢复歌单", 0, emptyList())),
            favorites = emptyList(),
            queueCheckpoint = emptyList(),
            lyricMetadata = emptyList(),
            localRecords = emptyList(),
        )
        val checksum = LegacyLibraryMigration.checksum(safeInput)
        preferences.markStaging(attemptId)
        repository.stageLegacyCopy(attemptId, safeInput, checksum)

        val recovered = LegacyLibraryMigration(repository, preferences).validateLaterStartup()

        assertEquals("room", recovered.backend)
        assertEquals("active", recovered.phase)
        assertEquals(attemptId, recovered.attemptId)
        assertEquals(checksum, recovered.checksum)
        assertTrue(recovered.cleanupEligible)
        assertEquals("recovered", repository.snapshot().personalPlaylists.single().playlistId)
        database.close()
    }
}
