package com.dazzlingwuming.listen2;

import org.junit.Test;
import java.net.URI;
import java.util.Map;
import static org.junit.Assert.*;

public final class MediaRequestHeadersTest {
    @Test public void providerHeadersFollowTheSelectedCdn() {
        Map<String, String> bili = MediaRequestHeaders.forUri(URI.create("https://cn.example.bilivideo.com/audio.m4s"));
        assertEquals("https://www.bilibili.com/", bili.get("Referer"));
        assertFalse(bili.get("User-Agent").contains("Mobile"));
        assertEquals(2, bili.size()); // No account cookies or authorization.
        assertEquals(bili, MediaRequestHeaders.forUri(
                URI.create("https://node.mcdn.bilivideo.cn:8082/audio.m4s")));
        assertEquals(bili, MediaRequestHeaders.forUri(
                URI.create("https://upos-hz-mirrorakam.akamaized.net/audio.m4s")));
        assertEquals("https://music.163.com/", MediaRequestHeaders.forUri(
                URI.create("https://m8.music.126.net/audio.mp3")).get("Referer"));
    }

    @Test public void unrelatedAndLocalLocationsReceiveNoProviderHeaders() {
        for (String value : new String[] { "https://bilivideo.com.attacker.test/a", "https://evilbilivideo.com/a",
                "http://cn.bilivideo.com/a", "https://user@cn.bilivideo.com/a", "https://cn.bilivideo.com:8443/a",
                "https://node.mcdn.bilivideo.cn.attacker.test:8082/a", "https://evilbilivideo.cn/a",
                "https://node.mcdn.bilivideo.cn:0/a", "https://node.mcdn.bilivideo.cn:65536/a",
                "https://other.akamaized.net/a", "https://upos-hz-mirrorakam.akamaized.net.evil.test/a",
                "https://upos-hz-mirrorakam.akamaized.net:8443/a",
                "content://com.listen2.media/audio", "file:///data/audio.mp3" }) {
            assertTrue(value, MediaRequestHeaders.forUri(URI.create(value)).isEmpty());
        }
        assertTrue(MediaRequestHeaders.forUri(null).isEmpty());
    }
}
