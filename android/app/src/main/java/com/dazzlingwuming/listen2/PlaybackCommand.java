package com.dazzlingwuming.listen2;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Immutable, validated command passed from the packaged page to the native coordinator. */
public final class PlaybackCommand {
    public enum Type {
        PREPARE_SELECTION,
        SELECT_PREPARED,
        PLAY,
        PAUSE,
        SEEK,
        PREVIOUS,
        NEXT,
        VOLUME,
        MUTE,
        MODE,
        REORDER,
        REMOVE,
        CLEAR,
        RETRY,
        SUBSCRIBE,
        DETACH
    }

    private final String requestId;
    private final long pageEpoch;
    private final long expectedRevision;
    private final Type type;
    private final Map<String, Object> payload;

    PlaybackCommand(String requestId, long pageEpoch, long expectedRevision, Type type,
            Map<String, Object> payload) {
        this.requestId = requestId;
        this.pageEpoch = pageEpoch;
        this.expectedRevision = expectedRevision;
        this.type = type;
        this.payload = Collections.unmodifiableMap(new LinkedHashMap<>(payload));
    }

    public String getRequestId() {
        return requestId;
    }

    public long getPageEpoch() {
        return pageEpoch;
    }

    public long getExpectedRevision() {
        return expectedRevision;
    }

    public Type getType() {
        return type;
    }

    /** Internal coordinator data only; this map is never serialized into a page snapshot. */
    public Map<String, Object> getPayload() {
        return payload;
    }
}
