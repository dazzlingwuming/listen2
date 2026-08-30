package com.dazzlingwuming.listen2;

/** Pure native projection: only an accepted Media3 clock can advance a lyric context. */
public final class LyricClockProjection {
    private static final long MAX_DURATION_MS = 28_800_000L;

    public enum Event { STATE, SEEK, TRANSITION, ERROR, RESTORE, CADENCE }

    public static final class Identity {
        private final String source;
        private final String providerTrackId;
        private final long providerPartId;
        private final String trackHandle;
        private final String occurrenceId;
        private final long selectionGeneration;

        public Identity(String source, String providerTrackId, long providerPartId, String trackHandle,
                String occurrenceId, long selectionGeneration) {
            if (!isSafeIdentity(source, providerTrackId, providerPartId, trackHandle, occurrenceId,
                    selectionGeneration)) throw new IllegalArgumentException("invalid lyric identity");
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.providerPartId = providerPartId;
            this.trackHandle = trackHandle;
            this.occurrenceId = occurrenceId;
            this.selectionGeneration = selectionGeneration;
        }

        boolean matches(Identity other) {
            return other != null && source.equals(other.source) && providerTrackId.equals(other.providerTrackId)
                    && providerPartId == other.providerPartId && occurrenceId.equals(other.occurrenceId)
                    && selectionGeneration == other.selectionGeneration;
        }
    }

    public static final class Projection {
        private final Identity identity;
        private final long playbackRevision;
        private final long positionMs;
        private final long durationMs;
        private final String capability;
        private final PlaybackSnapshot.State state;

        Projection(Identity identity, long playbackRevision, long positionMs, long durationMs,
                PlaybackSnapshot.State state, String capability) {
            this.identity = identity;
            this.playbackRevision = playbackRevision;
            this.positionMs = positionMs;
            this.durationMs = durationMs;
            this.state = state;
            this.capability = capability;
        }

        public long getPlaybackRevision() { return playbackRevision; }
        public long getPositionMs() { return positionMs; }

        public PlaybackSnapshot.LyricContext toLyricContext() {
            return new PlaybackSnapshot.LyricContext(identity.source, identity.providerTrackId,
                    identity.providerPartId, identity.trackHandle, identity.occurrenceId,
                    identity.selectionGeneration, playbackRevision, capability,
                    state.name().toLowerCase());
        }
    }

    private LyricClockProjection() {}

    public static Projection project(Projection previous, Identity identity, long playbackRevision,
            long positionMs, long durationMs, PlaybackSnapshot.State state, String capability, Event event) {
        if (identity == null || state == null || capability == null || event == null || playbackRevision < 0L) {
            throw new IllegalArgumentException("bounded Media3 projection required");
        }
        long boundedDuration = Math.max(0L, Math.min(MAX_DURATION_MS, durationMs));
        long boundedPosition = Math.max(0L, Math.min(boundedDuration, positionMs));
        boolean sameSelection = previous != null && previous.identity.matches(identity);
        if (sameSelection && playbackRevision <= previous.playbackRevision) return previous;
        if (sameSelection && event != Event.SEEK && boundedPosition < previous.positionMs) {
            boundedPosition = previous.positionMs;
        }
        return new Projection(identity, playbackRevision, boundedPosition, boundedDuration, state, capability);
    }

    private static boolean isSafeIdentity(String source, String providerTrackId, long providerPartId,
            String trackHandle, String occurrenceId, long selectionGeneration) {
        boolean sourceValid = "bilibili".equals(source) && providerTrackId != null
                && providerTrackId.matches("BV[0-9A-Za-z]{6,32}")
                || "netease".equals(source) && providerTrackId != null
                && providerTrackId.matches("[1-9][0-9]{0,17}");
        return sourceValid && providerPartId > 0L && selectionGeneration >= 0L
                && isOpaque(trackHandle) && isOpaque(occurrenceId);
    }

    private static boolean isOpaque(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,128}");
    }
}
