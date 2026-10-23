package com.dazzlingwuming.listen2;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Closed, native-owned NetEase route catalog and transport.
 *
 * <p>Every request is minted from a semantic operation.  There is no method
 * accepting a page URL, page headers, page cookies, or an arbitrary body.  The
 * resulting request may be inspected by the native client and is consumed by
 * the native transport only; it is never a bridge DTO.</p>
 */
final class NetEaseNativeProvider {
    static final String MUSIC_HOST = "music.163.com";
    static final String INTERFACE_HOST = "interface3.music.163.com";
    static final String SEARCH_PATH = "/api/search/get/web";
    static final String PLAYLIST_DETAIL_PATH = "/weapi/v3/playlist/detail";
    static final String SONG_DETAIL_PATH = "/weapi/v3/song/detail";
    static final String RENDITION_PATH = "/eapi/song/enhance/player/url";
    static final String LYRIC_PATH = "/weapi/song/lyric";
    static final String EAPI_URL_PATH = "/api/song/enhance/player/url";
    static final int PAGE_SIZE = 20;
    static final int MAX_PLAYLIST_TRACKS = 1_000;
    static final int MAX_REQUEST_BYTES = 128 * 1024;
    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    static final int CONNECT_TIMEOUT_MILLIS = 10_000;
    static final int READ_TIMEOUT_MILLIS = 15_000;
    static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.219 "
            + "Mobile Safari/537.36";

    enum Route {
        SEARCH("GET", MUSIC_HOST, SEARCH_PATH),
        PLAYLIST_DETAIL("POST", MUSIC_HOST, PLAYLIST_DETAIL_PATH),
        SONG_DETAIL("POST", MUSIC_HOST, SONG_DETAIL_PATH),
        RENDITION_DEFAULT("POST", INTERFACE_HOST, RENDITION_PATH),
        LYRIC_PRIMARY("POST", MUSIC_HOST, LYRIC_PATH);

        final String method;
        final String host;
        final String path;

        Route(String method, String host, String path) {
            this.method = method;
            this.host = host;
            this.path = path;
        }
    }

    interface Transport {
        Response execute(Request request) throws Exception;
    }

    interface SecretKeySource {
        String next();
    }

    interface CookieSource {
        String forWeapi();

        String forEapi();
    }

    static final class Request {
        final Route route;
        final URI uri;
        final String method;
        final String body;
        final String cookieHeader;

        Request(Route route, URI uri, String body, String cookieHeader) {
            this.route = route;
            this.uri = uri;
            this.method = route == null ? "" : route.method;
            this.body = body == null ? "" : body;
            this.cookieHeader = cookieHeader == null ? "" : cookieHeader;
        }

        byte[] bodyBytes() {
            return body.getBytes(StandardCharsets.UTF_8);
        }

        Map<String, String> fixedHeaders() {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Accept", "application/json, text/plain, */*");
            headers.put("Accept-Encoding", "identity");
            headers.put("User-Agent", USER_AGENT);
            headers.put("Referer", "https://music.163.com/");
            if ("POST".equals(method)) {
                headers.put("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            }
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
            return status >= 200 && status < 300 && body != null && errorCode == null;
        }
    }

    private final Transport transport;
    private final SecretKeySource secretKeys;
    private final CookieSource cookies;

    NetEaseNativeProvider() {
        this(new UrlConnectionTransport(),
                () -> NetEaseCrypto.createSecretKey(new SecureRandom()), new GeneratedCookieSource());
    }

    NetEaseNativeProvider(Transport transport) {
        this(transport, () -> NetEaseCrypto.createSecretKey(new SecureRandom()), new GeneratedCookieSource());
    }

    NetEaseNativeProvider(Transport transport, SecretKeySource secretKeys, CookieSource cookies) {
        this.transport = transport == null ? new UrlConnectionTransport() : transport;
        this.secretKeys = secretKeys == null
                ? () -> NetEaseCrypto.createSecretKey(new SecureRandom()) : secretKeys;
        this.cookies = cookies == null ? new GeneratedCookieSource() : cookies;
    }

    Request buildSearchRequest(String keyword, int page) throws URISyntaxException {
        if (!isSafeKeyword(keyword) || page < 1 || page > 1_000) {
            throw new URISyntaxException("", "Invalid search input");
        }
        long offset = (long) (page - 1) * PAGE_SIZE;
        String query = "s=" + encode(keyword) + "&type=1&offset=" + offset + "&limit=" + PAGE_SIZE;
        return request(Route.SEARCH, new URI("https://" + MUSIC_HOST + SEARCH_PATH + "?" + query),
                "", cookies.forWeapi());
    }

    Request buildPlaylistDetailRequest(long playlistId) throws URISyntaxException, JSONException {
        if (!isProviderId(playlistId)) throw new URISyntaxException("", "Invalid playlist id");
        JSONObject payload = new JSONObject();
        payload.put("id", playlistId);
        payload.put("offset", 0);
        payload.put("total", true);
        payload.put("limit", MAX_PLAYLIST_TRACKS);
        payload.put("n", MAX_PLAYLIST_TRACKS);
        payload.put("csrf_token", "");
        return weapiRequest(Route.PLAYLIST_DETAIL, PLAYLIST_DETAIL_PATH, payload);
    }

    Request buildSongDetailRequest(List<Long> trackIds) throws URISyntaxException, JSONException {
        if (trackIds == null || trackIds.isEmpty() || trackIds.size() > MAX_PLAYLIST_TRACKS) {
            throw new URISyntaxException("", "Invalid song ids");
        }
        JSONArray compact = new JSONArray();
        StringBuilder ids = new StringBuilder("[");
        for (int index = 0; index < trackIds.size(); index += 1) {
            Long value = trackIds.get(index);
            if (value == null || !isProviderId(value)) throw new URISyntaxException("", "Invalid song id");
            if (index > 0) ids.append(',');
            ids.append(value);
            compact.put(new JSONObject().put("id", value));
        }
        ids.append(']');
        JSONObject payload = new JSONObject();
        payload.put("c", compact.toString());
        payload.put("ids", ids.toString());
        return weapiRequest(Route.SONG_DETAIL, SONG_DETAIL_PATH, payload);
    }

    Request buildDefaultRenditionRequest(long trackId) throws URISyntaxException, JSONException {
        if (!isProviderId(trackId)) throw new URISyntaxException("", "Invalid song id");
        JSONObject payload = new JSONObject();
        payload.put("ids", "[" + trackId + "]");
        payload.put("br", 999_000);
        String json = payload.toString();
        String encrypted = NetEaseCrypto.encryptEapi(EAPI_URL_PATH, json);
        return formRequest(Route.RENDITION_DEFAULT,
                new URI("https", null, INTERFACE_HOST, -1, RENDITION_PATH, null, null),
                form("params", encrypted), cookies.forEapi());
    }

    Request buildPrimaryLyricRequest(long trackId) throws URISyntaxException, JSONException {
        if (!isProviderId(trackId)) throw new URISyntaxException("", "Invalid song id");
        JSONObject payload = new JSONObject();
        payload.put("id", trackId);
        payload.put("lv", -1);
        payload.put("tv", -1);
        payload.put("csrf_token", "");
        return weapiRequest(Route.LYRIC_PRIMARY, LYRIC_PATH + "?csrf_token=", payload);
    }

    Response execute(Request request) {
        if (!isApprovedRequest(request)) return Response.error("ROUTE_NOT_ALLOWED");
        if (request.bodyBytes().length > MAX_REQUEST_BYTES) return Response.error("REQUEST_TOO_LARGE");
        if (Thread.currentThread().isInterrupted()) return Response.error("CANCELLED");
        try {
            Response response = transport.execute(request);
            if (response == null) return Response.error("NETWORK_IO_ERROR");
            if (Thread.currentThread().isInterrupted()) return Response.error("CANCELLED");
            if (response.status >= 300 && response.status < 400) {
                return Response.error("REDIRECT_NOT_ALLOWED");
            }
            if (response.body != null && response.body.getBytes(StandardCharsets.UTF_8).length
                    > MAX_RESPONSE_BYTES) return Response.error("RESPONSE_TOO_LARGE");
            return response;
        } catch (java.net.SocketTimeoutException ignored) {
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
                || !request.route.method.equals(request.method)
                || !"https".equalsIgnoreCase(request.uri.getScheme())
                || request.uri.getPort() != -1
                || request.uri.getUserInfo() != null
                || request.uri.getRawFragment() != null
                || !request.route.host.equalsIgnoreCase(request.uri.getHost())
                || !request.route.path.equals(request.uri.getRawPath())) return false;
        if (request.route == Route.SEARCH) {
            return "".equals(request.body) && isApprovedSearchQuery(request.uri.getRawQuery());
        }
        if (request.route == Route.LYRIC_PRIMARY) {
            return "csrf_token=".equals(request.uri.getRawQuery()) && isFormBody(request.body,
                    "params", "encSecKey");
        }
        if (request.route == Route.RENDITION_DEFAULT) {
            return request.uri.getHost().equals(INTERFACE_HOST)
                    && request.uri.getRawQuery() == null && isFormBody(request.body, "params");
        }
        return isFormBody(request.body, "params", "encSecKey");
    }

    private Request weapiRequest(Route route, String cryptoUrl, JSONObject payload)
            throws JSONException, URISyntaxException {
        String key = secretKeys.next();
        if (key == null || key.length() != 16) throw new URISyntaxException("", "Invalid secret key");
        NetEaseCrypto.WeapiPayload encrypted = NetEaseCrypto.encryptWeapi(payload, key);
        URI uri = new URI("https", null, MUSIC_HOST, -1,
                route.path, route == Route.LYRIC_PRIMARY ? "csrf_token=" : null, null);
        return formRequest(route, uri, form("params", encrypted.params)
                        + "&" + form("encSecKey", encrypted.encSecKey), cookies.forWeapi());
    }

    private static Request formRequest(Route route, URI uri, String body, String cookieHeader) {
        return new Request(route, uri, body, cookieHeader);
    }

    private static Request request(Route route, URI uri, String body, String cookieHeader) {
        return new Request(route, uri, body, cookieHeader);
    }

    private static String form(String key, String value) {
        return encode(key) + "=" + encode(value);
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, StandardCharsets.UTF_8.name());
        } catch (java.io.UnsupportedEncodingException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static boolean isFormBody(String body, String... requiredKeys) {
        if (body == null || body.isEmpty() || body.length() > MAX_REQUEST_BYTES) return false;
        Map<String, String> values = new LinkedHashMap<>();
        for (String pair : body.split("&", -1)) {
            int delimiter = pair.indexOf('=');
            if (delimiter <= 0 || delimiter != pair.lastIndexOf('=')) return false;
            String key = decode(pair.substring(0, delimiter));
            String value = decode(pair.substring(delimiter + 1));
            if (key == null || value == null || values.put(key, value) != null) return false;
        }
        if (values.size() != requiredKeys.length) return false;
        for (String key : requiredKeys) {
            String value = values.get(key);
            if (value == null || value.isEmpty()) return false;
        }
        return true;
    }

    private static boolean isApprovedSearchQuery(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) return false;
        Map<String, String> values = new LinkedHashMap<>();
        for (String pair : rawQuery.split("&", -1)) {
            int delimiter = pair.indexOf('=');
            if (delimiter <= 0 || delimiter != pair.lastIndexOf('=')) return false;
            String key = decode(pair.substring(0, delimiter));
            String value = decode(pair.substring(delimiter + 1));
            if (key == null || value == null || values.put(key, value) != null) return false;
        }
        if (values.size() != 4 || !values.containsKey("s") || !values.containsKey("type")
                || !values.containsKey("offset") || !values.containsKey("limit")) return false;
        if (!isSafeKeyword(values.get("s")) || !"1".equals(values.get("type"))
                || !"20".equals(values.get("limit"))) return false;
        return isDecimal(values.get("offset"), 0, 100_000);
    }

    private static String decode(String value) {
        try {
            return java.net.URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (java.io.UnsupportedEncodingException | IllegalArgumentException ignored) {
            return null;
        }
    }

    private static boolean isSafeKeyword(String keyword) {
        return keyword != null && !keyword.trim().isEmpty()
                && keyword.trim().equals(keyword)
                && keyword.getBytes(StandardCharsets.UTF_8).length <= 256
                && keyword.indexOf('\u0000') < 0;
    }

    private static boolean isDecimal(String value, int minimum, int maximum) {
        if (value == null || value.isEmpty() || value.length() > 6) return false;
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (character < '0' || character > '9') return false;
        }
        try {
            int parsed = Integer.parseInt(value);
            return parsed >= minimum && parsed <= maximum;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private static boolean isProviderId(long value) {
        return value > 0L && value <= 999_999_999_999_999_999L;
    }

    private static final class GeneratedCookieSource implements CookieSource {
        private final String nuid;
        private final String nnid;

        GeneratedCookieSource() {
            String generated = NetEaseCrypto.createSecretKey(new SecureRandom())
                    + NetEaseCrypto.createSecretKey(new SecureRandom());
            nuid = generated.substring(0, 32);
            nnid = nuid + "," + System.currentTimeMillis();
        }

        @Override
        public String forWeapi() {
            return "_ntes_nuid=" + nuid + "; _ntes_nnid3=" + nnid + "; NMTID=0";
        }

        @Override
        public String forEapi() {
            return "os=pc";
        }
    }

    private static final class UrlConnectionTransport implements Transport {
        @Override
        public Response execute(Request request) throws IOException {
            if (!isApprovedRequest(request)) return Response.error("ROUTE_NOT_ALLOWED");
            HttpsURLConnection connection = null;
            try {
                URL url = request.uri.toURL();
                connection = (HttpsURLConnection) url.openConnection();
                connection.setRequestMethod(request.method);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
                connection.setReadTimeout(READ_TIMEOUT_MILLIS);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                for (Map.Entry<String, String> header : request.fixedHeaders().entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
                if ("POST".equals(request.method)) {
                    connection.setDoOutput(true);
                    byte[] body = request.bodyBytes();
                    if (body.length > MAX_REQUEST_BYTES) return Response.error("REQUEST_TOO_LARGE");
                    try (java.io.OutputStream output = connection.getOutputStream()) {
                        output.write(body);
                        output.flush();
                    }
                }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) return new Response(status, null, "REDIRECT_NOT_ALLOWED");
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String body = input == null ? "" : readBoundedUtf8(input);
                if (body == null) return new Response(status, null, "RESPONSE_TOO_LARGE");
                return new Response(status, body);
            } catch (java.net.SocketTimeoutException timeout) {
                throw timeout;
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
