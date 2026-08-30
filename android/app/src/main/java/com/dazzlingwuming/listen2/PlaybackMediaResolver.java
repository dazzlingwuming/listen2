package com.dazzlingwuming.listen2;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Mints native-only identity for logical provider audio selections. Candidate
 * URLs are obtained only from the typed native seam, stay in memory for one
 * occurrence, and never appear in durable or page-facing values.
 */
public final class PlaybackMediaResolver {
    private static final int MAX_TEXT = 256;
    private static final int MAX_CANDIDATES = 4;
    private static final long MAX_DURATION_MS = 28_800_000L;

    public interface ManifestPort {
        List<String> resolve(Descriptor descriptor);

        /** A source-specific actionable result when no transient candidate can be issued. */
        default String unavailableStatus() {
            return "no-safe-candidate";
        }
    }

    public interface HandleSource {
        String next();
    }

    public interface Clock {
        long nowEpochSeconds();
    }

    public static final class Descriptor {
        private final String source;
        private final String providerTrackId;
        private final long providerPartId;
        private final String title;
        private final String artist;
        private final long durationMs;
        private final String mediaKind;

        public Descriptor(String source, String providerTrackId, long providerPartId, String title, String artist,
                long durationMs, String mediaKind) {
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.providerPartId = providerPartId;
            this.title = title;
            this.artist = artist;
            this.durationMs = durationMs;
            this.mediaKind = mediaKind;
        }

        public String getSource() { return source; }
        /** Legacy Bilibili aliases retained for existing native-only callers. */
        public String getBvid() { return providerTrackId; }
        public long getCid() { return providerPartId; }
        public String getProviderTrackId() { return providerTrackId; }
        public long getProviderPartId() { return providerPartId; }
        public String getTitle() { return title; }
        public String getArtist() { return artist; }
        public long getDurationMs() { return durationMs; }
        public String getMediaKind() { return mediaKind; }

        boolean isSafe() {
            return isProviderIdentitySafe() && isText(title)
                    && isText(artist) && durationMs >= 0L && durationMs <= MAX_DURATION_MS
                    && "audio".equals(mediaKind);
        }

        private boolean isProviderIdentitySafe() {
            if (providerPartId <= 0L) return false;
            if ("bilibili".equals(source)) return isBvid(providerTrackId);
            return "netease".equals(source) && providerTrackId != null
                    && providerTrackId.matches("[1-9][0-9]{0,17}");
        }
    }

    public static final class Prepared {
        private final String trackHandle;
        private final String occurrenceId;
        private final Descriptor descriptor;
        private boolean consumed;

        Prepared(String trackHandle, String occurrenceId, Descriptor descriptor) {
            this.trackHandle = trackHandle;
            this.occurrenceId = occurrenceId;
            this.descriptor = descriptor;
        }

        public String getTrackHandle() { return trackHandle; }
        public String getOccurrenceId() { return occurrenceId; }
        Descriptor descriptor() { return descriptor; }
    }

    public static final class Selection {
        private final boolean accepted;
        private final String code;
        private final String occurrenceId;
        private final long expectedRevision;
        private final boolean playWhenReady;

        private Selection(boolean accepted, String code, String occurrenceId, long expectedRevision,
                boolean playWhenReady) {
            this.accepted = accepted;
            this.code = code;
            this.occurrenceId = occurrenceId;
            this.expectedRevision = expectedRevision;
            this.playWhenReady = playWhenReady;
        }

        static Selection accepted(String occurrenceId, long revision, boolean playWhenReady) {
            return new Selection(true, "accepted", occurrenceId, revision, playWhenReady);
        }
        static Selection rejected(String code, long revision) {
            return new Selection(false, code, "", revision, false);
        }
        public boolean isAccepted() { return accepted; }
        public String getOccurrenceId() { return occurrenceId; }
        public long getExpectedRevision() { return expectedRevision; }
        public boolean isPlayWhenReady() { return playWhenReady; }
    }

    /** Internal resolution result: it does not serialize candidates. */
    public static final class Resolution {
        private final boolean ready;
        private final boolean paused;
        private final String status;
        private final List<String> candidates;

        private Resolution(boolean ready, boolean paused, String status, List<String> candidates) {
            this.ready = ready;
            this.paused = paused;
            this.status = status;
            this.candidates = Collections.unmodifiableList(new ArrayList<>(candidates));
        }
        static Resolution ready(List<String> candidates) {
            return new Resolution(true, false, "ready", candidates);
        }
        static Resolution failed(String status, boolean paused) {
            return new Resolution(false, paused, status, Collections.<String>emptyList());
        }
        public boolean isReady() { return ready; }
        public boolean isPaused() { return paused; }
        public String getStatus() { return status; }
        public int getCandidateCount() { return candidates.size(); }
        List<String> candidates() { return candidates; }
        public Map<String, Object> toSnapshotFields() {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("status", status);
            values.put("retryable", !ready);
            return Collections.unmodifiableMap(values);
        }
    }

    public static final class IncrementingHandleSource implements HandleSource {
        private final String prefix;
        private long sequence;
        public IncrementingHandleSource(String prefix) { this.prefix = prefix; }
        @Override public String next() { return prefix + "-" + Long.toString(++sequence, 36); }
    }

    private final ManifestPort manifest;
    private final HandleSource handles;
    private final Clock clock;
    private final Map<String, Prepared> preparedByTrack = new LinkedHashMap<>();
    private Prepared selected;
    private long selectedRevision = -1L;

    public PlaybackMediaResolver(ManifestPort manifest, HandleSource handles, Clock clock) {
        if (manifest == null || handles == null || clock == null) throw new IllegalArgumentException("ports required");
        this.manifest = manifest;
        this.handles = handles;
        this.clock = clock;
    }

    public Prepared prepare(Descriptor descriptor) {
        if (descriptor == null || !descriptor.isSafe()) return null;
        String suffix = handles.next();
        if (!isLogicalId(suffix)) return null;
        Prepared prepared = new Prepared("track-" + suffix, "occ-" + suffix, descriptor);
        preparedByTrack.put(prepared.trackHandle, prepared);
        return prepared;
    }

    public Selection select(String trackHandle, String occurrenceId, long expectedRevision,
            String action, boolean playWhenReady) {
        Prepared prepared = preparedByTrack.get(trackHandle);
        if (prepared == null || prepared.consumed || !prepared.occurrenceId.equals(occurrenceId)
                || expectedRevision < 0L || !("replace-current".equals(action) || "enqueue-next".equals(action))) {
            return Selection.rejected("stale-or-unregistered-selection", expectedRevision);
        }
        prepared.consumed = true;
        preparedByTrack.remove(trackHandle);
        selected = prepared;
        selectedRevision = expectedRevision;
        return Selection.accepted(occurrenceId, expectedRevision, playWhenReady);
    }

    public Resolution resolveCurrent(String occurrenceId, long expectedRevision) {
        if (!isCurrent(occurrenceId, expectedRevision)) return Resolution.failed("stale-selection", true);
        return resolveFresh(selected.descriptor());
    }

    /** Recovery purposely starts fresh and never reuses an old signed candidate. */
    public Resolution restoreCurrent(String occurrenceId, long expectedRevision) {
        if (!isCurrent(occurrenceId, expectedRevision)) return Resolution.failed("stale-selection", true);
        return Resolution.failed("refresh-unavailable", true);
    }

    private Resolution resolveFresh(Descriptor descriptor) {
        List<String> raw;
        try {
            raw = manifest.resolve(descriptor);
        } catch (RuntimeException ignored) {
            return Resolution.failed("manifest-unavailable", true);
        }
        if (raw == null) return Resolution.failed("manifest-unavailable", true);
        LinkedHashSet<String> safe = new LinkedHashSet<>();
        for (String candidate : raw) {
            if (isSafeCandidate(candidate)) safe.add(candidate);
            if (safe.size() == MAX_CANDIDATES) break;
        }
        return safe.isEmpty() ? Resolution.failed(manifest.unavailableStatus(), true)
                : Resolution.ready(new ArrayList<>(safe));
    }

    private boolean isCurrent(String occurrenceId, long expectedRevision) {
        return selected != null && selected.occurrenceId.equals(occurrenceId)
                && selectedRevision == expectedRevision;
    }

    private boolean isSafeCandidate(String candidate) {
        if (candidate == null || candidate.length() > 2048) return false;
        try {
            URI uri = new URI(candidate);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getUserInfo() != null
                    || uri.getRawFragment() != null || !isSourceCandidateHost(selected.descriptor().getSource(), host)) {
                return false;
            }
            long deadline = deadline(uri.getRawQuery());
            return deadline > clock.nowEpochSeconds();
        } catch (URISyntaxException ignored) {
            return false;
        }
    }

    private static long deadline(String query) {
        if (query == null) return 0L;
        for (String pair : query.split("&")) {
            if (pair.startsWith("deadline=")) {
                try { return Long.parseLong(pair.substring(9)); } catch (NumberFormatException ignored) { return 0L; }
            }
        }
        return 0L;
    }

    private static boolean isBvid(String value) {
        return value != null && value.matches("BV[0-9A-Za-z]{10}");
    }

    private static boolean isSourceCandidateHost(String source, String host) {
        if ("bilibili".equals(source)) {
            return host.equals("bilivideo.com") || host.endsWith(".bilivideo.com");
        }
        return "netease".equals(source)
                && (host.equals("music.163.com") || host.endsWith(".music.163.com"));
    }
    private static boolean isText(String value) {
        return value != null && !value.isEmpty() && value.length() <= MAX_TEXT
                && value.indexOf('\u0000') < 0 && value.indexOf('<') < 0 && value.indexOf('>') < 0;
    }
    private static boolean isLogicalId(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,96}");
    }
}
