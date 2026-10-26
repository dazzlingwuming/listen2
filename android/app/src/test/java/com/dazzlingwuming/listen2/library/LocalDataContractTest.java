package com.dazzlingwuming.listen2.library;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.data.LocalDataRepository;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

/** Pure DTO boundary tests: the bridge cannot smuggle local paths through a view. */
public final class LocalDataContractTest {
    @Test
    public void historyQualificationMatchesDesktopBound() {
        assertEquals(110_000L, LocalDataRepository.qualificationThreshold(220_000L));
        assertEquals(240_000L, LocalDataRepository.qualificationThreshold(1_000_000L));
    }

    @Test
    public void safViewContainsNoUriOrPathFields() {
        for (java.lang.reflect.Field field : LocalDataRepository.SafGrantView.class.getFields()) {
            String name = field.getName().toLowerCase(java.util.Locale.ROOT);
            assertFalse(name.contains("uri"));
            assertFalse(name.contains("path"));
            assertFalse(name.contains("document"));
        }
        assertTrue(LocalDataRepository.Inspection.ready(42L).byteCount == 42L);
        assertEquals(LocalDataRepository.OK, LocalDataRepository.Inspection.ready(1L).status);
        for (java.lang.reflect.Field field : LocalDataRepository.LocalTrackView.class.getFields()) {
            String name = field.getName().toLowerCase(java.util.Locale.ROOT);
            assertFalse(name.contains("uri"));
            assertFalse(name.contains("path"));
            assertFalse(name.contains("document"));
        }
    }

    @Test
    public void pageSafeBackupFactoryAcceptsOnlyBoundedSemanticDtos() {
        AndroidLocalDataFacade.PageTrackInput track = new AndroidLocalDataFacade.PageTrackInput(
                "bilibili", "BV1abc", "Song", "Artist", 180_000L);
        AndroidLocalDataFacade.PagePlaylistInput playlist = new AndroidLocalDataFacade.PagePlaylistInput(
                "myplaylist_demo", "My list", Collections.singletonList(track));
        AndroidLocalDataFacade.PageFavoriteInput favorite = new AndroidLocalDataFacade.PageFavoriteInput(
                "netease", "12345", "Favorite", "Artist");
        AndroidLocalDataFacade.BackupFactoryResult result = AndroidLocalDataFacade.buildPageSafeBackup(
                new AndroidLocalDataFacade.PageBackupInput(Collections.singletonList(playlist),
                        Collections.singletonList(favorite)));
        assertTrue(result.ok);
        assertEquals("OK", result.status);
        assertEquals(1, result.backup.playlists.size());
        assertEquals(1, result.backup.favorites.size());
    }

    @Test
    public void pageSafeBackupFactoryRejectsExcessAndDuplicatePlaylists() {
        AndroidLocalDataFacade.PagePlaylistInput item = new AndroidLocalDataFacade.PagePlaylistInput(
                "myplaylist_demo", "My list", Collections.emptyList());
        assertFalse(AndroidLocalDataFacade.buildPageSafeBackup(
                new AndroidLocalDataFacade.PageBackupInput(Collections.nCopies(501, item),
                        Collections.emptyList())).ok);
        assertFalse(AndroidLocalDataFacade.buildPageSafeBackup(
                new AndroidLocalDataFacade.PageBackupInput(Arrays.asList(item, item),
                        Collections.emptyList())).ok);
    }

    @Test
    public void pageSafeBackupFactoryRejectsUnsafeIdsAndTransportLikeValues() {
        AndroidLocalDataFacade.PageTrackInput badId = new AndroidLocalDataFacade.PageTrackInput(
                "bilibili", "../../secret", "Song", "Artist", 1L);
        AndroidLocalDataFacade.PageTrackInput transport = new AndroidLocalDataFacade.PageTrackInput(
                "bilibili", "safe-id", "file:///private/music", "Artist", 1L);
        AndroidLocalDataFacade.PagePlaylistInput first = new AndroidLocalDataFacade.PagePlaylistInput(
                "myplaylist_demo", "My list", Collections.singletonList(badId));
        AndroidLocalDataFacade.PagePlaylistInput second = new AndroidLocalDataFacade.PagePlaylistInput(
                "myplaylist_other", "My list", Collections.singletonList(transport));
        assertFalse(AndroidLocalDataFacade.buildPageSafeBackup(
                new AndroidLocalDataFacade.PageBackupInput(Collections.singletonList(first),
                        Collections.emptyList())).ok);
        assertFalse(AndroidLocalDataFacade.buildPageSafeBackup(
                new AndroidLocalDataFacade.PageBackupInput(Collections.singletonList(second),
                        Collections.emptyList())).ok);
    }
}
