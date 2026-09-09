package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.net.SocketTimeoutException;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/** JVM-only tests: no provider endpoint is contacted. */
public final class BilibiliDirectoryProviderTest {
    @Test
    public void projectsOnlySemanticDirectoryAndTrackFields() throws Exception {
        List<BilibiliDirectoryProvider.Request> requests = new ArrayList<>();
        BilibiliDirectoryProvider provider = new BilibiliDirectoryProvider(request -> {
            requests.add(request);
            if (request.route == BilibiliDirectoryProvider.Route.DIRECTORY_PAGE) {
                return response(new JSONObject().put("data", new JSONArray().put(menu(17L))));
            }
            if (request.route == BilibiliDirectoryProvider.Route.DIRECTORY_INFO) {
                return response(new JSONObject().put("title", "Native menu")
                        .put("cover", "https://i0.hdslb.com/menu.jpg"));
            }
            return response(new JSONObject().put("data", new JSONArray().put(track(99L))));
        }, () -> "SESSDATA=fixture-native-only");

        BilibiliDirectoryProvider.Result page = provider.executeDirectoryPage(1);
        assertTrue(page.isSuccess());
        assertEquals("biplaylist_17", page.value.getJSONArray("rows").getJSONObject(0).getString("id"));
        assertEquals("Menu 17", page.value.getJSONArray("rows").getJSONObject(0).getString("title"));

        BilibiliDirectoryProvider.Result detail = provider.executeDirectoryDetail(17L);
        assertTrue(detail.isSuccess());
        assertEquals("Native menu", detail.value.getJSONObject("info").getString("title"));
        JSONObject safeTrack = detail.value.getJSONArray("tracks").getJSONObject(0);
        assertEquals("bitrack_99", safeTrack.getString("id"));
        assertEquals("playable", safeTrack.getString("capability"));
        assertFalse(safeTrack.has("audio"));
        assertFalse(safeTrack.has("playUrl"));
        assertFalse(safeTrack.has("lyric"));
        assertFalse(detail.value.toString().contains("fixture-native-only"));
        assertFalse(detail.value.toString().contains("media-secret"));
        assertEquals(3, requests.size());
        assertEquals("https://www.bilibili.com/audio/music-service-c/web/menu/hit?ps=20&pn=1",
                requests.get(0).uri.toASCIIString());
        assertEquals("https://www.bilibili.com/audio/music-service-c/web/menu/info?sid=17",
                requests.get(1).uri.toASCIIString());
        assertEquals("https://www.bilibili.com/audio/music-service-c/web/song/of-menu?pn=1&ps=100&sid=17",
                requests.get(2).uri.toASCIIString());
        assertEquals("SESSDATA=fixture-native-only", requests.get(0).fixedHeaders().get("Cookie"));
        assertEquals(BilibiliDirectoryProvider.REFERER, requests.get(0).fixedHeaders().get("Referer"));
        assertEquals(BilibiliDirectoryProvider.USER_AGENT, requests.get(0).fixedHeaders().get("User-Agent"));
    }

    @Test
    public void routeCatalogRejectsCallerTransportChangesAndInvalidSemanticInputs() throws Exception {
        BilibiliDirectoryProvider provider = new BilibiliDirectoryProvider(
                request -> new BilibiliDirectoryProvider.Response(200, "{}"), () -> "");
        BilibiliDirectoryProvider.Request page = provider.buildDirectoryPageRequest(1);
        assertTrue(BilibiliDirectoryProvider.isApprovedRequest(page));
        assertFalse(BilibiliDirectoryProvider.isApprovedRequest(new BilibiliDirectoryProvider.Request(
                BilibiliDirectoryProvider.Route.DIRECTORY_PAGE,
                new URI("https://evil.example/audio/music-service-c/web/menu/hit?ps=20&pn=1"), "")));
        assertFalse(BilibiliDirectoryProvider.isApprovedRequest(new BilibiliDirectoryProvider.Request(
                BilibiliDirectoryProvider.Route.DIRECTORY_PAGE,
                new URI("https://www.bilibili.com/audio/music-service-c/web/menu/hit?ps=20&pn=1&url=https%3A%2F%2Fevil.example"), "")));
        assertFalse(BilibiliDirectoryProvider.isApprovedRequest(new BilibiliDirectoryProvider.Request(
                BilibiliDirectoryProvider.Route.DIRECTORY_TRACKS,
                new URI("http://www.bilibili.com/audio/music-service-c/web/song/of-menu?pn=1&ps=100&sid=17"), "")));
        assertEquals("INVALID_PAYLOAD", provider.executeDirectoryPage(0).status);
        assertEquals("INVALID_PAYLOAD", provider.executeDirectoryPage(BilibiliDirectoryProvider.MAX_PAGE + 1).status);
        assertEquals("INVALID_PAYLOAD", provider.executeDirectoryDetail(0L).status);
        assertEquals("INVALID_PAYLOAD", provider.executeDirectoryDetail(1_000_000_000_000_000_000L).status);
    }

    @Test
    public void failsClosedForMaliciousFieldsAndOverlargeProviderRows() throws Exception {
        BilibiliDirectoryProvider provider = new BilibiliDirectoryProvider(request -> {
            if (request.route == BilibiliDirectoryProvider.Route.DIRECTORY_PAGE) {
                return response(new JSONObject().put("data", new JSONArray().put(menu(1L)
                        .put("title", "<img src=x>"))));
            }
            if (request.route == BilibiliDirectoryProvider.Route.DIRECTORY_INFO) {
                return response(new JSONObject().put("title", "Good"));
            }
            return response(new JSONObject().put("data", new JSONArray().put(track(1L)
                    .put("cover", "https://evil.example/tracker.png"))));
        }, () -> "");

        assertEquals("MALFORMED_PROVIDER_RESPONSE", provider.executeDirectoryPage(1).status);
        assertEquals("MALFORMED_PROVIDER_RESPONSE", provider.executeDirectoryDetail(1L).status);

        BilibiliDirectoryProvider oversized = new BilibiliDirectoryProvider(request -> {
            JSONArray rows = new JSONArray();
            int count = request.route == BilibiliDirectoryProvider.Route.DIRECTORY_PAGE ? 21 : 101;
            for (int index = 0; index < count; index += 1) {
                rows.put(request.route == BilibiliDirectoryProvider.Route.DIRECTORY_PAGE
                        ? menu(index + 1L) : track(index + 1L));
            }
            if (request.route == BilibiliDirectoryProvider.Route.DIRECTORY_INFO) {
                return response(new JSONObject().put("title", "Good"));
            }
            return response(new JSONObject().put("data", rows));
        }, () -> "");
        assertEquals("MALFORMED_PROVIDER_RESPONSE", oversized.executeDirectoryPage(1).status);
        assertEquals("MALFORMED_PROVIDER_RESPONSE", oversized.executeDirectoryDetail(1L).status);
    }

    @Test
    public void returnsTerminalProviderPermissionRedirectNoResultsAndNetworkStatuses() throws Exception {
        BilibiliDirectoryProvider permission = new BilibiliDirectoryProvider(
                request -> new BilibiliDirectoryProvider.Response(200,
                        new JSONObject().put("code", -101).toString()), () -> "");
        assertEquals("LOGIN_REQUIRED", permission.executeDirectoryPage(1).status);

        BilibiliDirectoryProvider providerStatus = new BilibiliDirectoryProvider(
                request -> new BilibiliDirectoryProvider.Response(503, "unavailable"), () -> "");
        assertEquals("PROVIDER_STATUS", providerStatus.executeDirectoryPage(1).status);

        BilibiliDirectoryProvider redirect = new BilibiliDirectoryProvider(
                request -> new BilibiliDirectoryProvider.Response(302, "redirect"), () -> "");
        assertEquals("REDIRECT_NOT_ALLOWED", redirect.executeDirectoryPage(1).status);

        BilibiliDirectoryProvider noResults = new BilibiliDirectoryProvider(
                request -> response(new JSONObject().put("data", new JSONArray())), () -> "");
        BilibiliDirectoryProvider.Result empty = noResults.executeDirectoryPage(1);
        assertEquals("NO_RESULTS", empty.status);
        assertFalse(empty.isSuccess());
        assertNull(empty.value);

        BilibiliDirectoryProvider network = new BilibiliDirectoryProvider(
                request -> { throw new SocketTimeoutException("fixture"); }, () -> "");
        assertEquals("NETWORK_TIMEOUT", network.executeDirectoryPage(1).status);
    }

    @Test
    public void ignoresInvalidNativeCookieRatherThanReflectingIt() throws Exception {
        List<BilibiliDirectoryProvider.Request> requests = new ArrayList<>();
        BilibiliDirectoryProvider provider = new BilibiliDirectoryProvider(request -> {
            requests.add(request);
            return response(new JSONObject().put("data", new JSONArray().put(menu(1L))));
        }, () -> "SESSDATA=bad\r\nX-Injected: yes");

        BilibiliDirectoryProvider.Result result = provider.executeDirectoryPage(1);
        assertTrue(result.isSuccess());
        assertNotNull(requests.get(0));
        assertFalse(requests.get(0).fixedHeaders().containsKey("Cookie"));
        assertFalse(result.value.toString().contains("Injected"));
    }

    private static BilibiliDirectoryProvider.Response response(JSONObject data) throws Exception {
        return new BilibiliDirectoryProvider.Response(200,
                new JSONObject().put("code", 0).put("data", data).toString());
    }

    private static JSONObject menu(long id) throws Exception {
        return new JSONObject().put("menuId", id).put("title", "Menu " + id)
                .put("cover", "https://i0.hdslb.com/menu-" + id + ".jpg");
    }

    private static JSONObject track(long id) throws Exception {
        return new JSONObject().put("id", id).put("uid", 5).put("title", "Song " + id)
                .put("uname", "Artist").put("duration", 123)
                .put("cover", "https://i0.hdslb.com/song-" + id + ".jpg")
                .put("playUrl", "https://media-secret.example/audio.m4s")
                .put("lyric", "https://media-secret.example/lyric");
    }
}
