package com.dazzlingwuming.listen2;

import java.net.URI;
import java.util.Locale;

/** CDN locations issued by the fixed Bilibili manifest endpoint. */
public final class BilibiliMediaPolicy {
    private BilibiliMediaPolicy() {}

    public static boolean permits(URI uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())
                || uri.getHost() == null || uri.getUserInfo() != null
                || uri.getRawFragment() != null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        int port = uri.getPort();
        // Bilibili's MCDN responses include HTTPS ports such as 8082 and 4483.
        // Preserve the provider-issued endpoint; do not substitute a host or port.
        if (host.endsWith(".mcdn.bilivideo.cn")) {
            return port == -1 || port > 0 && port <= 65535;
        }
        return (port == -1 || port == 443)
                && (host.equals("bilivideo.com") || host.endsWith(".bilivideo.com")
                || host.equals("bilivideo.cn") || host.endsWith(".bilivideo.cn"));
    }
}
