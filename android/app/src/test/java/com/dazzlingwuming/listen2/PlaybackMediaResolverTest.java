package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.net.URI;
import java.util.List;

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

    @Test
    public void netEaseDefaultResolverKeepsRouteAbsenceActionableAndFixturesInternal() {
        NetEasePlaybackResolver unavailable = new NetEasePlaybackResolver(new NetEaseNativeProvider(
                request -> NetEaseNativeProvider.Response.error("NETWORK_IO_ERROR"),
                () -> "0123456789abcdef", new NetEaseNativeProvider.CookieSource() {
                    @Override public String forWeapi() { return "fixture"; }
                    @Override public String forEapi() { return "os=pc"; }
                }));
        PlaybackMediaResolver resolver = new PlaybackMediaResolver(unavailable,
                new PlaybackMediaResolver.IncrementingHandleSource("netease"), () -> 1_000L);
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(new PlaybackMediaResolver.Descriptor(
                "netease", "123456", 1L, "title", "artist", 1_000L, "audio"));

        assertNotNull(prepared);
        assertTrue(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 4L,
                "replace-current", true).isAccepted());
        PlaybackMediaResolver.Resolution unavailableResult = resolver.resolveCurrent(
                prepared.getOccurrenceId(), 4L);
        assertFalse(unavailableResult.isReady());
        assertEquals("network-unavailable", unavailableResult.getStatus());
        assertFalse(unavailableResult.toSnapshotFields().toString().contains("candidate"));

        NetEasePlaybackResolver fixture = NetEasePlaybackResolver.forDeterministicFixture(
                Collections.singletonList("https://audio.music.163.com/default.mp3?deadline=9999999999"));
        PlaybackMediaResolver fixtureResolver = new PlaybackMediaResolver(fixture,
                new PlaybackMediaResolver.IncrementingHandleSource("fixture"), () -> 1_000L);
        PlaybackMediaResolver.Prepared fixturePrepared = fixtureResolver.prepare(
                new PlaybackMediaResolver.Descriptor("netease", "123456", 1L, "title", "artist",
                        1_000L, "audio"));
        fixtureResolver.select(fixturePrepared.getTrackHandle(), fixturePrepared.getOccurrenceId(), 5L,
                "replace-current", true);

        assertTrue(fixtureResolver.resolveCurrent(fixturePrepared.getOccurrenceId(), 5L).isReady());
    }

    @Test
    public void netEaseCdnAllowlistAcceptsMusic126AndRejectsAdjacentHosts() {
        FakeManifest manifest = new FakeManifest();
        String valid = "https://m801.music.126.net/audio.mp3?auth=fixture";
        manifest.candidates = Arrays.asList(valid,
                "https://m801.music.126.net.evil.example/audio.mp3?auth=fixture");
        PlaybackMediaResolver resolver = new PlaybackMediaResolver(manifest,
                new PlaybackMediaResolver.IncrementingHandleSource("netease-cdn"), () -> 1_000L);
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(new PlaybackMediaResolver.Descriptor(
                "netease", "123456", 1L, "title", "artist", 1_000L, "audio"));
        assertTrue(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 1L,
                "replace-current", true).isAccepted());

        PlaybackMediaResolver.Resolution result = resolver.resolveCurrent(
                prepared.getOccurrenceId(), 1L);
        assertTrue(result.isReady());
        assertEquals(1, result.getCandidateCount());
        assertEquals(valid, result.candidates().get(0));
        assertFalse(result.toSnapshotFields().toString().contains("music.126.net"));
    }

    @Test
    public void authorizedLocalContentUriIsConsumedNativelyWithoutGenericAuthorityAllowlist() {
        final URI authorized = URI.create("content://documents.example/tree/root/document/song");
        PlaybackMediaResolver.ManifestPort localManifest = new PlaybackMediaResolver.ManifestPort() {
            @Override public List<String> resolve(PlaybackMediaResolver.Descriptor descriptor) {
                return Collections.singletonList(authorized.toString());
            }

            @Override public boolean isAuthorizedLocalUri(PlaybackMediaResolver.Descriptor descriptor,
                    URI uri) {
                return descriptor != null && "local".equals(descriptor.getSource())
                        && authorized.equals(uri);
            }
        };
        PlaybackMediaResolver resolver = new PlaybackMediaResolver(localManifest,
                new PlaybackMediaResolver.IncrementingHandleSource("local"), () -> 1_000L);
        PlaybackMediaResolver.Prepared prepared = resolver.prepare(new PlaybackMediaResolver.Descriptor(
                "local", "local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                1L, "title", "artist", 1_000L, "audio"));
        assertNotNull(prepared);
        assertTrue(resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 1L,
                "replace-current", true).isAccepted());

        PlaybackMediaResolver.Resolution result = resolver.resolveCurrent(
                prepared.getOccurrenceId(), 1L);
        assertTrue(result.isReady());
        assertEquals(1, result.getCandidateCount());
        assertEquals(authorized, result.mediaUris().get(0));
        assertFalse(result.toSnapshotFields().toString().contains("content://"));
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
