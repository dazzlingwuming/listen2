package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Tests the disposable page authority around the service-owned playback port. */
public final class PlaybackBridgeControllerTest {
    @Test
    public void prepareMintsThenSelectsOnlyTheNativePairAndPublishesNewerSnapshots() {
        FakeService service = new FakeService();
        PlaybackBridgeController controller = new PlaybackBridgeController(service);
        FakePage page = new FakePage();
        controller.attach(7L, page);

        PlaybackBridgeController.Reply prepared = controller.handle(envelope("prepareSelection", 7L, 0L,
                mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 42L,
                        "title", "Title", "artist", "Artist", "durationMs", 1234L,
                        "mediaKind", "audio")));

        assertTrue(prepared.isAccepted());
        assertEquals(1L, prepared.getSnapshot().getRevision());
        PlaybackSnapshot.PreparedSelection selection = prepared.getSnapshot().getPreparedSelection();
        assertNotNull(selection);
        assertEquals(1, service.commands.size());
        assertEquals(PlaybackCommand.Type.PREPARE_SELECTION, service.commands.get(0).getType());
        controller.publish(prepared.getSnapshot());
        assertTrue(page.snapshots.get(0).getRevision() > 0L);

        PlaybackBridgeController.Reply selected = controller.handle(envelope("selectPrepared", 7L, 1L,
                mapOf("trackHandle", selection.getTrackHandle(), "occurrenceId", selection.getOccurrenceId(),
                        "selectionAction", "replace-current", "playWhenReady", true)));

        assertTrue(selected.isAccepted());
        assertEquals(2L, selected.getSnapshot().getRevision());
        assertEquals(2, service.commands.size());
        assertEquals(PlaybackCommand.Type.SELECT_PREPARED, service.commands.get(1).getType());
        controller.publish(selected.getSnapshot());
        assertEquals(2, page.snapshots.size());
    }

    @Test
    public void rejectsStaleEpochRevisionReplayAndTransportFieldsBeforeServiceDispatch() {
        FakeService service = new FakeService();
        PlaybackBridgeController controller = new PlaybackBridgeController(service);
        controller.attach(3L, new FakePage());

        assertCode("STALE_PAGE_EPOCH", controller.handle(envelope("play", 4L, 0L, mapOf())));
        assertCode("STALE_REVISION", controller.handle(envelope("play", 3L, 2L, mapOf())));
        assertCode("UNKNOWN_FIELD", controller.handle(envelope("prepareSelection", 3L, 0L,
                mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 42L,
                        "title", "Title", "artist", "Artist", "durationMs", 0L, "mediaKind", "audio",
                        "url", "https://example.invalid/stream"))));
        assertEquals(0, service.commands.size());

        PlaybackBridgeController.Reply prepared = controller.handle(envelope("prepareSelection", 3L, 0L,
                validPrepare()));
        PlaybackSnapshot.PreparedSelection selection = prepared.getSnapshot().getPreparedSelection();
        assertCode("UNKNOWN_PREPARED_SELECTION", controller.handle(envelope("selectPrepared", 3L, 1L,
                mapOf("trackHandle", "track-caller", "occurrenceId", selection.getOccurrenceId(),
                        "selectionAction", "replace-current", "playWhenReady", true))));
        assertTrue(controller.handle(envelope("selectPrepared", 3L, 1L,
                mapOf("trackHandle", selection.getTrackHandle(), "occurrenceId", selection.getOccurrenceId(),
                        "selectionAction", "replace-current", "playWhenReady", true))).isAccepted());
        assertCode("STALE_REVISION", controller.handle(envelope("selectPrepared", 3L, 1L,
                mapOf("trackHandle", selection.getTrackHandle(), "occurrenceId", selection.getOccurrenceId(),
                        "selectionAction", "replace-current", "playWhenReady", true))));
    }

    @Test
    public void detachMakesOldPageCommandsAndSnapshotsInertWithoutTouchingServicePlayback() {
        FakeService service = new FakeService();
        PlaybackBridgeController controller = new PlaybackBridgeController(service);
        FakePage first = new FakePage();
        controller.attach(5L, first);
        PlaybackBridgeController.Reply playing = controller.handle(envelope("play", 5L, 0L, mapOf()));
        assertTrue(playing.isAccepted());
        controller.publish(playing.getSnapshot());
        assertEquals(1, service.commands.size());

        controller.detach(5L);
        assertFalse(controller.handle(envelope("pause", 5L, 1L, mapOf())).isAccepted());
        controller.publish(service.snapshot(2L));
        assertEquals(1, first.snapshots.size());
        assertEquals(0, service.detachCount);

        FakePage next = new FakePage();
        controller.attach(6L, next);
        controller.publish(service.snapshot(3L));
        assertEquals(1, next.snapshots.size());
        assertEquals(3L, next.snapshots.get(0).getRevision());
    }

    private static void assertCode(String code, PlaybackBridgeController.Reply reply) {
        assertFalse(reply.isAccepted());
        assertEquals(code, reply.getErrorCode());
    }

    private static Map<String, Object> validPrepare() {
        return mapOf("source", "bilibili", "providerTrackId", "BV1xx411c7mD", "providerPartId", 42L,
                "title", "Title", "artist", "Artist", "durationMs", 0L, "mediaKind", "audio");
    }

    private static Map<String, Object> envelope(String command, long epoch, long revision,
            Map<String, Object> payload) {
        return mapOf("requestId", command + "-request", "pageEpoch", epoch,
                "expectedRevision", revision, "command", command, "payload", payload);
    }

    private static Map<String, Object> mapOf(Object... entries) {
        Map<String, Object> value = new LinkedHashMap<>();
        for (int index = 0; index < entries.length; index += 2) value.put((String) entries[index], entries[index + 1]);
        return value;
    }

    private static final class FakePage implements PlaybackBridgeController.PageSink {
        final List<PlaybackSnapshot> snapshots = new ArrayList<>();
        @Override public void publish(PlaybackSnapshot snapshot) { snapshots.add(snapshot); }
    }

    private static final class FakeService implements PlaybackBridgeController.ServicePort {
        final List<PlaybackCommand> commands = new ArrayList<>();
        int detachCount;
        @Override public void dispatch(PlaybackCommand command, PlaybackSnapshot snapshot) {
            commands.add(command);
        }
        @Override public void rendererDetached() { detachCount += 1; }
        @Override public PlaybackSnapshot latestSnapshot() { return null; }
        PlaybackSnapshot snapshot(long revision) {
            return new PlaybackSnapshot(1, 6L, revision, PlaybackSnapshot.State.PAUSED,
                    new PlaybackSnapshot.Metadata("Title", "Artist", 0L, "bundled-placeholder"),
                    0L, 0L, 100, false, PlaybackSnapshot.Mode.SEQUENTIAL,
                    new PlaybackSnapshot.ActionAvailability(true, true, false, false, false, false),
                    new ArrayList<>(), null, new PlaybackSnapshot.RecoveryStatus("ready", false));
        }
    }
}
