package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class BilibiliResponseMapperTest {
    private static final String BVID = "BV1xx411c7mD";

    @Test
    public void mapsVideoDetailWithBoundedApiOrderedPages() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.videoDetail(
                "detail", 1, BVID);
        JSONObject data = new JSONObject().put("bvid", BVID).put("title", "A Song")
                .put("duration", 120).put("pic", "https://i0.hdslb.com/a.jpg")
                .put("pages", new JSONArray()
                        .put(new JSONObject().put("cid", 22).put("page", 1).put("part", "P1")
                                .put("duration", 120))
                        .put(new JSONObject().put("cid", 23).put("page", 2).put("part", "P2")
                                .put("duration", 119)));
        BilibiliResponseMapper.MappingResult result = BilibiliResponseMapper.mapVideoDetail(
                request, new JSONObject().put("code", 0).put("data", data).toString());
        assertTrue(result.isValid());
        assertEquals(22, result.value.getJSONArray("pages").getJSONObject(0).getLong("cid"));
        assertFalse(result.value.has("raw"));
    }

    @Test
    public void explicitMissingCidFailsInsteadOfSelectingFirstPage() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "explicit", 99L);
        BilibiliResponseMapper.MappingResult result = BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), manifestFor(22).toString());
        assertFalse(result.isValid());
        assertEquals("INVALID_PART", result.errorCode);
    }

    @Test
    public void defaultFirstProjectsOnlySafeOrderedAudioCandidates() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "default-first", 0L);
        JSONObject manifest = manifestFor(22);
        JSONObject audio = manifest.getJSONObject("data").getJSONObject("dash")
                .getJSONArray("audio").getJSONObject(0);
        audio.put("backupUrl", new JSONArray()
                .put("https://upos-sz-mirrorcos.bilivideo.com/audio-backup.m4s?deadline=4102444800")
                .put("https://upos-sz-mirrorcos.bilivideo.com/audio-backup.m4s?deadline=4102444800"));
        BilibiliResponseMapper.MappingResult result = BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), manifest.toString());
        assertTrue(result.isValid());
        assertEquals(22, result.value.getLong("cid"));
        assertEquals(2, result.value.getJSONArray("candidates").length());
        assertFalse(result.value.has("headers"));
    }

    @Test
    public void rejectsUnsafeMediaAndExpiredOrUnsupportedStreams() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "explicit", 22L);
        JSONObject bad = manifestFor(22);
        bad.getJSONObject("data").getJSONObject("dash").getJSONArray("audio").getJSONObject(0)
                .put("baseUrl", "https://bilivideo.com.evil.example/a.m4s?deadline=4102444800")
                .put("codecs", "text/html");
        assertEquals("UNSUPPORTED_CODEC", BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), bad.toString()).errorCode);
        JSONObject expired = manifestFor(22);
        expired.getJSONObject("data").getJSONObject("dash").getJSONArray("audio").getJSONObject(0)
                .put("baseUrl", "https://upos-sz-mirrorcos.bilivideo.com/a.m4s?deadline=1");
        assertEquals("EXPIRED_STREAM", BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), expired.toString()).errorCode);
    }

    private static JSONObject detailWithPages() throws Exception {
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("bvid", BVID)
                .put("pages", new JSONArray().put(new JSONObject().put("cid", 22)
                        .put("page", 1).put("part", "P1").put("duration", 120))));
    }

    private static JSONObject manifestFor(long cid) throws Exception {
        JSONObject audio = new JSONObject().put("id", 30280).put("baseUrl",
                "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=4102444800")
                .put("mimeType", "audio/mp4").put("codecs", "mp4a.40.2").put("bandwidth", 128000);
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("bvid", BVID)
                .put("cid", cid).put("timelength", 120000).put("dash",
                        new JSONObject().put("audio", new JSONArray().put(audio))));
    }
}
