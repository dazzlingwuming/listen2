package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONException;
import org.junit.Test;

public final class NetEaseNativeProviderTest {
    @Test
    public void searchRouteIsExactAndPageCannotChangeTransport() throws Exception {
        NetEaseNativeProvider provider = new NetEaseNativeProvider(
                request -> new NetEaseNativeProvider.Response(200, "{}"),
                () -> "0123456789abcdef",
                new FixedCookies());

        NetEaseNativeProvider.Request request = provider.buildSearchRequest("Listen 2", 3);

        assertEquals(NetEaseNativeProvider.Route.SEARCH, request.route);
        assertEquals("GET", request.method);
        assertEquals("https://music.163.com/api/search/get/web?s=Listen+2&type=1&offset=40&limit=20",
                request.uri.toASCIIString());
        assertEquals("", request.body);
        assertTrue(NetEaseNativeProvider.isApprovedRequest(request));
        assertFalse(request.fixedHeaders().containsKey("X-Caller-Url"));
        assertFalse(request.fixedHeaders().containsKey("Authorization"));
    }

    @Test
    public void searchRouteEncodesUnicodeKeywordExactlyOnce() throws Exception {
        NetEaseNativeProvider provider = new NetEaseNativeProvider(
                request -> new NetEaseNativeProvider.Response(200, "{}"),
                () -> "0123456789abcdef",
                new FixedCookies());

        NetEaseNativeProvider.Request request = provider.buildSearchRequest("青花瓷", 1);

        assertEquals("s=%E9%9D%92%E8%8A%B1%E7%93%B7&type=1&offset=0&limit=20",
                request.uri.getRawQuery());
        assertFalse(request.uri.getRawQuery().contains("%25"));
        assertTrue(NetEaseNativeProvider.isApprovedRequest(request));
    }

    @Test
    public void weapiAndEapiRoutesHaveOnlyFixedHostsPathsAndFormKeys() throws Exception {
        NetEaseNativeProvider provider = new NetEaseNativeProvider(
                request -> new NetEaseNativeProvider.Response(200, "{}"),
                () -> "0123456789abcdef",
                new FixedCookies());

        NetEaseNativeProvider.Request playlist = provider.buildPlaylistDetailRequest(123L);
        NetEaseNativeProvider.Request songs = provider.buildSongDetailRequest(java.util.Arrays.asList(1L, 2L));
        NetEaseNativeProvider.Request rendition = provider.buildDefaultRenditionRequest(123L);
        NetEaseNativeProvider.Request lyric = provider.buildPrimaryLyricRequest(123L);

        assertEquals("https://music.163.com/weapi/v3/playlist/detail", playlist.uri.toASCIIString());
        assertEquals("https://music.163.com/weapi/v3/song/detail", songs.uri.toASCIIString());
        assertEquals("https://interface3.music.163.com/eapi/song/enhance/player/url",
                rendition.uri.toASCIIString());
        assertEquals("https://music.163.com/weapi/song/lyric?csrf_token=", lyric.uri.toASCIIString());
        assertTrue(NetEaseNativeProvider.isApprovedRequest(playlist));
        assertTrue(NetEaseNativeProvider.isApprovedRequest(songs));
        assertTrue(NetEaseNativeProvider.isApprovedRequest(rendition));
        assertTrue(NetEaseNativeProvider.isApprovedRequest(lyric));
        assertTrue(playlist.body.startsWith("params=") && playlist.body.contains("&encSecKey="));
        assertTrue(rendition.body.startsWith("params="));
        assertEquals("_ntes_nuid=fixture; _ntes_nnid3=fixture,1; NMTID=0", playlist.cookieHeader);
        assertEquals("os=pc", rendition.cookieHeader);
    }

    @Test
    public void routeAllowListRejectsHostPathMethodAndQueryChanges() throws Exception {
        NetEaseNativeProvider provider = new NetEaseNativeProvider(
                request -> new NetEaseNativeProvider.Response(200, "{}"),
                () -> "0123456789abcdef",
                new FixedCookies());
        NetEaseNativeProvider.Request original = provider.buildDefaultRenditionRequest(123L);
        NetEaseNativeProvider.Request evilHost = new NetEaseNativeProvider.Request(
                original.route, new URI(original.uri.toString().replace("interface3.music.163.com", "evil.example")),
                original.body, original.cookieHeader);
        NetEaseNativeProvider.Request evilMethod = new NetEaseNativeProvider.Request(
                NetEaseNativeProvider.Route.SEARCH, original.uri, original.body, original.cookieHeader);

        assertFalse(NetEaseNativeProvider.isApprovedRequest(evilHost));
        assertFalse(NetEaseNativeProvider.isApprovedRequest(evilMethod));
        assertFalse(NetEaseNativeProvider.isApprovedRequest(new NetEaseNativeProvider.Request(
                original.route, new URI(original.uri + "?redirect=https%3A%2F%2Fevil.example"),
                original.body, original.cookieHeader)));
    }

    @Test
    public void transportBoundsResponseAndReturnsStableFailure() throws Exception {
        List<NetEaseNativeProvider.Request> requests = new ArrayList<>();
        NetEaseNativeProvider provider = new NetEaseNativeProvider(request -> {
            requests.add(request);
            return new NetEaseNativeProvider.Response(302, "redirect");
        }, () -> "0123456789abcdef", new FixedCookies());

        NetEaseNativeProvider.Response response = provider.execute(provider.buildSearchRequest("x", 1));

        assertEquals(0, response.status);
        assertEquals("REDIRECT_NOT_ALLOWED", response.errorCode);
        assertEquals(1, requests.size());
        assertEquals(null, response.body);
    }

    private static final class FixedCookies implements NetEaseNativeProvider.CookieSource {
        @Override public String forWeapi() {
            return "_ntes_nuid=fixture; _ntes_nnid3=fixture,1; NMTID=0";
        }
        @Override public String forEapi() { return "os=pc"; }
    }
}
