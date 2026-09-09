package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

public final class BilibiliPlaybackResolverTest {
    private static final String BVID = "BV1xx411c7mD";

    @Test
    public void resolvesOnlyFixedDetailAndPlayurlRoutesForTheSelectedPart() throws Exception {
        FakeHttp http = new FakeHttp(detail(), manifest(22L));
        BilibiliPlaybackResolver resolver = new BilibiliPlaybackResolver(http);

        List<String> candidates = resolver.resolve(descriptor(22L));

        assertEquals(2, candidates.size());
        assertEquals("https://upos.bilivideo.com/audio.m4s?deadline=4102444800", candidates.get(0));
        assertEquals(2, http.requests.size());
        assertEquals("https://api.bilibili.com/x/web-interface/view?bvid=" + BVID,
                http.requests.get(0).toASCIIString());
        assertEquals("https://api.bilibili.com/x/player/playurl?fnval=16&fnver=0&fourk=1&bvid="
                        + BVID + "&cid=22", http.requests.get(1).toASCIIString());
    }

    @Test
    public void rejectsMismatchedPartsAndDoesNotExposeCandidateThroughResolutionSnapshot() throws Exception {
        BilibiliPlaybackResolver resolver = new BilibiliPlaybackResolver(new FakeHttp(detail(), manifest(22L)));
        PlaybackMediaResolver media = new PlaybackMediaResolver(resolver,
                new PlaybackMediaResolver.IncrementingHandleSource("native"), () -> 1_000L);
        PlaybackMediaResolver.Prepared prepared = media.prepare(descriptor(99L));
        assertTrue(media.select(prepared.getTrackHandle(), prepared.getOccurrenceId(), 2L,
                "replace-current", true).isAccepted());

        PlaybackMediaResolver.Resolution result = media.resolveCurrent(prepared.getOccurrenceId(), 2L);

        assertFalse(result.isReady());
        assertEquals("bilibili-manifest-unavailable", result.getStatus());
        assertFalse(result.toSnapshotFields().toString().contains("bilivideo"));
    }

    @Test
    public void resolvesLegacyAudioOnlyThroughTheFixedSidRoute() throws Exception {
        FakeHttp http = new FakeHttp("", new JSONObject().put("code", 0)
                .put("data", new JSONObject().put("cdns", new JSONArray()
                        .put("https://upos.bilivideo.com/legacy.m4s?deadline=4102444800")))
                .toString());
        BilibiliPlaybackResolver resolver = new BilibiliPlaybackResolver(http);

        List<String> candidates = resolver.resolve(new PlaybackMediaResolver.Descriptor(
                "bilibili", "9001", 1L, "title", "artist", 120_000L, "audio"));

        assertEquals(1, candidates.size());
        assertEquals("https://www.bilibili.com/audio/music-service-c/web/url?sid=9001",
                http.requests.get(0).toASCIIString());
    }

    private static PlaybackMediaResolver.Descriptor descriptor(long cid) {
        return new PlaybackMediaResolver.Descriptor("bilibili", BVID, cid, "title", "artist",
                120_000L, "audio");
    }

    private static String detail() throws Exception {
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("bvid", BVID)
                .put("title", "fixture").put("duration", 120).put("pages", new JSONArray()
                        .put(new JSONObject().put("cid", 22L).put("page", 1).put("part", "P1")
                                .put("duration", 120)))).toString();
    }

    private static String manifest(long cid) throws Exception {
        JSONObject audio = new JSONObject().put("id", 30280)
                .put("baseUrl", "https://upos.bilivideo.com/audio.m4s?deadline=4102444800")
                .put("backupUrl", new JSONArray().put(
                        "https://upos-backup.bilivideo.com/audio.m4s?deadline=4102444800"))
                .put("mimeType", "audio/mp4").put("codecs", "mp4a.40.2").put("bandwidth", 128000);
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("bvid", BVID)
                .put("cid", cid).put("timelength", 120000).put("dash",
                        new JSONObject().put("audio", new JSONArray().put(audio)))).toString();
    }

    private static final class FakeHttp implements BilibiliPlaybackResolver.HttpPort {
        final List<URI> requests = new ArrayList<>();
        final String detail;
        final String manifest;

        FakeHttp(String detail, String manifest) {
            this.detail = detail;
            this.manifest = manifest;
        }

        @Override public BilibiliPlaybackResolver.Response get(URI uri) {
            requests.add(uri);
            return new BilibiliPlaybackResolver.Response(200,
                    AndroidRpcContract.BILIBILI_VIDEO_DETAIL_PATH.equals(uri.getPath()) ? detail : manifest);
        }
    }
}
