package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import javax.net.ssl.HttpsURLConnection;

/**
 * Closed native Bilibili audio-directory provider.
 *
 * <p>The future typed bridge may expose only {@code bilibili.directory.page}
 * ({@code {page}}) and {@code bilibili.directory.detail} ({@code {playlistId}}).
 * This provider deliberately has no API accepting a page URL, caller headers,
 * caller cookies, or a body. It projects provider JSON to playlist/track
 * metadata and never returns an audio, lyric, or other provider-action URL.</p>
 */
final class BilibiliDirectoryProvider {
    static final String SOURCE = "bilibili";
    static final String HOST = "www.bilibili.com";
    static final String DIRECTORY_PAGE_PATH = "/audio/music-service-c/web/menu/hit";
    static final String DIRECTORY_INFO_PATH = "/audio/music-service-c/web/menu/info";
    static final String DIRECTORY_TRACKS_PATH = "/audio/music-service-c/web/song/of-menu";
    static final int DIRECTORY_PAGE_SIZE = 20;
    static final int DETAIL_PAGE_SIZE = 100;
    static final int MAX_PAGE = 1_000;
    static final int MAX_PLAYLIST_ID_DIGITS = 18;
    static final int MAX_DIRECTORY_ROWS = 20;
    static final int MAX_TRACK_ROWS = 100;
    static final int MAX_TEXT_LENGTH = 512;
    static final int MAX_ARTWORK_LENGTH = 2_048;
    static final int MAX_DURATION_SECONDS = 8 * 60 * 60;
    static final int MAX_COOKIE_BYTES = 8 * 1024;
    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    static final int CONNECT_TIMEOUT_MILLIS = 10_000;
    static final int READ_TIMEOUT_MILLIS = 15_000;
    static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.219 "
            + "Mobile Safari/537.36";
    static final String REFERER = "https://www.bilibili.com/";

    enum Route {
        DIRECTORY_PAGE(DIRECTORY_PAGE_PATH),
        DIRECTORY_INFO(DIRECTORY_INFO_PATH),
        DIRECTORY_TRACKS(DIRECTORY_TRACKS_PATH);

        final String path;

        Route(String path) {
            this.path = path;
        }
    }

    interface Transport {
        Response execute(Request request) throws Exception;
    }

    /** Native-only account/session cookie source. Values never cross this class boundary. */
    interface CookieSource {
        String getBilibiliCookieHeader();
    }

    static final class Request {
        final Route route;
        final URI uri;
        final String method;
        final String cookieHeader;

        Request(Route route, URI uri, String cookieHeader) {
            this.route = route;
            this.uri = uri;
            this.method = "GET";
            this.cookieHeader = cookieHeader == null ? "" : cookieHeader;
        }

        Map<String, String> fixedHeaders() {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Accept", "application/json, text/plain, */*");
            headers.put("Accept-Encoding", "identity");
            headers.put("User-Agent", USER_AGENT);
            headers.put("Referer", REFERER);
            if (!cookieHeader.isEmpty()) headers.put("Cookie", cookieHeader);
            return Collections.unmodifiableMap(headers);
        }
    }

    static final class Response {
        final int status;
        final String body;
        final String errorCode;

        Response(int status, String body) {
            this(status, body, null);
        }

        Response(int status, String body, String errorCode) {
            this.status = status;
            this.body = body;
            this.errorCode = errorCode;
        }

        static Response error(String errorCode) {
            return new Response(0, null, errorCode);
        }

        boolean isHttpSuccess() {
            return errorCode == null && status >= 200 && status < 300 && body != null;
        }
    }

    /** Terminal semantic outcome for bridge integration; {@code value} is safe page data only. */
    static final class Result {
        final String status;
        final int httpStatus;
        final JSONObject value;

        private Result(String status, int httpStatus, JSONObject value) {
            this.status = status;
            this.httpStatus = httpStatus;
            this.value = value;
        }

        static Result success(int httpStatus, JSONObject value) {
            return new Result("OK", httpStatus, value);
        }

        static Result error(String status, int httpStatus) {
            return new Result(status == null ? "NETWORK_IO_ERROR" : status, httpStatus, null);
        }

        boolean isSuccess() {
            return "OK".equals(status) && value != null;
        }
    }

    private final Transport transport;
    private final CookieSource cookies;

    BilibiliDirectoryProvider() {
        this(new UrlConnectionTransport(), () -> "");
    }

    BilibiliDirectoryProvider(Transport transport, CookieSource cookies) {
        this.transport = transport == null ? new UrlConnectionTransport() : transport;
        this.cookies = cookies == null ? () -> "" : cookies;
    }

    Result executeDirectoryPage(int page) {
        try {
            if (page < 1 || page > MAX_PAGE) return Result.error("INVALID_PAYLOAD", 0);
            Response response = execute(buildDirectoryPageRequest(page));
            if (!response.isHttpSuccess()) return responseError(response);
            return mapDirectoryPage(response.body, response.status);
        } catch (URISyntaxException ignored) {
            return Result.error("INVALID_PAYLOAD", 0);
        }
    }

    Result executeDirectoryDetail(long playlistId) {
        if (!isPlaylistId(playlistId)) return Result.error("INVALID_PAYLOAD", 0);
        try {
            Response info = execute(buildDirectoryInfoRequest(playlistId));
            if (!info.isHttpSuccess()) return responseError(info);
            JSONObject projectedInfo = mapInfo(playlistId, info.body);
            if (projectedInfo == null) return Result.error(providerOrMalformed(info.body), info.status);

            Response tracks = execute(buildDirectoryTracksRequest(playlistId));
            if (!tracks.isHttpSuccess()) return responseError(tracks);
            JSONArray projectedTracks = mapTracks(tracks.body);
            if (projectedTracks == null) return Result.error(providerOrMalformed(tracks.body), tracks.status);
            if (projectedTracks.length() == 0) return Result.error("NO_RESULTS", tracks.status);

            JSONObject result = new JSONObject();
            result.put("source", SOURCE);
            result.put("provider", SOURCE);
            result.put("info", projectedInfo);
            result.put("tracks", projectedTracks);
            return Result.success(tracks.status, result);
        } catch (URISyntaxException | JSONException ignored) {
            return Result.error("MALFORMED_PROVIDER_RESPONSE", 0);
        }
    }

    Request buildDirectoryPageRequest(int page) throws URISyntaxException {
        if (page < 1 || page > MAX_PAGE) throw new URISyntaxException("", "Invalid page");
        return request(Route.DIRECTORY_PAGE, "ps=" + DIRECTORY_PAGE_SIZE + "&pn=" + page);
    }

    Request buildDirectoryInfoRequest(long playlistId) throws URISyntaxException {
        if (!isPlaylistId(playlistId)) throw new URISyntaxException("", "Invalid playlist id");
        return request(Route.DIRECTORY_INFO, "sid=" + playlistId);
    }

    Request buildDirectoryTracksRequest(long playlistId) throws URISyntaxException {
        if (!isPlaylistId(playlistId)) throw new URISyntaxException("", "Invalid playlist id");
        return request(Route.DIRECTORY_TRACKS,
                "pn=1&ps=" + DETAIL_PAGE_SIZE + "&sid=" + playlistId);
    }

    private Request request(Route route, String query) throws URISyntaxException {
        return new Request(route, new URI("https", null, HOST, -1, route.path, query, null),
                nativeCookie());
    }

    private String nativeCookie() {
        try {
            String value = cookies.getBilibiliCookieHeader();
            if (value == null || value.isEmpty() || value.getBytes(StandardCharsets.UTF_8).length > MAX_COOKIE_BYTES
                    || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) return "";
            return value;
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private Response execute(Request request) {
        if (!isApprovedRequest(request)) return Response.error("ROUTE_NOT_ALLOWED");
        if (Thread.currentThread().isInterrupted()) return Response.error("CANCELLED");
        try {
            Response response = transport.execute(request);
            if (response == null) return Response.error("NETWORK_IO_ERROR");
            if (Thread.currentThread().isInterrupted()) return Response.error("CANCELLED");
            if (response.status >= 300 && response.status < 400) return Response.error("REDIRECT_NOT_ALLOWED");
            if (response.body != null && response.body.getBytes(StandardCharsets.UTF_8).length > MAX_RESPONSE_BYTES) {
                return Response.error("RESPONSE_TOO_LARGE");
            }
            return response;
        } catch (SocketTimeoutException ignored) {
            return Response.error("NETWORK_TIMEOUT");
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            return Response.error("CANCELLED");
        } catch (Exception ignored) {
            return Response.error("NETWORK_IO_ERROR");
        }
    }

    static boolean isApprovedRequest(Request request) {
        if (request == null || request.route == null || request.uri == null
                || !"GET".equals(request.method) || !"https".equalsIgnoreCase(request.uri.getScheme())
                || request.uri.getPort() != -1 || request.uri.getUserInfo() != null
                || request.uri.getRawFragment() != null || !HOST.equalsIgnoreCase(request.uri.getHost())
                || !request.route.path.equals(request.uri.getRawPath())) return false;
        Map<String, String> query = parseQuery(request.uri.getRawQuery());
        if (query == null) return false;
        if (request.route == Route.DIRECTORY_PAGE) {
            return query.size() == 2 && Integer.toString(DIRECTORY_PAGE_SIZE).equals(query.get("ps"))
                    && isDecimal(query.get("pn"), 1, MAX_PAGE);
        }
        if (request.route == Route.DIRECTORY_INFO) {
            return query.size() == 1 && isPlaylistId(query.get("sid"));
        }
        return query.size() == 3 && "1".equals(query.get("pn"))
                && Integer.toString(DETAIL_PAGE_SIZE).equals(query.get("ps"))
                && isPlaylistId(query.get("sid"));
    }

    private static Result responseError(Response response) {
        if (response == null) return Result.error("NETWORK_IO_ERROR", 0);
        if (response.errorCode != null) return Result.error(response.errorCode, 0);
        return Result.error(errorForStatus(response.status), response.status);
    }

    private static Result mapDirectoryPage(String body, int httpStatus) {
        try {
            JSONObject data = providerData(body);
            if (data == null) return Result.error(providerOrMalformed(body), httpStatus);
            JSONArray rows = data.optJSONArray("data");
            if (rows == null || rows.length() > MAX_DIRECTORY_ROWS) {
                return Result.error("MALFORMED_PROVIDER_RESPONSE", httpStatus);
            }
            JSONArray projected = new JSONArray();
            Set<Long> seen = new HashSet<>();
            for (int index = 0; index < rows.length(); index += 1) {
                JSONObject row = projectDirectoryRow(rows.optJSONObject(index));
                if (row == null || !seen.add(row.getLong("providerPlaylistId"))) {
                    return Result.error("MALFORMED_PROVIDER_RESPONSE", httpStatus);
                }
                projected.put(row);
            }
            if (projected.length() == 0) return Result.error("NO_RESULTS", httpStatus);
            JSONObject result = new JSONObject();
            result.put("source", SOURCE);
            result.put("provider", SOURCE);
            result.put("rows", projected);
            return Result.success(httpStatus, result);
        } catch (JSONException ignored) {
            return Result.error("MALFORMED_PROVIDER_RESPONSE", httpStatus);
        }
    }

    private static JSONObject mapInfo(long playlistId, String body) {
        JSONObject data = providerData(body);
        if (data == null) return null;
        try {
            String title = safeText(data.opt("title"));
            if (title == null) return null;
            JSONObject result = playlistIdentity(playlistId);
            result.put("title", title);
            Object coverValue = data.opt("cover");
            String cover = safeArtwork(coverValue);
            if (coverValue instanceof String && cover == null) return null;
            if (cover != null) result.put("cover", cover);
            return result;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static JSONArray mapTracks(String body) {
        JSONObject data = providerData(body);
        if (data == null) return null;
        JSONArray rows = data.optJSONArray("data");
        if (rows == null || rows.length() > MAX_TRACK_ROWS) return null;
        try {
            JSONArray result = new JSONArray();
            Set<Long> seen = new HashSet<>();
            for (int index = 0; index < rows.length(); index += 1) {
                JSONObject track = projectTrack(rows.optJSONObject(index));
                if (track == null || !seen.add(track.getLong("providerTrackId"))) return null;
                result.put(track);
            }
            return result;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static JSONObject projectDirectoryRow(JSONObject row) throws JSONException {
        if (row == null) return null;
        long id = positiveId(row.opt("menuId"));
        String title = safeText(row.opt("title"));
        if (!isPlaylistId(id) || title == null) return null;
        JSONObject result = playlistIdentity(id);
        result.put("title", title);
        Object coverValue = row.opt("cover");
        String cover = safeArtwork(coverValue);
        if (coverValue instanceof String && cover == null) return null;
        if (cover != null) result.put("cover", cover);
        return result;
    }

    private static JSONObject playlistIdentity(long id) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("id", "biplaylist_" + id);
        result.put("providerPlaylistId", id);
        result.put("source", SOURCE);
        result.put("provider", SOURCE);
        return result;
    }

    private static JSONObject projectTrack(JSONObject row) throws JSONException {
        if (row == null) return null;
        long id = positiveId(row.opt("id"));
        long artistId = positiveId(row.opt("uid"));
        long duration = positiveId(row.opt("duration"));
        String title = safeText(row.opt("title"));
        String artist = safeText(row.opt("uname"));
        if (!isPlaylistId(id) || title == null || artist == null || duration <= 0
                || duration > MAX_DURATION_SECONDS) return null;
        JSONObject result = new JSONObject();
        result.put("id", "bitrack_" + id);
        result.put("providerTrackId", id);
        result.put("source", SOURCE);
        result.put("provider", SOURCE);
        result.put("title", title);
        result.put("artist", artist);
        if (artistId > 0 && isPlaylistId(artistId)) result.put("artistId", "biartist_" + artistId);
        result.put("duration", duration);
        // The rendition is resolved later by the native fixed legacy-audio route.
        result.put("capability", "playable");
        Object coverValue = row.opt("cover");
        String cover = safeArtwork(coverValue);
        if (coverValue instanceof String && cover == null) return null;
        if (cover != null) result.put("cover", cover);
        return result;
    }

    private static JSONObject providerData(String body) {
        if (body == null || body.getBytes(StandardCharsets.UTF_8).length > MAX_RESPONSE_BYTES) return null;
        try {
            JSONObject root = new JSONObject(body);
            Object code = root.opt("code");
            if (!(code instanceof Number) || ((Number) code).intValue() != 0) return null;
            return root.optJSONObject("data");
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static String providerOrMalformed(String body) {
        if (body == null || body.getBytes(StandardCharsets.UTF_8).length > MAX_RESPONSE_BYTES) {
            return "MALFORMED_PROVIDER_RESPONSE";
        }
        try {
            JSONObject root = new JSONObject(body);
            Object code = root.opt("code");
            if (code instanceof Number && ((Number) code).intValue() != 0) {
                return errorForProviderCode(((Number) code).intValue());
            }
        } catch (JSONException ignored) {
            // Fall through to the one safe malformed status.
        }
        return "MALFORMED_PROVIDER_RESPONSE";
    }

    private static String errorForStatus(int status) {
        if (status == 401) return "LOGIN_REQUIRED";
        if (status == 402) return "MEMBERSHIP_REQUIRED";
        if (status == 403) return "ENTITLEMENT_REQUIRED";
        if (status == 429) return "RATE_LIMIT";
        if (status == 451) return "REGION_RESTRICTED";
        if (status >= 500 && status <= 599) return "PROVIDER_STATUS";
        return "HTTP_STATUS";
    }

    private static String errorForProviderCode(int code) {
        if (code == -101) return "LOGIN_REQUIRED";
        if (code == -403 || code == 403) return "ENTITLEMENT_REQUIRED";
        if (code == -429 || code == 429) return "RATE_LIMIT";
        return "PROVIDER_STATUS";
    }

    private static String safeText(Object value) {
        if (!(value instanceof String)) return null;
        String text = (String) value;
        if (text.isEmpty() || text.length() > MAX_TEXT_LENGTH || text.indexOf('<') >= 0
                || text.indexOf('>') >= 0 || text.indexOf('\u0000') >= 0) return null;
        for (int index = 0; index < text.length(); index += 1) {
            if (Character.isISOControl(text.charAt(index)) && text.charAt(index) != '\n') return null;
        }
        return text;
    }

    private static String safeArtwork(Object value) {
        if (!(value instanceof String)) return null;
        String raw = (String) value;
        if (raw.startsWith("//")) raw = "https:" + raw;
        if (raw.length() > MAX_ARTWORK_LENGTH) return null;
        try {
            URI uri = new URI(raw);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && host != null && uri.getUserInfo() == null
                    && uri.getPort() == -1 && uri.getRawFragment() == null && isArtworkHost(host)
                    ? uri.toASCIIString() : null;
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    private static boolean isArtworkHost(String host) {
        String normalized = host.toLowerCase(java.util.Locale.ROOT);
        return "hdslb.com".equals(normalized) || normalized.endsWith(".hdslb.com")
                || "bilibili.com".equals(normalized) || normalized.endsWith(".bilibili.com");
    }

    private static long positiveId(Object value) {
        return value instanceof Number && ((Number) value).longValue() > 0L
                ? ((Number) value).longValue() : 0L;
    }

    private static boolean isPlaylistId(long value) {
        return value > 0L && Long.toString(value).length() <= MAX_PLAYLIST_ID_DIGITS;
    }

    private static boolean isPlaylistId(String value) {
        return value != null && value.matches("[1-9][0-9]{0," + (MAX_PLAYLIST_ID_DIGITS - 1) + "}");
    }

    private static boolean isDecimal(String value, int minimum, int maximum) {
        if (value == null || value.isEmpty() || value.length() > 6) return false;
        for (int index = 0; index < value.length(); index += 1) {
            char item = value.charAt(index);
            if (item < '0' || item > '9') return false;
        }
        try {
            int parsed = Integer.parseInt(value);
            return parsed >= minimum && parsed <= maximum;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private static Map<String, String> parseQuery(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) return null;
        Map<String, String> result = new LinkedHashMap<>();
        for (String pair : rawQuery.split("&", -1)) {
            int delimiter = pair.indexOf('=');
            if (delimiter <= 0 || delimiter != pair.lastIndexOf('=')) return null;
            String key = decode(pair.substring(0, delimiter));
            String value = decode(pair.substring(delimiter + 1));
            if (key == null || value == null || result.put(key, value) != null) return null;
        }
        return result;
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (java.io.UnsupportedEncodingException | IllegalArgumentException ignored) {
            return null;
        }
    }

    private static final class UrlConnectionTransport implements Transport {
        @Override
        public Response execute(Request request) throws IOException {
            if (!isApprovedRequest(request)) return Response.error("ROUTE_NOT_ALLOWED");
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) new URL(request.uri.toASCIIString()).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
                connection.setReadTimeout(READ_TIMEOUT_MILLIS);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                for (Map.Entry<String, String> header : request.fixedHeaders().entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) return Response.error("REDIRECT_NOT_ALLOWED");
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String body = input == null ? "" : readBoundedUtf8(input);
                return body == null ? Response.error("RESPONSE_TOO_LARGE") : new Response(status, body);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        private static String readBoundedUtf8(InputStream input) throws IOException {
            try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8_192];
                int total = 0;
                int read;
                while ((read = stream.read(buffer)) != -1) {
                    if (read > MAX_RESPONSE_BYTES - total) return null;
                    output.write(buffer, 0, read);
                    total += read;
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        }
    }
}
