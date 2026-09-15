package com.listen2mobile.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryBridgeContractTest {
    @Test fun bridge_accepts_only_versioned_allow_listed_mutations() {
        val result = LibraryBridgeContract.parseMutation(
            mapOf(
                "schemaVersion" to 1,
                "requestId" to "bridge-1",
                "expectedRevision" to 0,
                "operation" to "createPlaylist",
                "payload" to mapOf("playlistId" to "personal-1", "title" to "收藏"),
            ),
        )
        assertTrue(result is LibraryValidation.Accepted)
        assertEquals("bridge-1", (result as LibraryValidation.Accepted).mutation.requestId)
    }

    @Test fun bridge_rejects_private_fields_unknown_operations_and_oversized_dto() {
        val privateInput = mapOf(
            "schemaVersion" to 1, "requestId" to "bridge-2", "expectedRevision" to 0,
            "operation" to "createPlaylist", "payload" to mapOf("playlistId" to "p", "title" to "x", "contentUri" to "content://private"),
        )
        assertTrue(LibraryBridgeContract.parseMutation(privateInput) is LibraryValidation.Rejected)
        assertTrue(
            LibraryBridgeContract.parseMutation(
                mapOf("schemaVersion" to 2, "requestId" to "bridge-3", "expectedRevision" to 0, "operation" to "deleteAll", "payload" to emptyMap<String, String>()),
            ) is LibraryValidation.Rejected,
        )
    }
}
