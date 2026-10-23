package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class HttpBridgePolicyTest {
    @Test
    public void listenerIsBoundToOnlyThePackagedAssetOrigin() {
        assertEquals(1, HttpBridgePolicy.ALLOWED_ORIGIN_RULES.size());
        assertTrue(HttpBridgePolicy.ALLOWED_ORIGIN_RULES.contains(
                "https://appassets.androidplatform.net"));
        assertTrue(HttpBridgePolicy.isTrustedSourceOrigin(
                "https", "appassets.androidplatform.net", -1, true));
        assertFalse(HttpBridgePolicy.isTrustedSourceOrigin(
                "https", "evil.example", -1, true));
        assertFalse(HttpBridgePolicy.isTrustedSourceOrigin(
                "https", "appassets.androidplatform.net", -1, false));
    }

    @Test
    public void nonHttpsAndUnapprovedHostsAreRejected() {
        assertError("HTTP_REQUIRED", "GET", "http://api.bilibili.com/x", "HTTPS_REQUIRED");
        assertError("FILE_NOT_ALLOWED", "GET", "file:///sdcard/private.json", "HTTPS_REQUIRED");
        assertError("CONTENT_NOT_ALLOWED", "GET", "content://api.bilibili.com/item", "HTTPS_REQUIRED");
        assertError("HOST_NOT_ALLOWED", "GET", "https://api.bilibili.com.evil.example/x", "HOST_NOT_ALLOWED");
    }

    @Test
    public void onlyGetAndBoundedUrlsAreAllowed() {
        assertError("POST_NOT_ALLOWED", "POST", "https://api.bilibili.com/x", "METHOD_NOT_ALLOWED");
        String tooLong = "https://api.bilibili.com/" + "x".repeat(HttpBridgePolicy.MAX_URL_LENGTH);
        assertError("URL_TOO_LONG", "GET", tooLong, "URL_TOO_LONG");
    }

    @Test
    public void approvedBilibiliGetPassesValidation() {
        HttpBridgePolicy.ValidationResult result = HttpBridgePolicy.validateRequest(
                "GET", "https://api.bilibili.com/x/web-interface/nav?from=listen2");
        assertTrue(result.isValid());
        assertEquals("api.bilibili.com", result.getUri().getHost());
    }

    @Test
    public void onlyTheNeteaseSearchGetEndpointAndQueryAreAllowed() {
        String searchUrl =
                "https://music.163.com/api/search/get/web?s=Listen2&type=1&offset=0&limit=20";
        HttpBridgePolicy.ValidationResult result = HttpBridgePolicy.validateRequest("GET", searchUrl);
        assertTrue(result.isValid());
        assertEquals(HttpBridgePolicy.RequestRoute.NETEASE_SEARCH_GET, result.getRoute());

        assertError("NETEASE_POST_NOT_ALLOWED", "POST", searchUrl, "METHOD_NOT_ALLOWED");
        assertError("NETEASE_PATH_NOT_ALLOWED", "GET",
                "https://music.163.com/api/search/pc?s=Listen2&type=1&offset=0&limit=20",
                "PATH_NOT_ALLOWED");
        assertError("NETEASE_HOST_NOT_ALLOWED", "GET",
                "https://music.163.com.evil.example/api/search/get/web?s=Listen2&type=1&offset=0&limit=20",
                "HOST_NOT_ALLOWED");
        assertError("NETEASE_PORT_NOT_ALLOWED", "GET",
                "https://music.163.com:8443/api/search/get/web?s=Listen2&type=1&offset=0&limit=20",
                "PORT_NOT_ALLOWED");
    }

    @Test
    public void neteaseSearchQueryRejectsDuplicateUnboundedAndUnexpectedValues() {
        String base = "https://music.163.com/api/search/get/web";
        assertError("NETEASE_DUPLICATE_KEY", "GET",
                base + "?s=Listen2&s=Other&type=1&offset=0&limit=20", "QUERY_NOT_ALLOWED");
        assertError("NETEASE_UNEXPECTED_KEY", "GET",
                base + "?s=Listen2&type=1&offset=0&limit=20&csrf_token=x", "QUERY_NOT_ALLOWED");
        assertError("NETEASE_TYPE_NOT_ALLOWED", "GET",
                base + "?s=Listen2&type=1018&offset=0&limit=20", "QUERY_NOT_ALLOWED");
        assertError("NETEASE_OFFSET_NOT_ALLOWED", "GET",
                base + "?s=Listen2&type=1&offset=100001&limit=20", "QUERY_NOT_ALLOWED");
        assertError("NETEASE_LIMIT_NOT_ALLOWED", "GET",
                base + "?s=Listen2&type=1&offset=0&limit=21", "QUERY_NOT_ALLOWED");
        assertError("NETEASE_FRAGMENT_NOT_ALLOWED", "GET",
                base + "?s=Listen2&type=1&offset=0&limit=20#ignored", "PATH_NOT_ALLOWED");
    }

    @Test
    public void versionOnePolicyCannotBecomeAVersionTwoOperationTransport() {
        assertError("NETEASE_DETAIL_NOT_V1", "GET",
                "https://music.163.com/api/song/detail?ids=123", "PATH_NOT_ALLOWED");
        assertError("NETEASE_LYRIC_NOT_V1", "GET",
                "https://music.163.com/api/song/lyric?id=123", "PATH_NOT_ALLOWED");
    }

    @Test
    public void onlyValidBilibiliAnonymousCookieValuesAreReused() {
        String validBuvid3 = "A1b2C3d4E5f6G7h8i9j0infoc";
        assertEquals(validBuvid3, HttpBridgePolicy.extractValidBilibiliBuvid3(
                "SESSDATA=private-login-cookie; buvid3=" + validBuvid3 + "; bili_jct=private"));
        assertTrue(HttpBridgePolicy.isValidBilibiliBuvid3(validBuvid3));
        assertFalse(HttpBridgePolicy.isValidBilibiliBuvid3("0"));
        assertFalse(HttpBridgePolicy.isValidBilibiliBuvid3("bad value with spaces"));
        assertFalse(HttpBridgePolicy.isValidBilibiliBuvid3("bad;cookie-injection-1234"));
        assertEquals(null, HttpBridgePolicy.extractValidBilibiliBuvid3("buvid3=0"));
        assertEquals(HttpBridgePolicy.BILIBILI_FINGERPRINT_URL,
                "https://api.bilibili.com/x/frontend/finger/spi");
    }

    private static void assertError(String message, String method, String url, String expectedError) {
        HttpBridgePolicy.ValidationResult result = HttpBridgePolicy.validateRequest(method, url);
        assertFalse(message, result.isValid());
        assertEquals(message, expectedError, result.getErrorCode());
    }
}
