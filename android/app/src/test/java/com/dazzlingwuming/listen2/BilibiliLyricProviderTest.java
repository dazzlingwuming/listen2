package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.junit.Test;

public final class BilibiliLyricProviderTest {
    @Test
    public void exactSemanticSelectionFindsOnlyAHighConfidencePrimaryLyric() {
        FakeCatalog catalog = new FakeCatalog();
        catalog.candidates = Collections.singletonList(new BilibiliLyricProvider.Candidate(
                "123", "Song Name", "Artist", 181L));
        catalog.lyric = new BilibiliLyricProvider.Lyric("[00:01.00]line", "[00:01.00]译文");

        BilibiliLyricProvider.Resolution result = new BilibiliLyricProvider(catalog).resolve(
                selection("Song Name", "Artist", 180L), () -> false);

        assertTrue(result.isFound());
        assertEquals(BilibiliLyricProvider.Status.FOUND, result.status);
        assertEquals("netease-primary-for-bilibili", result.source);
        assertEquals("[00:01.00]line", result.lrc);
        assertEquals("[00:01.00]译文", result.tlyric);
        assertEquals("Song Name", result.matchedTitle);
        assertEquals("Artist", result.matchedArtist);
        assertTrue(result.matchScorePercent >= 93);
        assertEquals(1, catalog.searchCalls);
        assertEquals(1, catalog.lyricCalls);
    }

    @Test
    public void lowScoreOrDurationMismatchIsNoLyricAndDoesNotFetchAnotherSongsWords() {
        FakeCatalog catalog = new FakeCatalog();
        catalog.candidates = Arrays.asList(
                new BilibiliLyricProvider.Candidate("123", "Different Title", "Artist", 180L),
                new BilibiliLyricProvider.Candidate("456", "Song Name", "Artist", 240L));

        BilibiliLyricProvider.Resolution result = new BilibiliLyricProvider(catalog).resolve(
                selection("Song Name", "Artist", 180L), () -> false);

        assertEquals(BilibiliLyricProvider.Status.NO_LYRIC, result.status);
        assertEquals("NO_HIGH_CONFIDENCE_MATCH", result.errorCode);
        assertEquals(0, catalog.lyricCalls);
        assertNull(result.lrc);
    }

    @Test
    public void maliciousAndOversizedInputOrLyricNeverBecomeRenderableSuccess() {
        FakeCatalog catalog = new FakeCatalog();
        BilibiliLyricProvider.Resolution invalid = new BilibiliLyricProvider(catalog).resolve(
                selection("<img src=x>", "Artist", 180L), () -> false);
        assertEquals(BilibiliLyricProvider.Status.INVALID_SELECTION, invalid.status);
        assertEquals(0, catalog.searchCalls);

        catalog.candidates = Collections.singletonList(new BilibiliLyricProvider.Candidate(
                "123", "Song Name", "Artist", 180L));
        catalog.lyric = new BilibiliLyricProvider.Lyric("[00:01.00]<script>", "");
        BilibiliLyricProvider.Resolution malicious = new BilibiliLyricProvider(catalog).resolve(
                selection("Song Name", "Artist", 180L), () -> false);
        assertEquals(BilibiliLyricProvider.Status.PROVIDER_FAILURE, malicious.status);
        assertEquals("MALFORMED_PROVIDER_RESPONSE", malicious.errorCode);

        catalog.lyric = new BilibiliLyricProvider.Lyric("[00:01.00]"
                + repeat('x', 512 * 1024), "");
        BilibiliLyricProvider.Resolution oversized = new BilibiliLyricProvider(catalog).resolve(
                selection("Song Name", "Artist", 180L), () -> false);
        assertEquals(BilibiliLyricProvider.Status.PROVIDER_FAILURE, oversized.status);
        assertEquals("MALFORMED_PROVIDER_RESPONSE", oversized.errorCode);
    }

    @Test
    public void providerTimeoutAndCancellationHaveStableTerminalStates() {
        FakeCatalog timeoutCatalog = new FakeCatalog();
        timeoutCatalog.searchResult = BilibiliLyricProvider.CatalogResult.failure(
                BilibiliLyricProvider.CatalogStatus.TIMEOUT);
        BilibiliLyricProvider.Resolution timeout = new BilibiliLyricProvider(timeoutCatalog).resolve(
                selection("Song Name", "Artist", 180L), () -> false);
        assertEquals(BilibiliLyricProvider.Status.TIMEOUT, timeout.status);
        assertEquals("TIMEOUT", timeout.errorCode);

        FakeCatalog failedCatalog = new FakeCatalog();
        failedCatalog.searchResult = BilibiliLyricProvider.CatalogResult.failure(
                BilibiliLyricProvider.CatalogStatus.PROVIDER_FAILURE);
        BilibiliLyricProvider.Resolution failed = new BilibiliLyricProvider(failedCatalog).resolve(
                selection("Song Name", "Artist", 180L), () -> false);
        assertEquals(BilibiliLyricProvider.Status.PROVIDER_FAILURE, failed.status);
        assertEquals("PROVIDER_FAILURE", failed.errorCode);

        FakeCatalog cancelledCatalog = new FakeCatalog();
        cancelledCatalog.candidates = Collections.singletonList(new BilibiliLyricProvider.Candidate(
                "123", "Song Name", "Artist", 180L));
        final boolean[] cancelled = { false };
        cancelledCatalog.onSearch = () -> cancelled[0] = true;
        BilibiliLyricProvider.Resolution cancelledResult = new BilibiliLyricProvider(cancelledCatalog)
                .resolve(selection("Song Name", "Artist", 180L), () -> cancelled[0]);
        assertEquals(BilibiliLyricProvider.Status.CANCELLED, cancelledResult.status);
        assertEquals("CANCELLED", cancelledResult.errorCode);
        assertEquals(0, cancelledCatalog.lyricCalls);
    }

    @Test
    public void resolutionDoesNotCarryUrlCookieOrRawProviderResponse() {
        FakeCatalog catalog = new FakeCatalog();
        catalog.candidates = Collections.singletonList(new BilibiliLyricProvider.Candidate(
                "123", "Song Name", "Artist", 180L));
        catalog.lyric = new BilibiliLyricProvider.Lyric("[00:01.00]line", "");

        BilibiliLyricProvider.Resolution result = new BilibiliLyricProvider(catalog).resolve(
                selection("Song Name", "Artist", 180L), () -> false);

        String visible = result.source + result.lrc + result.tlyric + result.matchedTitle
                + result.matchedArtist + result.errorCode;
        assertFalse(visible.toLowerCase().contains("http"));
        assertFalse(visible.toLowerCase().contains("cookie"));
        assertFalse(visible.toLowerCase().contains("authorization"));
        assertFalse(visible.toLowerCase().contains("raw"));
    }

    private static BilibiliLyricProvider.Selection selection(String title, String artist, long duration) {
        return new BilibiliLyricProvider.Selection("BV1xx411c7mD", 42L, title, artist, duration,
                "bilibili:BV1xx411c7mD:42:selection-1");
    }

    private static String repeat(char character, int count) {
        StringBuilder value = new StringBuilder(count);
        for (int index = 0; index < count; index += 1) value.append(character);
        return value.toString();
    }

    private static final class FakeCatalog implements BilibiliLyricProvider.NetEaseCatalog {
        List<BilibiliLyricProvider.Candidate> candidates = Collections.emptyList();
        BilibiliLyricProvider.Lyric lyric = new BilibiliLyricProvider.Lyric("[00:01.00]line", "");
        BilibiliLyricProvider.CatalogResult<List<BilibiliLyricProvider.Candidate>> searchResult;
        Runnable onSearch;
        int searchCalls;
        int lyricCalls;

        @Override
        public BilibiliLyricProvider.CatalogResult<List<BilibiliLyricProvider.Candidate>> search(
                String title, String artist) {
            searchCalls += 1;
            if (onSearch != null) onSearch.run();
            return searchResult == null ? BilibiliLyricProvider.CatalogResult.success(candidates)
                    : searchResult;
        }

        @Override
        public BilibiliLyricProvider.CatalogResult<BilibiliLyricProvider.Lyric> fetchPrimaryLyric(
                String providerTrackId) {
            lyricCalls += 1;
            return BilibiliLyricProvider.CatalogResult.success(lyric);
        }
    }
}
