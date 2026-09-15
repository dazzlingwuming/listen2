package com.listen2mobile.library

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

internal data class LegacyTrack(val source: String?, val trackId: String?, val title: String?, val artist: String?)
internal data class LegacyPlaylist(val playlistId: String?, val title: String?, val position: Int?, val tracks: List<LegacyTrack>?)
internal data class LegacyLocalEntry(val title: String?, val artist: String?)
internal data class LegacyQueueCheckpoint(val occurrenceId: String?, val position: Int?, val source: String?, val trackId: String?)
internal data class LegacyLyricMetadata(val source: String?, val trackId: String?, val selectedVariantId: String?, val offsetMillis: Long?)
/**
 * The remote collection field was added after the original migration contract. Keep it last and
 * optional so older in-process callers cannot accidentally reinterpret the positional fields.
 */
internal data class LegacyLibraryInput(
    val schemaVersion: Int,
    val playlists: List<LegacyPlaylist>?,
    val favorites: List<LegacyTrack>?,
    val queueCheckpoint: List<LegacyQueueCheckpoint>?,
    val lyricMetadata: List<LegacyLyricMetadata>?,
    val localEntries: List<LegacyLocalEntry>?,
    val remoteCollections: List<SafeRemoteCollection>? = null,
)
internal data class SafeLegacyPlaylist(val playlistId: String, val title: String, val position: Int, val tracks: List<SafeTrack>)
internal data class SafeLegacyLocalRecord(val title: String, val artist: String)
internal data class SafeLegacyInput(
    val playlists: List<SafeLegacyPlaylist>,
    val favorites: List<SafeTrack>,
    val queueCheckpoint: List<SafeQueueCheckpoint>,
    val lyricMetadata: List<SafeLyricMetadata>,
    val localRecords: List<SafeLegacyLocalRecord>,
    val remoteCollections: List<SafeRemoteCollection> = emptyList(),
)
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
            preferences.markFailed(attemptId)
            return MigrationResult.Rejected("MIGRATION_WRITE_FAILED")
        }
        if (journal.phase != "validated" || journal.checksum != checksum || !journal.sourceRetained) {
            preferences.markFailed(attemptId)
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
        // A null list is a partial source record, not an empty collection. The
        // JS bridge always supplies all lists (using [] for genuinely absent
        // optional legacy fields), so activating here with defaults could only
        // hide a truncated read and lose data.
        val playlists = input.playlists ?: return null
        val localEntries = input.localEntries ?: return null
        val favorites = input.favorites ?: return null
        val queue = input.queueCheckpoint ?: return null
        val lyrics = input.lyricMetadata ?: return null
        // Remote metadata was added after the original in-process contract;
        // an omitted field is safe only because it contains no legacy rows in
        // that older caller, while all core lists above remain mandatory.
        val remote = input.remoteCollections ?: emptyList()
        if (playlists.size > LibraryLimits.MAX_PLAYLISTS || localEntries.size > LibraryLimits.MAX_PLAYLISTS || favorites.size > 50_000 || queue.size > 50_000 || lyrics.size > 50_000 || remote.size > LibraryLimits.MAX_PLAYLISTS) return null
        fun text(value: String?, fallback: String): String = value?.trim()?.takeIf { it.isNotEmpty() }?.take(128) ?: fallback
        fun track(value: LegacyTrack, localAllowed: Boolean = true): SafeTrack? {
            val source = value.source ?: return null; val id = value.trackId ?: return null
            if (source !in setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") || (!localAllowed && source == "local") || !id.matches(Regex("^[A-Za-z0-9._:-]{1,128}$"))) return null
            return SafeTrack(source, id, text(value.title, "未知歌曲"), text(value.artist, "未知艺人"))
        }
        val parsedPlaylists = playlists.mapIndexed { index, item ->
            val id = item.playlistId?.takeIf { it.matches(Regex("^[A-Za-z0-9._:-]{1,64}$")) } ?: "legacy_playlist_$index"
            val rawTracks = item.tracks ?: return@mapIndexed null
            val safeTracks = rawTracks.map { track(it) ?: return@mapIndexed null }
            SafeLegacyPlaylist(id, text(item.title, "未命名歌单"), index, safeTracks.distinctBy { "${it.source}:${it.trackId}" })
        }
        if (parsedPlaylists.any { it == null }) return null
        val safePlaylists = parsedPlaylists.filterNotNull()
        if (safePlaylists.map { it.playlistId }.distinct().size != safePlaylists.size) return null
        val parsedFavorites = favorites.map { track(it, false) }
        if (parsedFavorites.any { it == null }) return null
        val safeFavorites = parsedFavorites.filterNotNull()
        if (safeFavorites.map { "${it.source}:${it.trackId}" }.distinct().size != safeFavorites.size) return null
        val parsedQueue = queue.mapIndexed { index, item ->
            val source = item.source ?: return@mapIndexed null
            val trackId = item.trackId ?: return@mapIndexed null
            if (source !in setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") || !trackId.matches(Regex("^[A-Za-z0-9._:-]{1,128}$"))) return@mapIndexed null
            SafeQueueCheckpoint(item.occurrenceId?.takeIf { it.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) } ?: "legacy_queue_$index", index, source, trackId)
        }
        if (parsedQueue.any { it == null }) return null
        val safeQueue = parsedQueue.filterNotNull()
        if (safeQueue.map { it.occurrenceId }.distinct().size != safeQueue.size) return null
        val parsedLyrics = lyrics.map { item ->
            val source = item.source ?: return@map null
            val trackId = item.trackId ?: return@map null
            val offset = item.offsetMillis ?: return@map null
            if (source !in setOf("netease", "kugou", "kuwo", "qq", "bilibili", "local") || !trackId.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) || kotlin.math.abs(offset) > 86_400_000) return@map null
            SafeLyricMetadata(source, trackId, item.selectedVariantId?.takeIf { it.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) }, offset)
        }
        if (parsedLyrics.any { it == null }) return null
        val safeLyrics = parsedLyrics.filterNotNull()
        if (safeLyrics.map { "${it.source}:${it.trackId}" }.distinct().size != safeLyrics.size) return null
        val parsedRemote = remote.map { item ->
            if (!item.collectionId.matches(Regex("^[A-Za-z0-9._:-]{1,128}$")) || item.source !in setOf("netease", "kugou", "kuwo", "qq", "bilibili") || item.title.isBlank() || item.title.length > LibraryLimits.MAX_TITLE || item.syncState !in setOf("ready", "refreshing", "error", "unavailable")) return@map null
            item
        }
        if (parsedRemote.any { it == null }) return null
        val safeRemote = parsedRemote.filterNotNull()
        if (safeRemote.map { it.collectionId }.distinct().size != safeRemote.size) return null
        return SafeLegacyInput(
            safePlaylists.mapIndexed { index, item -> item.copy(position = index) },
            safeFavorites,
            safeQueue,
            safeLyrics,
            localEntries.map { SafeLegacyLocalRecord(text(it.title, "未知本地音乐"), text(it.artist, "未知艺人")) },
            safeRemote,
        )
    }

    companion object {
    internal fun checksum(input: SafeLegacyInput): String {
        fun field(value: Any?) = "${value?.toString()?.length ?: 0}:${value ?: ""}"
        val canonical = buildString {
            input.playlists.forEach { playlist -> append('p').append(field(playlist.playlistId)).append(field(playlist.title)).append(field(playlist.position)).append('\n'); playlist.tracks.forEach { append('t').append(field(it.source)).append(field(it.trackId)).append(field(it.title)).append(field(it.artist)).append('\n') } }
            input.favorites.forEach { append('f').append(field(it.source)).append(field(it.trackId)).append(field(it.title)).append(field(it.artist)).append('\n') }
            input.remoteCollections.forEach { append('r').append(field(it.collectionId)).append(field(it.source)).append(field(it.title)).append(field(it.syncState)).append('\n') }
            input.queueCheckpoint.forEach { append('q').append(field(it.occurrenceId)).append(field(it.position)).append(field(it.source)).append(field(it.trackId)).append('\n') }
            input.lyricMetadata.forEach { append('y').append(field(it.source)).append(field(it.trackId)).append(field(it.selectedVariantId)).append(field(it.offsetMillis)).append('\n') }
            input.localRecords.forEach { append('l').append(field(it.title)).append(field(it.artist)).append('\n') }
        }
        return MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
    }
}
