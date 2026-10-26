package com.dazzlingwuming.listen2.library;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Desktop Listen1/Listen2 Gist format. Only semantic Bilibili tracks enter Room. */
public final class GitHubPlaylistCodec {
    public static final String FILE_NAME = "listen1_backup.json";
    public static final int MAX_BYTES = 4 * 1024 * 1024;
    static final String LOCAL_PREFIX = "myplaylist_android_local_";
    static final String FAVORITES_ID = "myplaylist_android_favorites";

    private GitHubPlaylistCodec() { }

    public static JSONObject empty() throws JSONException {
        return new JSONObject().put("format", "listen2-playlist-backup").put("version", 2)
                .put("exportedAt", Instant.now().toString()).put("playlists", new JSONArray())
                .put("favoritePlaylists", new JSONArray());
    }

    public static JSONObject parse(String text) throws JSONException {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES)
            throw new JSONException("BACKUP_TOO_LARGE");
        JSONObject raw = new JSONObject(text);
        JSONObject result = empty();
        if ("listen2-playlist-backup".equals(raw.optString("format"))) {
            if (raw.optInt("version") != 2) throw new JSONException("UNSUPPORTED_BACKUP_VERSION");
            result.put("playlists", raw.getJSONArray("playlists"));
            result.put("favoritePlaylists", raw.getJSONArray("favoritePlaylists"));
        } else {
            if (!raw.has("playerlists") && !raw.has("favoriteplayerlists"))
                throw new JSONException("INVALID_BACKUP");
            result.put("playlists", legacyEntries(raw, "playerlists"));
            result.put("favoritePlaylists", legacyEntries(raw, "favoriteplayerlists"));
        }
        Set<String> ids = new HashSet<>();
        validateEntries(result.getJSONArray("playlists"), true, ids);
        validateEntries(result.getJSONArray("favoritePlaylists"), false, ids);
        return result;
    }

    private static JSONArray legacyEntries(JSONObject raw, String index) throws JSONException {
        JSONArray entries = new JSONArray();
        if (!raw.has(index)) return entries;
        JSONArray ids = raw.getJSONArray(index);
        for (int i = 0; i < ids.length(); i++) {
            String id = ids.getString(i);
            entries.put(new JSONObject().put("id", id).put("playlist", raw.getJSONObject(id)));
        }
        return entries;
    }

    private static void validateEntries(JSONArray entries, boolean owned, Set<String> ids)
            throws JSONException {
        if (entries.length() > 500) throw new JSONException("BACKUP_TOO_LARGE");
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i);
            String id = entry.getString("id");
            JSONObject playlist = entry.getJSONObject("playlist");
            if (!safeId(id) || !ids.add(id) || (owned && !id.startsWith("myplaylist_"))
                    || !id.equals(playlist.getJSONObject("info").getString("id"))
                    || desktopFlag(playlist.opt("is_mine")) != owned
                    || desktopFlag(playlist.opt("is_fav")) == owned)
                throw new JSONException("INVALID_BACKUP");
            JSONArray tracks = playlist.optJSONArray("tracks");
            if ((owned && tracks == null) || (tracks != null && tracks.length() > 5000))
                throw new JSONException("INVALID_BACKUP");
        }
    }

    public static ImportResult toNative(JSONObject document) throws JSONException {
        List<LocalDataRepository.PlaylistView> playlists = new ArrayList<>();
        List<LocalDataRepository.FavoriteView> favorites = new ArrayList<>();
        int skipped = 0;
        for (String category : new String[]{"playlists", "favoritePlaylists"}) {
            JSONArray entries = document.getJSONArray(category);
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.getJSONObject(i);
                JSONObject playlist = entry.getJSONObject("playlist");
                String id = entry.getString("id");
                JSONArray rows = playlist.optJSONArray("tracks");
                if (rows == null) { skipped++; continue; }
                Map<String, LocalDataRepository.Track> tracks = new LinkedHashMap<>();
                for (int t = 0; t < rows.length(); t++) {
                    LocalDataRepository.Track track = fromDesktopTrack(rows.optJSONObject(t));
                    if (track == null) { skipped++; continue; }
                    tracks.putIfAbsent(track.providerTrackId, track);
                }
                if (FAVORITES_ID.equals(id)) {
                    for (LocalDataRepository.Track track : tracks.values())
                        favorites.add(new LocalDataRepository.FavoriteView(track.source,
                                track.providerTrackId, track.title, track.artist, 0));
                } else if (!tracks.isEmpty() || rows.length() == 0) {
                    String nativeId = id.startsWith(LOCAL_PREFIX) ? id.substring(LOCAL_PREFIX.length()) : id;
                    if (!safeId(nativeId)) throw new JSONException("INVALID_BACKUP");
                    playlists.add(new LocalDataRepository.PlaylistView(nativeId,
                            label(playlist.getJSONObject("info").optString("title"), "未命名歌单"),
                            playlists.size(), 0, new ArrayList<>(tracks.values())));
                }
            }
        }
        if (playlists.size() > 500 || favorites.size() > 5000) throw new JSONException("BACKUP_TOO_LARGE");
        return new ImportResult(new LocalDataRepository.Backup(1, playlists, favorites), skipped);
    }

    public static JSONObject mergeForUpload(JSONObject remote, LocalDataRepository.Backup local)
            throws JSONException {
        // Work on a copy. Preserve all remote playlists, metadata and unsupported tracks.
        JSONObject result = parse(remote.toString());
        Map<String, JSONObject> known = new LinkedHashMap<>();
        for (String category : new String[]{"playlists", "favoritePlaylists"}) {
            JSONArray entries = result.getJSONArray(category);
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.getJSONObject(i);
                known.put(entry.getString("id"), entry.getJSONObject("playlist"));
            }
        }
        for (LocalDataRepository.PlaylistView playlist : local.playlists) {
            String id = known.containsKey(playlist.playlistId) || playlist.playlistId.startsWith("myplaylist_")
                    ? playlist.playlistId : LOCAL_PREFIX + playlist.playlistId;
            mergePlaylist(result, known, id, playlist.name, playlist.tracks);
        }
        if (!local.favorites.isEmpty()) {
            List<LocalDataRepository.Track> favorites = new ArrayList<>();
            for (LocalDataRepository.FavoriteView f : local.favorites)
                favorites.add(new LocalDataRepository.Track(f.source, f.providerTrackId, f.title, f.artist, 0));
            mergePlaylist(result, known, FAVORITES_ID, "手机收藏", favorites);
        }
        result.put("exportedAt", Instant.now().toString());
        if (result.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES)
            throw new JSONException("BACKUP_TOO_LARGE");
        // Enforce limits after merging, before any network write.
        return parse(result.toString());
    }

    private static void mergePlaylist(JSONObject result, Map<String, JSONObject> known, String id,
            String title, List<LocalDataRepository.Track> nativeTracks) throws JSONException {
        JSONArray additions = new JSONArray();
        for (LocalDataRepository.Track track : nativeTracks) {
            if (!"bilibili".equals(track.source) || !validBiliId(track.providerTrackId)) continue;
            additions.put(new JSONObject().put("id", "bitrack_v_" + track.providerTrackId)
                    .put("source", "bilibili").put("title", track.title).put("artist", track.artist)
                    .put("duration", track.durationMs / 1000.0)
                    .put("source_url", "https://www.bilibili.com/video/" + track.providerTrackId.split("-")[0]));
        }
        if (additions.length() == 0 && !nativeTracks.isEmpty()) return;
        JSONObject playlist = known.get(id);
        if (playlist == null) {
            playlist = new JSONObject().put("info", new JSONObject().put("id", id).put("title", title))
                    .put("is_mine", true).put("is_fav", false).put("tracks", new JSONArray());
            result.getJSONArray("playlists").put(new JSONObject().put("id", id).put("playlist", playlist));
            known.put(id, playlist);
        }
        JSONArray tracks = playlist.optJSONArray("tracks");
        if (tracks == null) { tracks = new JSONArray(); playlist.put("tracks", tracks); }
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = tracks.optJSONObject(i);
            if (track != null) seen.add(track.optString("id"));
        }
        for (int i = 0; i < additions.length(); i++) {
            JSONObject track = additions.getJSONObject(i);
            if (seen.add(track.getString("id"))) tracks.put(track);
        }
    }

    private static LocalDataRepository.Track fromDesktopTrack(JSONObject track) {
        if (track == null || !"bilibili".equals(track.optString("source"))) return null;
        String id = track.optString("id");
        if (!id.startsWith("bitrack_v_")) return null;
        id = id.substring("bitrack_v_".length());
        if (!validBiliId(id)) return null;
        long duration = Math.max(0, Math.min(28_800_000, Math.round(track.optDouble("duration", 0) * 1000)));
        return new LocalDataRepository.Track("bilibili", id, label(track.optString("title"), "未命名视频"),
                label(track.optString("artist"), "哔哩哔哩"), duration);
    }

    static boolean validBiliId(String id) { return id != null && id.matches("BV[0-9A-Za-z]{6,32}(-[1-9][0-9]{0,17})?"); }
    private static boolean desktopFlag(Object value) {
        return Boolean.TRUE.equals(value) || (value instanceof Number && ((Number) value).doubleValue() == 1.0);
    }
    private static boolean safeId(String id) { return id != null && id.matches("[A-Za-z0-9:._-]{1,160}"); }
    private static String label(String value, String fallback) {
        String text = value == null ? "" : value.replaceAll("[\\p{Cntrl}]", " ").trim();
        // The native library accepts labels only, never transport addresses.
        if (text.isEmpty() || text.contains("://") || text.startsWith("/") || text.startsWith("\\")) return fallback;
        return text.substring(0, Math.min(320, text.length()));
    }

    public static final class ImportResult {
        public final LocalDataRepository.Backup backup;
        public final int skipped;
        ImportResult(LocalDataRepository.Backup backup, int skipped) { this.backup = backup; this.skipped = skipped; }
    }
}
