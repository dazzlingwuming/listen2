package com.dazzlingwuming.listen2;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Security boundary for URLs handled inside the packaged WebView. */
final class NavigationPolicy {
    static final boolean ALLOW_FILE_ACCESS_FROM_FILE_URLS = false;
    static final boolean ALLOW_UNIVERSAL_ACCESS_FROM_FILE_URLS = false;
    static final String APP_ASSET_HOST = "appassets.androidplatform.net";
    static final String APP_ASSET_PATH_PREFIX = "/assets/listen1/";

    private NavigationPolicy() {}

    /**
     * An explicit navigation outcome keeps policy decisions separate from Android intent dispatch.
     * The only URI exposed to the host is the already-sanitized external value.
     */
    static final class ExternalNavigationDecision {
        private enum Kind { PACKAGED, EXTERNAL, BLOCKED }

        private final Kind kind;
        private final URI externalUri;

        private ExternalNavigationDecision(Kind kind, URI externalUri) {
            this.kind = kind;
            this.externalUri = externalUri;
        }

        static ExternalNavigationDecision packaged() {
            return new ExternalNavigationDecision(Kind.PACKAGED, null);
        }

        static ExternalNavigationDecision external(URI uri) {
            return new ExternalNavigationDecision(Kind.EXTERNAL, uri);
        }

        static ExternalNavigationDecision blocked() {
            return new ExternalNavigationDecision(Kind.BLOCKED, null);
        }

        boolean isPackaged() {
            return kind == Kind.PACKAGED;
        }

        boolean isExternal() {
            return kind == Kind.EXTERNAL;
        }

        boolean isBlocked() {
            return kind == Kind.BLOCKED;
        }

        URI getExternalUri() {
            return externalUri;
        }
    }

    static boolean isPackagedAssetUrl(String rawUrl) {
        return decideNavigation(rawUrl).isPackaged();
    }

    static boolean isApprovedExternalUrl(String rawUrl) {
        return decideNavigation(rawUrl).isExternal();
    }

    static ExternalNavigationDecision decideNavigation(String rawUrl) {
        URI uri = parse(rawUrl);
        if (uri == null) return ExternalNavigationDecision.blocked();
        if (isPackagedAssetUri(uri)) return ExternalNavigationDecision.packaged();

        URI sanitizedExternal = sanitizeExternalUri(uri);
        return sanitizedExternal == null
                ? ExternalNavigationDecision.blocked()
                : ExternalNavigationDecision.external(sanitizedExternal);
    }

    private static URI parse(String rawUrl) {
        if (rawUrl == null || rawUrl.length() > 4096) return null;
        try {
            return new URI(rawUrl);
        } catch (URISyntaxException | NullPointerException ignored) {
            return null;
        }
    }

    private static boolean isPackagedAssetUri(URI uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !APP_ASSET_HOST.equalsIgnoreCase(uri.getHost())
                || uri.getRawUserInfo() != null
                || !isNormalPort(uri, 443)
                || uri.getRawQuery() != null) {
            return false;
        }
        String rawPath = uri.getRawPath();
        if (rawPath == null || rawPath.indexOf('\\') >= 0 || hasEncodedTraversal(rawPath)) {
            return false;
        }
        URI normalized = uri.normalize();
        String normalizedPath = normalized.getRawPath();
        return rawPath.equals(normalizedPath)
                && rawPath.startsWith(APP_ASSET_PATH_PREFIX)
                && rawPath.length() > APP_ASSET_PATH_PREFIX.length();
    }

    private static URI sanitizeExternalUri(URI uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return null;
        String normalizedScheme = scheme.toLowerCase(Locale.ROOT);
        int normalPort;
        if ("https".equals(normalizedScheme)) {
            normalPort = 443;
        } else if ("http".equals(normalizedScheme)) {
            normalPort = 80;
        } else {
            return null;
        }
        if (uri.getHost() == null || uri.getRawUserInfo() != null || !isNormalPort(uri, normalPort)
                || containsSensitiveParameter(uri.getRawQuery())
                || containsSensitiveParameter(uri.getRawFragment())) {
            return null;
        }
        String rawPath = uri.getRawPath();
        if (rawPath == null || rawPath.isEmpty()) rawPath = "/";
        if (rawPath.indexOf('\\') >= 0 || hasEncodedTraversal(rawPath)) return null;
        String normalizedPath = uri.normalize().getRawPath();
        if (normalizedPath == null || normalizedPath.isEmpty()) normalizedPath = "/";
        try {
            // Drop fragments completely. They are never needed for a safe system handoff and can
            // otherwise transport secret-bearing state outside this trusted page.
            return new URI(normalizedScheme, null, uri.getHost().toLowerCase(Locale.ROOT),
                    uri.getPort(), normalizedPath, uri.getRawQuery(), null);
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    private static boolean isNormalPort(URI uri, int normalPort) {
        return uri.getPort() == -1 || uri.getPort() == normalPort;
    }

    private static boolean hasEncodedTraversal(String rawPath) {
        String lowerPath = rawPath.toLowerCase(Locale.ROOT);
        return lowerPath.contains("%2e") || lowerPath.contains("%2f") || lowerPath.contains("%5c");
    }

    private static boolean containsSensitiveParameter(String rawComponent) {
        if (rawComponent == null || rawComponent.isEmpty()) return false;
        String[] parameters = rawComponent.split("[&;]");
        for (String parameter : parameters) {
            int equalsIndex = parameter.indexOf('=');
            String rawName = equalsIndex >= 0 ? parameter.substring(0, equalsIndex) : parameter;
            String name = URLDecoder.decode(rawName, StandardCharsets.UTF_8)
                    .toLowerCase(Locale.ROOT);
            if ("token".equals(name) || "access_token".equals(name)
                    || "cookie".equals(name) || "signature".equals(name)
                    || "sig".equals(name) || "sign".equals(name)
                    || "authorization".equals(name) || "auth".equals(name)
                    || "session".equals(name) || "secret".equals(name)
                    || "credential".equals(name) || "password".equals(name)
                    || "api_key".equals(name) || "apikey".equals(name)
                    || "key".equals(name)) {
                return true;
            }
        }
        return false;
    }
}
