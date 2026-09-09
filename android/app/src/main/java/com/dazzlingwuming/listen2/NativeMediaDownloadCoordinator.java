package com.dazzlingwuming.listen2;

import com.dazzlingwuming.listen2.platform.AndroidMediaCache;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Native-only download ownership above {@link AndroidMediaCache}. The input is
 * a previously validated semantic descriptor, never a page-provided URL,
 * cookie, header, URI, destination or filename. Candidate resolution and the
 * app-private cache remain behind native ports.
 */
public final class NativeMediaDownloadCoordinator {
    public static final String COMPLETED = "COMPLETED";
    public static final String CANCELLED = "CANCELLED";
    public static final String INVALID_INPUT = "INVALID_INPUT";
    public static final String CANDIDATE_UNAVAILABLE = "CANDIDATE_UNAVAILABLE";
    public static final String DUPLICATE_TRACK = "DUPLICATE_TRACK";
    public static final String DUPLICATE_OPERATION = "DUPLICATE_OPERATION";
    public static final String CACHE_FAILED = "CACHE_FAILED";
    public static final String CATALOG_FAILED = "CATALOG_FAILED";

    private static final int MAX_CANDIDATES = 4;
    private static final long MAX_CACHE_BYTES = 2L * 1024L * 1024L * 1024L;
    private static final ConcurrentHashMap<String, CancellationToken> ACTIVE_OPERATIONS =
            new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, String> ACTIVE_TRACKS = new ConcurrentHashMap<>();

    public enum Retention {
        TEMPORARY("temporary"), PLAYLIST("playlist"), DOWNLOAD("download");
        final String wireValue;
        Retention(String wireValue) { this.wireValue = wireValue; }
    }

    /** Trusted native provider resolver; it receives no renderer transport input. */
    public interface CandidateSource {
        CandidateResolution resolve(PlaybackMediaResolver.Descriptor descriptor);
    }

    /** Narrow cache seam permits deterministic JVM tests without a network transport. */
    public interface CachePort {
        CacheResult cache(String opaqueContentKey, AndroidMediaCache.Candidate candidate,
                long maxBytes, AndroidMediaCache.Cancellation cancellation);
    }

    /** Native catalogue writer; a rejection never becomes a completed download. */
    public interface CatalogPort {
        CatalogResult record(CatalogRecord record);
    }

    /** Adapter reserved for an owner that instantiates AndroidMediaCache. */
    public static final class AndroidCachePort implements CachePort {
        private final AndroidMediaCache cache;
        public AndroidCachePort(AndroidMediaCache cache) {
            if (cache == null) throw new IllegalArgumentException("cache required");
            this.cache = cache;
        }
        @Override public CacheResult cache(String key, AndroidMediaCache.Candidate candidate,
                long maxBytes, AndroidMediaCache.Cancellation cancellation) {
            AndroidMediaCache.Result result = cache.cache(key, candidate, maxBytes, cancellation);
            return new CacheResult(result.status, result.byteCount, result.sha256);
        }
    }

    /** Candidate objects have already enforced provider host/scheme policy and expose no URI here. */
    public static final class CandidateResolution {
        private final List<AndroidMediaCache.Candidate> candidates;
        private CandidateResolution(List<AndroidMediaCache.Candidate> candidates) {
            this.candidates = candidates;
        }
        public static CandidateResolution unavailable() {
            return new CandidateResolution(Collections.<AndroidMediaCache.Candidate>emptyList());
        }
        public static CandidateResolution available(List<AndroidMediaCache.Candidate> candidates) {
            if (candidates == null || candidates.isEmpty() || candidates.size() > MAX_CANDIDATES) {
                return unavailable();
            }
            return new CandidateResolution(Collections.unmodifiableList(new ArrayList<>(candidates)));
        }
    }

    /** Cache result has no candidate, URI or local-file field. */
    public static final class CacheResult {
        final String status;
        final long byteCount;
        final String digest;
        public CacheResult(String status, long byteCount, String digest) {
            this.status = status;
            this.byteCount = byteCount;
            this.digest = digest;
        }
    }

    public static final class CatalogRecord {
        final String cacheId;
        final String opaqueContentKey;
        final PlaybackMediaResolver.Descriptor descriptor;
        final long byteCount;
        final String digest;
        final Retention retention;
        CatalogRecord(String cacheId, String opaqueContentKey, PlaybackMediaResolver.Descriptor descriptor,
                long byteCount, String digest, Retention retention) {
            this.cacheId = cacheId;
            this.opaqueContentKey = opaqueContentKey;
            this.descriptor = descriptor;
            this.byteCount = byteCount;
            this.digest = digest;
            this.retention = retention;
        }
    }

    public static final class CatalogResult {
        final boolean accepted;
        private CatalogResult(boolean accepted) { this.accepted = accepted; }
        public static CatalogResult accepted() { return new CatalogResult(true); }
        public static CatalogResult rejected() { return new CatalogResult(false); }
    }

    /** Page-safe terminal shape. No transport, app-private or operation fields are present. */
    public static final class DownloadResult {
        public final String status;
        public final String source;
        public final String providerTrackId;
        public final long byteCount;
        public final String digest;
        public final String retention;

        private DownloadResult(String status, PlaybackMediaResolver.Descriptor descriptor, long byteCount,
                String digest, Retention retention) {
            this.status = status;
            this.source = descriptor == null ? "" : descriptor.getSource();
            this.providerTrackId = descriptor == null ? "" : descriptor.getProviderTrackId();
            this.byteCount = Math.max(0L, byteCount);
            this.digest = validDigest(digest) ? digest : "";
            this.retention = retention == null ? "" : retention.wireValue;
        }
    }

    private final CandidateSource candidates;
    private final CachePort cache;
    private final CatalogPort catalogue;
    private final long maxBytes;

    public NativeMediaDownloadCoordinator(CandidateSource candidates, CachePort cache,
            CatalogPort catalogue, long maxBytes) {
        if (candidates == null || cache == null || catalogue == null || maxBytes <= 0L
                || maxBytes > MAX_CACHE_BYTES) throw new IllegalArgumentException("native ports required");
        this.candidates = candidates;
        this.cache = cache;
        this.catalogue = catalogue;
        this.maxBytes = maxBytes;
    }

    public DownloadResult download(String operationId, PlaybackMediaResolver.Descriptor descriptor,
            Retention retention) {
        if (!validOperation(operationId) || descriptor == null || !descriptor.isSafe()
                || !isCacheableProvider(descriptor.getSource()) || retention == null) {
            return result(INVALID_INPUT, descriptor, 0L, "", retention);
        }
        String trackKey = trackKey(descriptor);
        CancellationToken token = new CancellationToken();
        String existingTrack = ACTIVE_TRACKS.putIfAbsent(trackKey, operationId);
        if (existingTrack != null) return result(DUPLICATE_TRACK, descriptor, 0L, "", retention);
        if (ACTIVE_OPERATIONS.putIfAbsent(operationId, token) != null) {
            ACTIVE_TRACKS.remove(trackKey, operationId);
            return result(DUPLICATE_OPERATION, descriptor, 0L, "", retention);
        }
        try {
            if (token.isCancelled()) return result(CANCELLED, descriptor, 0L, "", retention);
            CandidateResolution resolved;
            try {
                resolved = candidates.resolve(descriptor);
            } catch (RuntimeException ignored) {
                return result(CANDIDATE_UNAVAILABLE, descriptor, 0L, "", retention);
            }
            if (resolved == null || resolved.candidates.isEmpty()) {
                return result(CANDIDATE_UNAVAILABLE, descriptor, 0L, "", retention);
            }
            String contentKey = contentKeyFor(descriptor);
            CacheResult lastFailure = null;
            for (AndroidMediaCache.Candidate candidate : resolved.candidates) {
                if (token.isCancelled()) return result(CANCELLED, descriptor, 0L, "", retention);
                if (candidate == null || !candidate.matchesProvider(descriptor.getSource())) continue;
                CacheResult cached = cache.cache(contentKey, candidate, maxBytes, token);
                if (cached == null) continue;
                if (AndroidMediaCache.CANCELLED.equals(cached.status) || token.isCancelled()) {
                    return result(CANCELLED, descriptor, 0L, "", retention);
                }
                if (!isCacheCompletion(cached)) {
                    lastFailure = cached;
                    if (!retryableCacheStatus(cached.status)) break;
                    continue;
                }
                if (token.isCancelled()) return result(CANCELLED, descriptor, 0L, "", retention);
                CatalogResult catalogued;
                try {
                    catalogued = catalogue.record(new CatalogRecord(cacheIdFor(descriptor), contentKey,
                            descriptor, cached.byteCount, cached.digest, retention));
                } catch (RuntimeException ignored) {
                    return result(CATALOG_FAILED, descriptor, cached.byteCount, cached.digest, retention);
                }
                if (catalogued == null || !catalogued.accepted) {
                    return result(CATALOG_FAILED, descriptor, cached.byteCount, cached.digest, retention);
                }
                return result(COMPLETED, descriptor, cached.byteCount, cached.digest, retention);
            }
            return result(lastFailure == null ? CANDIDATE_UNAVAILABLE : CACHE_FAILED, descriptor,
                    0L, "", retention);
        } catch (RuntimeException ignored) {
            return result(CACHE_FAILED, descriptor, 0L, "", retention);
        } finally {
            ACTIVE_OPERATIONS.remove(operationId, token);
            ACTIVE_TRACKS.remove(trackKey, operationId);
        }
    }

    /** Cancellation is keyed only by an opaque native operation ID. */
    public boolean cancel(String operationId) {
        CancellationToken token = ACTIVE_OPERATIONS.get(operationId);
        if (token == null) return false;
        token.cancel();
        return true;
    }

    private static boolean isCacheCompletion(CacheResult value) {
        return value.byteCount > 0L && validDigest(value.digest)
                && (AndroidMediaCache.COMPLETED.equals(value.status)
                        || AndroidMediaCache.ALREADY_CACHED.equals(value.status));
    }

    private static boolean retryableCacheStatus(String status) {
        return AndroidMediaCache.NETWORK_FAILED.equals(status) || AndroidMediaCache.TIMEOUT.equals(status)
                || AndroidMediaCache.RESPONSE_REJECTED.equals(status);
    }

    private static boolean validDigest(String digest) {
        return digest != null && digest.matches("[0-9a-f]{64}");
    }

    private static boolean validOperation(String operationId) {
        return operationId != null && operationId.matches("[A-Za-z0-9._-]{1,96}");
    }

    private static boolean isCacheableProvider(String source) {
        return "bilibili".equals(source) || "netease".equals(source);
    }

    private static String trackKey(PlaybackMediaResolver.Descriptor descriptor) {
        return descriptor.getSource() + "\u0000" + descriptor.getProviderTrackId() + "\u0000"
                + descriptor.getProviderPartId();
    }

    /** Shared only with the native playback owner for offline cache lookup. */
    static String contentKeyFor(PlaybackMediaResolver.Descriptor descriptor) {
        return "media." + digest("content\u0000" + trackKey(descriptor));
    }

    /** Native-only catalogue identity; never put this opaque value in a page reply. */
    static String cacheIdFor(PlaybackMediaResolver.Descriptor descriptor) {
        return "cache." + digest("catalogue\u0000" + trackKey(descriptor));
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(bytes.length * 2);
            for (byte valueByte : bytes) out.append(String.format(Locale.ROOT, "%02x", valueByte));
            return out.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static DownloadResult result(String status, PlaybackMediaResolver.Descriptor descriptor,
            long bytes, String digest, Retention retention) {
        return new DownloadResult(status, descriptor, bytes, digest, retention);
    }

    private static final class CancellationToken implements AndroidMediaCache.Cancellation {
        private volatile boolean cancelled;
        @Override public boolean isCancelled() { return cancelled; }
        void cancel() { cancelled = true; }
    }
}
