package com.listen2mobile.library

import androidx.room.Room
import androidx.test.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryRepositoryInstrumentationTest {
    @Test fun mutation_is_idempotent_and_order_survives_reopen_contract() {
        val context = InstrumentationRegistry.getTargetContext()
        val database = Room.inMemoryDatabaseBuilder(context, Listen2Database::class.java).allowMainThreadQueries().build()
        val repository = LibraryRepository(database)
        val mutation = LibraryMutation("instrumented-1", 0, "createPlaylist", "personal-1", "First")
        assertEquals("applied", repository.apply(mutation).status)
        assertEquals("applied", repository.apply(mutation).status)
        assertEquals(1, repository.snapshot().personalPlaylists.size)
        assertTrue(repository.apply(mutation.copy(requestId = "instrumented-2", expectedRevision = 0)).status == "stale")
        database.close()
    }
}
