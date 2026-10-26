package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;
import org.junit.Test;

public final class NetEaseProviderClientTest {
    @Test
    public void searchDirectoryRenditionAndLyricAreClosedTypedReplies() throws Exception {
        FakeTransport transport = new FakeTransport();
        NetEaseProviderClient client = new NetEaseProviderClient(new NetEaseNativeProvider(
                transport, () -> "0123456789abcdef", new NetEaseNativeProvider.CookieSource() {
                    @Override public String forWeapi() { return "weapi-fixture"; }
                    @Override public String forEapi() { return "os=pc"; }
                }));

        AndroidRpcContract.TypedReply search = client.executeSearch(
                AndroidRpcContract.TypedRequest.neteaseSearch("search", 1, "title", 1));
        AndroidRpcContract.TypedReply directory = client.executeDirectoryDetail(
                AndroidRpcContract.TypedRequest.operation("directory", 1,
                        AndroidRpcContract.Operation.NETEASE_DIRECTORY_DETAIL,
                        new JSONObject().put("trackId", "9")));
        AndroidRpcContract.TypedReply rendition = client.executeDefaultRendition(
                AndroidRpcContract.TypedRequest.operation("rendition", 1,
                        AndroidRpcContract.Operation.NETEASE_RENDITION_DEFAULT,
                        new JSONObject().put("trackId", "123").put("selectionRevision", 0)));
        AndroidRpcContract.TypedReply lyric = client.executePrimaryLyric(
                AndroidRpcContract.TypedRequest.operation("lyric", 1,
                        AndroidRpcContract.Operation.NETEASE_LYRIC_PRIMARY,
                        new JSONObject().put("trackId", "123")
                                .put("selectionIdentity", "occ-1")
                                .put("selectionRevision", 0)
                                .put("selectionToken", "token-1")));

        assertEquals(AndroidRpcContract.Terminal.OK, search.terminal);
        assertEquals(AndroidRpcContract.Terminal.OK, directory.terminal);
        assertEquals(AndroidRpcContract.Terminal.OK, rendition.terminal);
        assertEquals(AndroidRpcContract.Terminal.OK, lyric.terminal);
        assertEquals(2, directory.result.getJSONArray("tracks").length());
        assertTrue(rendition.result.getBoolean("prepared"));
        assertFalse(rendition.toJson().contains("music.126.net"));
        assertFalse(rendition.toJson().contains("signed"));
        assertEquals("[search, playlist, songs, rendition, lyric]", transport.routes.toString());
    }

    @Test
    public void nullRenditionUrlIsAnActionablePermissionFailure() throws Exception {
        FakeTransport transport = new FakeTransport();
        transport.nullRendition = true;
        NetEaseProviderClient client = new NetEaseProviderClient(new NetEaseNativeProvider(
                transport, () -> "0123456789abcdef", new FixedCookies()));

        AndroidRpcContract.TypedReply reply = client.executeDefaultRendition(
                AndroidRpcContract.TypedRequest.operation("rendition", 1,
                        AndroidRpcContract.Operation.NETEASE_RENDITION_DEFAULT,
                        new JSONObject().put("trackId", "123").put("selectionRevision", 0)));

        assertEquals(AndroidRpcContract.Terminal.ERROR, reply.terminal);
        assertEquals("ENTITLEMENT_REQUIRED", reply.errorCode);
        assertFalse(reply.toJson().contains("url"));
    }

    private static final class FixedCookies implements NetEaseNativeProvider.CookieSource {
        @Override public String forWeapi() { return "weapi-fixture"; }
        @Override public String forEapi() { return "os=pc"; }
    }

    private static final class FakeTransport implements NetEaseNativeProvider.Transport {
        final List<String> routes = new ArrayList<>();
        boolean nullRendition;

        @Override
        public NetEaseNativeProvider.Response execute(NetEaseNativeProvider.Request request) {
            switch (request.route) {
                case SEARCH:
                    routes.add("search");
                    return new NetEaseNativeProvider.Response(200,
                            "{\"code\":200,\"result\":{\"songCount\":1,\"songs\":["
                                    + "{\"id\":123,\"name\":\"One\",\"artists\":[{\"name\":\"Artist\"}],"
                                    + "\"duration\":123000}]}}");
                case PLAYLIST_DETAIL:
                    routes.add("playlist");
                    return new NetEaseNativeProvider.Response(200,
                            "{\"code\":200,\"playlist\":{\"id\":9,\"name\":\"List\","
                                    + "\"trackIds\":[{\"id\":123},{\"id\":456}]}}");
                case SONG_DETAIL:
                    routes.add("songs");
                    return new NetEaseNativeProvider.Response(200,
                            "{\"code\":200,\"songs\":["
                                    + "{\"id\":123,\"name\":\"One\",\"fee\":0,\"dt\":123000,"
                                    + "\"ar\":[{\"name\":\"Artist\"}],\"al\":{\"name\":\"Album\"}},"
                                    + "{\"id\":456,\"name\":\"Two\",\"fee\":0,\"dt\":456000,"
                                    + "\"ar\":[{\"name\":\"Artist 2\"}],\"al\":{\"name\":\"Album 2\"}}]}");
                case RENDITION_DEFAULT:
                    routes.add("rendition");
                    return new NetEaseNativeProvider.Response(200,
                            "{\"code\":200,\"data\":[{\"id\":123,\"url\":"
                                    + (nullRendition ? "null" : "\"https://m801.music.126.net/signed?auth=1\"")
                                    + ",\"br\":999000}]}");
                case LYRIC_PRIMARY:
                    routes.add("lyric");
                    return new NetEaseNativeProvider.Response(200,
                            "{\"code\":200,\"lrc\":{\"lyric\":\"[00:01.00]Hello\"},"
                                    + "\"tlyric\":{\"lyric\":\"[00:01.00]你好\"}}");
                default:
                    return NetEaseNativeProvider.Response.error("NETWORK_IO_ERROR");
            }
        }
    }
}
