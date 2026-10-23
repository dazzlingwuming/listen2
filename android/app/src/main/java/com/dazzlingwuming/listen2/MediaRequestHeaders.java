package com.dazzlingwuming.listen2;

import java.net.URI;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Fixed public request metadata for approved media hosts; never accepts page headers. */
public final class MediaRequestHeaders {
    // These are web-player CDN URLs. The mobile-browser UA is rejected by
    // Bilibili's regular mirrors even when Referer and the signed URL are valid.
    static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

    private MediaRequestHeaders() {}

    public static Map<String, String> forUri(URI uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())
                || uri.getHost() == null || uri.getUserInfo() != null) {
            return Collections.emptyMap();
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        String referer;
        if (BilibiliMediaPolicy.permits(uri)) {
            referer = "https://www.bilibili.com/";
        } else if ((uri.getPort() == -1 || uri.getPort() == 443)
                && (matches(host, "music.163.com") || matches(host, "music.126.net"))) {
            referer = "https://music.163.com/";
        } else {
            return Collections.emptyMap();
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("User-Agent", USER_AGENT);
        headers.put("Referer", referer);
        return Collections.unmodifiableMap(headers);
    }

    private static boolean matches(String host, String suffix) {
        return host.equals(suffix) || host.endsWith("." + suffix);
    }
}
