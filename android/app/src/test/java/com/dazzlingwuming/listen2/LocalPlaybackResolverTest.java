package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.data.DurableRecordEntities;

import org.junit.Test;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

public final class LocalPlaybackResolverTest {
    private static final String HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String TRACK_ID = "local.track." + HASH;
    private static final String OPAQUE = "local." + HASH;
    private static final String GRANT_ID = "saf.tree.1";
    private static final String DOCUMENT = "content://provider/tree/root/document/song";
    private static final String TREE = "content://provider/tree/root";
    private static final String HANDLE = "native-handle";

    @Test
    public void resolvesFromLogicalIdAndReturnsOnlySemanticMetadataAndNativeHandle() {
        FakeCatalog catalog = catalog(true, "active", "tree");
        FakeMediaPort media = new FakeMediaPort();
        LocalPlaybackResolver<String> resolver = new LocalPlaybackResolver<>(catalog, media);

        LocalPlaybackResolver.Resolution<String> result = resolver.resolve(TRACK_ID);

        assertTrue(result.ok);
        assertEquals(LocalPlaybackResolver.STATUS_AVAILABLE, result.status);
        assertEquals(TRACK_ID, result.localTrackId);
        assertSame(HANDLE, result.mediaHandle);
        assertEquals(TRACK_ID, media.lastTrackId);
        assertEquals("local", result.track.source);
        assertEquals("Track title", result.track.title);
        assertEquals(123_000L, result.track.durationMs);
        assertEquals(GRANT_ID, result.track.grantReferenceId);
        assertTrue(result.track.cover);
        assertTrue(result.track.lrc);

        Map<String, Object> semantic = result.track.toSemanticMap();
        assertEquals(11, semantic.size());
        assertEquals("local", semantic.get("source"));
        assertEquals(123_000L, semantic.get("durationMs"));
        assertFalse(semantic.containsKey("uri"));
        assertFalse(semantic.containsKey("path"));
        assertFalse(semantic.toString().contains("content://"));
        assertFalse(semantic.toString().contains("/document/"));
    }

    @Test
    public void invalidOrUnavailableGrantStopsBeforeNativeOpen() {
        FakeCatalog revoked = catalog(true, "revoked", "tree");
        FakeMediaPort media = new FakeMediaPort();

        LocalPlaybackResolver.Resolution<String> revokedResult =
                new LocalPlaybackResolver<>(revoked, media).resolve(TRACK_ID);

        assertFalse(revokedResult.ok);
        assertEquals(LocalPlaybackResolver.STATUS_REVOKED, revokedResult.status);
        assertNull(revokedResult.mediaHandle);
        assertNull(media.lastTrackId);

        LocalPlaybackResolver.Resolution<String> invalid =
                new LocalPlaybackResolver<>(revoked, media).resolve("content://not-an-id");
        assertFalse(invalid.ok);
        assertEquals(LocalPlaybackResolver.STATUS_INVALID_INPUT, invalid.status);
        assertNull(invalid.localTrackId);
        assertNull(media.lastTrackId);
    }

    @Test
    public void nativePortFailureIsBoundedAndDoesNotExposeItsUriText() {
        FakeCatalog catalog = catalog(true, "active", "tree");
        FakeMediaPort media = new FakeMediaPort();
        media.failure = new IOException("content://provider/private/document/song");

        LocalPlaybackResolver.Resolution<String> result =
                new LocalPlaybackResolver<>(catalog, media).resolve(TRACK_ID);

        assertFalse(result.ok);
        assertEquals(LocalPlaybackResolver.STATUS_IO_UNAVAILABLE, result.status);
        assertNull(result.track);
        assertNull(result.mediaHandle);
        assertFalse(result.status.contains("content://"));
    }

    @Test
    public void malformedSemanticRowBecomesRepairableStateAndIsNotOpened() {
        FakeCatalog catalog = catalog(true, "active", "tree");
        catalog.track = new DurableRecordEntities.LocalMediaTrackEntity(
                TRACK_ID, GRANT_ID, OPAQUE, DOCUMENT, "/private/song.mp3", "audio/mpeg",
                12L, 123_000L, "Track title", "Artist", true, true, "available", 1L);
        FakeMediaPort media = new FakeMediaPort();

        LocalPlaybackResolver.Resolution<String> result =
                new LocalPlaybackResolver<>(catalog, media).resolve(TRACK_ID);

        assertFalse(result.ok);
        assertEquals(LocalPlaybackResolver.STATUS_NEEDS_REPAIR, result.status);
        assertNull(media.lastTrackId);
    }

    @Test
    public void documentGrantMustMatchTheIndexedDocumentBeforeOpen() {
        FakeCatalog catalog = catalog(true, "active", "document");
        catalog.grant = new DurableRecordEntities.SafReferenceEntity(
                GRANT_ID, "", "content://provider/tree/other/document/song", 1L,
                "Song", "active", "document");
        FakeMediaPort media = new FakeMediaPort();

        LocalPlaybackResolver.Resolution<String> result =
                new LocalPlaybackResolver<>(catalog, media).resolve(TRACK_ID);

        assertFalse(result.ok);
        assertEquals(LocalPlaybackResolver.STATUS_NEEDS_REPAIR, result.status);
        assertNull(media.lastTrackId);
    }

    @Test
    public void lyricAvailabilityNeverFabricatesTextFromCatalogFlag() {
        FakeCatalog catalog = catalog(false, "active", "tree");
        LocalPlaybackResolver<String> noPort = new LocalPlaybackResolver<>(catalog,
                new FakeMediaPort());
        LocalPlaybackResolver.LyricResult absent = noPort.readAdjacentLyric(TRACK_ID);
        assertFalse(absent.ok);
        assertEquals(LocalPlaybackResolver.STATUS_LYRIC_NOT_PRESENT, absent.status);
        assertNull(absent.content);

        catalog.track = track(true);
        LocalPlaybackResolver.LyricResult unavailable = noPort.readAdjacentLyric(TRACK_ID);
        assertFalse(unavailable.ok);
        assertEquals(LocalPlaybackResolver.STATUS_LYRIC_UNAVAILABLE, unavailable.status);
        assertNull(unavailable.content);

        LocalPlaybackResolver<String> withPort = new LocalPlaybackResolver<>(catalog,
                new FakeMediaPort(), id -> "[00:01.00]real lyric");
        LocalPlaybackResolver.LyricResult available = withPort.readAdjacentLyric(TRACK_ID);
        assertTrue(available.ok);
        assertEquals(LocalPlaybackResolver.STATUS_LYRIC_AVAILABLE, available.status);
        assertEquals("[00:01.00]real lyric", available.content);
    }

    @Test
    public void lyricPortEmptyOrOversizedContentIsUnavailable() {
        FakeCatalog catalog = catalog(true, "active", "tree");
        LocalPlaybackResolver<String> empty = new LocalPlaybackResolver<>(catalog,
                new FakeMediaPort(), id -> "");
        assertEquals(LocalPlaybackResolver.STATUS_LYRIC_UNAVAILABLE,
                empty.readAdjacentLyric(TRACK_ID).status);

        LocalPlaybackResolver<String> oversized = new LocalPlaybackResolver<>(catalog,
                new FakeMediaPort(), id -> repeat('x', 256 * 1024 + 1));
        LocalPlaybackResolver.LyricResult result = oversized.readAdjacentLyric(TRACK_ID);
        assertFalse(result.ok);
        assertEquals(LocalPlaybackResolver.STATUS_LYRIC_UNAVAILABLE, result.status);
        assertNull(result.content);
    }

    private static FakeCatalog catalog(boolean adjacentLrc, String grantState, String grantKind) {
        FakeCatalog catalog = new FakeCatalog();
        catalog.track = track(adjacentLrc);
        catalog.grant = new DurableRecordEntities.SafReferenceEntity(
                GRANT_ID, TREE, "", 1L, "Music", grantState, grantKind);
        return catalog;
    }

    private static DurableRecordEntities.LocalMediaTrackEntity track(boolean adjacentLrc) {
        return new DurableRecordEntities.LocalMediaTrackEntity(
                TRACK_ID, GRANT_ID, OPAQUE, DOCUMENT, "song.mp3", "audio/mpeg", 12L,
                123_000L, "Track title", "Artist", true, adjacentLrc, "available", 1L);
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index += 1) result.append(value);
        return result.toString();
    }

    private static final class FakeCatalog implements LocalPlaybackResolver.Catalog {
        DurableRecordEntities.LocalMediaTrackEntity track;
        DurableRecordEntities.SafReferenceEntity grant;
        final Map<String, Integer> lookups = new HashMap<>();

        @Override
        public DurableRecordEntities.LocalMediaTrackEntity findLocalTrack(String localTrackId) {
            lookups.put("track", lookups.getOrDefault("track", 0) + 1);
            return track;
        }

        @Override
        public DurableRecordEntities.SafReferenceEntity findGrant(String grantReferenceId) {
            lookups.put("grant", lookups.getOrDefault("grant", 0) + 1);
            return grant;
        }
    }

    private static final class FakeMediaPort implements LocalPlaybackResolver.MediaPort<String> {
        String lastTrackId;
        IOException failure;

        @Override
        public String openReadOnlyForLocalTrack(String localTrackId) throws IOException {
            lastTrackId = localTrackId;
            if (failure != null) throw failure;
            return HANDLE;
        }
    }
}
