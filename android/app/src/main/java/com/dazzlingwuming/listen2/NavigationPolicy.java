package com.dazzlingwuming.listen2;

import java.net.URI;
import java.net.URISyntaxException;

/** Security boundary for URLs handled inside the packaged WebView. */
final class NavigationPolicy {
    static final boolean ALLOW_FILE_ACCESS_FROM_FILE_URLS = false;
    static final boolean ALLOW_UNIVERSAL_ACCESS_FROM_FILE_URLS = false;
    static final String APP_ASSET_HOST = "appassets.androidplatform.net";
    static final String APP_ASSET_PATH_PREFIX = "/assets/listen1/";

    private NavigationPolicy() {}

    static boolean isPackagedAssetUrl(String rawUrl) {
        try {
            URI uri = new URI(rawUrl);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && APP_ASSET_HOST.equalsIgnoreCase(uri.getHost())
                    && uri.getPath() != null
                    && uri.getPath().startsWith(APP_ASSET_PATH_PREFIX);
        } catch (URISyntaxException | NullPointerException ignored) {
            return false;
        }
    }

    static boolean isApprovedExternalUrl(String rawUrl) {
        try {
            URI uri = new URI(rawUrl);
            String scheme = uri.getScheme();
            return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                    && !isPackagedAssetUrl(rawUrl);
        } catch (URISyntaxException | NullPointerException ignored) {
            return false;
        }
    }
}
