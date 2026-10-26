package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

public final class NetEasePlaybackResolverTest {
    @Test
    public void resolvesOneNativeDefaultCandidateWithoutASecondRoute() {
        NetEaseNativeProvider provider = new NetEaseNativeProvider(request ->
                new NetEaseNativeProvider.Response(200,
                        "{\"code\":200,\"data\":[{\"id\":123,\"br\":999000,"
                                + "\"url\":\"https://m801.music.126.net/signed?auth=1\"}]}") ,
                () -> "0123456789abcdef", new FixedCookies());
        NetEasePlaybackResolver resolver = new NetEasePlaybackResolver(provider);

        List<String> candidates = resolver.resolve(descriptor());

        assertEquals(1, candidates.size());
        assertEquals("https://m801.music.126.net/signed?auth=1", candidates.get(0));
        assertEquals("ready", resolver.unavailableStatus());
    }

    @Test
    public void nullUrlDoesNotBecomeAPlayableCandidate() {
        NetEaseNativeProvider provider = new NetEaseNativeProvider(request ->
                new NetEaseNativeProvider.Response(200,
                        "{\"code\":200,\"data\":[{\"id\":123,\"br\":999000,\"url\":null}]}") ,
                () -> "0123456789abcdef", new FixedCookies());
        NetEasePlaybackResolver resolver = new NetEasePlaybackResolver(provider);

        assertTrue(resolver.resolve(descriptor()).isEmpty());
        assertEquals("permission-required", resolver.unavailableStatus());
    }

    @Test
    public void fixtureCandidatesRemainResolverPrivateAndRouteAbsenceIsExplicit() {
        NetEasePlaybackResolver fixture = NetEasePlaybackResolver.forDeterministicFixture(
                java.util.Collections.singletonList("https://audio.music.163.com/fixture?deadline=4102444800"));
        PlaybackMediaResolver media = new PlaybackMediaResolver(fixture,
                new PlaybackMediaResolver.IncrementingHandleSource("fixture"), () -> 1_000L);
        PlaybackMediaResolver.Prepared prepared = media.prepare(descriptor());
        assertTrue(media.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 1L,
                "replace-current", true).isAccepted());

        PlaybackMediaResolver.Resolution resolution = media.resolveCurrent(
                prepared.getOccurrenceId(), 1L);
        assertTrue(resolution.isReady());
        assertEquals(1, resolution.getCandidateCount());
        assertFalse(resolution.toSnapshotFields().toString().contains("music.163.com"));
    }

    private static PlaybackMediaResolver.Descriptor descriptor() {
        return new PlaybackMediaResolver.Descriptor("netease", "123", 1L,
                "Title", "Artist", 123_000L, "audio");
    }

    private static final class FixedCookies implements NetEaseNativeProvider.CookieSource {
        @Override public String forWeapi() { return "weapi-fixture"; }
        @Override public String forEapi() { return "os=pc"; }
    }
}
