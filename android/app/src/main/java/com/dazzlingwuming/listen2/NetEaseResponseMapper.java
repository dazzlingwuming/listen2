package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Projects untrusted NetEase provider data into the small page-safe search DTO. */
final class NetEaseResponseMapper {
    private static final int MAX_ROWS = 50;
    private static final int MAX_TRACKS = 1_000;
    private static final int MAX_TEXT = 512;
    private static final int MAX_LYRIC_TEXT = 512 * 1024;

    private NetEaseResponseMapper() {}

    static MappingResult mapSearch(AndroidRpcContract.TypedRequest request, String body) {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_SEARCH
                || body == null || body.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject root = new JSONObject(body);
            Object code = root.opt("code");
            if (!(code instanceof Number)) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            int providerCode = ((Number) code).intValue();
            if (providerCode != 200) return MappingResult.error(errorForProviderCode(providerCode));
            JSONObject result = root.optJSONObject("result");
            JSONArray songs = result == null ? null : result.optJSONArray("songs");
            if (songs == null || songs.length() > MAX_ROWS) {
                return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            JSONArray rows = new JSONArray();
            for (int index = 0; index < songs.length(); index += 1) {
                JSONObject row = projectSong(songs.optJSONObject(index));
                if (row != null) rows.put(row);
            }
            if (songs.length() > 0 && rows.length() == 0) {
                return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            JSONObject safe = new JSONObject();
            safe.put("source", AndroidRpcContract.NETEASE_SOURCE);
            safe.put("provider", AndroidRpcContract.NETEASE_SOURCE);
            safe.put("total", boundedCount(result.opt("songCount"), rows.length()));
            safe.put("rows", rows);
            return MappingResult.success(safe);
        } catch (JSONException ignored) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    static String errorForStatus(int status) {
        if (status == 401) return "LOGIN_REQUIRED";
        if (status == 402) return "MEMBERSHIP_REQUIRED";
        if (status == 403) return "ENTITLEMENT_REQUIRED";
        if (status == 423) return "DRM_RESTRICTED";
        if (status == 429) return "RATE_LIMIT";
        if (status == 451) return "REGION_RESTRICTED";
        if (status >= 500 && status <= 599) return "PROVIDER_STATUS";
        return "HTTP_STATUS";
    }

    static String errorForProviderCode(int code) {
        if (code == 301 || code == 302) return "LOGIN_REQUIRED";
        if (code == 401 || code == 403) return "ENTITLEMENT_REQUIRED";
        if (code == 429) return "RATE_LIMIT";
        return "PROVIDER_STATUS";
    }

    private static JSONObject projectSong(JSONObject song) throws JSONException {
        if (song == null || !(song.opt("id") instanceof Number)) return null;
        long id = ((Number) song.opt("id")).longValue();
        String title = safeText(song.optString("name", ""));
        JSONArray artists = song.optJSONArray("artists");
        String artist = artists == null || artists.length() == 0 ? null
                : safeText(artists.optJSONObject(0) == null ? ""
                        : artists.optJSONObject(0).optString("name", ""));
        if (id <= 0 || title == null || artist == null) return null;
        JSONObject safe = new JSONObject();
        safe.put("source", AndroidRpcContract.NETEASE_SOURCE);
        safe.put("provider", AndroidRpcContract.NETEASE_SOURCE);
        safe.put("id", "netrack_" + id);
        safe.put("providerTrackId", Long.toString(id));
        safe.put("title", title);
        safe.put("artist", artist);
        long duration = song.optLong("duration", song.optLong("dt", 0L));
        if (duration > 0L) safe.put("durationMs", boundedDuration(duration));
        safe.put("capability", isPlayable(song) ? "default-rendition" : "permission-required");
        return safe;
    }

    /**
     * Projects a playlist detail plus its separately fetched song metadata.
     * The playlist response is intentionally reduced to track IDs before the
     * song response is accepted; arbitrary provider playlist JSON never crosses
     * the bridge.
     */
    static MappingResult mapDirectoryDetail(String playlistId, String playlistBody,
            String songBody) {
        if (!isProviderId(playlistId) || playlistBody == null || songBody == null
                || playlistBody.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES
                || songBody.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject playlistRoot = new JSONObject(playlistBody);
            if (!isProviderSuccess(playlistRoot)) return MappingResult.error(errorForProviderCode(
                    playlistRoot.optInt("code", -1)));
            JSONObject playlist = playlistRoot.optJSONObject("playlist");
            JSONArray trackIds = playlist == null ? null : playlist.optJSONArray("trackIds");
            if (trackIds == null || trackIds.length() == 0 || trackIds.length() > MAX_TRACKS) {
                return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            JSONObject songsRoot = new JSONObject(songBody);
            if (!isProviderSuccess(songsRoot)) return MappingResult.error(errorForProviderCode(
                    songsRoot.optInt("code", -1)));
            JSONArray songs = songsRoot.optJSONArray("songs");
            if (songs == null || songs.length() == 0 || songs.length() > MAX_TRACKS) {
                return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            }

            Map<Long, JSONObject> byId = new LinkedHashMap<>();
            for (int index = 0; index < songs.length(); index += 1) {
                JSONObject song = songs.optJSONObject(index);
                if (song != null && song.opt("id") instanceof Number) {
                    byId.put(((Number) song.opt("id")).longValue(), song);
                }
            }
            JSONArray projectedTracks = new JSONArray();
            for (int index = 0; index < trackIds.length(); index += 1) {
                JSONObject trackId = trackIds.optJSONObject(index);
                long id = trackId == null ? 0L : trackId.optLong("id", 0L);
                JSONObject projected = projectDirectorySong(byId.get(id));
                if (projected != null) projectedTracks.put(projected);
            }
            if (projectedTracks.length() == 0) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");

            JSONObject info = new JSONObject();
            info.put("id", "neplaylist_" + playlistId);
            info.put("source", AndroidRpcContract.NETEASE_SOURCE);
            String title = safeText(playlist == null ? "" : playlist.optString("name", ""));
            if (title == null) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            info.put("title", title);
            JSONObject result = new JSONObject();
            result.put("source", AndroidRpcContract.NETEASE_SOURCE);
            result.put("provider", AndroidRpcContract.NETEASE_SOURCE);
            result.put("info", info);
            result.put("tracks", projectedTracks);
            return MappingResult.success(result);
        } catch (JSONException ignored) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    static TrackIdsResult extractPlaylistTrackIds(String playlistId, String playlistBody) {
        if (!isProviderId(playlistId) || playlistBody == null
                || playlistBody.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
            return TrackIdsResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject root = new JSONObject(playlistBody);
            if (!isProviderSuccess(root)) return TrackIdsResult.error(errorForProviderCode(root.optInt("code", -1)));
            JSONObject playlist = root.optJSONObject("playlist");
            JSONArray trackIds = playlist == null ? null : playlist.optJSONArray("trackIds");
            if (trackIds == null || trackIds.length() == 0 || trackIds.length() > MAX_TRACKS) {
                return TrackIdsResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            List<Long> ids = new ArrayList<>();
            for (int index = 0; index < trackIds.length(); index += 1) {
                JSONObject row = trackIds.optJSONObject(index);
                long id = row == null ? 0L : row.optLong("id", 0L);
                if (!isProviderId(id)) return TrackIdsResult.error("MALFORMED_PROVIDER_RESPONSE");
                ids.add(id);
            }
            return TrackIdsResult.success(ids);
        } catch (JSONException ignored) {
            return TrackIdsResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    static RenditionResult mapDefaultRendition(String requestedTrackId, String body) {
        if (!isProviderId(requestedTrackId) || body == null
                || body.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
            return RenditionResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject root = new JSONObject(body);
            if (!isProviderSuccess(root)) {
                return RenditionResult.error(errorForProviderCode(root.optInt("code", -1)));
            }
            JSONArray data = root.optJSONArray("data");
            if (data == null || data.length() == 0 || data.length() > 4) {
                return RenditionResult.error("ENTITLEMENT_REQUIRED");
            }
            JSONObject first = data.optJSONObject(0);
            if (first == null) return RenditionResult.error("ENTITLEMENT_REQUIRED");
            long id = first.optLong("id", 0L);
            if (id > 0L && !requestedTrackId.equals(Long.toString(id))) {
                return RenditionResult.error("IDENTITY_MISMATCH");
            }
            String url = first.optString("url", null);
            if (url == null || url.isEmpty()) return RenditionResult.error("ENTITLEMENT_REQUIRED");
            if (!isSafeMediaUrl(url)) return RenditionResult.error("MALFORMED_PROVIDER_RESPONSE");
            long bitrate = first.optLong("br", 0L);
            return RenditionResult.success(url, Math.max(0L, Math.min(2_000_000L, bitrate)));
        } catch (JSONException ignored) {
            return RenditionResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    static MappingResult mapPrimaryLyric(String body) {
        if (body == null || body.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject root = new JSONObject(body);
            if (!isProviderSuccess(root)) return MappingResult.error(errorForProviderCode(root.optInt("code", -1)));
            JSONObject lrc = root.optJSONObject("lrc");
            JSONObject tlyric = root.optJSONObject("tlyric");
            String lyric = boundedLyric(lrc == null ? "" : lrc.optString("lyric", ""));
            String translated = boundedLyric(tlyric == null ? "" : tlyric.optString("lyric", ""));
            if (lyric == null || translated == null) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            JSONObject result = new JSONObject();
            result.put("source", AndroidRpcContract.NETEASE_SOURCE);
            result.put("lyric", lyric);
            result.put("tlyric", translated);
            return MappingResult.success(result);
        } catch (JSONException ignored) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    private static JSONObject projectDirectorySong(JSONObject song) throws JSONException {
        if (song == null || !(song.opt("id") instanceof Number)) return null;
        long id = song.optLong("id", 0L);
        if (!isProviderId(id)) return null;
        String title = safeText(song.optString("name", ""));
        JSONArray artists = song.optJSONArray("ar");
        if (artists == null) artists = song.optJSONArray("artists");
        JSONObject artistObject = artists == null ? null : artists.optJSONObject(0);
        String artist = safeText(artistObject == null ? "" : artistObject.optString("name", ""));
        JSONObject album = song.optJSONObject("al");
        if (album == null) album = song.optJSONObject("album");
        String albumName = safeText(album == null ? "" : album.optString("name", ""));
        if (title == null || artist == null || albumName == null) return null;
        JSONObject result = new JSONObject();
        result.put("id", "netrack_" + id);
        result.put("providerTrackId", Long.toString(id));
        result.put("title", title);
        result.put("artist", artist);
        result.put("album", albumName);
        result.put("source", AndroidRpcContract.NETEASE_SOURCE);
        result.put("provider", AndroidRpcContract.NETEASE_SOURCE);
        result.put("duration", durationSeconds(song));
        result.put("capability", isPlayable(song) ? "default-rendition" : "permission-required");
        return result;
    }

    private static boolean isProviderSuccess(JSONObject root) {
        return root != null && root.opt("code") instanceof Number
                && ((Number) root.opt("code")).intValue() == 200;
    }

    private static boolean isProviderId(String value) {
        return value != null && value.matches("[1-9][0-9]{0,17}");
    }

    private static boolean isProviderId(long value) {
        return value > 0L && value <= 999_999_999_999_999_999L;
    }

    private static boolean isPlayable(JSONObject song) {
        int fee = song == null ? 0 : song.optInt("fee", 0);
        return fee != 1 && fee != 4;
    }

    private static long boundedDuration(long duration) {
        return duration > 0L && duration <= 28_800_000L ? duration : 0L;
    }

    private static long durationSeconds(JSONObject song) {
        long milliseconds = song == null ? 0L : song.optLong("dt", song.optLong("duration", 0L));
        milliseconds = boundedDuration(milliseconds);
        return milliseconds <= 0L ? 0L : milliseconds / 1_000L;
    }

    private static String boundedLyric(String lyric) {
        if (lyric == null || lyric.length() > MAX_LYRIC_TEXT || lyric.indexOf('\u0000') >= 0
                || lyric.indexOf('<') >= 0 || lyric.indexOf('>') >= 0) return null;
        return lyric.replace("\b", "").replace("\\", "").replace('\u2005', ' ');
    }

    private static boolean isSafeMediaUrl(String value) {
        if (value == null || value.length() > 4_096) return false;
        try {
            java.net.URI uri = new java.net.URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || uri.getUserInfo() != null || uri.getRawFragment() != null) return false;
            return host.equals("music.163.com") || host.endsWith(".music.163.com")
                    || host.equals("music.126.net") || host.endsWith(".music.126.net");
        } catch (java.net.URISyntaxException ignored) {
            return false;
        }
    }

    private static int boundedCount(Object value, int fallback) {
        if (!(value instanceof Number)) return fallback;
        return Math.max(0, Math.min(1_000_000, ((Number) value).intValue()));
    }

    private static String safeText(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_TEXT
                || value.indexOf('\u0000') >= 0 || value.indexOf('<') >= 0 || value.indexOf('>') >= 0) {
            return null;
        }
        return value;
    }

    static final class MappingResult {
        final JSONObject value;
        final String errorCode;
        private MappingResult(JSONObject value, String errorCode) {
            this.value = value;
            this.errorCode = errorCode;
        }
        static MappingResult success(JSONObject value) { return new MappingResult(value, null); }
        static MappingResult error(String errorCode) { return new MappingResult(null, errorCode); }
        boolean isValid() { return value != null; }
    }

    static final class TrackIdsResult {
        final List<Long> ids;
        final String errorCode;
        private TrackIdsResult(List<Long> ids, String errorCode) {
            this.ids = ids == null ? Collections.<Long>emptyList() : Collections.unmodifiableList(ids);
            this.errorCode = errorCode;
        }
        static TrackIdsResult success(List<Long> ids) { return new TrackIdsResult(ids, null); }
        static TrackIdsResult error(String errorCode) { return new TrackIdsResult(null, errorCode); }
        boolean isValid() { return errorCode == null && !ids.isEmpty(); }
    }

    static final class RenditionResult {
        final String url;
        final long bitrate;
        final String errorCode;
        private RenditionResult(String url, long bitrate, String errorCode) {
            this.url = url;
            this.bitrate = bitrate;
            this.errorCode = errorCode;
        }
        static RenditionResult success(String url, long bitrate) { return new RenditionResult(url, bitrate, null); }
        static RenditionResult error(String errorCode) { return new RenditionResult(null, 0L, errorCode); }
        boolean isValid() { return url != null && errorCode == null; }
    }
}
