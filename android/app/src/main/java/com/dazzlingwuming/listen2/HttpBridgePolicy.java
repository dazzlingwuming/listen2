package com.dazzlingwuming.listen2;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Pure-Java validation for the deliberately small HTTP capability exposed to
 * the packaged Listen1 page. Keep this independent of Android APIs so its
 * security boundary is covered by JVM tests.
 */
final class HttpBridgePolicy {
    static final int PROTOCOL_VERSION = 1;
    static final String JAVASCRIPT_OBJECT_NAME = "Listen2AndroidHttp";
    static final String TRUSTED_ORIGIN_RULE = "https://appassets.androidplatform.net";
    static final Set<String> ALLOWED_ORIGIN_RULES =
            Collections.singleton(TRUSTED_ORIGIN_RULE);
    static final String BILIBILI_API_HOST = "api.bilibili.com";
    static final String BILIBILI_FINGERPRINT_PATH = "/x/frontend/finger/spi";
    static final String BILIBILI_FINGERPRINT_URL =
            "https://" + BILIBILI_API_HOST + BILIBILI_FINGERPRINT_PATH;
    static final String BILIBILI_BUVID3_COOKIE_NAME = "buvid3";
    static final int MIN_BILIBILI_BUVID3_LENGTH = 16;
    static final int MAX_BILIBILI_BUVID3_LENGTH = 128;
    static final int MAX_BILIBILI_FINGERPRINT_RESPONSE_BYTES = 16 * 1024;
    static final String NETEASE_MUSIC_HOST = "music.163.com";
    static final String NETEASE_SEARCH_PATH = "/api/search/get/web";
    static final int MAX_URL_LENGTH = 4096;
    static final int MAX_REQUEST_ID_LENGTH = 256;
    static final int MAX_MESSAGE_LENGTH = 16 * 1024;
    static final int MAX_NETEASE_SEARCH_TERM_BYTES = 256;
    static final int MAX_NETEASE_SEARCH_OFFSET = 100_000;
    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    private HttpBridgePolicy() {}

    static ValidationResult validateRequest(String method, String rawUrl) {
        if (rawUrl == null || rawUrl.isEmpty()) {
            return ValidationResult.error("INVALID_URL");
        }
        if (rawUrl.length() > MAX_URL_LENGTH) {
            return ValidationResult.error("URL_TOO_LONG");
        }

        try {
            URI uri = new URI(rawUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                return ValidationResult.error("HTTPS_REQUIRED");
            }
            // The API host is approved only on its normal HTTPS port. A host
            // allow-list alone must not accidentally grant arbitrary ports.
            if (uri.getPort() != -1 && uri.getPort() != 443) {
                return ValidationResult.error("PORT_NOT_ALLOWED");
            }
            if (uri.getUserInfo() != null) {
                return ValidationResult.error("INVALID_URL");
            }
            if (BILIBILI_API_HOST.equalsIgnoreCase(uri.getHost())) {
                if (!"GET".equals(method)) {
                    return ValidationResult.error("METHOD_NOT_ALLOWED");
                }
                return ValidationResult.valid(uri, RequestRoute.BILIBILI_GET);
            }
            if (NETEASE_MUSIC_HOST.equalsIgnoreCase(uri.getHost())) {
                if (!"GET".equals(method)) {
                    return ValidationResult.error("METHOD_NOT_ALLOWED");
                }
                if (!NETEASE_SEARCH_PATH.equals(uri.getRawPath())
                        || uri.getRawFragment() != null) {
                    return ValidationResult.error("PATH_NOT_ALLOWED");
                }
                if (!isAllowedNeteaseSearchQuery(uri.getRawQuery())) {
                    return ValidationResult.error("QUERY_NOT_ALLOWED");
                }
                return ValidationResult.valid(uri, RequestRoute.NETEASE_SEARCH_GET);
            }
            return ValidationResult.error("HOST_NOT_ALLOWED");
        } catch (URISyntaxException | NullPointerException ignored) {
            return ValidationResult.error("INVALID_URL");
        }
    }

    private static boolean isAllowedNeteaseSearchQuery(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) {
            return false;
        }
        String searchTerm = null;
        String type = null;
        String offset = null;
        String limit = null;
        Set<String> seenKeys = new HashSet<>();
        for (String rawPair : rawQuery.split("&", -1)) {
            int delimiter = rawPair.indexOf('=');
            if (delimiter <= 0 || delimiter != rawPair.lastIndexOf('=')) {
                return false;
            }
            String key = decodeQueryComponent(rawPair.substring(0, delimiter));
            String value = decodeQueryComponent(rawPair.substring(delimiter + 1));
            if (key == null || value == null || !seenKeys.add(key)) {
                return false;
            }
            switch (key) {
                case "s":
                    searchTerm = value;
                    break;
                case "type":
                    type = value;
                    break;
                case "offset":
                    offset = value;
                    break;
                case "limit":
                    limit = value;
                    break;
                default:
                    return false;
            }
        }
        return searchTerm != null
                && !searchTerm.isEmpty()
                && searchTerm.getBytes(StandardCharsets.UTF_8).length <= MAX_NETEASE_SEARCH_TERM_BYTES
                && ("1".equals(type) || "1000".equals(type))
                && isBoundedDecimal(offset, 0, MAX_NETEASE_SEARCH_OFFSET)
                && "20".equals(limit);
    }

    private static String decodeQueryComponent(String rawComponent) {
        try {
            return URLDecoder.decode(rawComponent, "UTF-8");
        } catch (java.io.UnsupportedEncodingException | IllegalArgumentException ignored) {
            return null;
        }
    }

    private static boolean isBoundedDecimal(String value, int minimum, int maximum) {
        if (value == null || value.isEmpty() || value.length() > 7) {
            return false;
        }
        for (int index = 0; index < value.length(); index += 1) {
            if (value.charAt(index) < '0' || value.charAt(index) > '9') {
                return false;
            }
        }
        try {
            int parsed = Integer.parseInt(value);
            return parsed >= minimum && parsed <= maximum;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    static boolean isTrustedSourceOrigin(String scheme, String host, int port, boolean isMainFrame) {
        return isMainFrame
                && "https".equalsIgnoreCase(scheme)
                && NavigationPolicy.APP_ASSET_HOST.equalsIgnoreCase(host)
                && (port == -1 || port == 443);
    }

    static String extractValidBilibiliBuvid3(String cookieHeader) {
        if (cookieHeader == null || cookieHeader.isEmpty()) {
            return null;
        }
        for (String rawCookie : cookieHeader.split(";")) {
            int delimiter = rawCookie.indexOf('=');
            if (delimiter <= 0) {
                continue;
            }
            String name = rawCookie.substring(0, delimiter).trim();
            if (!BILIBILI_BUVID3_COOKIE_NAME.equals(name)) {
                continue;
            }
            String value = rawCookie.substring(delimiter + 1).trim();
            if (isValidBilibiliBuvid3(value)) {
                return value;
            }
        }
        return null;
    }

    static boolean isValidBilibiliBuvid3(String value) {
        if (value == null
                || value.length() < MIN_BILIBILI_BUVID3_LENGTH
                || value.length() > MAX_BILIBILI_BUVID3_LENGTH) {
            return false;
        }
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (!(character >= 'A' && character <= 'Z')
                    && !(character >= 'a' && character <= 'z')
                    && !(character >= '0' && character <= '9')
                    && character != '_'
                    && character != '-') {
                return false;
            }
        }
        return true;
    }

    static final class ValidationResult {
        private final URI uri;
        private final RequestRoute route;
        private final String errorCode;

        private ValidationResult(URI uri, RequestRoute route, String errorCode) {
            this.uri = uri;
            this.route = route;
            this.errorCode = errorCode;
        }

        static ValidationResult valid(URI uri, RequestRoute route) {
            return new ValidationResult(uri, route, null);
        }

        static ValidationResult error(String errorCode) {
            return new ValidationResult(null, null, errorCode);
        }

        boolean isValid() {
            return uri != null;
        }

        URI getUri() {
            return uri;
        }

        RequestRoute getRoute() {
            return route;
        }

        String getErrorCode() {
            return errorCode;
        }
    }

    enum RequestRoute {
        BILIBILI_GET("GET", "https://www.bilibili.com/"),
        NETEASE_SEARCH_GET("GET", "https://music.163.com/");

        private final String method;
        private final String referer;

        RequestRoute(String method, String referer) {
            this.method = method;
            this.referer = referer;
        }

        String getMethod() {
            return method;
        }

        String getReferer() {
            return referer;
        }
    }
}
