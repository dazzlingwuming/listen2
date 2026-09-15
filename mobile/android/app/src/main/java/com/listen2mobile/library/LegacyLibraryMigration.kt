package com.listen2mobile.library

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

internal data class LegacyTrack(val source: String?, val trackId: String?, val title: String?, val artist: String?)
internal data class LegacyPlaylist(val playlistId: String?, val title: String?, val position: Int?, val tracks: List<LegacyTrack>?)
internal data class LegacyLocalEntry(val title: String?, val artist: String?)
internal data class LegacyQueueCheckpoint(val occurrenceId: String?, val position: Int?, val source: String?, val trackId: String?)
internal data class LegacyLyricMetadata(val source: String?, val trackId: String?, val selectedVariantId: String?, val offsetMillis: Long?)
internal data class LegacyLibraryInput(val schemaVersion: Int, val playlists: List<LegacyPlaylist>?, val favorites: List<LegacyTrack>?, val queueCheckpoint: List<LegacyQueueCheckpoint>?, val lyricMetadata: List<LegacyLyricMetadata>?, val localEntries: List<LegacyLocalEntry>?)
internal data class SafeLegacyPlaylist(val playlistId: String, val title: String, val position: Int, val tracks: List<SafeTrack>)
internal data class SafeLegacyLocalRecord(val title: String, val artist: String)
internal data class SafeLegacyInput(val playlists: List<SafeLegacyPlaylist>, val favorites: List<SafeTrack>, val queueCheckpoint: List<SafeQueueCheckpoint>, val lyricMetadata: List<SafeLyricMetadata>, val localRecords: List<SafeLegacyLocalRecord>)
internal sealed class MigrationResult {
    data class Activated(val status: MigrationStatus) : MigrationResult()
    data class Rejected(val errorCode: String) : MigrationResult()
}

/**
 * The old source remains external to this component. A crash before activation leaves DataStore
 * on `legacy`; a retry replaces only this attempt's stage rows and cannot duplicate them.
 */
internal class LegacyLibraryMigration(private val repository: LibraryRepository, private val preferences: LibraryPreferences) {
    suspend fun migrate(input: LegacyLibraryInput, attemptId: String, expectedChecksum: String? = null): MigrationResult {
        val normalized = normalize(input, attemptId) ?: return MigrationResult.Rejected("INVALID_LEGACY_DATA")
        val checksum = checksum(normalized)
        if (expectedChecksum != null && checksum != expectedChecksum) return MigrationResult.Rejected("MIGRATION_CHECKSUM_MISMATCH")
        preferences.markStaging(attemptId)
        val journal = try { repository.stageLegacyCopy(attemptId, normalized, checksum) } catch (_: Exception) {
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
        if (status.backend == "room" && status.phase == "active" && journal?.checksum == status.checksum && journal?.sourceRetained == true && status.checksum == repository.migrationReadbackChecksum(status.attemptId)) {
            preferences.markLaterStartupValidated()
        }
        return preferences.status()
    }

    private fun normalize(input: LegacyLibraryInput, attemptId: String): SafeLegacyInput? {
        if (!attemptId.matches(Regex("^[A-Za-z0-9_-]{1,64}$")) || input.schemaVersion !in 0..1) return null
        val playlists = input.playlists ?: emptyList()
        val localEntries = input.localEntries ?: emptyList(); val favorites = input.favorites ?: emptyList()
        val queue = input.queueCheckpoint ?: emptyList(); val lyrics = input.lyricMetadata ?: emptyList()
        if (playlists.size > LibraryLimits.MAX_PLAYLISTS || localEntries.size > LibraryLimits.MAX_PLAYLISTS || favorites.size > 50_000 || queue.size > 50_000 || lyrics.size > 50_000) return null
        fun text(value: String?, fallback: String): String = value?.trim()?.takeIf { it.isNotEmpty() }?.take(128) ?: fallback
        fun track(value: LegacyTrack, localAllowed: Boolean = true): SafeTrack? {
            val source = value.source ?: return null; val id = value.trackId ?: return null
            if (source !in setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") || (!localAllowed && source == "local") || !id.matches(Regex("^[A-Za-z0-9._:-]{1,128}$"))) return null
            return SafeTrack(source, id, text(value.title, "未知歌曲"), text(value.artist, "未知艺人"))
        }
        val safePlaylists = playlists.mapIndexed { index, item ->
            val id = item.playlistId?.takeIf { it.matches(Regex("^[A-Za-z0-9._:-]{1,64}$")) } ?: "legacy_playlist_$index"
            SafeLegacyPlaylist(id, text(item.title, "未命名歌单"), index, (item.tracks ?: emptyList()).mapNotNull(::track).distinctBy { "${it.source}:${it.trackId}" })
        }.distinctBy { it.playlistId }.mapIndexed { index, item -> item.copy(position = index) }
        val safeFavorites = favorites.mapNotNull { track(it, false) }.distinctBy { "${it.source}:${it.trackId}" }
        val safeQueue = queue.mapIndexedNotNull { index, item ->
            if (item.source !in setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") || item.trackId?.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) != true) null
            else SafeQueueCheckpoint(item.occurrenceId?.takeIf { it.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) } ?: "legacy_queue_$index", index, requireNotNull(item.source), requireNotNull(item.trackId))
        }.distinctBy { it.occurrenceId }
        val safeLyrics = lyrics.mapNotNull { item ->
            if (item.source !in setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") || item.trackId?.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) != true || item.offsetMillis == null || kotlin.math.abs(item.offsetMillis) > 86_400_000) null
            else SafeLyricMetadata(requireNotNull(item.source), requireNotNull(item.trackId), item.selectedVariantId?.takeIf { it.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) }, requireNotNull(item.offsetMillis))
        }.distinctBy { "${it.source}:${it.trackId}" }
        return SafeLegacyInput(safePlaylists, safeFavorites, safeQueue, safeLyrics, localEntries.map { SafeLegacyLocalRecord(text(it.title, "未知本地音乐"), text(it.artist, "未知艺人")) })
    }

    companion object {
    internal fun checksum(input: SafeLegacyInput): String {
        val canonical = buildString {
            input.playlists.forEach { playlist -> append("p:").append(playlist.playlistId).append('|').append(playlist.title).append('|').append(playlist.position).append('\n'); playlist.tracks.forEach { append("t:").append(it.source).append('|').append(it.trackId).append('|').append(it.title).append('|').append(it.artist).append('\n') } }
            input.favorites.forEach { append("f:").append(it.source).append('|').append(it.trackId).append('|').append(it.title).append('|').append(it.artist).append('\n') }
            input.queueCheckpoint.forEach { append("q:").append(it.occurrenceId).append('|').append(it.position).append('|').append(it.source).append('|').append(it.trackId).append('\n') }
            input.lyricMetadata.forEach { append("y:").append(it.source).append('|').append(it.trackId).append('|').append(it.selectedVariantId ?: "").append('|').append(it.offsetMillis).append('\n') }
            input.localRecords.forEach { append("l:").append(it.title).append('|').append(it.artist).append('\n') }
        }
        var hash = 0x811c9dc5.toInt()
        canonical.forEach { character ->
            hash = hash xor character.code
            hash *= 0x01000193
        }
        return "fnv1a-%08x".format(hash)
    }
    }
}
