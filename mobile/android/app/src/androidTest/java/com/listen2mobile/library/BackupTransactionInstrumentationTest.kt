package com.listen2mobile.library

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test

/** Compiled here; the phase-wide controlled instrumentation run is deferred to 06-07. */
class BackupTransactionInstrumentationTest {
    @Test fun room_reopens_confirmed_playlist_and_favorite_projection() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        assertEquals("applied", repository.apply(LibraryMutation("create-1", 0, "createPlaylist", mapOf("playlistId" to "p-one", "title" to "Road"))).status)
        assertEquals("applied", repository.apply(LibraryMutation("favorite-1", 1, "favorite", mapOf("playlistId" to "favorites", "source" to "netease", "trackId" to "t-one", "title" to "Song", "artist" to "Artist"))).status)
        val snapshot = repository.snapshot()
        assertEquals(1, snapshot.personalPlaylists.size)
        assertEquals(1, snapshot.favorites.size)
        database.close()
    }
}
