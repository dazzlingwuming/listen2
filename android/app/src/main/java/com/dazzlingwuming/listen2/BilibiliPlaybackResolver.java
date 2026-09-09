package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.net.ssl.HttpsURLConnection;

/**
 * Native-only Bilibili audio-manifest seam for Media3.
 *
 * <p>The packaged page supplies a logical BVID/CID through the playback bridge.
 * This resolver owns the two fixed provider routes and keeps the resulting
 * short-lived CDN candidates in the Media3 process only. It deliberately has
 * no caller-controlled URL, header, or cookie input.</p>
 */
final class BilibiliPlaybackResolver implements PlaybackMediaResolver.ManifestPort {
    private static final String LEGACY_AUDIO_HOST = "www.bilibili.com";
    private static final String LEGACY_AUDIO_PATH = "/audio/music-service-c/web/url";
    private static final int CONNECT_TIMEOUT_MILLIS = 10_000;
    private static final int READ_TIMEOUT_MILLIS = 15_000;
    private static final String ACCEPT_HEADER = "application/json, text/plain, */*";
    private static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.219 "
            + "Mobile Safari/537.36";

    interface HttpPort {
        Response get(URI uri);
    }

    interface AccountCookieSource {
        String getBilibiliCookieHeader();
    }

    static final class Response {
        final int status;
        final String body;

        Response(int status, String body) {
            this.status = status;
            this.body = body;
        }

        boolean isSuccess() {
            return status >= 200 && status < 300 && body != null;
        }
    }

    private final HttpPort http;

    BilibiliPlaybackResolver() {
        this(new UrlConnectionPort(null));
    }

    BilibiliPlaybackResolver(AccountCookieSource accountCookies) {
        this(new UrlConnectionPort(accountCookies));
    }

    BilibiliPlaybackResolver(HttpPort http) {
        this.http = http == null ? new UrlConnectionPort(null) : http;
    }

    @Override
    public List<String> resolve(PlaybackMediaResolver.Descriptor descriptor) {
        if (descriptor == null || !"bilibili".equals(descriptor.getSource())) {
            return Collections.emptyList();
        }
        try {
            String bvid = descriptor.getProviderTrackId();
            long cid = descriptor.getProviderPartId();
            if (bvid.matches("[1-9][0-9]{0,17}") && cid == 1L) {
                return resolveLegacyAudio(bvid);
            }
            AndroidRpcContract.TypedRequest detailRequest = AndroidRpcContract.TypedRequest.videoDetail(
                    "native-media", 0, bvid);
            Response detail = http.get(AndroidRpcContract.buildVideoDetailUri(detailRequest));
            if (!detail.isSuccess()) return Collections.emptyList();
            BilibiliResponseMapper.MappingResult detailProjection = BilibiliResponseMapper.mapVideoDetail(
                    detailRequest, detail.body);
            if (!detailProjection.isValid() || !containsCid(detailProjection.value.getJSONArray("pages"), cid)) {
                return Collections.emptyList();
            }

            AndroidRpcContract.TypedRequest manifestRequest = AndroidRpcContract.TypedRequest.audioManifest(
                    "native-media", 0, bvid, "explicit", cid);
            Response manifest = http.get(AndroidRpcContract.buildAudioManifestUri(manifestRequest));
            if (!manifest.isSuccess()) return Collections.emptyList();
            BilibiliResponseMapper.MappingResult mapped = BilibiliResponseMapper.mapAudioManifest(
                    manifestRequest, detail.body, manifest.body);
            if (!mapped.isValid()) return Collections.emptyList();

            JSONArray candidates = mapped.value.optJSONArray("candidates");
            if (candidates == null || candidates.length() == 0 || candidates.length() > 4) {
                return Collections.emptyList();
            }
            List<String> result = new ArrayList<>();
            for (int index = 0; index < candidates.length(); index += 1) {
                String candidate = candidates.optString(index, "");
                if (candidate.isEmpty() || result.contains(candidate)) return Collections.emptyList();
                result.add(candidate);
            }
            return result;
        } catch (JSONException | java.net.URISyntaxException | RuntimeException ignored) {
            return Collections.emptyList();
        }
    }

    private List<String> resolveLegacyAudio(String sid) throws JSONException, java.net.URISyntaxException {
        URI uri = new URI("https", null, LEGACY_AUDIO_HOST, -1, LEGACY_AUDIO_PATH,
                "sid=" + sid, null);
        Response response = http.get(uri);
        if (!response.isSuccess()) return Collections.emptyList();
        JSONObject root = new JSONObject(response.body);
        Object code = root.opt("code");
        JSONObject data = root.optJSONObject("data");
        JSONArray cdns = data == null ? null : data.optJSONArray("cdns");
        if (!(code instanceof Number) || ((Number) code).intValue() != 0
                || cdns == null || cdns.length() < 1 || cdns.length() > 4) {
            return Collections.emptyList();
        }
        List<String> result = new ArrayList<>();
        for (int index = 0; index < cdns.length(); index += 1) {
            Object candidate = cdns.opt(index);
            if (!(candidate instanceof String) || ((String) candidate).isEmpty()
                    || result.contains(candidate)) return Collections.emptyList();
            result.add((String) candidate);
        }
        return result;
    }

    @Override
    public String unavailableStatus() {
        return "bilibili-manifest-unavailable";
    }

    private static boolean containsCid(JSONArray pages, long cid) throws JSONException {
        if (pages == null || cid <= 0L) return false;
        for (int index = 0; index < pages.length(); index += 1) {
            if (pages.getJSONObject(index).optLong("cid", 0L) == cid) return true;
        }
        return false;
    }

    /** Fixed-route network client. It never reads page cookies or accepts page headers. */
    private static final class UrlConnectionPort implements HttpPort {
        private static final int MAX_COOKIE_BYTES = 8 * 1024;
        private final AccountCookieSource accountCookies;
        private String anonymousBuvid3;
        private boolean fingerprintAttempted;

        UrlConnectionPort(AccountCookieSource accountCookies) {
            this.accountCookies = accountCookies;
        }

        @Override
        public Response get(URI uri) {
            if (!isManifestRoute(uri)) {
                return new Response(0, null);
            }
            String cookieHeader = authenticatedCookieHeader();
            if (cookieHeader == null) cookieHeader = anonymousCookieHeader();
            if (cookieHeader == null) return new Response(0, null);
            return fetch(uri, cookieHeader);
        }

        /** Account cookies are read only from Android's native cookie jar and never projected. */
        private String authenticatedCookieHeader() {
            if (accountCookies == null) return null;
            try {
                String value = accountCookies.getBilibiliCookieHeader();
                if (value == null || value.isEmpty() || value.length() > MAX_COOKIE_BYTES
                        || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0
                        || !containsCookie(value, "SESSDATA")) return null;
                return value;
            } catch (RuntimeException ignored) {
                return null;
            }
        }

        private static boolean containsCookie(String header, String requestedName) {
            for (String item : header.split(";")) {
                int equals = item.indexOf('=');
                if (equals <= 0) continue;
                if (requestedName.equals(item.substring(0, equals).trim())
                        && !item.substring(equals + 1).trim().isEmpty()) return true;
            }
            return false;
        }

        /**
         * The resolver never reads WebView or account cookies. A bounded
         * provider-issued anonymous identifier is sufficient for public
         * manifest routes and cannot grant any account entitlement.
         */
        private String anonymousCookieHeader() {
            if (HttpBridgePolicy.isValidBilibiliBuvid3(anonymousBuvid3)) {
                return HttpBridgePolicy.BILIBILI_BUVID3_COOKIE_NAME + "=" + anonymousBuvid3;
            }
            if (fingerprintAttempted) return null;
            fingerprintAttempted = true;
            Response fingerprint;
            try {
                fingerprint = fetch(new URI(HttpBridgePolicy.BILIBILI_FINGERPRINT_URL), null);
            } catch (java.net.URISyntaxException ignored) {
                return null;
            }
            if (!fingerprint.isSuccess()) return null;
            try {
                JSONObject root = new JSONObject(fingerprint.body);
                JSONObject data = root.optJSONObject("data");
                String value = data == null ? null : data.optString("b_3", null);
                Object code = root.opt("code");
                if (!(code instanceof Number) || ((Number) code).intValue() != 0
                        || !HttpBridgePolicy.isValidBilibiliBuvid3(value)) return null;
                anonymousBuvid3 = value;
                return HttpBridgePolicy.BILIBILI_BUVID3_COOKIE_NAME + "=" + value;
            } catch (JSONException ignored) {
                return null;
            }
        }

        private static boolean isManifestRoute(URI uri) {
            if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())
                    || uri.getPort() != -1 || uri.getUserInfo() != null || uri.getRawFragment() != null) {
                return false;
            }
            if (HttpBridgePolicy.BILIBILI_API_HOST.equals(uri.getHost())) {
                return AndroidRpcContract.BILIBILI_VIDEO_DETAIL_PATH.equals(uri.getPath())
                        || AndroidRpcContract.BILIBILI_AUDIO_MANIFEST_PATH.equals(uri.getPath());
            }
            return LEGACY_AUDIO_HOST.equals(uri.getHost()) && LEGACY_AUDIO_PATH.equals(uri.getPath())
                    && uri.getRawQuery() != null && uri.getRawQuery().matches("sid=[1-9][0-9]{0,17}");
        }

        private Response fetch(URI uri, String cookieHeader) {
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) new URL(uri.toASCIIString()).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
                connection.setReadTimeout(READ_TIMEOUT_MILLIS);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setRequestProperty("Accept", ACCEPT_HEADER);
                connection.setRequestProperty("Accept-Encoding", "identity");
                connection.setRequestProperty("User-Agent", USER_AGENT);
                connection.setRequestProperty("Referer",
                        HttpBridgePolicy.RequestRoute.BILIBILI_GET.getReferer());
                if (cookieHeader != null) connection.setRequestProperty("Cookie", cookieHeader);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300
                        || connection.getContentLengthLong() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
                    return new Response(status, null);
                }
                try (InputStream input = connection.getInputStream()) {
                    return new Response(status, readBoundedUtf8(input));
                }
            } catch (SocketTimeoutException ignored) {
                return new Response(0, null);
            } catch (IOException | RuntimeException ignored) {
                return new Response(0, null);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        private static String readBoundedUtf8(InputStream input) throws IOException {
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (read > HttpBridgePolicy.MAX_RESPONSE_BYTES - total) return null;
                    output.write(buffer, 0, read);
                    total += read;
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        }
    }
}
