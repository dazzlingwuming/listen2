package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;

import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** Split host-driven process-death stages; each emits only bounded semantic assertions. */
public final class PlaybackRecoveryInstrumentationTest {
    @Test
    public void stageASeedsCommittedCheckpointAndDetachesRendererWithoutStoppingOwner() throws Exception {
        PlaybackInstrumentationFixture.clearDurableState();
        try (PlaybackInstrumentationFixture fixture = PlaybackInstrumentationFixture.connect()) {
            PlaybackCheckpointRepository repository = fixture.checkpointRepository();
            long expected = repository.restore().getRevision();
            long revision = expected + 1L;
            PlaybackCheckpointRepository.DurableState state = new PlaybackCheckpointRepository.DurableState(
                    revision, "stage-a-transition", "stage-a-context", "current-occurrence",
                    "current-occurrence", PlaybackQueueEngine.Mode.SHUFFLE,
                    PlaybackQueueEngine.Mode.SHUFFLE, true, 0, 4_000L,
                    Arrays.asList(
                            new PlaybackCheckpointRepository.OccurrenceState("current-occurrence", "track-current", "base", 0, true),
                            new PlaybackCheckpointRepository.OccurrenceState("duplicate-one", "track-duplicate", "queue", 0, true),
                            new PlaybackCheckpointRepository.OccurrenceState("duplicate-two", "track-duplicate", "queue", 1, true)),
                    Arrays.asList(new PlaybackCheckpointRepository.HistoryState(0, "current-occurrence", 1L)));
            PlaybackCheckpointRepository.Result result = repository.applyTransition(expected, state);
            assertEquals(PlaybackCheckpointRepository.Status.ACCEPTED, result.getStatus());
            assertEquals(revision, result.getRevision());

            Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
            Activity activity = launch(instrumentation);
            try {
                activity.finish();
                instrumentation.waitForIdleSync();
                assertTrue("renderer teardown must leave the sole service port usable", fixture.service() != null);
            } finally {
                if (!activity.isFinishing() && !activity.isDestroyed()) activity.finish();
            }
        }
    }

    @Test
    public void stageBRestoresPausedExactSemanticCheckpointWithoutTransport() throws Exception {
        try (PlaybackInstrumentationFixture fixture = PlaybackInstrumentationFixture.connect()) {
            fixture.await(() -> "restored".equals(recovery(fixture.snapshot())));
            Map<String, Object> snapshot = fixture.snapshot();
            assertEquals("paused", snapshot.get("state"));
            assertEquals("shuffle", snapshot.get("mode"));
            assertTrue("checkpoint revision must survive process death", number(snapshot.get("revision")) >= 1L);
            assertTrue("position must remain within recovery tolerance",
                    Math.abs(number(snapshot.get("positionMs")) - 4_000L) <= 5_000L);
            assertEquals(Arrays.asList("duplicate-one", "duplicate-two"), queueIds(snapshot));
            assertNoTransportMaterial(snapshot);
        }
    }

    private static Activity launch(Instrumentation instrumentation) {
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = instrumentation.startActivitySync(intent);
        if (activity == null) throw new AssertionError("MainActivity did not reconnect");
        return activity;
    }

    private static String recovery(Map<String, Object> snapshot) {
        Object value = snapshot.get("recovery");
        return value instanceof Map && ((Map<?, ?>) value).get("status") instanceof String
                ? (String) ((Map<?, ?>) value).get("status") : "";
    }

    private static List<String> queueIds(Map<String, Object> snapshot) {
        List<String> result = new ArrayList<>();
        Object queue = snapshot.get("queue");
        if (!(queue instanceof List)) return result;
        for (Object row : (List<?>) queue) {
            if (row instanceof Map && ((Map<?, ?>) row).get("occurrenceId") instanceof String) {
                result.add((String) ((Map<?, ?>) row).get("occurrenceId"));
            }
        }
        return result;
    }

    private static long number(Object value) { return value instanceof Number ? ((Number) value).longValue() : -1L; }

    private static void assertNoTransportMaterial(Object value) {
        if (value instanceof Map) {
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                String key = String.valueOf(entry.getKey()).toLowerCase();
                assertFalse("snapshot key exposes transport", key.contains("url") || key.contains("header")
                        || key.contains("cookie") || key.contains("candidate") || key.contains("signed"));
                assertNoTransportMaterial(entry.getValue());
            }
        } else if (value instanceof List) {
            for (Object item : (List<?>) value) assertNoTransportMaterial(item);
        } else if (value instanceof String) {
            String text = ((String) value).toLowerCase();
            assertFalse("snapshot string exposes transport", text.contains("http://") || text.contains("https://")
                    || text.contains("cookie=") || text.contains("authorization:"));
        }
    }
}
