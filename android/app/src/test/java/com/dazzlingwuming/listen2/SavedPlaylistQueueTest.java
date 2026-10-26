package com.dazzlingwuming.listen2;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public final class SavedPlaylistQueueTest {
    @Test public void largeImportedPlaylistKeepsOrderAndDefersDefaultPartsWithoutNetworkRequests() {
        List<LocalDataRepository.Track> tracks = new ArrayList<>();
        for (int i = 0; i < 746; i++) tracks.add(new LocalDataRepository.Track("bilibili",
                "BV1xx411c7mD" + (i % 2 == 0 ? "" : "-" + (100 + i)), "歌曲 " + i, "歌手", 120000));
        List<PlaybackMediaResolver.Descriptor> result = SavedPlaylistQueue.descriptors(
                new LocalDataRepository.PlaylistView("myplaylist_fixture", "大歌单", 0, 1, tracks));
        assertEquals(746, result.size());
        PlaybackMediaResolver resolver = new PlaybackMediaResolver(descriptor -> {
            fail("Queue construction must not fetch every track"); return Collections.emptyList();
        }, new PlaybackMediaResolver.IncrementingHandleSource("fixture"), () -> 1000L);
        for (int i = 0; i < result.size(); i++) {
            assertEquals("歌曲 " + i, result.get(i).getTitle());
            assertEquals(i % 2 == 0 ? 0L : 100L + i, result.get(i).getProviderPartId());
            assertNotNull(resolver.prepare(result.get(i)));
        }
    }

    @Test public void importedTitlesAreMadeSafeForPlaybackAndMissingArtistsHaveFallbacks() {
        String title = String.join("", Collections.nCopies(320, "歌")) + "<tag>\n";
        List<PlaybackMediaResolver.Descriptor> result = SavedPlaylistQueue.descriptors(
                new LocalDataRepository.PlaylistView("myplaylist_fixture", "歌单", 0, 1,
                Collections.singletonList(new LocalDataRepository.Track("bilibili", "BV1xx411c7mD", title, "", 0))));
        assertEquals(256, result.get(0).getTitle().length());
        assertEquals("哔哩哔哩", result.get(0).getArtist());
    }

    @Test(expected = IllegalArgumentException.class) public void emptyPlaylistDoesNotReplaceCurrentQueue() {
        SavedPlaylistQueue.descriptors(new LocalDataRepository.PlaylistView("myplaylist_fixture", "歌单", 0, 1, Collections.emptyList()));
    }
}
