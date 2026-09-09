package com.dazzlingwuming.listen2.platform;

import android.webkit.CookieManager;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.provider.BilibiliAccountSession;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

/**
 * Closed native Bilibili QR endpoint owner. It permits only the three account
 * paths below, never accepts a caller URL/header/cookie, and writes provider
 * cookies straight into CookieManager rather than returning them to the bridge.
 */
public final class BilibiliQrGateway implements BilibiliAccountSession.QrGateway {
    private static final String ORIGIN = "https://passport.bilibili.com";
    private static final String GENERATE_PATH = "/x/passport-login/web/qrcode/generate";
    private static final String POLL_PATH = "/x/passport-login/web/qrcode/poll?qrcode_key=";
    private static final String LOGOUT_PATH = "/login/exit/v2";
    private static final int CONNECT_TIMEOUT_MILLIS = 10_000;
    private static final int READ_TIMEOUT_MILLIS = 15_000;
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private static final int MAX_COOKIE_BYTES = 8 * 1024;
    private static final long QR_LIFETIME_MILLIS = 180_000L;
    private static final String USER_AGENT = "Listen2Android/1";

    private final CookieManager cookies;

    public BilibiliQrGateway(@NonNull CookieManager cookies) {
        this.cookies = cookies;
    }

    @Override
    public BilibiliAccountSession.QrChallenge begin() throws Exception {
        JSONObject data = requestJson(GENERATE_PATH, "GET", null);
        String opaqueKey = data.optString("qrcode_key", "");
        String qrUrl = data.optString("url", "");
        if (!isSafeOpaqueKey(opaqueKey) || !isApprovedQrUrl(qrUrl)) {
            throw new IOException("Invalid QR challenge");
        }
        return new BilibiliAccountSession.QrChallenge(opaqueKey, qrUrl,
                System.currentTimeMillis() + QR_LIFETIME_MILLIS);
    }

    @Override
    public BilibiliAccountSession.PollResult poll(String opaqueChallenge) throws Exception {
        if (!isSafeOpaqueKey(opaqueChallenge)) throw new IOException("Invalid QR challenge");
        String encoded = URLEncoder.encode(opaqueChallenge, StandardCharsets.UTF_8.name());
        JSONObject data = requestJson(POLL_PATH + encoded, "GET", null);
        int code = data.optInt("code", Integer.MIN_VALUE);
        if (code == 0) {
            String refreshMaterial = data.optString("refresh_token", "");
            if (!isSafeRefreshMaterial(refreshMaterial)) throw new IOException("Missing refresh material");
            return new BilibiliAccountSession.PollResult(
                    BilibiliAccountSession.Status.AUTHENTICATED, refreshMaterial);
        }
        if (code == 86101) return new BilibiliAccountSession.PollResult(
                BilibiliAccountSession.Status.WAITING, null);
        if (code == 86090) return new BilibiliAccountSession.PollResult(
                BilibiliAccountSession.Status.SCANNED, null);
        if (code == 86038) return new BilibiliAccountSession.PollResult(
                BilibiliAccountSession.Status.EXPIRED, null);
        throw new IOException("Unexpected QR state");
    }

    @Override
    public void logout() {
        // Server logout is best-effort: local cookie/vault removal still has to
        // occur when connectivity is unavailable.
        try {
            String csrf = findCookie("bili_jct");
            if (csrf != null && !csrf.isEmpty()) {
                requestJson(LOGOUT_PATH, "POST", "biliCSRF="
                        + URLEncoder.encode(csrf, StandardCharsets.UTF_8.name()));
            }
        } catch (Exception ignored) {
            // Never expose provider errors or cookie material to callers.
        } finally {
            clearBilibiliCookies();
        }
    }

    @Override
    public boolean hasAuthenticatedSession() {
        String header = cookies.getCookie("https://api.bilibili.com");
        return hasBoundedCookie(header, "SESSDATA") && hasBoundedCookie(header, "DedeUserID");
    }

    private JSONObject requestJson(String pathAndQuery, String method, String body) throws Exception {
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new java.net.URL(ORIGIN + pathAndQuery).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
            connection.setReadTimeout(READ_TIMEOUT_MILLIS);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", USER_AGENT);
            String cookieHeader = cookies.getCookie(ORIGIN);
            if (cookieHeader != null && cookieHeader.length() <= MAX_COOKIE_BYTES) {
                connection.setRequestProperty("Cookie", cookieHeader);
            }
            if (body != null) {
                byte[] encoded = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type",
                        "application/x-www-form-urlencoded;charset=UTF-8");
                connection.setFixedLengthStreamingMode(encoded.length);
                try (java.io.OutputStream output = connection.getOutputStream()) {
                    output.write(encoded);
                }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("Unexpected HTTP status");
            commitBilibiliCookies(connection);
            JSONObject root = new JSONObject(readBounded(connection.getInputStream()));
            if (root.optInt("code", Integer.MIN_VALUE) != 0) {
                // Poll status lives in data.code; outer failures are not a valid state transition.
                throw new IOException("Provider response rejected");
            }
            JSONObject data = root.optJSONObject("data");
            if (data == null) throw new IOException("Malformed provider response");
            return data;
        } catch (JSONException error) {
            throw new IOException("Malformed provider response", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void commitBilibiliCookies(HttpsURLConnection connection) {
        Map<String, List<String>> headers = connection.getHeaderFields();
        if (headers == null) return;
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() == null || !"set-cookie".equalsIgnoreCase(entry.getKey())) continue;
            List<String> values = entry.getValue();
            if (values == null) continue;
            for (String value : values) {
                if (isApprovedSetCookie(value)) cookies.setCookie(ORIGIN, value);
            }
        }
        cookies.flush();
    }

    private String findCookie(String name) {
        String header = cookies.getCookie(ORIGIN);
        if (header == null || header.length() > MAX_COOKIE_BYTES) return null;
        for (String item : header.split(";")) {
            int equals = item.indexOf('=');
            if (equals <= 0) continue;
            String candidate = item.substring(0, equals).trim();
            if (name.equals(candidate)) return item.substring(equals + 1).trim();
        }
        return null;
    }

    private void clearBilibiliCookies() {
        String header = cookies.getCookie(ORIGIN);
        if (header == null || header.length() > MAX_COOKIE_BYTES) return;
        for (String item : header.split(";")) {
            int equals = item.indexOf('=');
            if (equals <= 0) continue;
            String name = item.substring(0, equals).trim();
            if (!name.matches("[A-Za-z0-9_-]{1,128}")) continue;
            String expired = name + "=; Max-Age=0; Path=/; Domain=.bilibili.com; Secure; HttpOnly";
            cookies.setCookie(ORIGIN, expired);
        }
        cookies.flush();
    }

    private static String readBounded(InputStream input) throws IOException {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = source.read(buffer)) != -1) {
                if (output.size() + read > MAX_RESPONSE_BYTES) throw new IOException("Response too large");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static boolean isApprovedSetCookie(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_COOKIE_BYTES
                || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) return false;
        String[] attributes = value.split(";");
        if (attributes.length == 0 || attributes[0].indexOf('=') <= 0) return false;
        for (int index = 1; index < attributes.length; index += 1) {
            String attribute = attributes[index].trim();
            if (attribute.regionMatches(true, 0, "domain=", 0, "domain=".length())) {
                String domain = attribute.substring("domain=".length()).trim();
                if (!isBilibiliHost(domain.startsWith(".") ? domain.substring(1) : domain)) return false;
            }
        }
        return true;
    }

    private static boolean isApprovedQrUrl(String value) {
        if (value == null || value.isEmpty() || value.length() > 2048) return false;
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getRawUserInfo() == null && uri.getRawFragment() == null
                    && isBilibiliHost(uri.getHost());
        } catch (URISyntaxException ignored) {
            return false;
        }
    }

    private static boolean isBilibiliHost(String host) {
        if (host == null) return false;
        String lower = host.toLowerCase(Locale.ROOT);
        return "bilibili.com".equals(lower) || lower.endsWith(".bilibili.com");
    }

    private static boolean isSafeOpaqueKey(String value) {
        return value != null && value.length() > 0 && value.length() <= 1024
                && value.indexOf('\r') < 0 && value.indexOf('\n') < 0;
    }

    private static boolean isSafeRefreshMaterial(String value) {
        return value != null && value.length() > 0 && value.length() <= 8192
                && value.indexOf('\r') < 0 && value.indexOf('\n') < 0;
    }

    private static boolean hasBoundedCookie(String header, String requestedName) {
        if (header == null || header.length() > MAX_COOKIE_BYTES
                || header.indexOf('\r') >= 0 || header.indexOf('\n') >= 0) return false;
        for (String item : header.split(";")) {
            int equals = item.indexOf('=');
            if (equals <= 0) continue;
            String name = item.substring(0, equals).trim();
            String value = item.substring(equals + 1).trim();
            if (requestedName.equals(name) && !value.isEmpty() && value.length() <= 4096) return true;
        }
        return false;
    }
}
