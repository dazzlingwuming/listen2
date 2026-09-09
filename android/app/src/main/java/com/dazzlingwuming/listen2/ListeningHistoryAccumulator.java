package com.dazzlingwuming.listen2;

/**
 * Pure playback-time accumulator for durable listening history. It counts
 * bounded forward playback time instead of media position, so seeking cannot
 * manufacture listening time and long lifecycle gaps cannot create a record.
 */
final class ListeningHistoryAccumulator {
    private static final long MAX_OBSERVATION_GAP_MS = 5_000L;
    private static final long PERSIST_INTERVAL_MS = 15_000L;

    static final class Sample {
        final String sessionId;
        final String source;
        final String providerTrackId;
        final String title;
        final String artist;
        final long cumulativePlayedMs;
        final long durationMs;
        final long occurredAtMs;

        Sample(String sessionId, String source, String providerTrackId, String title, String artist,
                long cumulativePlayedMs, long durationMs, long occurredAtMs) {
            this.sessionId = sessionId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.title = title;
            this.artist = artist;
            this.cumulativePlayedMs = cumulativePlayedMs;
            this.durationMs = durationMs;
            this.occurredAtMs = occurredAtMs;
        }
    }

    private String sessionId = "";
    private String source = "";
    private String providerTrackId = "";
    private String title = "";
    private String artist = "";
    private long durationMs;
    private long occurredAtMs;
    private long cumulativePlayedMs;
    private long reportedPlayedMs;
    private long lastObservedAtMs = -1L;
    private long lastPositionMs = -1L;
    private boolean previouslyPlaying;

    void begin(String sessionId, String source, String providerTrackId, String title, String artist,
            long durationMs, long occurredAtMs) {
        this.sessionId = safe(sessionId);
        this.source = safe(source);
        this.providerTrackId = safe(providerTrackId);
        this.title = safe(title);
        this.artist = safe(artist);
        this.durationMs = Math.max(0L, durationMs);
        this.occurredAtMs = occurredAtMs;
        cumulativePlayedMs = 0L;
        reportedPlayedMs = 0L;
        lastObservedAtMs = -1L;
        lastPositionMs = -1L;
        previouslyPlaying = false;
    }

    Sample observe(long positionMs, boolean isPlaying, long nowMs) {
        long safePosition = Math.max(0L, positionMs);
        if (isActive() && previouslyPlaying && lastObservedAtMs >= 0L && nowMs >= lastObservedAtMs) {
            long elapsed = nowMs - lastObservedAtMs;
            long advanced = lastPositionMs < 0L ? 0L : safePosition - lastPositionMs;
            // Count only normal forward progression. A seek, replay, suspended
            // process, or clock jump becomes a new baseline rather than history.
            if (elapsed <= MAX_OBSERVATION_GAP_MS && advanced >= 0L
                    && advanced <= elapsed + 2_000L) {
                cumulativePlayedMs = Math.min(durationMs,
                        cumulativePlayedMs + Math.min(elapsed, advanced + 1_000L));
            }
        }
        lastObservedAtMs = nowMs;
        lastPositionMs = safePosition;
        previouslyPlaying = isPlaying;
        return snapshot();
    }

    Sample snapshot() {
        if (!isActive()) return null;
        return new Sample(sessionId, source, providerTrackId, title, artist,
                cumulativePlayedMs, durationMs, occurredAtMs);
    }

    void updateDuration(long observedDurationMs) {
        if (observedDurationMs > 30_000L) durationMs = observedDurationMs;
    }

    /** Returns a cumulative idempotent sample only when a durable write is worthwhile. */
    Sample drainForPersistence(boolean force) {
        if (!isActive() || cumulativePlayedMs <= reportedPlayedMs) return null;
        if (!force && cumulativePlayedMs - reportedPlayedMs < PERSIST_INTERVAL_MS) return null;
        reportedPlayedMs = cumulativePlayedMs;
        return snapshot();
    }

    void clear() {
        begin("", "", "", "", "", 0L, 0L);
    }

    private boolean isActive() {
        return !sessionId.isEmpty() && !source.isEmpty() && !providerTrackId.isEmpty()
                && durationMs > 30_000L && occurredAtMs > 0L;
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
