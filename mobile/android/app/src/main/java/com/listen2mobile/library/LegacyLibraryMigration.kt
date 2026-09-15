package com.listen2mobile.library

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

internal data class LegacyPlaylist(val title: String?)
internal data class LegacyLocalEntry(val title: String?, val artist: String?)
internal data class LegacyLibraryInput(val schemaVersion: Int, val playlists: List<LegacyPlaylist>?, val localEntries: List<LegacyLocalEntry>?)
internal data class SafeLegacyPlaylist(val title: String)
internal data class SafeLegacyLocalRecord(val title: String, val artist: String)
internal sealed class MigrationResult {
    data class Activated(val status: MigrationStatus) : MigrationResult()
    data class Rejected(val errorCode: String) : MigrationResult()
}

/**
 * The old source remains external to this component. A crash before activation leaves DataStore
 * on `legacy`; a retry replaces only this attempt's stage rows and cannot duplicate them.
 */
internal class LegacyLibraryMigration(private val repository: LibraryRepository, private val preferences: LibraryPreferences) {
    suspend fun migrate(input: LegacyLibraryInput, attemptId: String): MigrationResult {
        val normalized = normalize(input, attemptId) ?: return MigrationResult.Rejected("INVALID_LEGACY_DATA")
        preferences.markStaging(attemptId)
        val checksum = checksum(normalized.first, normalized.second)
        val journal = try { repository.stageLegacyCopy(attemptId, normalized.first, normalized.second, checksum) } catch (_: Exception) {
            return MigrationResult.Rejected("MIGRATION_WRITE_FAILED")
        }
        if (journal.phase != "validated" || journal.checksum != checksum || !journal.sourceRetained) {
            return MigrationResult.Rejected("MIGRATION_VALIDATION_FAILED")
        }
        preferences.activate(attemptId, checksum)
        return MigrationResult.Activated(preferences.status())
    }

    suspend fun validateLaterStartup(): MigrationStatus {
        val status = preferences.status()
        val journal = status.attemptId?.let(repository::migrationJournal)
        if (status.backend == "room" && status.phase == "active" && journal?.checksum == status.checksum && journal?.sourceRetained == true) {
            preferences.markLaterStartupValidated()
        }
        return preferences.status()
    }

    private fun normalize(input: LegacyLibraryInput, attemptId: String): Pair<List<SafeLegacyPlaylist>, List<SafeLegacyLocalRecord>>? {
        if (!attemptId.matches(Regex("^[A-Za-z0-9_-]{1,64}$")) || input.schemaVersion !in 0..1) return null
        val playlists = input.playlists ?: emptyList()
        val localEntries = input.localEntries ?: emptyList()
        if (playlists.size > LibraryLimits.MAX_PLAYLISTS || localEntries.size > LibraryLimits.MAX_PLAYLISTS) return null
        fun text(value: String?, fallback: String): String = value?.trim()?.takeIf { it.isNotEmpty() }?.take(128) ?: fallback
        return playlists.map { SafeLegacyPlaylist(text(it.title, "未命名歌单")) } to
            localEntries.map { SafeLegacyLocalRecord(text(it.title, "未知本地音乐"), text(it.artist, "未知艺人")) }
    }

    private fun checksum(playlists: List<SafeLegacyPlaylist>, localRecords: List<SafeLegacyLocalRecord>): String {
        val canonical = buildString {
            playlists.forEach { append("p:").append(it.title).append('\n') }
            localRecords.forEach { append("l:").append(it.title).append('|').append(it.artist).append('\n') }
        }
        return MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
