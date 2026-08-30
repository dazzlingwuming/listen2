package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public final class PlaybackMediaResolverTest {
    @Test
    public void prepareMintsNativeHandlesAndSelectConsumesThemOnce() {
        PlaybackMediaResolver resolver = resolver(new FakeManifest());
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(descriptor());

        assertNotNull(prepared);
        assertTrue(prepared.getTrackHandle().startsWith("track-"));
        assertTrue(prepared.getOccurrenceId().startsWith("occ-"));
        assertTrue(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 4L,
                "replace-current", true).isAccepted());
        assertFalse(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 4L,
                "replace-current", true).isAccepted());
    }

    @Test
    public void rejectsUnsafeDescriptorsAndStaleSelectionRevision() {
        PlaybackMediaResolver resolver = resolver(new FakeManifest());
        assertEquals(null, resolver.prepare(new PlaybackMediaResolver.Descriptor("netease", "BV1abcDE1234",
                2L, "title", "artist", 1_000L, "audio")));
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(descriptor());
        assertTrue(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 3L,
                "replace-current", true).isAccepted());
        assertFalse(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 2L,
                "replace-current", true).isAccepted());
    }

    @Test
    public void candidatesAreBoundedOrderedDeduplicatedAndExpiredCandidatesFailSafely() {
        FakeManifest manifest = new FakeManifest();
        manifest.candidates = Arrays.asList(
                "https://a.bilivideo.com/audio.m4s?deadline=9999999999",
                "https://a.bilivideo.com/audio.m4s?deadline=9999999999",
                "https://b.bilivideo.com/audio.m4s?deadline=9999999999",
                "https://evil.example/audio.m4s?deadline=9999999999");
        PlaybackMediaResolver resolver = resolver(manifest);
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(descriptor());
        resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 4L, "replace-current", true);

        PlaybackMediaResolver.Resolution resolution = resolver.resolveCurrent(prepared.getOccurrenceId(), 4L);
        assertTrue(resolution.isReady());
        assertEquals(2, resolution.getCandidateCount());
        assertFalse(resolution.toSnapshotFields().containsKey("candidate"));
        assertFalse(resolution.toSnapshotFields().containsKey("headers"));
    }

    @Test
    public void restoreWithoutFreshManifestIsPausedAndActionable() {
        PlaybackMediaResolver resolver = resolver(new FakeManifest());
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(descriptor());
        resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 4L, "replace-current", true);

        PlaybackMediaResolver.Resolution restored = resolver.restoreCurrent(prepared.getOccurrenceId(), 4L);

        assertFalse(restored.isReady());
        assertEquals("refresh-unavailable", restored.getStatus());
        assertTrue(restored.isPaused());
    }

    private static PlaybackMediaResolver resolver(FakeManifest manifest) {
        return new PlaybackMediaResolver(manifest, new PlaybackMediaResolver.IncrementingHandleSource("native"),
                () -> 1_000L);
    }

    private static PlaybackMediaResolver.Descriptor descriptor() {
        return new PlaybackMediaResolver.Descriptor("bilibili", "BV1abcDE1234", 2L, "title", "artist",
                1_000L, "audio");
    }

    private static final class FakeManifest implements PlaybackMediaResolver.ManifestPort {
        java.util.List<String> candidates = Collections.singletonList(
                "https://a.bilivideo.com/audio.m4s?deadline=9999999999");
        @Override public java.util.List<String> resolve(PlaybackMediaResolver.Descriptor descriptor) {
            return candidates;
        }
    }
}
