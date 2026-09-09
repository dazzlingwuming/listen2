package com.dazzlingwuming.listen2.data;

import androidx.annotation.NonNull;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Transactional local-data boundary for the Android bridge.  All public views are
 * semantic: persisted SAF URIs and cache file locations never leave this class.
 * The caller supplies an I/O port, so a download/catalogue write cannot claim a
 * file exists until the native owner has independently inspected it.
 */
public final class LocalDataRepository {
    public static final String OK = "OK";
    public static final String INVALID_INPUT = "INVALID_INPUT";
    public static final String NOT_FOUND = "NOT_FOUND";
    public static final String STALE_REVISION = "STALE_REVISION";
    public static final String CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED";
    public static final String GRANT_INVALID = "GRANT_INVALID";
    public static final String NEEDS_REPAIR = "NEEDS_REPAIR";
    public static final String CORRUPT = "CORRUPT";
    public static final String IO_UNAVAILABLE = "IO_UNAVAILABLE";
    public static final String INTEGRITY_FAILED = "INTEGRITY_FAILED";
    public static final String DISABLED = "DISABLED";
    public static final String PARTIAL = "PARTIAL";
    private static final int MAX_ID = 160;
    private static final int MAX_TITLE = 320;
    private static final int MAX_PLAYLISTS = 500;
    private static final int MAX_TRACKS = 5_000;
    private static final int MAX_CACHE_ENTRIES = 10_000;
    private static final int MAX_LOCAL_MEDIA_TRACKS = 5_000;
    private static final long MIN_CACHE_BYTES = 32L * 1024L * 1024L;
    private static final long MAX_CACHE_BYTES = 8L * 1024L * 1024L * 1024L;
    private static final String HISTORY_ENABLED = "history.enabled";
    private static final String CACHE_CAPACITY = "cache.capacityBytes";
    private static final String CACHE_DIRECTORY_STATE = "cache.directoryState";

    /** Native-only port. The page must never be given a path, URI, descriptor, or URL. */
    public interface MediaFilePort {
        Inspection inspect(String opaqueContentKey);
        boolean delete(String opaqueContentKey);
    }

    public static final class Inspection {
        public final String status;
        public final long byteCount;
        private Inspection(String status, long byteCount) { this.status = status; this.byteCount = byteCount; }
        public static Inspection ready(long byteCount) { return new Inspection(OK, byteCount); }
        public static Inspection unavailable() { return new Inspection(IO_UNAVAILABLE, 0L); }
        public static Inspection corrupt() { return new Inspection(CORRUPT, 0L); }
    }

    private final Listen2Database database;
    private final Listen2Dao dao;
    private final MediaFilePort files;
    private final Clock clock;

    public interface Clock { long nowMs(); }
    public LocalDataRepository(@NonNull Listen2Database database, @NonNull MediaFilePort files) {
        this(database, files, System::currentTimeMillis);
    }
    public LocalDataRepository(@NonNull Listen2Database database, @NonNull MediaFilePort files, @NonNull Clock clock) {
        this.database = database; this.dao = database.listen2Dao(); this.files = files; this.clock = clock;
    }

    public Result<PlaylistView> createPlaylist(String playlistId, String name, List<Track> tracks) {
        if (!safeId(playlistId) || !safeText(name, MAX_TITLE) || !validTracks(tracks)) return Result.error(INVALID_INPUT);
        final Result<PlaylistView>[] result = new Result[1];
        database.runInTransaction(() -> {
            if (dao.getPlaylist(playlistId) != null || dao.getPlaylists().size() >= MAX_PLAYLISTS) { result[0] = Result.error(INVALID_INPUT); return; }
            long now = clock.nowMs();
            DurableRecordEntities.PlaylistEntity entity = new DurableRecordEntities.PlaylistEntity(playlistId, name.trim(), dao.getPlaylists().size(), now, now, "custom", 1L);
            dao.upsertPlaylist(entity); dao.upsertPlaylistTracks(trackRows(playlistId, tracks)); result[0] = Result.ok(playlistView(entity, tracks));
        });
        return result[0] == null ? Result.error(CORRUPT) : result[0];
    }

    public Result<PlaylistView> getPlaylist(String playlistId) {
        if (!safeId(playlistId)) return Result.error(INVALID_INPUT);
        DurableRecordEntities.PlaylistEntity entity = dao.getPlaylist(playlistId);
        return entity == null ? Result.error(NOT_FOUND) : Result.ok(playlistView(entity, tracksFromRows(dao.getPlaylistTracks(playlistId))));
    }

    public Result<List<PlaylistView>> listPlaylists() {
        List<PlaylistView> views = new ArrayList<>();
        for (DurableRecordEntities.PlaylistEntity entity : dao.getPlaylists()) views.add(playlistView(entity, tracksFromRows(dao.getPlaylistTracks(entity.playlistId))));
        return Result.ok(Collections.unmodifiableList(views));
    }

    public Result<PlaylistView> replacePlaylist(String playlistId, long expectedRevision, String name, List<Track> tracks) {
        if (!safeId(playlistId) || expectedRevision < 0L || !safeText(name, MAX_TITLE) || !validTracks(tracks)) return Result.error(INVALID_INPUT);
        final Result<PlaylistView>[] result = new Result[1];
        database.runInTransaction(() -> {
            DurableRecordEntities.PlaylistEntity current = dao.getPlaylist(playlistId);
            if (current == null) { result[0] = Result.error(NOT_FOUND); return; }
            if (current.revision != expectedRevision) { result[0] = Result.error(STALE_REVISION, current.revision); return; }
            DurableRecordEntities.PlaylistEntity next = new DurableRecordEntities.PlaylistEntity(current.playlistId, name.trim(), current.ordinal, current.createdAtMs, clock.nowMs(), current.kind, current.revision + 1L);
            dao.upsertPlaylist(next); dao.deletePlaylistTracks(playlistId); dao.upsertPlaylistTracks(trackRows(playlistId, tracks)); result[0] = Result.ok(playlistView(next, tracks));
        });
        return result[0] == null ? Result.error(CORRUPT) : result[0];
    }

    public Result<Void> deletePlaylist(String playlistId, long expectedRevision) {
        if (!safeId(playlistId) || expectedRevision < 0L) return Result.error(INVALID_INPUT);
        final Result<Void>[] result = new Result[1];
        database.runInTransaction(() -> { DurableRecordEntities.PlaylistEntity p = dao.getPlaylist(playlistId); if (p == null) result[0] = Result.error(NOT_FOUND); else if (p.revision != expectedRevision) result[0] = Result.error(STALE_REVISION, p.revision); else { dao.deletePlaylist(playlistId); result[0] = Result.ok(null); } });
        return result[0] == null ? Result.error(CORRUPT) : result[0];
    }

    /** Reorders only an exact playlist set, preventing a hostile partial order from losing rows. */
    public Result<Void> reorderPlaylists(List<String> ids) {
        if (!validIdList(ids, MAX_PLAYLISTS)) return Result.error(INVALID_INPUT);
        final Result<Void>[] result = new Result[1];
        database.runInTransaction(() -> {
            List<DurableRecordEntities.PlaylistEntity> current = dao.getPlaylists(); Set<String> known = new HashSet<>(); for (DurableRecordEntities.PlaylistEntity p : current) known.add(p.playlistId);
            if (known.size() != ids.size() || !known.containsAll(ids)) { result[0] = Result.error(INVALID_INPUT); return; }
            long now = clock.nowMs(); for (int i = 0; i < ids.size(); i++) { DurableRecordEntities.PlaylistEntity p = dao.getPlaylist(ids.get(i)); dao.upsertPlaylist(new DurableRecordEntities.PlaylistEntity(p.playlistId, p.name, i, p.createdAtMs, now, p.kind, p.revision + 1L)); } result[0] = Result.ok(null);
        }); return result[0] == null ? Result.error(CORRUPT) : result[0];
    }

    public Result<FavoriteView> setFavorite(Track track, boolean wanted) {
        if (!validTrack(track)) return Result.error(INVALID_INPUT);
        final Result<FavoriteView>[] result = new Result[1];
        database.runInTransaction(() -> { DurableRecordEntities.FavoriteEntity old = dao.getFavorite(track.source, track.providerTrackId); if (!wanted) { if (old == null) result[0] = Result.error(NOT_FOUND); else { dao.deleteFavorite(track.source, track.providerTrackId); result[0] = Result.ok(null); } return; } if (old != null) { result[0] = Result.ok(favoriteView(old)); return; } DurableRecordEntities.FavoriteEntity next = new DurableRecordEntities.FavoriteEntity("fav." + track.source + "." + track.providerTrackId, track.source, track.providerTrackId, clock.nowMs(), track.title, track.artist); dao.upsertFavorite(next); result[0] = Result.ok(favoriteView(next)); });
        return result[0] == null ? Result.error(CORRUPT) : result[0];
    }

    public Result<List<FavoriteView>> listFavorites() { List<FavoriteView> out = new ArrayList<>(); for (DurableRecordEntities.FavoriteEntity e : dao.getFavorites()) out.add(favoriteView(e)); return Result.ok(Collections.unmodifiableList(out)); }

    /** Stores a native-only persisted SAF URI; view() deliberately does not contain either URI column. */
    public Result<SafGrantView> recordSafGrant(SafGrant grant) {
        if (grant == null || !safeId(grant.referenceId) || !safeSemanticText(grant.displayName, MAX_TITLE)
                || !validGrantKind(grant.grantKind) || !validGrantReferences(grant)) {
            return Result.error(INVALID_INPUT);
        }
        // Persist only the reference relevant to the selected grant kind. This
        // keeps document and tree permissions distinct even for callers using
        // the legacy four-argument SafGrant constructor.
        String treeReference = "tree".equals(grant.grantKind) ? grant.treeReference : "";
        String documentReference = "document".equals(grant.grantKind) ? grant.documentReference : "";
        DurableRecordEntities.SafReferenceEntity previous = dao.getSafReference(grant.referenceId);
        if (previous != null && previous.treeReference.equals(treeReference)
                && previous.documentReference.equals(documentReference)
                && previous.grantKind.equals(grant.grantKind) && "active".equals(previous.grantState)) {
            return Result.accepted("DUPLICATE", safView(previous));
        }
        DurableRecordEntities.SafReferenceEntity entity = new DurableRecordEntities.SafReferenceEntity(
                grant.referenceId, treeReference, documentReference, clock.nowMs(),
                grant.displayName.trim(), "active", grant.grantKind);
        dao.upsertSafReference(entity);
        return Result.accepted(previous == null ? OK : "REPAIRED", safView(entity));
    }
    public Result<SafGrantView> updateSafGrantState(String referenceId, String state) {
        if (!safeId(referenceId) || !("active".equals(state) || "needs-repair".equals(state) || "revoked".equals(state))) return Result.error(INVALID_INPUT);
        DurableRecordEntities.SafReferenceEntity old = dao.getSafReference(referenceId); if (old == null) return Result.error(NOT_FOUND); DurableRecordEntities.SafReferenceEntity next = new DurableRecordEntities.SafReferenceEntity(old.referenceId, old.treeReference, old.documentReference, clock.nowMs(), old.displayName, state, old.grantKind); dao.upsertSafReference(next); return Result.ok(safView(next));
    }
    public Result<List<SafGrantView>> listSafGrants() { List<SafGrantView> out = new ArrayList<>(); for (DurableRecordEntities.SafReferenceEntity e : dao.getSafReferences()) out.add(safView(e)); return Result.ok(Collections.unmodifiableList(out)); }

    /** Replaces one grant's native catalog atomically; document references remain write-only here. */
    public Result<List<LocalTrackView>> replaceLocalMediaTracks(String grantReferenceId,
            List<LocalTrackInput> inputs) {
        if (!safeId(grantReferenceId) || !validLocalTrackInputs(inputs)) return Result.error(INVALID_INPUT);
        for (LocalTrackInput input : inputs) {
            if (!grantReferenceId.equals(input.grantReferenceId)) return Result.error(INVALID_INPUT);
        }
        DurableRecordEntities.SafReferenceEntity grant = dao.getSafReference(grantReferenceId);
        if (grant == null) return Result.error(NOT_FOUND);
        if (!"active".equals(grant.grantState)) return Result.error(GRANT_INVALID);
        final List<LocalTrackView>[] result = new List[1];
        database.runInTransaction(() -> {
            dao.deleteLocalMediaTracksForGrant(grantReferenceId);
            List<DurableRecordEntities.LocalMediaTrackEntity> rows = new ArrayList<>();
            List<LocalTrackView> views = new ArrayList<>();
            long now = clock.nowMs();
            for (LocalTrackInput input : inputs) {
                rows.add(new DurableRecordEntities.LocalMediaTrackEntity(input.localTrackId,
                        grantReferenceId, input.opaqueReference, input.documentReference,
                        input.displayName, input.mimeType, input.byteCount, input.durationMs,
                        input.title, input.artist, input.embeddedCover, input.adjacentLrc,
                        "available", now));
                views.add(localTrackView(input));
            }
            if (!rows.isEmpty()) dao.upsertLocalMediaTracks(rows);
            result[0] = Collections.unmodifiableList(views);
        });
        return result[0] == null ? Result.error(INVALID_INPUT) : Result.ok(result[0]);
    }

    public Result<List<LocalTrackView>> listLocalMediaTracks() {
        List<LocalTrackView> views = new ArrayList<>();
        for (DurableRecordEntities.LocalMediaTrackEntity entity : dao.getAllLocalMediaTracks()) {
            DurableRecordEntities.SafReferenceEntity grant = dao.getSafReference(entity.grantReferenceId);
            if (grant != null) views.add(localTrackView(entity,
                    "active".equals(grant.grantState) ? entity.availability : grant.grantState));
        }
        return Result.ok(Collections.unmodifiableList(views));
    }

    public Result<Void> clearLocalMediaTracksForGrant(String grantReferenceId) {
        if (!safeId(grantReferenceId)) return Result.error(INVALID_INPUT);
        database.runInTransaction(() -> dao.deleteLocalMediaTracksForGrant(grantReferenceId));
        return Result.ok(null);
    }

    public Result<HistoryStatus> setHistoryEnabled(boolean enabled) { dao.upsertSetting(new DurableRecordEntities.SettingEntity(HISTORY_ENABLED, Boolean.toString(enabled), clock.nowMs())); return Result.ok(historyStatus()); }
    public HistoryStatus historyStatus() { DurableRecordEntities.SettingEntity e = dao.getSetting(HISTORY_ENABLED); return new HistoryStatus(e == null || !"false".equals(e.settingValue)); }
    public Result<HistoryIngest> ingestHistory(HistoryInput input) {
        if (!validHistory(input)) return Result.error(INVALID_INPUT); if (!historyStatus().enabled) return Result.error(DISABLED);
        final Result<HistoryIngest>[] result = new Result[1]; database.runInTransaction(() -> { DurableRecordEntities.ListeningHistoryEntity old = dao.getListeningHistory(input.sessionId); long prior = old == null ? 0L : old.cumulativePlayedMs; long delta = Math.max(0L, input.cumulativePlayedMs - prior); boolean qualified = (old != null && old.qualified) || input.cumulativePlayedMs >= qualificationThreshold(input.durationMs); if (delta == 0L && (old == null || qualified == old.qualified)) { result[0] = Result.ok(new HistoryIngest(0L, qualified, "duplicate")); return; } DurableRecordEntities.ListeningHistoryEntity next = new DurableRecordEntities.ListeningHistoryEntity(input.sessionId, input.track.source, input.track.providerTrackId, input.occurredAtMs, input.cumulativePlayedMs, input.sessionId, input.cumulativePlayedMs, qualified, input.track.title, input.track.artist); dao.upsertListeningHistory(next); result[0] = Result.ok(new HistoryIngest(delta, qualified, "recorded")); }); return result[0] == null ? Result.error(CORRUPT) : result[0];
    }
    public Result<AnnualSummary> annualSummary(int year) { if (year < 1970 || year > 3000) return Result.error(INVALID_INPUT); long from = utcYearStart(year); long until = utcYearStart(year + 1); long ms = 0L; int plays = 0; Set<String> tracks = new HashSet<>(); Set<String> artists = new HashSet<>(); for (DurableRecordEntities.ListeningHistoryEntity e : dao.getListeningHistoryBetween(from, until)) { ms += Math.max(0L, e.listenedDurationMs); if (e.qualified) plays++; tracks.add(e.source + ":" + e.providerTrackId); if (!e.artist.isEmpty()) artists.add(e.artist); } return Result.ok(new AnnualSummary(year, historyStatus().enabled, ms, plays, tracks.size(), artists.size())); }
    public Result<List<HistoryExport>> exportHistory(int year) { if (year < 1970 || year > 3000) return Result.error(INVALID_INPUT); List<HistoryExport> out = new ArrayList<>(); for (DurableRecordEntities.ListeningHistoryEntity e : dao.getListeningHistoryBetween(utcYearStart(year), utcYearStart(year + 1))) out.add(new HistoryExport(e.source, e.providerTrackId, e.title, e.artist, e.listenedAtMs, e.listenedDurationMs, e.qualified)); return Result.ok(Collections.unmodifiableList(out)); }
    public Result<Void> clearHistory() { database.runInTransaction(() -> dao.clearListeningHistory()); return Result.ok(null); }

    public Result<CacheView> recordCache(CacheRequest request) {
        if (request == null || !validTrack(request.track) || !safeId(request.cacheId) || !safeId(request.opaqueContentKey) || !validRetention(request.retention)) return Result.error(INVALID_INPUT);
        Inspection inspection = files.inspect(request.opaqueContentKey); if (inspection == null || !OK.equals(inspection.status)) return Result.error(inspection == null ? IO_UNAVAILABLE : inspection.status); if (inspection.byteCount <= 0L || inspection.byteCount != request.expectedBytes) return Result.error(INTEGRITY_FAILED);
        if (dao.getCacheEntriesByLru().size() >= MAX_CACHE_ENTRIES && dao.getCacheEntry(request.cacheId) == null) return Result.error(INVALID_INPUT);
        DurableRecordEntities.CacheCatalogEntity entity = new DurableRecordEntities.CacheCatalogEntity(request.cacheId, request.track.source, request.track.providerTrackId, request.opaqueContentKey, inspection.byteCount, clock.nowMs(), request.retention, "ready", clock.nowMs(), "verified"); dao.upsertCacheEntry(entity); return Result.ok(cacheView(entity));
    }
    /** Native-only explicit deletion. Both opaque identities must match the catalogue row. */
    public Result<Void> deleteCache(String cacheId, String opaqueContentKey) {
        if (!safeId(cacheId) || !safeId(opaqueContentKey)) return Result.error(INVALID_INPUT);
        DurableRecordEntities.CacheCatalogEntity current = dao.getCacheEntry(cacheId);
        if (current == null) return Result.error(NOT_FOUND);
        if (!opaqueContentKey.equals(current.contentKey)) return Result.error(INVALID_INPUT);
        if (!files.delete(opaqueContentKey)) return Result.error(IO_UNAVAILABLE);
        dao.deleteCacheEntry(cacheId);
        return Result.ok(null);
    }
    public Result<CacheSummary> cacheSummary() { long bytes = 0L; int corrupt = 0; List<CacheView> entries = new ArrayList<>(); for (DurableRecordEntities.CacheCatalogEntity e : dao.getCacheEntriesByLru()) { bytes += Math.max(0L, e.byteCount); if (!"ready".equals(e.state)) corrupt++; entries.add(cacheView(e)); } return Result.ok(new CacheSummary(cacheCapacity(), bytes, corrupt, Collections.unmodifiableList(entries))); }
    /** Re-checks opaque native files and records a usable corrupt state instead of silently dropping them. */
    public Result<CacheSummary> refreshCacheIntegrity() { boolean unavailable = false; for (DurableRecordEntities.CacheCatalogEntity e : dao.getCacheEntriesByLru()) { Inspection inspection = files.inspect(e.contentKey); if (inspection == null || IO_UNAVAILABLE.equals(inspection.status)) { unavailable = true; continue; } boolean valid = OK.equals(inspection.status) && inspection.byteCount == e.byteCount && inspection.byteCount > 0L; if (!valid) dao.upsertCacheEntry(new DurableRecordEntities.CacheCatalogEntity(e.cacheId, e.source, e.providerTrackId, e.contentKey, e.byteCount, clock.nowMs(), e.retention, "corrupt", e.lastAccessedAtMs, "failed")); } Result<CacheSummary> summary = cacheSummary(); return unavailable ? Result.withStatus(PARTIAL, summary.value) : summary; }
    public Result<CacheSummary> setCacheCapacity(long bytes) { if (bytes < MIN_CACHE_BYTES || bytes > MAX_CACHE_BYTES) return Result.error(INVALID_INPUT); dao.upsertSetting(new DurableRecordEntities.SettingEntity(CACHE_CAPACITY, Long.toString(bytes), clock.nowMs())); return trimCache(); }
    /** Persists only an availability classification, never a directory path or tree URI. */
    public Result<DirectoryStatus> setCacheDirectoryState(String state) { if (!("ready".equals(state) || "unavailable".equals(state) || "read-only".equals(state))) return Result.error(INVALID_INPUT); dao.upsertSetting(new DurableRecordEntities.SettingEntity(CACHE_DIRECTORY_STATE, state, clock.nowMs())); return Result.ok(cacheDirectoryStatus()); }
    public DirectoryStatus cacheDirectoryStatus() { return new DirectoryStatus(setting(CACHE_DIRECTORY_STATE, "unavailable")); }
    public Result<CacheSummary> trimCache() { long capacity = cacheCapacity(); List<DurableRecordEntities.CacheCatalogEntity> rows = dao.getCacheEntriesByLru(); long used = 0L; for (DurableRecordEntities.CacheCatalogEntity e : rows) used += Math.max(0L, e.byteCount); boolean failed = false; for (DurableRecordEntities.CacheCatalogEntity e : rows) { if (used <= capacity || "download".equals(e.retention)) continue; if (files.delete(e.contentKey)) { dao.deleteCacheEntry(e.cacheId); used -= Math.max(0L, e.byteCount); } else failed = true; } Result<CacheSummary> summary = cacheSummary(); return failed ? Result.withStatus(PARTIAL, summary.value) : summary; }

    public Result<SettingsView> updateSettings(SettingsInput input) { if (input == null || !validSetting(input.theme, 32) || !validSetting(input.language, 32)) return Result.error(INVALID_INPUT); dao.upsertSetting(new DurableRecordEntities.SettingEntity("ui.theme", input.theme, clock.nowMs())); dao.upsertSetting(new DurableRecordEntities.SettingEntity("ui.language", input.language, clock.nowMs())); return Result.ok(settings()); }
    public SettingsView settings() { return new SettingsView(setting("ui.theme", "system"), setting("ui.language", "system"), historyStatus().enabled, cacheCapacity()); }

    public Backup exportBackup() { List<PlaylistView> playlists = listPlaylists().value; List<FavoriteView> favorites = listFavorites().value; return new Backup(1, playlists == null ? Collections.emptyList() : playlists, favorites == null ? Collections.emptyList() : favorites); }
    public Result<BackupPreview> previewBackup(Backup backup) { if (!validBackup(backup)) return Result.error(INVALID_INPUT); int tracks = 0; for (PlaylistView p : backup.playlists) tracks += p.tracks.size(); return Result.ok(new BackupPreview(backup.playlists.size(), backup.favorites.size(), tracks)); }
    public Result<BackupPreview> importBackup(Backup backup, String mode, boolean overwriteConfirmed) { Result<BackupPreview> preview = previewBackup(backup); if (!preview.ok) return preview; if (!("merge".equals(mode) || "overwrite".equals(mode))) return Result.error(INVALID_INPUT); if ("overwrite".equals(mode) && !overwriteConfirmed) return Result.error(CONFIRMATION_REQUIRED); final Result<BackupPreview>[] result = new Result[1]; database.runInTransaction(() -> { if ("overwrite".equals(mode)) { for (DurableRecordEntities.PlaylistEntity p : dao.getPlaylists()) dao.deletePlaylist(p.playlistId); dao.clearFavorites(); } for (PlaylistView p : backup.playlists) { DurableRecordEntities.PlaylistEntity existing = dao.getPlaylist(p.playlistId); if (existing != null && "merge".equals(mode)) continue; long now = clock.nowMs(); dao.upsertPlaylist(new DurableRecordEntities.PlaylistEntity(p.playlistId, p.name, dao.getPlaylists().size(), now, now, "custom", 1L)); dao.deletePlaylistTracks(p.playlistId); dao.upsertPlaylistTracks(trackRows(p.playlistId, p.tracks)); } for (FavoriteView f : backup.favorites) if (dao.getFavorite(f.source, f.providerTrackId) == null) dao.upsertFavorite(new DurableRecordEntities.FavoriteEntity("fav." + f.source + "." + f.providerTrackId, f.source, f.providerTrackId, clock.nowMs(), f.title, f.artist)); result[0] = Result.ok(preview.value); }); return result[0] == null ? Result.error(CORRUPT) : result[0]; }

    private long cacheCapacity() { try { return Long.parseLong(setting(CACHE_CAPACITY, Long.toString(512L * 1024L * 1024L))); } catch (NumberFormatException ignored) { return 512L * 1024L * 1024L; } }
    private String setting(String key, String fallback) { DurableRecordEntities.SettingEntity e = dao.getSetting(key); return e == null ? fallback : e.settingValue; }
    private static List<DurableRecordEntities.PlaylistTrackEntity> trackRows(String id, List<Track> tracks) { List<DurableRecordEntities.PlaylistTrackEntity> out = new ArrayList<>(); for (int i = 0; i < tracks.size(); i++) { Track t = tracks.get(i); out.add(new DurableRecordEntities.PlaylistTrackEntity(id, i, t.source, t.providerTrackId, t.title, t.artist, t.durationMs)); } return out; }
    private static List<Track> tracksFromRows(List<DurableRecordEntities.PlaylistTrackEntity> rows) { List<Track> out = new ArrayList<>(); for (DurableRecordEntities.PlaylistTrackEntity e : rows) out.add(new Track(e.source, e.providerTrackId, e.title, e.artist, e.durationMs)); return Collections.unmodifiableList(out); }
    private static PlaylistView playlistView(DurableRecordEntities.PlaylistEntity e, List<Track> tracks) { return new PlaylistView(e.playlistId, e.name, e.ordinal, e.revision, tracks); }
    private static FavoriteView favoriteView(DurableRecordEntities.FavoriteEntity e) { return new FavoriteView(e.source, e.providerTrackId, e.title, e.artist, e.addedAtMs); }
    private static SafGrantView safView(DurableRecordEntities.SafReferenceEntity e) {
        return new SafGrantView(safePageId(e.referenceId),
                semanticOrFallback(e.displayName, "Selected music"),
                safeGrantState(e.grantState), safeGrantKind(e.grantKind), e.updatedAtMs);
    }
    private static LocalTrackView localTrackView(LocalTrackInput input) {
        return new LocalTrackView(input.localTrackId, input.grantReferenceId, input.displayName,
                input.mimeType, input.byteCount, input.durationMs, input.title, input.artist,
                input.embeddedCover, input.adjacentLrc, "available");
    }
    private static LocalTrackView localTrackView(DurableRecordEntities.LocalMediaTrackEntity e,
            String availability) {
        return new LocalTrackView(safePageId(e.localTrackId), safePageId(e.grantReferenceId),
                semanticOrFallback(e.displayName, "Unknown audio"), safeMimeOrFallback(e.mimeType),
                Math.max(0L, e.byteCount), Math.max(0L, Math.min(28_800_000L, e.durationMs)),
                semanticOrFallback(e.title, "Unknown title"),
                semanticOrFallback(e.artist, "Unknown artist"), e.embeddedCover, e.adjacentLrc,
                safeAvailability(availability));
    }
    private static CacheView cacheView(DurableRecordEntities.CacheCatalogEntity e) { return new CacheView(e.cacheId, e.source, e.providerTrackId, e.byteCount, e.retention, e.state, e.integrity, e.lastAccessedAtMs); }
    private static boolean safeId(String v) { return v != null && v.length() > 0 && v.length() <= MAX_ID && v.matches("[A-Za-z0-9:._-]+"); }
    private static boolean safeText(String v, int max) { return v != null && !v.trim().isEmpty() && v.length() <= max; }
    private static boolean safeSemanticText(String v, int max) {
        return safeText(v, max) && !v.contains("\n") && !v.contains("\r")
                && !looksLikeTransportOrPath(v);
    }
    private static String safePageId(String value) {
        return safeId(value) ? value : "unknown";
    }
    private static String semanticOrFallback(String value, String fallback) {
        return safeSemanticText(value, MAX_TITLE) ? value.trim() : fallback;
    }
    private static String safeMimeOrFallback(String value) {
        return safeMimeType(value) ? value : "application/octet-stream";
    }
    private static String safeAvailability(String value) {
        return "available".equals(value) || "needs-repair".equals(value)
                || "revoked".equals(value) ? value : "needs-repair";
    }
    private static String safeGrantState(String value) {
        return "active".equals(value) || "needs-repair".equals(value)
                || "revoked".equals(value) ? value : "needs-repair";
    }
    private static String safeGrantKind(String value) {
        return validGrantKind(value) ? value : "document";
    }
    private static boolean looksLikeTransportOrPath(String value) {
        String lower = value.toLowerCase(java.util.Locale.ROOT);
        return lower.contains("://") || lower.startsWith("file:") || lower.startsWith("content:")
                || value.startsWith("/") || value.startsWith("\\")
                || value.matches("^[A-Za-z]:[\\\\/].*");
    }
    private static boolean safeUri(String v) { return v != null && v.length() <= 4096 && v.startsWith("content://") && !v.contains("\n") && !v.contains("\r"); }
    private static boolean validGrantKind(String value) { return "document".equals(value) || "tree".equals(value); }
    private static boolean validGrantReferences(SafGrant grant) {
        if ("tree".equals(grant.grantKind)) {
            return safeUri(grant.treeReference)
                    && (isEmpty(grant.documentReference) || safeUri(grant.documentReference));
        }
        return (isEmpty(grant.treeReference) || safeUri(grant.treeReference))
                && safeUri(grant.documentReference);
    }
    private static boolean isEmpty(String value) { return value == null || value.isEmpty(); }
    private static boolean validLocalTrackInputs(List<LocalTrackInput> inputs) { if (inputs == null || inputs.size() > MAX_LOCAL_MEDIA_TRACKS) return false; Set<String> references = new HashSet<>(); Set<String> ids = new HashSet<>(); for (LocalTrackInput input : inputs) if (input == null || !validLocalTrackId(input.localTrackId) || !safeId(input.grantReferenceId) || !validOpaqueReference(input.opaqueReference) || !safeUri(input.documentReference) || !safeSemanticText(input.displayName, MAX_TITLE) || !safeMimeType(input.mimeType) || !safeSemanticText(input.title, MAX_TITLE) || !safeSemanticText(input.artist, MAX_TITLE) || input.byteCount < 0L || input.durationMs < 0L || input.durationMs > 28_800_000L || !ids.add(input.localTrackId) || !references.add(input.opaqueReference)) return false; return true; }
    private static boolean validLocalTrackId(String value) { return value != null && value.matches("local\\.track\\.[a-f0-9]{64}"); }
    private static boolean validOpaqueReference(String value) { return value != null && value.matches("local\\.[a-f0-9]{64}"); }
    private static boolean safeMimeType(String value) { return value != null && value.length() <= 128 && value.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+"); }
    private static boolean validSetting(String v, int max) { return v != null && v.length() > 0 && v.length() <= max && v.matches("[A-Za-z0-9_-]+"); }
    private static boolean validTrack(Track t) { return t != null && safeId(t.source) && safeId(t.providerTrackId) && t.durationMs >= 0L && t.durationMs <= 28_800_000L && (t.title == null || t.title.length() <= MAX_TITLE) && (t.artist == null || t.artist.length() <= MAX_TITLE); }
    private static boolean validTracks(List<Track> tracks) { if (tracks == null || tracks.size() > MAX_TRACKS) return false; Set<String> ids = new HashSet<>(); for (Track t : tracks) if (!validTrack(t) || !ids.add(t.source + ":" + t.providerTrackId)) return false; return true; }
    private static boolean validIdList(List<String> ids, int max) { if (ids == null || ids.size() > max) return false; Set<String> unique = new HashSet<>(); for (String id : ids) if (!safeId(id) || !unique.add(id)) return false; return true; }
    private static boolean validRetention(String value) { return "temporary".equals(value) || "playlist".equals(value) || "download".equals(value); }
    private static boolean validHistory(HistoryInput i) { return i != null && safeId(i.sessionId) && validTrack(i.track) && i.occurredAtMs > 0L && i.cumulativePlayedMs >= 0L && i.cumulativePlayedMs <= 28_800_000L && i.durationMs > 30_000L && i.durationMs <= 28_800_000L; }
    /** Same effective-play threshold as desktop history: half duration, capped at four minutes. */
    public static long qualificationThreshold(long durationMs) { return Math.min(durationMs / 2L, 240_000L); }
    private static long utcYearStart(int year) { return java.time.LocalDate.of(year, 1, 1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli(); }
    private static boolean validBackup(Backup b) { if (b == null || b.version != 1 || !validTracksInBackup(b.playlists) || b.favorites == null || b.favorites.size() > MAX_TRACKS) return false; for (FavoriteView f : b.favorites) if (f == null || !safeId(f.source) || !safeId(f.providerTrackId)) return false; return true; }
    private static boolean validTracksInBackup(List<PlaylistView> ps) { if (ps == null || ps.size() > MAX_PLAYLISTS) return false; Set<String> ids = new HashSet<>(); for (PlaylistView p : ps) if (p == null || !safeId(p.playlistId) || !safeText(p.name, MAX_TITLE) || !ids.add(p.playlistId) || !validTracks(p.tracks)) return false; return true; }

    public static final class Result<T> { public final boolean ok; public final String status; public final long revision; public final T value; private Result(boolean ok, String status, long revision, T value) { this.ok = ok; this.status = status; this.revision = revision; this.value = value; } static <T> Result<T> ok(T value) { return new Result<>(true, OK, -1L, value); } static <T> Result<T> accepted(String status, T value) { return new Result<>(true, status, -1L, value); } public static <T> Result<T> error(String status) { return new Result<>(false, status, -1L, null); } static <T> Result<T> error(String status, long revision) { return new Result<>(false, status, revision, null); } static <T> Result<T> withStatus(String status, T value) { return new Result<>(PARTIAL.equals(status), status, -1L, value); } }
    public static final class Track { public final String source, providerTrackId, title, artist; public final long durationMs; public Track(String source, String providerTrackId, String title, String artist, long durationMs) { this.source=source; this.providerTrackId=providerTrackId; this.title=title == null ? "" : title; this.artist=artist == null ? "" : artist; this.durationMs=durationMs; } }
    public static final class PlaylistView { public final String playlistId, name; public final int ordinal; public final long revision; public final List<Track> tracks; public PlaylistView(String id,String name,int ordinal,long revision,List<Track> tracks){this.playlistId=id;this.name=name;this.ordinal=ordinal;this.revision=revision;this.tracks=Collections.unmodifiableList(new ArrayList<>(tracks));} }
    public static final class FavoriteView { public final String source, providerTrackId, title, artist; public final long addedAtMs; public FavoriteView(String s,String id,String t,String a,long at){source=s;providerTrackId=id;title=t;artist=a;addedAtMs=at;} }
    public static final class SafGrant { public final String referenceId, treeReference, documentReference, displayName, grantKind; public SafGrant(String id,String tree,String doc,String name){this(id,tree,doc,name,"document");} public SafGrant(String id,String tree,String doc,String name,String kind){referenceId=id;treeReference=tree;documentReference=doc;displayName=name;grantKind=kind;} }
    public static final class SafGrantView { public final String referenceId, displayName, state, grantKind; public final long updatedAtMs; SafGrantView(String id,String name,String state,String kind,long at){referenceId=id;displayName=name;this.state=state;grantKind=kind;updatedAtMs=at;} }
    /** Semantic page DTO: the opaque native document reference is intentionally absent. */
    public static final class LocalTrackView { public final String localTrackId, grantReferenceId, displayName, mimeType, title, artist, availability; public final long byteCount, durationMs; public final boolean embeddedCover, adjacentLrc; LocalTrackView(String id,String grant,String name,String mime,long bytes,long duration,String title,String artist,boolean cover,boolean lrc,String availability){localTrackId=id;grantReferenceId=grant;displayName=name;mimeType=mime;byteCount=bytes;durationMs=duration;this.title=title;this.artist=artist;embeddedCover=cover;adjacentLrc=lrc;this.availability=availability;} }
    /** Native scanner input. documentReference never crosses AndroidLocalDataFacade. */
    public static final class LocalTrackInput { public final String localTrackId, grantReferenceId, opaqueReference, documentReference, displayName, mimeType, title, artist; public final long byteCount, durationMs; public final boolean embeddedCover, adjacentLrc; public LocalTrackInput(String id,String grant,String opaque,String document,String name,String mime,long bytes,long duration,String title,String artist,boolean cover,boolean lrc){localTrackId=id;grantReferenceId=grant;opaqueReference=opaque;documentReference=document;displayName=name;mimeType=mime;byteCount=bytes;durationMs=duration;this.title=title;this.artist=artist;embeddedCover=cover;adjacentLrc=lrc;} }
    public static final class HistoryStatus { public final boolean enabled; HistoryStatus(boolean enabled){this.enabled=enabled;} }
    public static final class HistoryInput { public final String sessionId; public final Track track; public final long cumulativePlayedMs, durationMs, occurredAtMs; public HistoryInput(String s,Track t,long c,long d,long at){sessionId=s;track=t;cumulativePlayedMs=c;durationMs=d;occurredAtMs=at;} }
    public static final class HistoryIngest { public final long deltaPlayedMs; public final boolean qualified; public final String disposition; HistoryIngest(long d,boolean q,String p){deltaPlayedMs=d;qualified=q;disposition=p;} }
    public static final class AnnualSummary { public final int year, uniqueTracks, uniqueArtists, playCount; public final boolean enabled; public final long playedMs; AnnualSummary(int y,boolean e,long ms,int p,int tracks,int artists){year=y;enabled=e;playedMs=ms;playCount=p;uniqueTracks=tracks;uniqueArtists=artists;} }
    public static final class HistoryExport { public final String source,providerTrackId,title,artist; public final long listenedAtMs,listenedDurationMs; public final boolean qualified; HistoryExport(String s,String id,String t,String a,long at,long d,boolean q){source=s;providerTrackId=id;title=t;artist=a;listenedAtMs=at;listenedDurationMs=d;qualified=q;} }
    public static final class CacheRequest { public final String cacheId,opaqueContentKey,retention; public final Track track; public final long expectedBytes; public CacheRequest(String id,Track t,String key,long bytes,String r){cacheId=id;track=t;opaqueContentKey=key;expectedBytes=bytes;retention=r;} }
    public static final class CacheView { public final String cacheId,source,providerTrackId,retention,state,integrity; public final long byteCount,lastAccessedAtMs; CacheView(String id,String s,String track,long b,String r,String state,String integrity,long access){cacheId=id;source=s;providerTrackId=track;byteCount=b;retention=r;this.state=state;this.integrity=integrity;lastAccessedAtMs=access;} }
    public static final class CacheSummary { public final long capacityBytes,usedBytes; public final int corruptEntries; public final List<CacheView> entries; CacheSummary(long c,long u,int corrupt,List<CacheView> e){capacityBytes=c;usedBytes=u;corruptEntries=corrupt;entries=e;} }
    public static final class DirectoryStatus { public final String state; DirectoryStatus(String state){this.state=state;} }
    public static final class SettingsInput { public final String theme,language; public SettingsInput(String theme,String language){this.theme=theme;this.language=language;} }
    public static final class SettingsView { public final String theme,language; public final boolean historyEnabled; public final long cacheCapacityBytes; SettingsView(String t,String l,boolean h,long c){theme=t;language=l;historyEnabled=h;cacheCapacityBytes=c;} }
    public static final class Backup { public final int version; public final List<PlaylistView> playlists; public final List<FavoriteView> favorites; public Backup(int v,List<PlaylistView> p,List<FavoriteView> f){version=v;playlists=Collections.unmodifiableList(new ArrayList<>(p));favorites=Collections.unmodifiableList(new ArrayList<>(f));} }
    public static final class BackupPreview { public final int playlists,favorites,tracks; BackupPreview(int p,int f,int t){playlists=p;favorites=f;tracks=t;} }
}
