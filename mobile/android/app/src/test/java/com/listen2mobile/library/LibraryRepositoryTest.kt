package com.listen2mobile.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryRepositoryTest {
    @Test fun `valid create mutation produces safe bounded request`() {
        val checked = LibraryMutationValidator.validate(
            requestId = "request-1",
            expectedRevision = 0L,
            operation = "createPlaylist",
            payload = mapOf("playlistId" to "personal-1", "title" to "我的歌单"),
        )
        assertTrue(checked is LibraryValidation.Accepted)
        assertEquals("personal-1", (checked as LibraryValidation.Accepted).mutation.playlistId)
    }

    @Test fun `unsafe input and stale identity are rejected before a write`() {
        assertTrue(
            LibraryMutationValidator.validate("", 0L, "createPlaylist", emptyMap()) is LibraryValidation.Rejected,
        )
        assertTrue(
            LibraryMutationValidator.validate(
                "request-2", 0L, "createPlaylist", mapOf("playlistId" to "personal-1", "title" to "x", "uri" to "content://private"),
            ) is LibraryValidation.Rejected,
        )
        assertFalse(LibraryIdentity.sameTrack("netease", "netrack_1", "netease", "netrack_2"))
        assertTrue(LibraryIdentity.sameTrack("netease", "netrack_1", "netease", "netrack_1"))
    }
}
