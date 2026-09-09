package com.dazzlingwuming.listen2.library;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.data.LocalDataRepository;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** JVM coverage for the external backup boundary and its fake native document port. */
public final class BackupJsonCodecTest {
    @Test
    public void roundTripIsVersionedExactAndProjectsOnlySemanticFields() {
        LocalDataRepository.Backup input = sampleBackup();
        BackupJsonCodec.EncodeResult encoded = BackupJsonCodec.encode(input);
        assertTrue(encoded.ok);
        String json = new String(encoded.bytes, StandardCharsets.UTF_8);
        assertTrue(json.contains("\"version\":1"));
        assertTrue(json.contains("\"playlists\""));
        assertTrue(json.contains("\"favorites\""));

        BackupJsonCodec.DecodeResult decoded = BackupJsonCodec.decode(encoded.bytes);
        assertTrue(decoded.ok);
        assertEquals(1, decoded.preview.playlists);
        assertEquals(1, decoded.preview.favorites);
        assertEquals(1, decoded.preview.tracks);
        assertEquals("p-1", decoded.backup.playlists.get(0).playlistId);
        assertEquals("BV1abcDE1234", decoded.backup.playlists.get(0).tracks.get(0).providerTrackId);
        assertFalse(json.contains("uri"));
        assertFalse(json.contains("path"));
        assertFalse(json.contains("cookie"));
    }

    @Test
    public void rejectsOldVersionMalformedUtf8ExtraSensitiveAndDuplicateIds() {
        byte[] safe = BackupJsonCodec.encode(sampleBackup()).bytes;
        assertStatus("INVALID_SCHEMA", new String(safe, StandardCharsets.UTF_8)
                .replace("\"version\":1", "\"version\":0").getBytes(StandardCharsets.UTF_8));
        assertStatus("INVALID_UTF8", new byte[] {(byte) 0xc3, (byte) 0x28});
        assertStatus("INVALID_SCHEMA", new String(safe, StandardCharsets.UTF_8)
                .replace("\"favorites\":[", "\"cookie\":\"secret\",\"favorites\":[")
                .getBytes(StandardCharsets.UTF_8));
        assertStatus("INVALID_SCHEMA", new String(safe, StandardCharsets.UTF_8)
                .replace("\"durationMs\":1234", "\"durationMs\":1234,\"uri\":\"content://evil\"")
                .getBytes(StandardCharsets.UTF_8));
        assertStatus("INVALID_BACKUP", new String(safe, StandardCharsets.UTF_8)
                .replace("\"tracks\":[{", "\"tracks\":[{\"source\":\"bilibili\",\"providerTrackId\":\"BV1abcDE1234\",\"title\":\"Second\",\"artist\":\"Artist\",\"durationMs\":99},{")
                .getBytes(StandardCharsets.UTF_8));
        assertStatus("INVALID_BACKUP", ("{\"version\":1,\"playlists\":["
                + "{\"playlistId\":\"p-1\",\"name\":\"One\",\"tracks\":[]},"
                + "{\"playlistId\":\"p-1\",\"name\":\"Two\",\"tracks\":[]}],\"favorites\":[]}")
                .getBytes(StandardCharsets.UTF_8));
        assertStatus("INVALID_BACKUP", ("{\"version\":1,\"playlists\":[],\"favorites\":["
                + "{\"source\":\"netease\",\"providerTrackId\":\"1\",\"title\":\"A\",\"artist\":\"B\"},"
                + "{\"source\":\"netease\",\"providerTrackId\":\"1\",\"title\":\"C\",\"artist\":\"D\"}]}")
                .getBytes(StandardCharsets.UTF_8));
    }

    @Test
    public void rejectsOverLimitAndTransportLikeSemanticValues() {
        byte[] tooLarge = new byte[BackupJsonCodec.MAX_BYTES + 1];
        assertStatus("TOO_LARGE", tooLarge);
        byte[] unsafeTitle = new String(BackupJsonCodec.encode(sampleBackup()).bytes, StandardCharsets.UTF_8)
                .replace("\"Song\"", "\"/private/song.mp3\"").getBytes(StandardCharsets.UTF_8);
        assertStatus("INVALID_BACKUP", unsafeTitle);
        byte[] tokenField = new String(BackupJsonCodec.encode(sampleBackup()).bytes, StandardCharsets.UTF_8)
                .replace("\"favorites\":[{", "\"favorites\":[{\"apiKey\":\"no\",")
                .getBytes(StandardCharsets.UTF_8);
        assertStatus("INVALID_SCHEMA", tokenField);
    }

    @Test
    public void fakePortBindsOneShotSessionToItsRequestedActionAndWriteFailure() {
        BackupSafFilePort port = new BackupSafFilePort();
        BackupSafFilePort.StartResult started = port.beginExport(sampleBackup());
        assertTrue(started.ok);
        assertEquals("create", started.pendingOperation.pickerAction());
        FakeDocument destination = new FakeDocument(null, false);
        BackupSafFilePort.Completion exported = port.completeActivityResult(started.pendingOperation, destination);
        assertTrue(exported.ok);
        assertTrue(exported.exported);
        assertNotNull(destination.written);
        assertArrayEquals(BackupJsonCodec.encode(sampleBackup()).bytes, destination.written);
        assertEquals("INVALID_SESSION", port.completeActivityResult(started.pendingOperation, destination).status);

        BackupSafFilePort.StartResult failing = port.beginExport(sampleBackup());
        assertTrue(failing.ok);
        assertEquals("WRITE_FAILED", port.completeActivityResult(failing.pendingOperation,
                new FakeDocument(null, true)).status);
        BackupSafFilePort.StartResult recovered = port.beginImport();
        assertTrue(recovered.ok); // A consumed failed write cannot leave a stuck session.
        assertEquals("CANCELLED", port.cancel(recovered.pendingOperation).status);
    }

    @Test
    public void fakePortImportsBoundedFileAndReportsCancelWithoutAnyLocation() {
        BackupSafFilePort port = new BackupSafFilePort();
        BackupSafFilePort.StartResult started = port.beginImport();
        assertTrue(started.ok);
        assertEquals("open", started.pendingOperation.pickerAction());
        BackupSafFilePort.Completion imported = port.completeActivityResult(started.pendingOperation,
                new FakeDocument(BackupJsonCodec.encode(sampleBackup()).bytes, false));
        assertTrue(imported.ok);
        assertFalse(imported.exported);
        assertEquals(1, imported.preview.tracks);
        assertEquals("p-1", imported.importedBackup.playlists.get(0).playlistId);

        BackupSafFilePort.StartResult cancelled = port.beginImport();
        assertTrue(cancelled.ok);
        BackupSafFilePort.Completion result = port.cancel(cancelled.pendingOperation);
        assertFalse(result.ok);
        assertEquals("CANCELLED", result.status);
        assertNull(result.preview);
        assertNull(result.importedBackup);
    }

    private static void assertStatus(String status, byte[] bytes) {
        BackupJsonCodec.DecodeResult result = BackupJsonCodec.decode(bytes);
        assertFalse(result.ok);
        assertEquals(status, result.status);
    }

    private static LocalDataRepository.Backup sampleBackup() {
        LocalDataRepository.Track track = new LocalDataRepository.Track("bilibili", "BV1abcDE1234",
                "Song", "Artist", 1234L);
        LocalDataRepository.PlaylistView playlist = new LocalDataRepository.PlaylistView("p-1", "Road trip",
                0, 1L, Collections.singletonList(track));
        LocalDataRepository.FavoriteView favorite = new LocalDataRepository.FavoriteView("netease", "123",
                "Fav", "Artist", 1L);
        return new LocalDataRepository.Backup(1, Collections.singletonList(playlist),
                Collections.singletonList(favorite));
    }

    private static final class FakeDocument implements BackupSafFilePort.NativeDocument {
        final byte[] input;
        final boolean failWrite;
        byte[] written;
        FakeDocument(byte[] input, boolean failWrite) {
            this.input = input; this.failWrite = failWrite;
        }
        @Override public byte[] readAtMost(int maxBytes) {
            return input == null || input.length > maxBytes ? null : input.clone();
        }
        @Override public boolean replace(byte[] bytes) {
            if (failWrite) return false;
            written = bytes.clone();
            return true;
        }
    }
}
