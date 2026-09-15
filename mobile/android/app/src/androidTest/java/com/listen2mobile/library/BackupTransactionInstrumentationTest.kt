package com.listen2mobile.library

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test

/** Compiled here; the phase-wide controlled instrumentation run is deferred to 06-07. */
class BackupTransactionInstrumentationTest {
    @Test fun room_commits_only_checksum_bound_backup_and_keeps_other_state_on_rejection() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        assertEquals("applied", repository.apply(LibraryMutation("create-1", 0, "createPlaylist", mapOf("playlistId" to "p-one", "title" to "Road"))).status)
        assertEquals("applied", repository.apply(LibraryMutation("favorite-1", 1, "favorite", mapOf("playlistId" to "favorites", "source" to "netease", "trackId" to "t-one", "title" to "Song", "artist" to "Artist"))).status)
        val snapshot = repository.snapshot()
        assertEquals(1, snapshot.personalPlaylists.size)
        assertEquals(1, snapshot.favorites.size)
        val incoming = BackupInput(
            expectedRevision = snapshot.revision,
            mode = "merge",
            favorites = listOf(SafeTrack("netease", "t-two", "Song 2", "Artist")),
            playlists = listOf(BackupPlaylistInput("p-import", "Imported", listOf(SafeTrack("netease", "t-two", "Song 2", "Artist")))),
        )
        val preview = repository.previewBackup(incoming)
        assertEquals("ready", preview.status)
        assertEquals("applied", repository.applyBackup(requireNotNull(preview.token), requireNotNull(preview.checksum), preview.baseRevision).status)
        assertEquals(2, repository.snapshot().personalPlaylists.size)
        assertEquals(2, repository.snapshot().favorites.size)
        val rejected = repository.applyBackup("0123456789abcdef", "0".repeat(64), repository.snapshot().revision)
        assertEquals("rejected", rejected.status)
        assertEquals(2, repository.snapshot().personalPlaylists.size)
        database.close()
    }
}
