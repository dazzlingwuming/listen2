package com.dazzlingwuming.listen2.library;

import com.dazzlingwuming.listen2.data.LocalDataRepository;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Strict external-file codec for the deliberately small local-data backup.
 *
 * <p>This is independent of WebView/RPC parsing.  In particular, it rejects
 * unknown keys rather than silently retaining a future credential, URI, cache,
 * lyric, history, or UI setting field in a backup file.  The byte entry point
 * performs a reporting UTF-8 decode so malformed byte sequences cannot be
 * replaced and then parsed as a different document.</p>
 */
public final class BackupJsonCodec {
    public static final int VERSION = 1;
    public static final int MAX_BYTES = 4 * 1024 * 1024;
    private static final int MAX_PLAYLISTS = 500;
    private static final int MAX_TRACKS_PER_PLAYLIST = 5_000;
    private static final int MAX_FAVORITES = 5_000;
    private static final int MAX_ID_LENGTH = 160;
    private static final int MAX_TEXT_LENGTH = 320;

    private static final Set<String> ROOT_KEYS = keys("version", "playlists", "favorites");
    private static final Set<String> PLAYLIST_KEYS = keys("playlistId", "name", "tracks");
    private static final Set<String> TRACK_KEYS =
            keys("source", "providerTrackId", "title", "artist", "durationMs");
    private static final Set<String> FAVORITE_KEYS = keys("source", "providerTrackId", "title", "artist");

    private BackupJsonCodec() { }

    /** Serializes only the versioned, semantic backup projection. */
    public static EncodeResult encode(LocalDataRepository.Backup backup) {
        if (!validBackup(backup)) return EncodeResult.error("INVALID_BACKUP");
        try {
            JSONObject root = new JSONObject();
            root.put("version", VERSION);
            JSONArray playlists = new JSONArray();
            for (LocalDataRepository.PlaylistView playlist : backup.playlists) {
                JSONObject item = new JSONObject();
                item.put("playlistId", playlist.playlistId);
                item.put("name", playlist.name);
                JSONArray tracks = new JSONArray();
                for (LocalDataRepository.Track track : playlist.tracks) tracks.put(trackJson(track));
                item.put("tracks", tracks);
                playlists.put(item);
            }
            JSONArray favorites = new JSONArray();
            for (LocalDataRepository.FavoriteView favorite : backup.favorites) {
                JSONObject item = new JSONObject();
                item.put("source", favorite.source);
                item.put("providerTrackId", favorite.providerTrackId);
                item.put("title", favorite.title);
                item.put("artist", favorite.artist);
                favorites.put(item);
            }
            root.put("playlists", playlists);
            root.put("favorites", favorites);
            byte[] bytes = root.toString().getBytes(StandardCharsets.UTF_8);
            return bytes.length <= MAX_BYTES ? EncodeResult.ok(bytes) : EncodeResult.error("TOO_LARGE");
        } catch (JSONException error) {
            return EncodeResult.error("ENCODE_FAILED");
        }
    }

    /** Parses an exact schema document from a bounded byte sequence. */
    public static DecodeResult decode(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return DecodeResult.error("EMPTY_FILE");
        if (bytes.length > MAX_BYTES) return DecodeResult.error("TOO_LARGE");
        final String text;
        try {
            CharBuffer decoded = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes));
            text = decoded.toString();
        } catch (CharacterCodingException error) {
            return DecodeResult.error("INVALID_UTF8");
        }
        try {
            JSONObject root = new JSONObject(text);
            if (!hasExactKeys(root, ROOT_KEYS) || !isStrictInt(root, "version")
                    || root.getInt("version") != VERSION
                    || !(root.opt("playlists") instanceof JSONArray)
                    || !(root.opt("favorites") instanceof JSONArray)) {
                return DecodeResult.error("INVALID_SCHEMA");
            }
            JSONArray playlistArray = root.getJSONArray("playlists");
            JSONArray favoriteArray = root.getJSONArray("favorites");
            if (playlistArray.length() > MAX_PLAYLISTS || favoriteArray.length() > MAX_FAVORITES) {
                return DecodeResult.error("TOO_MANY_ITEMS");
            }
            Set<String> playlistIds = new HashSet<>();
            Set<String> favoriteIds = new HashSet<>();
            List<LocalDataRepository.PlaylistView> playlists = new ArrayList<>();
            List<LocalDataRepository.FavoriteView> favorites = new ArrayList<>();
            int trackCount = 0;
            for (int index = 0; index < playlistArray.length(); index += 1) {
                Object value = playlistArray.opt(index);
                if (!(value instanceof JSONObject)) return DecodeResult.error("INVALID_SCHEMA");
                JSONObject item = (JSONObject) value;
                if (!hasExactKeys(item, PLAYLIST_KEYS) || !(item.opt("tracks") instanceof JSONArray)) {
                    return DecodeResult.error("INVALID_SCHEMA");
                }
                String playlistId = requiredString(item, "playlistId");
                String name = requiredString(item, "name");
                JSONArray tracksArray = item.getJSONArray("tracks");
                if (!safeId(playlistId) || !safeText(name)
                        || tracksArray.length() > MAX_TRACKS_PER_PLAYLIST
                        || !playlistIds.add(playlistId)) return DecodeResult.error("INVALID_BACKUP");
                Set<String> trackIds = new HashSet<>();
                List<LocalDataRepository.Track> tracks = new ArrayList<>();
                for (int trackIndex = 0; trackIndex < tracksArray.length(); trackIndex += 1) {
                    Object trackValue = tracksArray.opt(trackIndex);
                    if (!(trackValue instanceof JSONObject)) return DecodeResult.error("INVALID_SCHEMA");
                    JSONObject trackObject = (JSONObject) trackValue;
                    if (!hasExactKeys(trackObject, TRACK_KEYS)
                            || !isStrictLong(trackObject, "durationMs")) {
                        return DecodeResult.error("INVALID_SCHEMA");
                    }
                    LocalDataRepository.Track track = parseTrack(trackObject);
                    if (track == null || !trackIds.add(track.source + ":" + track.providerTrackId)) {
                        return DecodeResult.error("INVALID_BACKUP");
                    }
                    tracks.add(track);
                    trackCount += 1;
                }
                playlists.add(new LocalDataRepository.PlaylistView(playlistId, name.trim(),
                        index, 0L, tracks));
            }
            for (int index = 0; index < favoriteArray.length(); index += 1) {
                Object value = favoriteArray.opt(index);
                if (!(value instanceof JSONObject)) return DecodeResult.error("INVALID_SCHEMA");
                JSONObject item = (JSONObject) value;
                if (!hasExactKeys(item, FAVORITE_KEYS)) {
                    return DecodeResult.error("INVALID_SCHEMA");
                }
                String source = requiredString(item, "source");
                String providerTrackId = requiredString(item, "providerTrackId");
                String title = requiredString(item, "title");
                String artist = requiredString(item, "artist");
                if (!safeId(source) || !safeId(providerTrackId) || !safeText(title) || !safeText(artist)
                        || !favoriteIds.add(source + ":" + providerTrackId)) {
                    return DecodeResult.error("INVALID_BACKUP");
                }
                favorites.add(new LocalDataRepository.FavoriteView(source, providerTrackId,
                        title.trim(), artist.trim(), 0L));
            }
            return DecodeResult.ok(new LocalDataRepository.Backup(VERSION, playlists, favorites),
                    new BackupPreview(playlists.size(), favorites.size(), trackCount));
        } catch (JSONException | RuntimeException error) {
            return DecodeResult.error("INVALID_JSON");
        }
    }

    private static JSONObject trackJson(LocalDataRepository.Track track) throws JSONException {
        JSONObject item = new JSONObject();
        item.put("source", track.source);
        item.put("providerTrackId", track.providerTrackId);
        item.put("title", track.title);
        item.put("artist", track.artist);
        item.put("durationMs", track.durationMs);
        return item;
    }

    private static LocalDataRepository.Track parseTrack(JSONObject item) throws JSONException {
        String source = requiredString(item, "source");
        String providerTrackId = requiredString(item, "providerTrackId");
        String title = requiredString(item, "title");
        String artist = requiredString(item, "artist");
        long durationMs = item.getLong("durationMs");
        if (!safeId(source) || !safeId(providerTrackId) || !safeText(title) || !safeText(artist)
                || durationMs < 0L || durationMs > 28_800_000L) return null;
        return new LocalDataRepository.Track(source, providerTrackId, title.trim(), artist.trim(), durationMs);
    }

    private static boolean validBackup(LocalDataRepository.Backup backup) {
        if (backup == null || backup.version != VERSION || backup.playlists == null
                || backup.favorites == null || backup.playlists.size() > MAX_PLAYLISTS
                || backup.favorites.size() > MAX_FAVORITES) return false;
        Set<String> playlistIds = new HashSet<>();
        Set<String> favoriteIds = new HashSet<>();
        for (LocalDataRepository.PlaylistView playlist : backup.playlists) {
            if (playlist == null || !safeId(playlist.playlistId) || !safeText(playlist.name)
                    || playlist.ordinal < 0 || playlist.revision < 0 || playlist.tracks == null
                    || playlist.tracks.size() > MAX_TRACKS_PER_PLAYLIST || !playlistIds.add(playlist.playlistId)) return false;
            Set<String> trackIds = new HashSet<>();
            for (LocalDataRepository.Track track : playlist.tracks) {
                if (!validTrack(track) || !trackIds.add(track.source + ":" + track.providerTrackId)) return false;
            }
        }
        for (LocalDataRepository.FavoriteView favorite : backup.favorites) {
            if (favorite == null || !safeId(favorite.source) || !safeId(favorite.providerTrackId)
                    || !safeText(favorite.title) || !safeText(favorite.artist) || favorite.addedAtMs < 0
                    || !favoriteIds.add(favorite.source + ":" + favorite.providerTrackId)) return false;
        }
        return true;
    }

    private static boolean validTrack(LocalDataRepository.Track track) {
        return track != null && safeId(track.source) && safeId(track.providerTrackId)
                && safeText(track.title) && safeText(track.artist) && track.durationMs >= 0L
                && track.durationMs <= 28_800_000L;
    }

    private static boolean hasExactKeys(JSONObject object, Set<String> expected) {
        if (object.length() != expected.size()) return false;
        Iterator<String> iterator = object.keys();
        while (iterator.hasNext()) if (!expected.contains(iterator.next())) return false;
        return true;
    }

    private static boolean isStrictInt(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof Integer || value instanceof Long
                && ((Long) value) <= Integer.MAX_VALUE && ((Long) value) >= Integer.MIN_VALUE;
    }

    private static boolean isStrictLong(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof Integer || value instanceof Long;
    }

    private static String requiredString(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof String ? (String) value : null;
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
        String lower = value.toLowerCase(Locale.ROOT);
        return lower.contains("://") || lower.startsWith("file:") || lower.startsWith("content:")
                || value.startsWith("/") || value.startsWith("\\")
                || value.matches("^[A-Za-z]:[\\\\/].*");
    }

    private static Set<String> keys(String... values) {
        Set<String> result = new HashSet<>();
        java.util.Collections.addAll(result, values);
        return java.util.Collections.unmodifiableSet(result);
    }

    public static final class EncodeResult {
        public final boolean ok;
        public final String status;
        public final byte[] bytes;
        private EncodeResult(boolean ok, String status, byte[] bytes) {
            this.ok = ok; this.status = status; this.bytes = bytes == null ? null : bytes.clone();
        }
        static EncodeResult ok(byte[] bytes) { return new EncodeResult(true, "OK", bytes); }
        static EncodeResult error(String status) { return new EncodeResult(false, status, null); }
    }

    public static final class DecodeResult {
        public final boolean ok;
        public final String status;
        /** Native semantic object; MainActivity must map it to a page-safe DTO. */
        public final LocalDataRepository.Backup backup;
        public final BackupPreview preview;
        private DecodeResult(boolean ok, String status, LocalDataRepository.Backup backup,
                BackupPreview preview) {
            this.ok = ok; this.status = status; this.backup = backup; this.preview = preview;
        }
        static DecodeResult ok(LocalDataRepository.Backup backup, BackupPreview preview) {
            return new DecodeResult(true, "OK", backup, preview);
        }
        static DecodeResult error(String status) { return new DecodeResult(false, status, null, null); }
    }

    /** The only external-file result that should be projected to the page. */
    public static final class BackupPreview {
        public final int playlists;
        public final int favorites;
        public final int tracks;
        BackupPreview(int playlists, int favorites, int tracks) {
            this.playlists = playlists; this.favorites = favorites; this.tracks = tracks;
        }
    }
}
