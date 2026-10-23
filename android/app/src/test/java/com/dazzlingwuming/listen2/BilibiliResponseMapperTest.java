package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class BilibiliResponseMapperTest {
    private static final String BVID = "BV1xx411c7mD";

    @Test public void importedTracksInLargeCollectionsResolveTheirExplicitPart() throws Exception {
        JSONArray pages = new JSONArray();
        for (int i = 0; i < 198; i++) pages.put(new JSONObject().put("cid", 22 + i)
                .put("page", i + 1).put("part", "歌曲 " + i).put("duration", 120));
        String detail = new JSONObject().put("code", 0).put("data", new JSONObject()
                .put("bvid", BVID).put("title", "歌曲合集").put("pages", pages)).toString();
        BilibiliResponseMapper.MappingResult projection = BilibiliResponseMapper.mapVideoDetail(
                AndroidRpcContract.TypedRequest.videoDetail("detail", 1, BVID), detail);
        assertTrue(projection.isValid()); assertEquals(198, projection.value.getJSONArray("pages").length());
        BilibiliResponseMapper.MappingResult audio = BilibiliResponseMapper.mapAudioManifest(
                AndroidRpcContract.TypedRequest.audioManifest("manifest", 1, BVID, "explicit", 219L),
                detail, manifestFor(219).toString());
        assertTrue(audio.isValid()); assertEquals(219, audio.value.getLong("cid"));
    }

    @Test
    public void mapsVideoDetailWithBoundedApiOrderedPages() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.videoDetail(
                "detail", 1, BVID);
        JSONObject data = new JSONObject().put("bvid", BVID).put("title", "A Song")
                .put("duration", 120).put("pic", "http://i0.hdslb.com/a.jpg")
                .put("pages", new JSONArray()
                        .put(new JSONObject().put("cid", 22).put("page", 1).put("part", "P1")
                                .put("duration", 120))
                        .put(new JSONObject().put("cid", 23).put("page", 2).put("part", "P2")
                                .put("duration", 119)));
        BilibiliResponseMapper.MappingResult result = BilibiliResponseMapper.mapVideoDetail(
                request, new JSONObject().put("code", 0).put("data", data).toString());
        assertTrue(result.isValid());
        assertEquals("https://i0.hdslb.com/a.jpg", result.value.getString("cover"));
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
    public void missingManifestIdentityUsesVerifiedDetailAndRequestIdentity() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "explicit", 22L);
        for (String omitted : new String[] { "bvid", "cid", "both" }) {
            JSONObject manifest = manifestFor(22);
            JSONObject data = manifest.getJSONObject("data");
            if (!"cid".equals(omitted)) data.remove("bvid");
            if (!"bvid".equals(omitted)) data.remove("cid");
            BilibiliResponseMapper.MappingResult result = BilibiliResponseMapper.mapAudioManifest(
                    request, detailWithPages(), manifest.toString());
            assertTrue(result.isValid());
            assertEquals(BVID, result.value.getString("bvid"));
            assertEquals(22L, result.value.getLong("cid"));
        }
        JSONObject wrongDetail = detailWithPages();
        wrongDetail.getJSONObject("data").put("bvid", "BV1yy411c7mD");
        JSONObject absent = manifestFor(22);
        absent.getJSONObject("data").remove("bvid");
        absent.getJSONObject("data").remove("cid");
        assertEquals("IDENTITY_MISMATCH", BilibiliResponseMapper.mapAudioManifest(
                request, wrongDetail, absent.toString()).errorCode);
    }

    @Test
    public void preservesProviderIssuedMcdnPrimaryAndItsSignedQuery() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "explicit", 22L);
        JSONObject manifest = manifestFor(22);
        String primary = "https://node.mcdn.bilivideo.cn:8082/audio.m4s?deadline=4102444800&token=a%2Bb";
        manifest.getJSONObject("data").getJSONObject("dash").getJSONArray("audio")
                .getJSONObject(0).put("baseUrl", primary);
        BilibiliResponseMapper.MappingResult result = BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), manifest.toString());
        assertTrue(result.isValid());
        assertEquals(primary, result.value.getJSONArray("candidates").getString(0));
    }

    @Test
    public void presentManifestIdentityMustRemainValidAndMatch() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "explicit", 22L);
        for (Object bvid : new Object[] { "BV1yy411c7mD", "", 22, JSONObject.NULL }) {
            JSONObject manifest = manifestFor(22);
            manifest.getJSONObject("data").put("bvid", bvid);
            assertEquals("IDENTITY_MISMATCH", BilibiliResponseMapper.mapAudioManifest(
                    request, detailWithPages(), manifest.toString()).errorCode);
        }
        for (Object cid : new Object[] { 23L, 0L, -22L, 22.5, "22", JSONObject.NULL }) {
            JSONObject manifest = manifestFor(22);
            manifest.getJSONObject("data").put("cid", cid);
            assertEquals("IDENTITY_MISMATCH", BilibiliResponseMapper.mapAudioManifest(
                    request, detailWithPages(), manifest.toString()).errorCode);
        }
    }

    @Test
    public void unusableCandidatesDoNotPoisonUsablePrimaryOrBackup() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "explicit", 22L);
        String good = "https://upos-sz-mirrorcos.bilivideo.com/good.m4s?deadline=4102444800";
        String unsafe = "https://bilivideo.com.evil.example/bad.m4s?deadline=4102444800";
        String expired = "https://upos-sz-mirrorcos.bilivideo.com/old.m4s?deadline=1";
        for (String primary : new String[] { good, unsafe, expired }) {
            JSONObject manifest = manifestFor(22);
            JSONObject audio = manifest.getJSONObject("data").getJSONObject("dash")
                    .getJSONArray("audio").getJSONObject(0);
            audio.put("baseUrl", primary).put("backupUrl", new JSONArray()
                    .put(unsafe).put(expired).put(good).put(good));
            BilibiliResponseMapper.MappingResult result = BilibiliResponseMapper.mapAudioManifest(
                    request, detailWithPages(), manifest.toString());
            assertTrue(result.isValid());
            assertEquals(1, result.value.getJSONArray("candidates").length());
            assertEquals(good, result.value.getJSONArray("candidates").getString(0));
            assertEquals(22L, result.value.getLong("cid"));
        }
    }

    @Test
    public void noUsableCandidateKeepsExplicitFailureAndInputBounds() throws Exception {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.audioManifest(
                "manifest", 1, BVID, "explicit", 22L);
        String good = "https://upos-sz-mirrorcos.bilivideo.com/good.m4s?deadline=4102444800";
        String unsafe = "http://upos-sz-mirrorcos.bilivideo.com/bad.m4s?deadline=4102444800";
        JSONObject bad = manifestFor(22);
        bad.getJSONObject("data").getJSONObject("dash").getJSONArray("audio").getJSONObject(0)
                .put("baseUrl", unsafe).put("backupUrl", new JSONArray().put(unsafe));
        assertEquals("INVALID_STREAM", BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), bad.toString()).errorCode);
        JSONObject excess = manifestFor(22);
        excess.getJSONObject("data").getJSONObject("dash").getJSONArray("audio").getJSONObject(0)
                .put("backupUrl", new JSONArray().put(good).put(good).put(good).put(good).put(good));
        assertEquals("INVALID_STREAM", BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), excess.toString()).errorCode);
        JSONObject wrongIdentity = manifestFor(23);
        assertEquals("IDENTITY_MISMATCH", BilibiliResponseMapper.mapAudioManifest(
                request, detailWithPages(), wrongIdentity.toString()).errorCode);
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
