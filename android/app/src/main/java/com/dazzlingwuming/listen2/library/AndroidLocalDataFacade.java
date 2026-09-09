package com.dazzlingwuming.listen2.library;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.data.LocalDataRepository;

import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Thin named seam for the versioned Android RPC owner. It intentionally exposes
 * no Android Uri, File, ParcelFileDescriptor, cache path, or media URL type.
 * Main-line bridge wiring can map its validated RPC DTOs to these semantic DTOs.
 */
public final class AndroidLocalDataFacade {
    private static final int MAX_PLAYLISTS = 500;
    private static final int MAX_TRACKS_PER_PLAYLIST = 5_000;
    private static final int MAX_FAVORITES = 5_000;
    private static final int MAX_ID_LENGTH = 160;
    private static final int MAX_TEXT_LENGTH = 320;
    private final LocalDataRepository repository;

    public AndroidLocalDataFacade(@NonNull LocalDataRepository repository) {
        this.repository = repository;
    }

    public LocalDataRepository.Result<List<LocalDataRepository.PlaylistView>> listPlaylists() { return repository.listPlaylists(); }
    public LocalDataRepository.Result<LocalDataRepository.PlaylistView> getPlaylist(String playlistId) { return repository.getPlaylist(playlistId); }
    public LocalDataRepository.Result<LocalDataRepository.PlaylistView> createPlaylist(String id, String name, List<LocalDataRepository.Track> tracks) { return repository.createPlaylist(id, name, tracks); }
    public LocalDataRepository.Result<LocalDataRepository.PlaylistView> replacePlaylist(String id, long revision, String name, List<LocalDataRepository.Track> tracks) { return repository.replacePlaylist(id, revision, name, tracks); }
    public LocalDataRepository.Result<Void> deletePlaylist(String id, long revision) { return repository.deletePlaylist(id, revision); }
    public LocalDataRepository.Result<Void> reorderPlaylists(List<String> ids) { return repository.reorderPlaylists(ids); }
    public LocalDataRepository.Result<LocalDataRepository.FavoriteView> setFavorite(LocalDataRepository.Track track, boolean wanted) { return repository.setFavorite(track, wanted); }
    public LocalDataRepository.Result<List<LocalDataRepository.FavoriteView>> listFavorites() { return repository.listFavorites(); }
    public LocalDataRepository.Result<LocalDataRepository.SafGrantView> recordSafGrant(LocalDataRepository.SafGrant grant) { return repository.recordSafGrant(grant); }
    public LocalDataRepository.Result<LocalDataRepository.SafGrantView> updateSafGrantState(String id, String state) { return repository.updateSafGrantState(id, state); }
    public LocalDataRepository.Result<List<LocalDataRepository.SafGrantView>> listSafGrants() { return repository.listSafGrants(); }
    /** Called only by the Android SAF scanner; LocalTrackInput holds the native document URI. */
    public LocalDataRepository.Result<List<LocalDataRepository.LocalTrackView>> replaceLocalMediaTracks(
            String grantReferenceId, List<LocalDataRepository.LocalTrackInput> inputs) {
        return repository.replaceLocalMediaTracks(grantReferenceId, inputs);
    }
    public LocalDataRepository.Result<List<LocalDataRepository.LocalTrackView>> listLocalMediaTracks() { return repository.listLocalMediaTracks(); }
    public LocalDataRepository.Result<Void> clearLocalMediaTracksForGrant(String grantReferenceId) { return repository.clearLocalMediaTracksForGrant(grantReferenceId); }
    public LocalDataRepository.Result<LocalDataRepository.HistoryStatus> setHistoryEnabled(boolean enabled) { return repository.setHistoryEnabled(enabled); }
    public LocalDataRepository.Result<LocalDataRepository.HistoryIngest> ingestHistory(LocalDataRepository.HistoryInput input) { return repository.ingestHistory(input); }
    public LocalDataRepository.Result<LocalDataRepository.AnnualSummary> annualSummary(int year) { return repository.annualSummary(year); }
    public LocalDataRepository.Result<List<LocalDataRepository.HistoryExport>> exportHistory(int year) { return repository.exportHistory(year); }
    public LocalDataRepository.Result<Void> clearHistory() { return repository.clearHistory(); }
    public LocalDataRepository.Result<LocalDataRepository.CacheView> recordCache(LocalDataRepository.CacheRequest request) { return repository.recordCache(request); }
    public LocalDataRepository.Result<LocalDataRepository.CacheSummary> cacheSummary() { return repository.cacheSummary(); }
    public LocalDataRepository.Result<LocalDataRepository.CacheSummary> refreshCacheIntegrity() { return repository.refreshCacheIntegrity(); }
    public LocalDataRepository.Result<LocalDataRepository.CacheSummary> setCacheCapacity(long bytes) { return repository.setCacheCapacity(bytes); }
    public LocalDataRepository.Result<LocalDataRepository.DirectoryStatus> setCacheDirectoryState(String state) { return repository.setCacheDirectoryState(state); }
    public LocalDataRepository.DirectoryStatus cacheDirectoryStatus() { return repository.cacheDirectoryStatus(); }
    public LocalDataRepository.Result<LocalDataRepository.SettingsView> updateSettings(LocalDataRepository.SettingsInput input) { return repository.updateSettings(input); }
    public LocalDataRepository.SettingsView settings() { return repository.settings(); }
    public LocalDataRepository.Backup exportBackup() { return repository.exportBackup(); }
    public LocalDataRepository.Result<LocalDataRepository.BackupPreview> previewBackup(LocalDataRepository.Backup backup) { return repository.previewBackup(backup); }
    public LocalDataRepository.Result<LocalDataRepository.BackupPreview> importBackup(LocalDataRepository.Backup backup, String mode, boolean confirmed) { return repository.importBackup(backup, mode, confirmed); }

    /** Converts only the bridge's already parsed semantic playlist fields. No path/URI/credential slot exists. */
    public static BackupFactoryResult buildPageSafeBackup(PageBackupInput input) {
        if (input == null || input.playlists == null || input.favorites == null
                || input.playlists.size() > MAX_PLAYLISTS || input.favorites.size() > MAX_FAVORITES) {
            return BackupFactoryResult.error("INVALID_BACKUP_INPUT");
        }
        Set<String> playlistIds = new HashSet<>();
        Set<String> favoriteKeys = new HashSet<>();
        List<LocalDataRepository.PlaylistView> playlists = new ArrayList<>();
        List<LocalDataRepository.FavoriteView> favorites = new ArrayList<>();
        int ordinal = 0;
        for (PagePlaylistInput playlist : input.playlists) {
            if (playlist == null || !safeId(playlist.playlistId) || !safeText(playlist.name)
                    || playlist.tracks == null || playlist.tracks.size() > MAX_TRACKS_PER_PLAYLIST
                    || !playlistIds.add(playlist.playlistId)) return BackupFactoryResult.error("INVALID_BACKUP_INPUT");
            List<LocalDataRepository.Track> tracks = new ArrayList<>();
            Set<String> trackKeys = new HashSet<>();
            for (PageTrackInput track : playlist.tracks) {
                if (track == null || !safeId(track.source) || !safeId(track.providerTrackId)
                        || !safeText(track.title) || !safeText(track.artist) || track.durationMs < 0L
                        || track.durationMs > 28_800_000L || !trackKeys.add(track.source + ":" + track.providerTrackId)) {
                    return BackupFactoryResult.error("INVALID_BACKUP_INPUT");
                }
                tracks.add(new LocalDataRepository.Track(track.source, track.providerTrackId,
                        track.title, track.artist, track.durationMs));
            }
            playlists.add(new LocalDataRepository.PlaylistView(playlist.playlistId, playlist.name,
                    ordinal++, 0L, tracks));
        }
        for (PageFavoriteInput favorite : input.favorites) {
            if (favorite == null || !safeId(favorite.source) || !safeId(favorite.providerTrackId)
                    || !safeText(favorite.title) || !safeText(favorite.artist)
                    || !favoriteKeys.add(favorite.source + ":" + favorite.providerTrackId)) {
                return BackupFactoryResult.error("INVALID_BACKUP_INPUT");
            }
            favorites.add(new LocalDataRepository.FavoriteView(favorite.source, favorite.providerTrackId,
                    favorite.title, favorite.artist, 0L));
        }
        return BackupFactoryResult.ok(new LocalDataRepository.Backup(1, playlists, favorites));
    }

    public LocalDataRepository.Result<LocalDataRepository.BackupPreview> previewPageSafeBackup(PageBackupInput input) {
        BackupFactoryResult built = buildPageSafeBackup(input);
        return built.ok ? repository.previewBackup(built.backup) : LocalDataRepository.Result.error(built.status);
    }

    public LocalDataRepository.Result<LocalDataRepository.BackupPreview> importPageSafeBackup(
            PageBackupInput input, String mode, boolean confirmed) {
        BackupFactoryResult built = buildPageSafeBackup(input);
        return built.ok ? repository.importBackup(built.backup, mode, confirmed)
                : LocalDataRepository.Result.error(built.status);
    }

    private static boolean safeId(String value) {
        return value != null && value.length() > 0 && value.length() <= MAX_ID_LENGTH
                && value.matches("[A-Za-z0-9:._-]+") && !transportLike(value);
    }

    private static boolean safeText(String value) {
        return value != null && !value.trim().isEmpty() && value.length() <= MAX_TEXT_LENGTH
                && !value.contains("\n") && !value.contains("\r") && !transportLike(value);
    }

    private static boolean transportLike(String value) {
        String lower = value.toLowerCase(java.util.Locale.ROOT);
        return lower.contains("://") || lower.startsWith("file:") || lower.startsWith("content:")
                || value.startsWith("/") || value.startsWith("\\") || value.matches("^[A-Za-z]:[\\\\/].*");
    }

    public static final class PageBackupInput {
        public final List<PagePlaylistInput> playlists;
        public final List<PageFavoriteInput> favorites;
        public PageBackupInput(List<PagePlaylistInput> playlists, List<PageFavoriteInput> favorites) {
            this.playlists = playlists == null ? null : Collections.unmodifiableList(new ArrayList<>(playlists));
            this.favorites = favorites == null ? null : Collections.unmodifiableList(new ArrayList<>(favorites));
        }
    }

    public static final class PagePlaylistInput {
        public final String playlistId;
        public final String name;
        public final List<PageTrackInput> tracks;
        public PagePlaylistInput(String playlistId, String name, List<PageTrackInput> tracks) {
            this.playlistId = playlistId; this.name = name;
            this.tracks = tracks == null ? null : Collections.unmodifiableList(new ArrayList<>(tracks));
        }
    }

    public static final class PageTrackInput {
        public final String source;
        public final String providerTrackId;
        public final String title;
        public final String artist;
        public final long durationMs;
        public PageTrackInput(String source, String providerTrackId, String title, String artist, long durationMs) {
            this.source = source; this.providerTrackId = providerTrackId; this.title = title;
            this.artist = artist; this.durationMs = durationMs;
        }
    }

    public static final class PageFavoriteInput {
        public final String source;
        public final String providerTrackId;
        public final String title;
        public final String artist;
        public PageFavoriteInput(String source, String providerTrackId, String title, String artist) {
            this.source = source; this.providerTrackId = providerTrackId; this.title = title; this.artist = artist;
        }
    }

    public static final class BackupFactoryResult {
        public final boolean ok;
        public final String status;
        public final LocalDataRepository.Backup backup;
        private BackupFactoryResult(boolean ok, String status, LocalDataRepository.Backup backup) {
            this.ok = ok; this.status = status; this.backup = backup;
        }
        static BackupFactoryResult ok(LocalDataRepository.Backup backup) { return new BackupFactoryResult(true, "OK", backup); }
        static BackupFactoryResult error(String status) { return new BackupFactoryResult(false, status, null); }
    }
}
