package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NetEaseNativeProjectionTest {
    @Test
    public void directoryProjectionIsBoundedAndContainsNoTransportFields() throws Exception {
        String playlist = "{\"code\":200,\"playlist\":{\"id\":9,\"name\":\"Fixture list\","
                + "\"trackIds\":[{\"id\":123},{\"id\":456}]}}";
        String songs = "{\"code\":200,\"songs\":["
                + "{\"id\":123,\"name\":\"One\",\"fee\":0,\"dt\":123000,"
                + "\"ar\":[{\"id\":1,\"name\":\"Artist\"}],\"al\":{\"id\":2,\"name\":\"Album\"}},"
                + "{\"id\":456,\"name\":\"Two\",\"fee\":1,\"dt\":456000,"
                + "\"ar\":[{\"id\":3,\"name\":\"Artist 2\"}],\"al\":{\"id\":4,\"name\":\"Album 2\"}}]}";

        NetEaseResponseMapper.MappingResult result = NetEaseResponseMapper.mapDirectoryDetail(
                "9", playlist, songs);

        assertTrue(result.isValid());
        assertEquals("neplaylist_9", result.value.getJSONObject("info").getString("id"));
        assertEquals(2, result.value.getJSONArray("tracks").length());
        assertEquals("default-rendition", result.value.getJSONArray("tracks")
                .getJSONObject(0).getString("capability"));
        assertEquals("permission-required", result.value.getJSONArray("tracks")
                .getJSONObject(1).getString("capability"));
        assertFalse(result.value.toString().contains("http"));
        assertFalse(result.value.toString().contains("cookie"));
        assertFalse(result.value.toString().contains("params"));
    }

    @Test
    public void renditionNullUrlIsPermissionNotEmptySuccessAndUnsafeUrlIsMalformed() throws Exception {
        String nullUrl = "{\"code\":200,\"data\":[{\"id\":123,\"url\":null,\"br\":999000}]}";
        NetEaseResponseMapper.RenditionResult permission = NetEaseResponseMapper.mapDefaultRendition(
                "123", nullUrl);
        assertFalse(permission.isValid());
        assertEquals("ENTITLEMENT_REQUIRED", permission.errorCode);

        String unsafe = "{\"code\":200,\"data\":[{\"id\":123,"
                + "\"url\":\"https://evil.example/signed\",\"br\":999000}]}";
        NetEaseResponseMapper.RenditionResult malformed = NetEaseResponseMapper.mapDefaultRendition(
                "123", unsafe);
        assertFalse(malformed.isValid());
        assertEquals("MALFORMED_PROVIDER_RESPONSE", malformed.errorCode);
    }

    @Test
    public void validRenditionStaysInsideNativeResultType() throws Exception {
        String body = "{\"code\":200,\"data\":[{\"id\":123,"
                + "\"url\":\"https://m801.music.126.net/signed?auth=1\",\"br\":999000}]}";
        NetEaseResponseMapper.RenditionResult result = NetEaseResponseMapper.mapDefaultRendition("123", body);

        assertTrue(result.isValid());
        assertEquals("https://m801.music.126.net/signed?auth=1", result.url);
        assertEquals(999000L, result.bitrate);
    }

    @Test
    public void lyricProjectionBoundsTextAndReturnsOnlyProviderNeutralFields() throws Exception {
        String body = "{\"code\":200,\"lrc\":{\"lyric\":\"[00:01.00]Hello\\\\\\n\"},"
                + "\"tlyric\":{\"lyric\":\"[00:01.00]你好\"}}";
        NetEaseResponseMapper.MappingResult result = NetEaseResponseMapper.mapPrimaryLyric(body);

        assertTrue(result.isValid());
        assertEquals("netease", result.value.getString("source"));
        assertEquals("[00:01.00]Hello\n", result.value.getString("lyric"));
        assertEquals("[00:01.00]你好", result.value.getString("tlyric"));
        assertFalse(result.value.toString().contains("url"));
    }
}
