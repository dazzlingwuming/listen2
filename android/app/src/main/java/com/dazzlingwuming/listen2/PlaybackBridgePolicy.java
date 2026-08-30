package com.dazzlingwuming.listen2;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Android-free allow-list for the versioned playback bridge. It validates the
 * complete page envelope before any command reaches the native coordinator.
 */
public final class PlaybackBridgePolicy {
    private static final int SNAPSHOT_VERSION = 1;
    private static final long MAX_PAGE_EPOCH = 2_147_483_647L;
    private static final long MAX_REVISION = 2_147_483_647L;
    private static final long MAX_DURATION_MS = 28_800_000L;
    private static final int MAX_TEXT_LENGTH = 256;
    private static final Set<String> ENVELOPE_KEYS = keys("requestId", "pageEpoch",
            "expectedRevision", "command", "payload");

    private final long pageEpoch;
    private long revision;
    private long identitySequence;
    private PlaybackSnapshot.State state = PlaybackSnapshot.State.IDLE;
    private PlaybackSnapshot.Metadata metadata = new PlaybackSnapshot.Metadata("", "", 0L,
            "bundled-placeholder");
    private long positionMs;
    private int volumePercent = 100;
    private boolean muted;
    private PlaybackSnapshot.Mode mode = PlaybackSnapshot.Mode.SEQUENTIAL;
    private PlaybackSnapshot.RecoveryStatus recovery = new PlaybackSnapshot.RecoveryStatus("ready", false);
    private final List<PlaybackSnapshot.QueueOccurrence> queue = new ArrayList<>();
    private final Map<String, NativePreparedSelection> preparedSelections = new HashMap<>();
    private PlaybackSnapshot.PreparedSelection visiblePreparedSelection;

    public PlaybackBridgePolicy(long pageEpoch, long initialRevision) {
        if (!isBoundedNonNegative(pageEpoch, MAX_PAGE_EPOCH)
                || !isBoundedNonNegative(initialRevision, MAX_REVISION)) {
            throw new IllegalArgumentException("page epoch and revision must be bounded");
        }
        this.pageEpoch = pageEpoch;
        this.revision = initialRevision;
    }

    public Result parseAndApply(Map<String, Object> envelope) {
        if (envelope == null) return Result.error("INVALID_ENVELOPE");
        if (!hasExactlyKeys(envelope, ENVELOPE_KEYS)) return Result.error("UNKNOWN_FIELD");
        Object requestId = envelope.get("requestId");
        Object rawPageEpoch = envelope.get("pageEpoch");
        Object rawExpectedRevision = envelope.get("expectedRevision");
        Object rawCommand = envelope.get("command");
        Object rawPayload = envelope.get("payload");
        if (!isSafeRequestId(requestId)) return Result.error("INVALID_REQUEST_ID");
        Long requestedEpoch = boundedLong(rawPageEpoch, MAX_PAGE_EPOCH);
        if (requestedEpoch == null) return Result.error("INVALID_PAGE_EPOCH");
        Long expectedRevision = boundedLong(rawExpectedRevision, MAX_REVISION);
        if (expectedRevision == null) return Result.error("INVALID_EXPECTED_REVISION");
        if (!(rawCommand instanceof String)) return Result.error("UNSUPPORTED_COMMAND");
        if (!(rawPayload instanceof Map)) return Result.error("INVALID_PAYLOAD");
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) rawPayload;
        PlaybackCommand.Type type = parseType((String) rawCommand);
        if (type == null) return Result.error("UNSUPPORTED_COMMAND");
        if (requestedEpoch.longValue() != pageEpoch) return Result.error("STALE_PAGE_EPOCH");
        if (expectedRevision.longValue() != revision) return Result.error("STALE_REVISION");
        if (revision == MAX_REVISION) return Result.error("REVISION_EXHAUSTED");
        return apply((String) requestId, expectedRevision.longValue(), type, payload);
    }

    private Result apply(String requestId, long expectedRevision, PlaybackCommand.Type type,
            Map<String, Object> payload) {
        if (type == PlaybackCommand.Type.PREPARE_SELECTION) {
            return prepare(requestId, expectedRevision, payload);
        }
        if (type == PlaybackCommand.Type.SELECT_PREPARED) {
            return selectPrepared(requestId, expectedRevision, payload);
        }
        String validationError = validateOtherPayload(type, payload);
        if (validationError != null) return Result.error(validationError);
        applyOtherCommand(type, payload);
        return accept(requestId, expectedRevision, type, payload);
    }

    private Result prepare(String requestId, long expectedRevision, Map<String, Object> payload) {
        Set<String> expected = keys("source", "providerTrackId", "providerPartId", "title", "artist",
                "durationMs", "mediaKind");
        if (!hasExactlyKeys(payload, expected)) return Result.error("UNKNOWN_FIELD");
        String source = stringValue(payload.get("source"));
        String providerTrackId = stringValue(payload.get("providerTrackId"));
        Long providerPartId = positiveLong(payload.get("providerPartId"));
        String title = stringValue(payload.get("title"));
        String artist = stringValue(payload.get("artist"));
        Long durationMs = boundedLong(payload.get("durationMs"), MAX_DURATION_MS);
        String mediaKind = stringValue(payload.get("mediaKind"));
        if (!"bilibili".equals(source) || !isSafeBvid(providerTrackId) || providerPartId == null
                || !isPlainText(title) || !isPlainText(artist) || durationMs == null
                || !"audio".equals(mediaKind)) return Result.error("INVALID_PAYLOAD");

        String suffix = Long.toString(++identitySequence, 36) + "-"
                + UUID.randomUUID().toString().replace("-", "");
        String trackHandle = "track-" + suffix;
        String occurrenceId = "occ-" + suffix;
        PlaybackSnapshot.Metadata preparedMetadata = new PlaybackSnapshot.Metadata(title, artist,
                durationMs.longValue(), "bundled-placeholder");
        NativePreparedSelection nativeSelection = new NativePreparedSelection(trackHandle, occurrenceId,
                source, providerTrackId, providerPartId.longValue(), preparedMetadata);
        preparedSelections.put(trackHandle, nativeSelection);
        visiblePreparedSelection = new PlaybackSnapshot.PreparedSelection(trackHandle, occurrenceId,
                preparedMetadata);
        return accept(requestId, expectedRevision, PlaybackCommand.Type.PREPARE_SELECTION, payload);
    }

    private Result selectPrepared(String requestId, long expectedRevision, Map<String, Object> payload) {
        if (!hasExactlyKeys(payload, keys("trackHandle", "occurrenceId", "selectionAction", "playWhenReady"))) {
            return Result.error("UNKNOWN_FIELD");
        }
        String trackHandle = stringValue(payload.get("trackHandle"));
        String occurrenceId = stringValue(payload.get("occurrenceId"));
        String action = stringValue(payload.get("selectionAction"));
        if (trackHandle == null || occurrenceId == null || !(payload.get("playWhenReady") instanceof Boolean)
                || !("replace-current".equals(action) || "enqueue-next".equals(action))) {
            return Result.error("INVALID_PAYLOAD");
        }
        NativePreparedSelection selected = preparedSelections.get(trackHandle);
        if (selected == null || !selected.occurrenceId.equals(occurrenceId)) {
            return Result.error("UNKNOWN_PREPARED_SELECTION");
        }
        preparedSelections.remove(trackHandle);
        visiblePreparedSelection = null;
        PlaybackSnapshot.QueueOccurrence occurrence = new PlaybackSnapshot.QueueOccurrence(
                selected.occurrenceId, selected.trackHandle, selected.metadataTitle(), selected.metadataArtist(),
                selected.metadataDurationMs());
        if ("replace-current".equals(action)) queue.clear();
        if ("enqueue-next".equals(action) && !queue.isEmpty()) queue.add(1, occurrence);
        else queue.add(occurrence);
        metadata = selected.metadata;
        positionMs = 0L;
        state = ((Boolean) payload.get("playWhenReady"))
                ? PlaybackSnapshot.State.PLAYING : PlaybackSnapshot.State.PAUSED;
        return accept(requestId, expectedRevision, PlaybackCommand.Type.SELECT_PREPARED, payload);
    }

    private String validateOtherPayload(PlaybackCommand.Type type, Map<String, Object> payload) {
        Set<String> expectedKeys;
        switch (type) {
            case PLAY:
            case PAUSE:
            case PREVIOUS:
            case NEXT:
            case CLEAR:
            case SUBSCRIBE:
            case DETACH:
                expectedKeys = Collections.emptySet();
                break;
            case SEEK:
                expectedKeys = keys("positionMs");
                break;
            case VOLUME:
                expectedKeys = keys("volumePercent");
                break;
            case MUTE:
                expectedKeys = keys("muted");
                break;
            case MODE:
                expectedKeys = keys("mode");
                break;
            case REORDER:
                expectedKeys = keys("occurrenceId", "targetIndex");
                break;
            case REMOVE:
            case RETRY:
                expectedKeys = keys("occurrenceId");
                break;
            default:
                return "UNSUPPORTED_COMMAND";
        }
        if (!hasExactlyKeys(payload, expectedKeys)) return "UNKNOWN_FIELD";
        switch (type) {
            case SEEK:
                return boundedLong(payload.get("positionMs"), MAX_DURATION_MS) != null ? null : "INVALID_PAYLOAD";
            case VOLUME:
                return boundedLong(payload.get("volumePercent"), 100L) != null ? null : "INVALID_PAYLOAD";
            case MUTE:
                return payload.get("muted") instanceof Boolean ? null : "INVALID_PAYLOAD";
            case MODE:
                return parseMode(stringValue(payload.get("mode"))) != null ? null : "INVALID_PAYLOAD";
            case REORDER:
                return isKnownOccurrence(stringValue(payload.get("occurrenceId")))
                        && boundedLong(payload.get("targetIndex"), Math.max(0, queue.size() - 1)) != null
                        ? null : "INVALID_PAYLOAD";
            case REMOVE:
            case RETRY:
                return isKnownOccurrence(stringValue(payload.get("occurrenceId"))) ? null : "INVALID_PAYLOAD";
            default:
                return null;
        }
    }

    private void applyOtherCommand(PlaybackCommand.Type type, Map<String, Object> payload) {
        switch (type) {
            case PLAY:
                state = PlaybackSnapshot.State.PLAYING;
                break;
            case PAUSE:
            case DETACH:
                state = PlaybackSnapshot.State.PAUSED;
                break;
            case SEEK:
                positionMs = boundedLong(payload.get("positionMs"), MAX_DURATION_MS);
                break;
            case VOLUME:
                volumePercent = boundedLong(payload.get("volumePercent"), 100L).intValue();
                break;
            case MUTE:
                muted = (Boolean) payload.get("muted");
                break;
            case MODE:
                mode = parseMode((String) payload.get("mode"));
                break;
            case REORDER:
                String movedId = (String) payload.get("occurrenceId");
                PlaybackSnapshot.QueueOccurrence moved = removeOccurrence(movedId);
                queue.add(boundedLong(payload.get("targetIndex"), Math.max(0, queue.size())).intValue(), moved);
                break;
            case REMOVE:
                removeOccurrence((String) payload.get("occurrenceId"));
                break;
            case CLEAR:
                queue.clear();
                break;
            case RETRY:
                recovery = new PlaybackSnapshot.RecoveryStatus("retrying", true);
                break;
            default:
                // Other commands are coordinator signals and deliberately do not mutate this policy projection.
                break;
        }
    }

    private Result accept(String requestId, long expectedRevision, PlaybackCommand.Type type,
            Map<String, Object> payload) {
        revision += 1L;
        return Result.accepted(new PlaybackCommand(requestId, pageEpoch, expectedRevision, type, payload),
                snapshot());
    }

    private PlaybackSnapshot snapshot() {
        return new PlaybackSnapshot(SNAPSHOT_VERSION, pageEpoch, revision, state, metadata, positionMs,
                metadataDuration(), volumePercent, muted, mode,
                new PlaybackSnapshot.ActionAvailability(true, true, !queue.isEmpty(), !queue.isEmpty(),
                        metadataDuration() > 0L, !queue.isEmpty()), queue, visiblePreparedSelection, recovery);
    }

    private long metadataDuration() {
        return metadataDurationFromSnapshot(metadata);
    }

    private static long metadataDurationFromSnapshot(PlaybackSnapshot.Metadata value) {
        return ((Number) value.toMap().get("durationMs")).longValue();
    }

    private boolean isKnownOccurrence(String occurrenceId) {
        if (occurrenceId == null) return false;
        for (PlaybackSnapshot.QueueOccurrence occurrence : queue) {
            if (occurrenceId.equals(occurrence.getOccurrenceId())) return true;
        }
        return false;
    }

    private PlaybackSnapshot.QueueOccurrence removeOccurrence(String occurrenceId) {
        for (int index = 0; index < queue.size(); index += 1) {
            if (occurrenceId.equals(queue.get(index).getOccurrenceId())) return queue.remove(index);
        }
        throw new IllegalStateException("validated occurrence disappeared");
    }

    private static PlaybackCommand.Type parseType(String value) {
        if (value == null) return null;
        switch (value) {
            case "prepareSelection": return PlaybackCommand.Type.PREPARE_SELECTION;
            case "selectPrepared": return PlaybackCommand.Type.SELECT_PREPARED;
            case "play": return PlaybackCommand.Type.PLAY;
            case "pause": return PlaybackCommand.Type.PAUSE;
            case "seek": return PlaybackCommand.Type.SEEK;
            case "previous": return PlaybackCommand.Type.PREVIOUS;
            case "next": return PlaybackCommand.Type.NEXT;
            case "volume": return PlaybackCommand.Type.VOLUME;
            case "mute": return PlaybackCommand.Type.MUTE;
            case "mode": return PlaybackCommand.Type.MODE;
            case "reorder": return PlaybackCommand.Type.REORDER;
            case "remove": return PlaybackCommand.Type.REMOVE;
            case "clear": return PlaybackCommand.Type.CLEAR;
            case "retry": return PlaybackCommand.Type.RETRY;
            case "subscribe": return PlaybackCommand.Type.SUBSCRIBE;
            case "detach": return PlaybackCommand.Type.DETACH;
            default: return null;
        }
    }

    private static PlaybackSnapshot.Mode parseMode(String value) {
        if ("sequential".equals(value)) return PlaybackSnapshot.Mode.SEQUENTIAL;
        if ("shuffle".equals(value)) return PlaybackSnapshot.Mode.SHUFFLE;
        if ("repeat-one".equals(value)) return PlaybackSnapshot.Mode.REPEAT_ONE;
        if ("repeat-all".equals(value)) return PlaybackSnapshot.Mode.REPEAT_ALL;
        return null;
    }

    private static boolean isSafeRequestId(Object value) {
        if (!(value instanceof String)) return false;
        String requestId = (String) value;
        if (requestId.isEmpty() || requestId.length() > 128) return false;
        for (int index = 0; index < requestId.length(); index += 1) {
            char character = requestId.charAt(index);
            if (character < 0x21 || character > 0x7e) return false;
        }
        return true;
    }

    private static boolean isSafeBvid(String value) {
        return value != null && value.matches("BV[0-9A-Za-z]{6,32}");
    }

    private static boolean isPlainText(String value) {
        if (value == null || value.length() > MAX_TEXT_LENGTH) return false;
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (Character.isISOControl(character) || character == '<' || character == '>') return false;
        }
        return true;
    }

    private static String stringValue(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private static Long positiveLong(Object value) {
        Long number = boundedLong(value, Long.MAX_VALUE);
        return number != null && number.longValue() > 0L ? number : null;
    }

    private static Long boundedLong(Object value, long maximum) {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer
                || value instanceof Long)) return null;
        long number = ((Number) value).longValue();
        return isBoundedNonNegative(number, maximum) ? number : null;
    }

    private static boolean isBoundedNonNegative(long value, long maximum) {
        return value >= 0L && value <= maximum;
    }

    private static Set<String> keys(String... values) {
        Set<String> result = new HashSet<>();
        Collections.addAll(result, values);
        return result;
    }

    private static boolean hasExactlyKeys(Map<String, Object> value, Set<String> expected) {
        return value.size() == expected.size() && value.keySet().containsAll(expected);
    }

    private static final class NativePreparedSelection {
        final String trackHandle;
        final String occurrenceId;
        final String source;
        final String providerTrackId;
        final long providerPartId;
        final PlaybackSnapshot.Metadata metadata;

        NativePreparedSelection(String trackHandle, String occurrenceId, String source,
                String providerTrackId, long providerPartId, PlaybackSnapshot.Metadata metadata) {
            this.trackHandle = trackHandle;
            this.occurrenceId = occurrenceId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.providerPartId = providerPartId;
            this.metadata = metadata;
        }

        String metadataTitle() {
            return (String) metadata.toMap().get("title");
        }

        String metadataArtist() {
            return (String) metadata.toMap().get("artist");
        }

        long metadataDurationMs() {
            return ((Number) metadata.toMap().get("durationMs")).longValue();
        }
    }

    public static final class Result {
        private final PlaybackCommand command;
        private final PlaybackSnapshot snapshot;
        private final String errorCode;

        private Result(PlaybackCommand command, PlaybackSnapshot snapshot, String errorCode) {
            this.command = command;
            this.snapshot = snapshot;
            this.errorCode = errorCode;
        }

        static Result accepted(PlaybackCommand command, PlaybackSnapshot snapshot) {
            return new Result(command, snapshot, null);
        }

        static Result error(String errorCode) {
            return new Result(null, null, errorCode);
        }

        public boolean isAccepted() {
            return command != null;
        }

        public PlaybackCommand getCommand() {
            return command;
        }

        public PlaybackSnapshot getSnapshot() {
            return snapshot;
        }

        public String getErrorCode() {
            return errorCode;
        }
    }
}
