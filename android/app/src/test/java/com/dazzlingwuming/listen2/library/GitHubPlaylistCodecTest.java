package com.dazzlingwuming.listen2.library;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public final class GitHubPlaylistCodecTest {
    @Test public void acceptsNumericDesktopOwnershipAndMissingFalseFlag() throws Exception {
        JSONObject desktop = GitHubPlaylistCodec.empty();
        JSONObject playlist = playlist("myplaylist_desktop", true);
        playlist.put("is_mine", 1); playlist.remove("is_fav");
        playlist.getJSONArray("tracks").put(new JSONObject().put("source", "bilibili")
                .put("id", "bitrack_v_BV11Z4y1A7Gq").put("title", "课程"));
        desktop.getJSONArray("playlists").put(new JSONObject().put("id", "myplaylist_desktop").put("playlist", playlist));
        GitHubPlaylistCodec.ImportResult result = GitHubPlaylistCodec.toNative(GitHubPlaylistCodec.parse(desktop.toString()));
        assertEquals(1, result.backup.playlists.size());
        assertEquals(1, result.backup.playlists.get(0).tracks.size());
    }
    @Test public void phoneUploadRoundTripsAndRepeatedMergeDoesNotDuplicate() throws Exception {
        LocalDataRepository.Backup local = new LocalDataRepository.Backup(1,
                Collections.singletonList(new LocalDataRepository.PlaylistView("phone-123", "课程", 0, 1,
                        Arrays.asList(track("BV11Z4y1A7Gq-305095846"), track("BV11Z4y1A7Gq")))),
                Collections.singletonList(new LocalDataRepository.FavoriteView("bilibili", "BV11Z4y1A7Gq", "课", "老师", 1)));
        JSONObject first = GitHubPlaylistCodec.mergeForUpload(GitHubPlaylistCodec.empty(), local);
        JSONObject again = GitHubPlaylistCodec.mergeForUpload(first, local);
        assertEquals(2, again.getJSONArray("playlists").length());
        GitHubPlaylistCodec.ImportResult imported = GitHubPlaylistCodec.toNative(again);
        assertEquals(1, imported.backup.playlists.size());
        assertEquals("phone-123", imported.backup.playlists.get(0).playlistId);
        assertEquals(2, imported.backup.playlists.get(0).tracks.size());
        assertEquals(1, imported.backup.favorites.size());
        assertEquals(0, imported.skipped);
    }

    @Test public void legacyDesktopBackupRetainsOtherTracksAndFavoritePlaylists() throws Exception {
        JSONObject legacy = new JSONObject().put("playerlists", new JSONArray().put("myplaylist_desktop"))
                .put("myplaylist_desktop", playlist("myplaylist_desktop", true))
                .put("favoriteplayerlists", new JSONArray().put("biplaylist_123"))
                .put("biplaylist_123", playlist("biplaylist_123", false))
                .put("githubOauthAccessKey", "fixture-must-not-be-exported");
        JSONObject desktop = GitHubPlaylistCodec.parse(legacy.toString());
        JSONObject tracks = desktop.getJSONArray("playlists").getJSONObject(0).getJSONObject("playlist");
        tracks.getJSONArray("tracks").put(new JSONObject().put("id", "external1").put("source", "unsupported"));
        LocalDataRepository.Backup local = new LocalDataRepository.Backup(1,
                Collections.singletonList(new LocalDataRepository.PlaylistView("myplaylist_desktop", "手机改名", 0, 1,
                        Collections.singletonList(track("BV11Z4y1A7Gq-305095846")))), Collections.emptyList());
        JSONObject merged = GitHubPlaylistCodec.mergeForUpload(desktop, local);
        assertFalse(merged.toString().contains("fixture-must-not-be-exported"));
        assertEquals(1, merged.getJSONArray("favoritePlaylists").length());
        assertEquals(2, merged.getJSONArray("playlists").getJSONObject(0).getJSONObject("playlist").getJSONArray("tracks").length());
        assertEquals("云端课程", merged.getJSONArray("playlists").getJSONObject(0).getJSONObject("playlist").getJSONObject("info").getString("title"));
        GitHubPlaylistCodec.ImportResult imported = GitHubPlaylistCodec.toNative(merged);
        assertEquals(1, imported.skipped);
        assertEquals(2, imported.backup.playlists.size());
    }

    @Test public void validatesBackupBeforeChangingData() throws Exception {
        assertThrows(JSONException.class, () -> GitHubPlaylistCodec.parse("{\"settings\":{}}"));
        JSONObject bad = GitHubPlaylistCodec.empty().put("version", 3);
        assertThrows(JSONException.class, () -> GitHubPlaylistCodec.parse(bad.toString()));
        JSONObject duplicate = GitHubPlaylistCodec.empty();
        JSONObject entry = new JSONObject().put("id", "myplaylist_test").put("playlist", playlist("myplaylist_test", true));
        duplicate.getJSONArray("playlists").put(entry).put(entry);
        assertThrows(JSONException.class, () -> GitHubPlaylistCodec.parse(duplicate.toString()));
    }

    private static LocalDataRepository.Track track(String id) {
        return new LocalDataRepository.Track("bilibili", id, "课", "老师", 120000);
    }
    private static JSONObject playlist(String id, boolean owned) throws Exception {
        return new JSONObject().put("info", new JSONObject().put("id", id).put("title", "云端课程"))
                .put("is_mine", owned).put("is_fav", !owned).put("tracks", new JSONArray());
    }
}
