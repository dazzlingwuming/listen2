package com.dazzlingwuming.listen2;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.net.URI;

public final class BilibiliLrclibProviderTest {
    private static JSONObject row(String title, String artist, double duration) throws Exception {
        return new JSONObject().put("id", 42).put("trackName", title)
                .put("artistName", artist).put("duration", duration)
                .put("syncedLyrics", "[00:01.00]Fixture line");
    }

    @Test public void exactSongMatchesAndUnicodeQueryIsEncodedOnce() throws Exception {
        final URI[] requested = { null };
        BilibiliLrclibProvider provider = new BilibiliLrclibProvider(uri -> {
            requested[0] = uri;
            return row("青花瓷", "周杰伦", 239).toString();
        });
        JSONObject result = provider.find("青花瓷", "周杰伦", 240);
        assertNotNull(result);
        assertEquals("lrclib", result.getString("source"));
        assertEquals("青花瓷", result.getString("matchedTitle"));
        assertEquals("lrclib.net", requested[0].getHost());
        assertTrue(requested[0].getRawQuery().contains("%E9%9D%92"));
        assertFalse(requested[0].getRawQuery().contains("%25E9"));
    }

    @Test public void mismatchedArtistTitleOrDurationNeverBecomesAutomaticLyrics() throws Exception {
        String body = row("Song", "Artist", 180).toString();
        BilibiliLrclibProvider provider = new BilibiliLrclibProvider(uri -> body);
        assertNull(provider.find("Different", "Artist", 180));
        assertNull(provider.find("Song", "Cover artist", 180));
        assertNull(provider.find("Song", "Artist", 195));
    }

    @Test public void unavailableOrMalformedResponseFallsBackWithoutInventingLyrics() {
        assertNull(new BilibiliLrclibProvider(uri -> null).find("Song", "Artist", 180));
        assertNull(new BilibiliLrclibProvider(uri -> "not json").find("Song", "Artist", 180));
        assertNull(new BilibiliLrclibProvider(uri -> { throw new Exception("offline"); })
                .find("Song", "Artist", 180));
    }

    @Test public void searchIsBoundedAndSkipsInstrumentalRows() throws Exception {
        JSONArray source = new JSONArray().put(row("Instrumental", "Artist", 180)
                .put("syncedLyrics", JSONObject.NULL).put("plainLyrics", JSONObject.NULL));
        for (int i = 0; i < 20; i++) source.put(row("Song " + i, "Artist", 180));
        JSONArray result = new BilibiliLrclibProvider(uri -> source.toString()).search("Song");
        assertEquals(12, result.length());
        assertEquals("Song 0", result.getJSONObject(0).getString("title"));
        assertEquals("lrclib:42", result.getJSONObject(0).getString("id"));
    }

    @Test public void enhancedLrcKeepsLineTimingWithoutExposingWordTags() throws Exception {
        JSONObject result = BilibiliLrclibProvider.mapRow(row("Song", "Artist", 180)
                .put("syncedLyrics", "[00:01.20]<00:01.20>Hello <00:02.35>world<00:03.40>"));
        assertEquals("[00:01.20]Hello world", result.getString("lyric"));
    }
}
