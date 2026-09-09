package com.dazzlingwuming.listen2.provider;

import java.util.UUID;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/**
 * Native-owned Bilibili QR-login state machine. QR tokens, cookies and refresh
 * material never enter a PublicState and must stay within the gateway/vault.
 */
public final class BilibiliAccountSession {
    public enum Status { IDLE, WAITING, SCANNED, AUTHENTICATED, EXPIRED, CANCELLED, ERROR, UNAVAILABLE }

    public interface QrGateway {
        QrChallenge begin() throws Exception;
        PollResult poll(String opaqueChallenge) throws Exception;
        void logout() throws Exception;
        default boolean hasAuthenticatedSession() { return false; }
    }

    /** Protected platform storage seam; implementations must not log values. */
    public interface CredentialVault {
        boolean isAvailable();
        void save(String refreshMaterial) throws Exception;
        void clear() throws Exception;
        default boolean hasStoredCredential() { return false; }
    }

    /** Gateway-only input. It is never sent to the page or included in errors. */
    public static final class QrChallenge {
        final String opaqueChallenge;
        final String qrUrl;
        final long expiresAtEpochMs;

        public QrChallenge(String opaqueChallenge, long expiresAtEpochMs) {
            this(opaqueChallenge, "", expiresAtEpochMs);
        }

        public QrChallenge(String opaqueChallenge, String qrUrl, long expiresAtEpochMs) {
            this.opaqueChallenge = opaqueChallenge;
            this.qrUrl = qrUrl;
            this.expiresAtEpochMs = expiresAtEpochMs;
        }
    }

    /** Gateway-only poll result. refreshMaterial is committed only through the vault. */
    public static final class PollResult {
        public final Status status;
        public final String refreshMaterial;

        public PollResult(Status status, String refreshMaterial) {
            this.status = status;
            this.refreshMaterial = refreshMaterial;
        }
    }

    /** The only page-safe account projection. */
    public static final class PublicState {
        private final String sessionId;
        private final Status status;
        private final long expiresAtEpochMs;
        private final String qrUrl;

        PublicState(String sessionId, Status status, long expiresAtEpochMs, String qrUrl) {
            this.sessionId = sessionId;
            this.status = status;
            this.expiresAtEpochMs = expiresAtEpochMs;
            this.qrUrl = qrUrl;
        }

        public String getSessionId() { return sessionId; }
        public Status getStatus() { return status; }
        public long getExpiresAtEpochMs() { return expiresAtEpochMs; }
        public String getQrUrl() { return qrUrl; }
    }

    private final QrGateway gateway;
    private final CredentialVault vault;
    private String sessionId = "";
    private String opaqueChallenge;
    private String qrUrl = "";
    private long expiresAtEpochMs;
    private Status status = Status.IDLE;

    public BilibiliAccountSession(QrGateway gateway, CredentialVault vault) {
        this.gateway = gateway;
        this.vault = vault;
        if (gateway != null && vault != null && vault.isAvailable()
                && gateway.hasAuthenticatedSession() && vault.hasStoredCredential()) {
            status = Status.AUTHENTICATED;
        }
    }

    public synchronized PublicState begin(long nowEpochMs) {
        clearTransient();
        if (gateway == null || vault == null || !vault.isAvailable()) {
            status = Status.UNAVAILABLE;
            return snapshot();
        }
        try {
            QrChallenge challenge = gateway.begin();
            if (challenge == null || !safeChallenge(challenge.opaqueChallenge) || !safeQrUrl(challenge.qrUrl)
                    || challenge.expiresAtEpochMs <= nowEpochMs) {
                status = Status.ERROR;
                return snapshot();
            }
            sessionId = UUID.randomUUID().toString();
            opaqueChallenge = challenge.opaqueChallenge;
            qrUrl = challenge.qrUrl;
            expiresAtEpochMs = challenge.expiresAtEpochMs;
            status = Status.WAITING;
        } catch (Exception ignored) {
            status = Status.ERROR;
        }
        return snapshot();
    }

    public synchronized PublicState poll(String requestedSessionId, long nowEpochMs) {
        if (!sameSession(requestedSessionId)) return snapshotWith(Status.CANCELLED);
        if (status != Status.WAITING && status != Status.SCANNED) return snapshot();
        if (nowEpochMs >= expiresAtEpochMs) {
            clearTransient();
            status = Status.EXPIRED;
            return snapshot();
        }
        try {
            PollResult result = gateway.poll(opaqueChallenge);
            if (result == null || result.status == null) throw new IllegalStateException();
            if (result.status == Status.AUTHENTICATED) {
                if (result.refreshMaterial == null || result.refreshMaterial.isEmpty()) throw new IllegalStateException();
                vault.save(result.refreshMaterial);
                clearTransient();
                status = Status.AUTHENTICATED;
            } else if (result.status == Status.WAITING || result.status == Status.SCANNED
                    || result.status == Status.EXPIRED) {
                status = result.status;
                if (status == Status.EXPIRED) clearTransient();
            } else {
                clearTransient();
                status = Status.ERROR;
            }
        } catch (Exception ignored) {
            clearTransient();
            status = Status.ERROR;
        }
        return snapshot();
    }

    public synchronized PublicState cancel(String requestedSessionId) {
        if (sameSession(requestedSessionId)) {
            clearTransient();
            status = Status.CANCELLED;
        }
        return snapshot();
    }

    public synchronized PublicState logout() {
        try {
            if (gateway != null) gateway.logout();
            if (vault != null) vault.clear();
            clearTransient();
            status = Status.IDLE;
        } catch (Exception ignored) {
            status = Status.ERROR;
        }
        return snapshot();
    }

    public synchronized PublicState snapshot() {
        return snapshotWith(status);
    }

    /** Lets the bridge project login truth only after native gateway/vault injection. */
    public boolean isAvailable() {
        return gateway != null && vault != null && vault.isAvailable();
    }

    private PublicState snapshotWith(Status requestedStatus) {
        String publicQrUrl = requestedStatus == Status.WAITING || requestedStatus == Status.SCANNED
                ? qrUrl : "";
        return new PublicState(sessionId, requestedStatus, expiresAtEpochMs, publicQrUrl);
    }

    private boolean sameSession(String requestedSessionId) {
        return requestedSessionId != null && !sessionId.isEmpty() && sessionId.equals(requestedSessionId);
    }

    private void clearTransient() {
        opaqueChallenge = null;
        qrUrl = "";
        expiresAtEpochMs = 0L;
    }

    private static boolean safeChallenge(String value) {
        return value != null && !value.isEmpty() && value.length() <= 1024;
    }

    /**
     * QR rendering is an exceptional page-visible URL. Bilibili's documented
     * scan endpoint needs the one-time qrcode_key in its own query, but this is
     * render-only: it is never separately projected or accepted from the page.
     */
    private static boolean safeQrUrl(String value) {
        if (value == null || value.length() > 2048) return false;
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"passport.bilibili.com".equals(uri.getHost())
                    || uri.getUserInfo() != null || uri.getRawFragment() != null
                    || !"/h5-app/passport/login/scan".equals(uri.getRawPath())) return false;
            String query = uri.getRawQuery();
            if (query == null || query.isEmpty()) return false;
            Set<String> seen = new HashSet<>();
            boolean hasQrKey = false;
            for (String pair : query.split("&", -1)) {
                int separator = pair.indexOf('=');
                if (separator <= 0 || separator != pair.lastIndexOf('=')) return false;
                String key = URLDecoder.decode(pair.substring(0, separator), StandardCharsets.UTF_8.name());
                String item = URLDecoder.decode(pair.substring(separator + 1), StandardCharsets.UTF_8.name());
                if (!seen.add(key) || ("qrcode_key".equals(key) && !item.matches("[A-Za-z0-9_-]{1,256}"))
                        || ("navhide".equals(key) && !("0".equals(item) || "1".equals(item)))) return false;
                if ("qrcode_key".equals(key)) hasQrKey = true;
                else if (!"navhide".equals(key)) return false;
            }
            return hasQrKey;
        } catch (URISyntaxException ignored) {
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }
}
