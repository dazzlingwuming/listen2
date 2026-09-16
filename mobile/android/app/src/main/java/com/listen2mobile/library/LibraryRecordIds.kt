package com.listen2mobile.library

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * Local record IDs cross the native/React Native boundary. Keep the public form
 * narrower than the legacy migration attempt ID so every snapshot can be
 * consumed by local playback and the JS library projection.
 */
internal object LibraryRecordIds {
    private const val MIGRATION_PREFIX = "migration-"
    private const val MIGRATION_HASH_LENGTH = 48
    private val attemptPattern = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val recordPattern = Regex("^[A-Za-z0-9-]{16,64}$")
    private val legacyMigrationPattern = Regex("^migration-([A-Za-z0-9_-]{1,64})-([0-9]{1,4})$")
    private val readableMigrationPattern = Regex("^migration-([A-Za-z0-9-]{1,64})-([0-9]{1,4})$")
    private val hashedMigrationPattern = Regex("^migration-([a-f0-9]{48})-([0-9]{1,4})$")

    fun isValid(value: String): Boolean = recordPattern.matches(value)

    /**
     * Generates the ID used for a newly staged legacy local entry. Normal
     * attempt IDs remain recognizable; unusually long IDs use a bounded hash
     * suffix so the public contract never grows beyond 64 characters.
     */
    fun forMigration(attemptId: String, index: Int): String {
        require(attemptPattern.matches(attemptId)) { "invalid migration attempt" }
        require(index in 0 until LibraryLimits.MAX_PLAYLISTS) { "invalid migration index" }
        val readable = "$MIGRATION_PREFIX${attemptId.replace('_', '-')}-${index}"
        if (isValid(readable)) return readable
        return "$MIGRATION_PREFIX${sha256(attemptId).take(MIGRATION_HASH_LENGTH)}-$index"
    }

    /**
     * Converts a durable ID to the safe ID exposed in a library snapshot.
     * Older app versions wrote `migration-boot_<base36>-0`; those rows stay in
     * Room and are represented by the same deterministic hyphenated ID.
     */
    fun publicId(storedId: String): String {
        if (isValid(storedId)) return storedId
        val legacy = legacyMigrationPattern.matchEntire(storedId)
        val index = legacy?.groupValues?.get(2)?.toIntOrNull()
        if (legacy != null && index != null && index in 0 until LibraryLimits.MAX_PLAYLISTS) {
            return forMigration(legacy.groupValues[1], index)
        }
        // Unknown/corrupt old rows must remain visible without crossing the
        // boundary. The digest is deterministic and contains no source data.
        return "legacy-${sha256(storedId).take(56)}"
    }

    /**
     * Returns the migration-local index for either a new canonical row or an
     * old row written with an underscore. This lets readback and operations
     * recover legacy rows without rewriting or deleting their primary keys.
     */
    fun migrationIndex(storedId: String, attemptId: String): Int? {
        if (!attemptPattern.matches(attemptId)) return null
        val normalizedAttempt = attemptId.replace('_', '-')
        val legacy = legacyMigrationPattern.matchEntire(storedId)
        val legacyIndex = legacy?.groupValues?.get(2)?.toIntOrNull()
        if (legacy != null && legacyIndex != null && legacyIndex in 0 until LibraryLimits.MAX_PLAYLISTS && legacy.groupValues[1].replace('_', '-') == normalizedAttempt) {
            return legacyIndex
        }

        val readable = readableMigrationPattern.matchEntire(publicId(storedId))
        val readableIndex = readable?.groupValues?.get(2)?.toIntOrNull()
        if (readable != null && readableIndex != null && readableIndex in 0 until LibraryLimits.MAX_PLAYLISTS && readable.groupValues[1] == normalizedAttempt) {
            return readableIndex
        }

        val hashed = hashedMigrationPattern.matchEntire(publicId(storedId))
        val hashedIndex = hashed?.groupValues?.get(2)?.toIntOrNull()
        if (hashed != null && hashedIndex != null && hashedIndex in 0 until LibraryLimits.MAX_PLAYLISTS && hashed.groupValues[1] == sha256(attemptId).take(MIGRATION_HASH_LENGTH)) {
            return hashedIndex
        }
        return null
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
