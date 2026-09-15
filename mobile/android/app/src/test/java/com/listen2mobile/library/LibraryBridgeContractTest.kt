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

    @Test fun bridge_accepts_only_correlated_safe_legacy_migration_dto() {
        val accepted = LibraryBridgeContract.parseLegacyMigration(
            mapOf(
                "schemaVersion" to 1,
                "attemptId" to "attempt_1",
                "checksum" to "a".repeat(64),
                "playlists" to listOf(mapOf("playlistId" to "road", "title" to "旧歌单", "position" to 0, "tracks" to listOf(mapOf("source" to "netease", "trackId" to "42", "title" to "歌", "artist" to "手")))),
                "favorites" to listOf(mapOf("source" to "netease", "trackId" to "42", "title" to "歌", "artist" to "手")),
                "remoteCollections" to emptyList<Map<String, String>>(),
                "queueCheckpoint" to listOf(mapOf("occurrenceId" to "q1", "position" to 0, "source" to "netease", "trackId" to "42")),
                "lyricMetadata" to listOf(mapOf("source" to "netease", "trackId" to "42", "selectedVariantId" to "main", "offsetMillis" to 0)),
                "localEntries" to listOf(mapOf("title" to "本地音乐", "artist" to "歌手")),
            ),
        )
        assertEquals("attempt_1", accepted?.second?.first)
        assertTrue(
            LibraryBridgeContract.parseLegacyMigration(
                mapOf(
                    "schemaVersion" to 1, "attemptId" to "attempt_2", "checksum" to "a".repeat(64),
                    "playlists" to listOf(mapOf("playlistId" to "road", "title" to "x", "position" to 0, "tracks" to listOf(mapOf("source" to "netease", "trackId" to "42", "title" to "x", "artist" to "y", "contentUri" to "content://private")))), "favorites" to emptyList<Map<String, String>>(), "remoteCollections" to emptyList<Map<String, String>>(), "queueCheckpoint" to emptyList<Map<String, String>>(), "lyricMetadata" to emptyList<Map<String, String>>(), "localEntries" to emptyList<Map<String, String>>(),
                ),
            ) == null,
        )
    }

    @Test fun bridge_rejects_fractional_and_non_finite_revision_numbers() {
        fun mutation(schema: Number, revision: Number) = mapOf(
            "schemaVersion" to schema,
            "requestId" to "bridge-number",
            "expectedRevision" to revision,
            "operation" to "createPlaylist",
            "payload" to mapOf("playlistId" to "p", "title" to "x"),
        )
        assertTrue(LibraryBridgeContract.parseMutation(mutation(1.5, 0)) is LibraryValidation.Rejected)
        assertTrue(LibraryBridgeContract.parseMutation(mutation(1, 0.5)) is LibraryValidation.Rejected)
        assertTrue(LibraryBridgeContract.parseMutation(mutation(Double.NaN, 0)) is LibraryValidation.Rejected)
        assertTrue(LibraryBridgeContract.parseMutation(mutation(1, Double.POSITIVE_INFINITY)) is LibraryValidation.Rejected)
        assertTrue(LibraryBridgeContract.parseBackup(mapOf(
            "schemaVersion" to 1.5,
            "expectedRevision" to 0,
            "mode" to "merge",
            "favorites" to emptyList<Any>(),
            "playlists" to emptyList<Any>(),
        )) == null)
    }
}
