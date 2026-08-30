package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

public final class PlaybackBridgePolicyTest {
    @Test
    public void acceptsOnlyDistinctSourceSpecificNetEaseIdentity() {
        PlaybackBridgePolicy policy = new PlaybackBridgePolicy(4L, 0L);

        assertTrue(policy.parseAndApply(command("prepareSelection", 4L, 0L,
                mapOf("source", "netease", "providerTrackId", "123456", "providerPartId", 1L,
                        "title", "Title", "artist", "Artist", "durationMs", 1000L,
                        "mediaKind", "audio"))).isAccepted());
        assertCode("INVALID_PAYLOAD", new PlaybackBridgePolicy(4L, 0L).parseAndApply(
                command("prepareSelection", 4L, 0L,
                        mapOf("source", "netease", "providerTrackId", "BV1xx411c7mD", "providerPartId", 1L,
                                "title", "Title", "artist", "Artist", "durationMs", 1000L,
                                "mediaKind", "audio"))));
    }
    @Test
    public void mintsOpaqueSelectionIdentityAndRequiresItForSelection() {
        PlaybackBridgePolicy policy = new PlaybackBridgePolicy(4L, 0L);

        PlaybackBridgePolicy.Result prepared = policy.parseAndApply(command("prepareSelection", 4L,
                0L, mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD",
                        "providerPartId", 42L, "title", "A title", "artist", "An artist",
                        "durationMs", 1234L, "mediaKind", "audio")));

        assertTrue(prepared.isAccepted());
        assertEquals(1L, prepared.getSnapshot().getRevision());
        PlaybackSnapshot.PreparedSelection selection = prepared.getSnapshot().getPreparedSelection();
        assertNotNull(selection);
        assertTrue(selection.getTrackHandle().startsWith("track-"));
        assertTrue(selection.getOccurrenceId().startsWith("occ-"));
        assertNotEquals("BV1xx411c7mD", selection.getTrackHandle());
        assertFalse(prepared.getSnapshot().toMap().toString().contains("BV1xx411c7mD"));

        PlaybackBridgePolicy.Result selected = policy.parseAndApply(command("selectPrepared", 4L,
                1L, mapOf("trackHandle", selection.getTrackHandle(), "occurrenceId",
                        selection.getOccurrenceId(), "selectionAction", "replace-current",
                        "playWhenReady", true)));

        assertTrue(selected.isAccepted());
        assertEquals(2L, selected.getSnapshot().getRevision());
        assertNull(selected.getSnapshot().getPreparedSelection());
        assertEquals(1, selected.getSnapshot().getQueue().size());
        assertEquals(selection.getOccurrenceId(), selected.getSnapshot().getQueue().get(0)
                .getOccurrenceId());
    }

    @Test
    public void rejectsStaleRevisionEpochReplayedPairsAndCallerChosenIds() {
        PlaybackBridgePolicy policy = new PlaybackBridgePolicy(2L, 0L);
        PlaybackBridgePolicy.Result prepared = policy.parseAndApply(command("prepareSelection", 2L,
                0L, validPreparePayload()));
        PlaybackSnapshot.PreparedSelection selection = prepared.getSnapshot().getPreparedSelection();

        assertCode("STALE_PAGE_EPOCH", policy.parseAndApply(command("play", 3L, 1L,
                Collections.<String, Object>emptyMap())));
        assertCode("STALE_REVISION", policy.parseAndApply(command("play", 2L, 0L,
                Collections.<String, Object>emptyMap())));
        assertCode("UNKNOWN_PREPARED_SELECTION", policy.parseAndApply(command("selectPrepared", 2L,
                1L, mapOf("trackHandle", "track-caller", "occurrenceId", selection.getOccurrenceId(),
                        "selectionAction", "replace-current", "playWhenReady", true))));

        assertTrue(policy.parseAndApply(command("selectPrepared", 2L, 1L,
                mapOf("trackHandle", selection.getTrackHandle(), "occurrenceId",
                        selection.getOccurrenceId(), "selectionAction", "replace-current",
                        "playWhenReady", true))).isAccepted());
        assertCode("STALE_REVISION", policy.parseAndApply(command("selectPrepared", 2L, 1L,
                mapOf("trackHandle", selection.getTrackHandle(), "occurrenceId",
                        selection.getOccurrenceId(), "selectionAction", "replace-current",
                        "playWhenReady", true))));
    }

    @Test
    public void rejectsClosedSchemaViolationsTransportShapesAndEveryBoundary() {
        PlaybackBridgePolicy policy = new PlaybackBridgePolicy(0L, 0L);
        assertCode("UNKNOWN_FIELD", policy.parseAndApply(command("prepareSelection", 0L, 0L,
                mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 1L,
                        "title", "Title", "artist", "Artist", "durationMs", 0L,
                        "mediaKind", "audio", "url", "https://evil.example"))));
        assertCode("INVALID_PAYLOAD", policy.parseAndApply(command("prepareSelection", 0L, 0L,
                mapOf("source", "bilibili", "providerTrackId", "not-bvid", "providerPartId", 0L,
                        "title", "Title", "artist", "Artist", "durationMs", 28_800_001L,
                        "mediaKind", "audio"))));
        assertCode("INVALID_REQUEST_ID", policy.parseAndApply(commandWithRequestId("", "play", 0L, 0L,
                Collections.<String, Object>emptyMap())));
        assertCode("INVALID_REQUEST_ID", policy.parseAndApply(commandWithRequestId("has space", "play", 0L,
                0L, Collections.<String, Object>emptyMap())));
        assertCode("INVALID_PAGE_EPOCH", policy.parseAndApply(command("play", -1L, 0L,
                Collections.<String, Object>emptyMap())));
        assertCode("INVALID_EXPECTED_REVISION", policy.parseAndApply(command("play", 0L, -1L,
                Collections.<String, Object>emptyMap())));
        assertCode("UNSUPPORTED_COMMAND", policy.parseAndApply(command("setMediaItem", 0L, 0L,
                Collections.<String, Object>emptyMap())));
        assertCode("UNKNOWN_FIELD", policy.parseAndApply(mapOf("requestId", "request-1", "pageEpoch", 0L,
                "expectedRevision", 0L, "command", "play", "payload", Collections.emptyMap(),
                "headers", "nope")));
        assertCode("INVALID_PAYLOAD", policy.parseAndApply(command("seek", 0L, 0L,
                mapOf("positionMs", -1L))));
        assertCode("INVALID_PAYLOAD", policy.parseAndApply(command("volume", 0L, 0L,
                mapOf("volumePercent", 101L))));
        assertCode("INVALID_PAYLOAD", policy.parseAndApply(command("mute", 0L, 0L,
                mapOf("muted", "true"))));
    }

    @Test
    public void acceptsExactPrepareBoundariesAndRejectsAllTransportLikePayloadFields() {
        PlaybackBridgePolicy policy = new PlaybackBridgePolicy(0L, 0L);
        String atLimit = repeated("x", 256);
        PlaybackBridgePolicy.Result accepted = policy.parseAndApply(commandWithRequestId(
                repeated("a", 128), "prepareSelection", 0L, 0L,
                mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 1L,
                        "title", atLimit, "artist", atLimit, "durationMs", 28_800_000L,
                        "mediaKind", "audio")));
        assertTrue(accepted.isAccepted());

        PlaybackBridgePolicy invalidPolicy = new PlaybackBridgePolicy(0L, 0L);
        for (String forbidden : Arrays.asList("url", "uri", "candidate", "method", "header", "headers",
                "cookie", "body", "bitmap", "mediaItem", "providerJson", "credential", "trackHandle",
                "occurrenceId", "callerId")) {
            Map<String, Object> payload = validPreparePayload();
            payload.put(forbidden, "caller-controlled");
            assertCode("UNKNOWN_FIELD", invalidPolicy.parseAndApply(command("prepareSelection", 0L, 0L,
                    payload)));
        }
        assertCode("INVALID_PAYLOAD", invalidPolicy.parseAndApply(command("prepareSelection", 0L, 0L,
                mapOf("source", "netease", "providerTrackId", "BV1xx411c7mD", "providerPartId", 1L,
                        "title", "Title", "artist", "Artist", "durationMs", 0L, "mediaKind", "audio"))));
        assertCode("INVALID_PAYLOAD", invalidPolicy.parseAndApply(command("prepareSelection", 0L, 0L,
                mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 1L,
                        "title", repeated("x", 257), "artist", "Artist", "durationMs", 0L,
                        "mediaKind", "audio"))));
        assertCode("INVALID_PAYLOAD", invalidPolicy.parseAndApply(command("prepareSelection", 0L, 0L,
                mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 1L,
                        "title", "Title", "artist", "<b>Artist</b>", "durationMs", 0L,
                        "mediaKind", "audio"))));
    }

    @Test
    public void serializesOnlyBoundedSafeSnapshotFields() {
        PlaybackSnapshot snapshot = new PlaybackSnapshot(1, 9L, 7L,
                PlaybackSnapshot.State.PAUSED,
                new PlaybackSnapshot.Metadata("Title", "Artist", 123L, "bundled-placeholder"),
                12L, 123L, 40, false, PlaybackSnapshot.Mode.SEQUENTIAL,
                new PlaybackSnapshot.ActionAvailability(true, true, true, true, true, true),
                Arrays.asList(new PlaybackSnapshot.QueueOccurrence("occ-native", "track-native",
                        "Title", "Artist", 123L)), null,
                new PlaybackSnapshot.RecoveryStatus("ready", false));

        Map<String, Object> projected = snapshot.toMap();
        assertEquals(1, projected.get("version"));
        assertEquals(7L, projected.get("revision"));
        assertTrue(projected.containsKey("queue"));
        for (String forbidden : Arrays.asList("url", "uri", "headers", "header", "cookie", "body",
                "candidate", "mediaItem", "providerJson", "credential", "bitmap")) {
            assertFalse("must exclude " + forbidden, projected.toString().contains(forbidden));
        }
    }

    private static Map<String, Object> validPreparePayload() {
        return mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 1L,
                "title", "Title", "artist", "Artist", "durationMs", 0L, "mediaKind", "audio");
    }

    private static Map<String, Object> command(String name, long pageEpoch, long expectedRevision,
            Map<String, Object> payload) {
        return commandWithRequestId("request-1", name, pageEpoch, expectedRevision, payload);
    }

    private static Map<String, Object> commandWithRequestId(String requestId, String name, long pageEpoch,
            long expectedRevision, Map<String, Object> payload) {
        return mapOf("requestId", requestId, "pageEpoch", pageEpoch, "expectedRevision", expectedRevision,
                "command", name, "payload", payload);
    }

    private static void assertCode(String expected, PlaybackBridgePolicy.Result result) {
        assertFalse(result.isAccepted());
        assertEquals(expected, result.getErrorCode());
    }

    private static Map<String, Object> mapOf(Object... values) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int index = 0; index < values.length; index += 2) {
            map.put((String) values[index], values[index + 1]);
        }
        return map;
    }

    private static String repeated(String value, int count) {
        StringBuilder builder = new StringBuilder(value.length() * count);
        for (int index = 0; index < count; index += 1) builder.append(value);
        return builder.toString();
    }
}
