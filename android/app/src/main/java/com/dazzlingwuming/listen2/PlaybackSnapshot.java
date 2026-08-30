package com.dazzlingwuming.listen2;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Versioned page projection. Its map serializer is intentionally an allow-list;
 * transport data and provider response bodies have no field in this DTO.
 */
public final class PlaybackSnapshot {
    public enum State { IDLE, RESOLVING, PLAYING, PAUSED, ERROR }
    public enum Mode { SEQUENTIAL, SHUFFLE, REPEAT_ONE, REPEAT_ALL }

    private final int version;
    private final long pageEpoch;
    private final long revision;
    private final State state;
    private final Metadata metadata;
    private final long positionMs;
    private final long durationMs;
    private final int volumePercent;
    private final boolean muted;
    private final Mode mode;
    private final ActionAvailability actionAvailability;
    private final List<QueueOccurrence> queue;
    private final PreparedSelection preparedSelection;
    private final RecoveryStatus recoveryStatus;
    private final LyricContext lyricContext;

    public PlaybackSnapshot(int version, long pageEpoch, long revision, State state,
            Metadata metadata, long positionMs, long durationMs, int volumePercent, boolean muted,
            Mode mode, ActionAvailability actionAvailability, List<QueueOccurrence> queue,
            PreparedSelection preparedSelection, RecoveryStatus recoveryStatus) {
        this(version, pageEpoch, revision, state, metadata, positionMs, durationMs, volumePercent, muted,
                mode, actionAvailability, queue, preparedSelection, recoveryStatus, LyricContext.unavailable());
    }

    public PlaybackSnapshot(int version, long pageEpoch, long revision, State state,
            Metadata metadata, long positionMs, long durationMs, int volumePercent, boolean muted,
            Mode mode, ActionAvailability actionAvailability, List<QueueOccurrence> queue,
            PreparedSelection preparedSelection, RecoveryStatus recoveryStatus, LyricContext lyricContext) {
        this.version = version;
        this.pageEpoch = pageEpoch;
        this.revision = revision;
        this.state = state;
        this.metadata = metadata;
        this.positionMs = positionMs;
        this.durationMs = durationMs;
        this.volumePercent = volumePercent;
        this.muted = muted;
        this.mode = mode;
        this.actionAvailability = actionAvailability;
        this.queue = Collections.unmodifiableList(new ArrayList<>(queue));
        this.preparedSelection = preparedSelection;
        this.recoveryStatus = recoveryStatus;
        this.lyricContext = lyricContext == null ? LyricContext.unavailable() : lyricContext;
    }

    public long getRevision() {
        return revision;
    }

    public List<QueueOccurrence> getQueue() {
        return queue;
    }

    public PreparedSelection getPreparedSelection() {
        return preparedSelection;
    }

    public LyricContext getLyricContext() {
        return lyricContext;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", version);
        result.put("pageEpoch", pageEpoch);
        result.put("revision", revision);
        result.put("state", state.name().toLowerCase());
        result.put("metadata", metadata.toMap());
        result.put("positionMs", positionMs);
        result.put("durationMs", durationMs);
        result.put("volumePercent", volumePercent);
        result.put("muted", muted);
        result.put("mode", mode.name().toLowerCase().replace('_', '-'));
        result.put("actions", actionAvailability.toMap());
        List<Map<String, Object>> queueRows = new ArrayList<>();
        for (QueueOccurrence occurrence : queue) queueRows.add(occurrence.toMap());
        result.put("queue", Collections.unmodifiableList(queueRows));
        if (preparedSelection != null) result.put("prepared", preparedSelection.toMap());
        result.put("recovery", recoveryStatus.toMap());
        result.put("lyric", lyricContext.toMap());
        assertPageSafe(result);
        return Collections.unmodifiableMap(result);
    }

    public static final class Metadata {
        private final String title;
        private final String artist;
        private final long durationMs;
        private final String artworkState;

        public Metadata(String title, String artist, long durationMs, String artworkState) {
            this.title = title;
            this.artist = artist;
            this.durationMs = durationMs;
            this.artworkState = artworkState;
        }

        Map<String, Object> toMap() {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("title", title);
            value.put("artist", artist);
            value.put("durationMs", durationMs);
            value.put("artworkState", artworkState);
            return Collections.unmodifiableMap(value);
        }
    }

    public static final class ActionAvailability {
        private final boolean play;
        private final boolean pause;
        private final boolean previous;
        private final boolean next;
        private final boolean seek;
        private final boolean retry;

        public ActionAvailability(boolean play, boolean pause, boolean previous, boolean next,
                boolean seek, boolean retry) {
            this.play = play;
            this.pause = pause;
            this.previous = previous;
            this.next = next;
            this.seek = seek;
            this.retry = retry;
        }

        Map<String, Object> toMap() {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("play", play);
            value.put("pause", pause);
            value.put("previous", previous);
            value.put("next", next);
            value.put("seek", seek);
            value.put("retry", retry);
            return Collections.unmodifiableMap(value);
        }
    }

    public static final class QueueOccurrence {
        private final String occurrenceId;
        private final String trackHandle;
        private final String title;
        private final String artist;
        private final long durationMs;

        public QueueOccurrence(String occurrenceId, String trackHandle, String title, String artist,
                long durationMs) {
            this.occurrenceId = occurrenceId;
            this.trackHandle = trackHandle;
            this.title = title;
            this.artist = artist;
            this.durationMs = durationMs;
        }

        public String getOccurrenceId() {
            return occurrenceId;
        }

        Map<String, Object> toMap() {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("occurrenceId", occurrenceId);
            value.put("trackHandle", trackHandle);
            value.put("title", title);
            value.put("artist", artist);
            value.put("durationMs", durationMs);
            return Collections.unmodifiableMap(value);
        }
    }

    public static final class PreparedSelection {
        private final String trackHandle;
        private final String occurrenceId;
        private final Metadata metadata;

        PreparedSelection(String trackHandle, String occurrenceId, Metadata metadata) {
            this.trackHandle = trackHandle;
            this.occurrenceId = occurrenceId;
            this.metadata = metadata;
        }

        public String getTrackHandle() {
            return trackHandle;
        }

        public String getOccurrenceId() {
            return occurrenceId;
        }

        Map<String, Object> toMap() {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("trackHandle", trackHandle);
            value.put("occurrenceId", occurrenceId);
            value.put("metadata", metadata.toMap());
            return Collections.unmodifiableMap(value);
        }
    }

    public static final class RecoveryStatus {
        private final String status;
        private final boolean retryable;

        public RecoveryStatus(String status, boolean retryable) {
            this.status = status;
            this.retryable = retryable;
        }

        Map<String, Object> toMap() {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("status", status);
            value.put("retryable", retryable);
            return Collections.unmodifiableMap(value);
        }
    }

    /** Bounded identity and Media3-only timing context consumed by the packaged lyric renderer. */
    public static final class LyricContext {
        private final String source;
        private final String providerTrackId;
        private final long providerPartId;
        private final String trackHandle;
        private final String occurrenceId;
        private final long selectionGeneration;
        private final long playbackRevision;
        private final String capability;
        private final String state;

        public LyricContext(String source, String providerTrackId, long providerPartId, String trackHandle,
                String occurrenceId, long selectionGeneration, long playbackRevision, String capability,
                String state) {
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.providerPartId = providerPartId;
            this.trackHandle = trackHandle;
            this.occurrenceId = occurrenceId;
            this.selectionGeneration = selectionGeneration;
            this.playbackRevision = playbackRevision;
            this.capability = capability;
            this.state = state;
        }

        static LyricContext unavailable() {
            return new LyricContext("", "", 0L, "", "", 0L, 0L, "unavailable", "idle");
        }

        public boolean isAvailable() {
            return !"unavailable".equals(capability) && !source.isEmpty() && !occurrenceId.isEmpty();
        }

        Map<String, Object> toMap() {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("source", source);
            value.put("providerTrackId", providerTrackId);
            value.put("providerPartId", providerPartId);
            value.put("trackHandle", trackHandle);
            value.put("occurrenceId", occurrenceId);
            value.put("selectionGeneration", selectionGeneration);
            value.put("playbackRevision", playbackRevision);
            value.put("capability", capability);
            value.put("state", state);
            return Collections.unmodifiableMap(value);
        }
    }

    /** Last line of defense before a nested value crosses into the packaged page. */
    private static void assertPageSafe(Object value) {
        if (value instanceof Map) {
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                if (!(entry.getKey() instanceof String) || isForbiddenKey((String) entry.getKey())) {
                    throw new IllegalStateException("snapshot contains forbidden field");
                }
                assertPageSafe(entry.getValue());
            }
            return;
        }
        if (value instanceof List) {
            for (Object row : (List<?>) value) assertPageSafe(row);
            return;
        }
        if (value instanceof String && isForbiddenValue((String) value)) {
            throw new IllegalStateException("snapshot contains transport-like value");
        }
        if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) {
            throw new IllegalStateException("snapshot contains unsupported value");
        }
    }

    private static boolean isForbiddenKey(String key) {
        String normalized = key.toLowerCase();
        return normalized.contains("url") || normalized.contains("query") || normalized.contains("candidate")
                || normalized.contains("header") || normalized.contains("cookie") || normalized.contains("body")
                || normalized.contains("credential") || normalized.contains("databaseerror")
                || normalized.contains("exception") || normalized.contains("path");
    }

    private static boolean isForbiddenValue(String value) {
        String normalized = value.toLowerCase();
        return normalized.contains("://") || normalized.contains("cookie=")
                || normalized.contains("authorization:") || normalized.contains("bearer ");
    }
}
