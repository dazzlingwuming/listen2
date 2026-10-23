package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Public lyric metadata for Bilibili music; fixed LRCLIB routes, no account data. */
final class BilibiliLrclibProvider {
    interface HttpPort { String get(URI uri) throws Exception; }
    private final HttpPort http;
    BilibiliLrclibProvider() { this(BilibiliLrclibProvider::fetch); }
    BilibiliLrclibProvider(HttpPort http) { this.http = http; }

    JSONObject find(String title, String artist, long duration) {
        try {
            URI uri = URI.create("https://lrclib.net/api/get?track_name=" + encode(title)
                    + "&artist_name=" + encode(artist) + "&duration=" + duration);
            String body = http.get(uri);
            if (body == null) return null;
            JSONObject row = new JSONObject(body);
            JSONObject mapped = mapRow(row);
            if (mapped == null || !normalize(title).equals(normalize(mapped.optString("title")))
                    || !normalize(artist).equals(normalize(mapped.optString("artist")))
                    || Math.abs(mapped.optDouble("duration") - duration) > 8) return null;
            return new JSONObject().put("lyric", mapped.getString("lyric"))
                    .put("tlyric", "").put("source", "lrclib")
                    .put("matchedTitle", mapped.getString("title"))
                    .put("matchedArtist", mapped.getString("artist"))
                    .put("matchedDurationSeconds", Math.round(mapped.getDouble("duration")))
                    .put("matchScorePercent", 100);
        } catch (Exception ignored) { return null; }
    }

    JSONArray search(String keyword) throws Exception {
        URI uri = URI.create("https://lrclib.net/api/search?track_name=" + encode(keyword));
        String body = http.get(uri);
        if (body == null) throw new IllegalStateException("LYRIC_CATALOG_UNAVAILABLE");
        JSONArray source = new JSONArray(body);
        JSONArray result = new JSONArray();
        for (int index = 0; index < source.length() && result.length() < 12; index++) {
            JSONObject mapped = mapRow(source.optJSONObject(index));
            if (mapped != null) result.put(mapped);
        }
        return result;
    }

    static JSONObject mapRow(JSONObject row) {
        if (row == null || row.optLong("id", 0) <= 0) return null;
        String title = row.optString("trackName", "");
        String artist = row.optString("artistName", "");
        String lyric = row.optString("syncedLyrics", "");
        if (lyric.isEmpty() || "null".equals(lyric)) lyric = row.optString("plainLyrics", "");
        double duration = row.optDouble("duration", 0);
        if (title.isEmpty() || title.length() > 256 || artist.isEmpty() || artist.length() > 256
                || lyric.isEmpty() || "null".equals(lyric) || lyric.length() > 64 * 1024
                || duration <= 0 || duration > 28_800) return null;
        // LRCLIB also contains enhanced LRC. Keep line timing, hide per-word tags
        // until the renderer supports word-level highlighting.
        lyric = lyric.replaceAll("<\\d{1,3}:\\d{2}(?:\\.\\d{1,3})?>", "");
        try {
            return new JSONObject().put("id", "lrclib:" + row.getLong("id"))
                    .put("provider", "LRCLIB").put("source", "lrclib")
                    .put("title", title).put("artist", artist)
                    .put("album", row.optString("albumName", "").substring(0,
                            Math.min(256, row.optString("albumName", "").length())))
                    .put("duration", duration).put("lyric", lyric).put("tlyric", "");
        } catch (Exception ignored) { return null; }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String normalize(String value) {
        return java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFKC)
                .replaceAll("[\\p{Punct}\\s]", "").toLowerCase(java.util.Locale.ROOT);
    }

    private static String fetch(URI uri) throws Exception {
        if (!"https".equals(uri.getScheme()) || !"lrclib.net".equals(uri.getHost())
                || uri.getPort() != -1 || uri.getUserInfo() != null
                || !("/api/get".equals(uri.getPath()) || "/api/search".equals(uri.getPath())))
            throw new IllegalArgumentException("Unsupported lyric route");
        HttpsURLConnection connection = (HttpsURLConnection) uri.toURL().openConnection();
        connection.setConnectTimeout(5_000);
        connection.setReadTimeout(7_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", "Listen2/2.35.2 (Android lyrics; https://github.com/dazzlingwuming/listen2)");
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (connection.getResponseCode() != 200) return null;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) return null;
                    if (out.size() + count > 2 * 1024 * 1024) return null;
                    out.write(buffer, 0, count);
                }
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally { connection.disconnect(); }
    }
}
