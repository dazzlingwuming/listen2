package com.dazzlingwuming.listen2;

import androidx.room.Room;
import androidx.test.platform.app.InstrumentationRegistry;
import com.dazzlingwuming.listen2.data.Listen2Database;
import com.dazzlingwuming.listen2.data.LocalDataRepository;
import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public final class GitHubPlaylistSyncInstrumentationTest {
    @Test public void mergingExistingPlaylistAddsTracksWithoutDuplicatesOrDataLoss() {
        Listen2Database db = Room.inMemoryDatabaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class).build();
        try {
            LocalDataRepository repository = new LocalDataRepository(db, new LocalDataRepository.MediaFilePort() {
                public LocalDataRepository.Inspection inspect(String id) { return LocalDataRepository.Inspection.unavailable(); }
                public boolean delete(String id) { return false; }
            });
            LocalDataRepository.Track a = new LocalDataRepository.Track("bilibili", "BV11Z4y1A7Gq-1", "A", "老师", 1000);
            LocalDataRepository.Track b = new LocalDataRepository.Track("bilibili", "BV11Z4y1A7Gq-2", "B", "老师", 1000);
            assertTrue(repository.createPlaylist("myplaylist_courses", "本机课表", Collections.singletonList(a)).ok);
            assertTrue(repository.createPlaylist("myplaylist_other", "其他课表", Collections.singletonList(b)).ok);
            LocalDataRepository.Backup incoming = new LocalDataRepository.Backup(1,
                    Collections.singletonList(new LocalDataRepository.PlaylistView("myplaylist_courses", "云端课表", 0, 0, Arrays.asList(a, b))),
                    Collections.singletonList(new LocalDataRepository.FavoriteView("bilibili", b.providerTrackId, b.title, b.artist, 0)));
            assertTrue(repository.mergeSyncedBackup(incoming).ok);
            assertTrue(repository.mergeSyncedBackup(incoming).ok);
            assertEquals(2, repository.listPlaylists().value.size());
            assertEquals(2, repository.getPlaylist("myplaylist_courses").value.tracks.size());
            assertEquals("本机课表", repository.getPlaylist("myplaylist_courses").value.name);
            assertEquals(1, repository.listFavorites().value.size());
            assertEquals(1, repository.getPlaylist("myplaylist_other").value.tracks.size());
        } finally { db.close(); }
    }
}
