package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** No real network is used: all range and body cases pass through a fake native transport. */
public final class AndroidMediaCacheTest {
    private File directory;

    @Before
    public void createDirectory() throws IOException {
        directory = Files.createTempDirectory("listen2-media-cache-test").toFile();
    }

    @After
    public void deleteDirectory() {
        deleteTree(directory);
    }

    @Test
    public void commitsVerifiedBytesAtomicallyAndReopensOnlyThroughNativeSeam() throws Exception {
        FakeTransport transport = new FakeTransport();
        transport.add(ResponseSpec.ok(bytes("song")));
        AndroidMediaCache cache = cache(transport);

        AndroidMediaCache.Result result = cache.cache("media_1", candidate(), 64L, neverCancelled());

        assertEquals(AndroidMediaCache.COMPLETED, result.status);
        assertEquals(4L, result.byteCount);
        assertEquals(sha256(bytes("song")), result.sha256);
        assertEquals(Arrays.asList(0L), transport.offsets);
        File ready = cache.readyFile("media_1");
        assertNotNull(ready);
        assertArrayEquals(bytes("song"), read(ready));
        assertEquals(AndroidMediaCache.ALREADY_CACHED,
                cache.cache("media_1", candidate(), 64L, neverCancelled()).status);
        assertEquals(1, transport.offsets.size());
    }

    @Test
    public void resumesOnlyAfterExactPartialContentRange() {
        FakeTransport transport = new FakeTransport();
        transport.add(ResponseSpec.failing(bytes("ab")));
        transport.add(ResponseSpec.partial(2L, 4L, bytes("cd")));
        AndroidMediaCache cache = cache(transport);

        assertEquals(AndroidMediaCache.NETWORK_FAILED,
                cache.cache("media_2", candidate(), 64L, neverCancelled()).status);
        AndroidMediaCache.Result completed = cache.cache("media_2", candidate(), 64L, neverCancelled());

        assertEquals(AndroidMediaCache.COMPLETED, completed.status);
        assertEquals(Arrays.asList(0L, 2L), transport.offsets);
        assertArrayEquals(bytes("abcd"), readUnchecked(cache.readyFile("media_2")));
    }

    @Test
    public void serverIgnoringRangeRestartsFromZeroInsteadOfAppending() throws Exception {
        FakeTransport transport = new FakeTransport();
        transport.add(ResponseSpec.failing(bytes("ab")));
        transport.add(ResponseSpec.ok(bytes("abcd")));
        AndroidMediaCache cache = cache(transport);
        assertEquals(AndroidMediaCache.NETWORK_FAILED,
                cache.cache("media_3", candidate(), 64L, neverCancelled()).status);

        AndroidMediaCache.Result completed = cache.cache("media_3", candidate(), 64L, neverCancelled());

        assertEquals(AndroidMediaCache.COMPLETED, completed.status);
        assertEquals(Arrays.asList(0L, 2L), transport.offsets);
        assertArrayEquals(bytes("abcd"), read(cache.readyFile("media_3")));
    }

    @Test
    public void cancellationLeavesNoReadyFileAndMaySafelyResumeLater() {
        FakeTransport transport = new FakeTransport();
        ToggleCancellation cancellation = new ToggleCancellation();
        transport.add(ResponseSpec.withInput(new CancellingInput(bytes("abcd"), cancellation), 200, 4L,
                0L, 4L));
        AndroidMediaCache cache = cache(transport);

        assertEquals(AndroidMediaCache.CANCELLED,
                cache.cache("media_4", candidate(), 64L, cancellation).status);
        assertNull(cache.readyFile("media_4"));
        assertTrue(rawFile("media_4", ".part").isFile());
    }

    @Test
    public void oversizeAndCorruptReadyFileAreRejectedThenRecovered() throws Exception {
        FakeTransport oversized = new FakeTransport();
        oversized.add(ResponseSpec.ok(bytes("abcde")));
        AndroidMediaCache cache = cache(oversized);
        assertEquals(AndroidMediaCache.TOO_LARGE,
                cache.cache("media_5", candidate(), 4L, neverCancelled()).status);
        assertNull(cache.readyFile("media_5"));

        FakeTransport replacement = new FakeTransport();
        replacement.add(ResponseSpec.ok(bytes("good")));
        cache = cache(replacement);
        File target = rawFile("media_6", "");
        Files.write(target.toPath(), bytes("bad"));
        Files.write(rawFile("media_6", ".sha256").toPath(),
                ("4\n" + sha256(bytes("good")) + "\n").getBytes("US-ASCII"));

        assertEquals(AndroidMediaCache.COMPLETED,
                cache.cache("media_6", candidate(), 64L, neverCancelled()).status);
        assertArrayEquals(bytes("good"), read(cache.readyFile("media_6")));
    }

    @Test
    public void truncatedBodyIsNeverPublishedEvenWhenTheResponseClaimsACompleteLength() {
        FakeTransport transport = new FakeTransport();
        transport.add(ResponseSpec.withInput(new ByteArrayInputStream(bytes("abc")), 200, 4L, 0L, 4L));
        AndroidMediaCache cache = cache(transport);

        assertEquals(AndroidMediaCache.NETWORK_FAILED,
                cache.cache("media_truncated", candidate(), 64L, neverCancelled()).status);
        assertNull(cache.readyFile("media_truncated"));
        assertTrue(rawFile("media_truncated", ".part").isFile());
    }

    @Test
    public void opaqueKeysCannotEscapeTheCacheDirectoryOrCreateRawPaths() {
        FakeTransport transport = new FakeTransport();
        AndroidMediaCache cache = cache(transport);

        assertEquals(AndroidMediaCache.INVALID_INPUT,
                cache.cache("../escape", candidate(), 64L, neverCancelled()).status);
        assertEquals(AndroidMediaCache.INVALID_INPUT,
                cache.cache("media/path", candidate(), 64L, neverCancelled()).status);
        assertNull(cache.readyFile("../escape"));
        assertFalse(new File(directory.getParentFile(), "escape").exists());
        assertEquals(0, transport.offsets.size());
    }

    @Test
    public void filePortEvictionRemovesCacheSidecarsForTheSameOpaqueKey() throws Exception {
        AndroidMediaFilePort files = new AndroidMediaFilePort(directory);
        File target = rawFile("media_7", "");
        Files.write(target.toPath(), bytes("data"));
        Files.write(rawFile("media_7", ".part").toPath(), bytes("partial"));
        Files.write(rawFile("media_7", ".sha256").toPath(), bytes("metadata"));

        assertTrue(files.delete("media_7"));
        assertFalse(target.exists());
        assertFalse(rawFile("media_7", ".part").exists());
        assertFalse(rawFile("media_7", ".sha256").exists());
    }

    private AndroidMediaCache cache(FakeTransport transport) {
        return new AndroidMediaCache(new AndroidMediaFilePort(directory), transport, 1_000, 1_000);
    }

    private File rawFile(String key, String suffix) {
        String filename = AndroidMediaFilePort.fileNameForKey(key);
        return new File(directory, filename + suffix);
    }

    private static AndroidMediaCache.Candidate candidate() {
        return AndroidMediaCache.Candidate.fromPlaybackCandidate(AndroidMediaCache.Source.BILIBILI,
                URI.create("https://audio.bilivideo.com/media.m4s?deadline=9999999999"));
    }

    private static AndroidMediaCache.Cancellation neverCancelled() { return () -> false; }
    private static byte[] bytes(String value) { return value.getBytes(java.nio.charset.StandardCharsets.US_ASCII); }
    private static byte[] read(File file) throws IOException { return Files.readAllBytes(file.toPath()); }
    private static byte[] readUnchecked(File file) { try { return read(file); } catch (IOException error) { throw new AssertionError(error); } }

    private static String sha256(byte[] value) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(value)) result.append(String.format("%02x", b));
        return result.toString();
    }

    private static void deleteTree(File target) {
        if (target == null || !target.exists()) return;
        File[] children = target.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        target.delete();
    }

    private static final class ToggleCancellation implements AndroidMediaCache.Cancellation {
        private boolean cancelled;
        @Override public boolean isCancelled() { return cancelled; }
    }

    private static final class CancellingInput extends InputStream {
        private final ByteArrayInputStream source;
        private final ToggleCancellation cancellation;
        CancellingInput(byte[] body, ToggleCancellation cancellation) {
            source = new ByteArrayInputStream(body); this.cancellation = cancellation;
        }
        @Override public int read() {
            int next = source.read();
            if (next >= 0) cancellation.cancelled = true;
            return next;
        }
        @Override public int read(byte[] buffer, int offset, int length) {
            int next = source.read(buffer, offset, Math.min(1, length));
            if (next > 0) cancellation.cancelled = true;
            return next;
        }
    }

    private static final class FakeTransport implements AndroidMediaCache.Transport {
        final List<Long> offsets = new ArrayList<>();
        final List<ResponseSpec> responses = new ArrayList<>();
        void add(ResponseSpec response) { responses.add(response); }
        @Override public AndroidMediaCache.Response open(AndroidMediaCache.Candidate candidate,
                long offset, int connectTimeoutMs, int readTimeoutMs) throws IOException {
            offsets.add(offset);
            if (responses.isEmpty()) throw new IOException("no fake response");
            return responses.remove(0).response();
        }
    }

    private static final class ResponseSpec {
        final InputStream input;
        final int status;
        final long contentLength;
        final long rangeStart;
        final long totalLength;
        ResponseSpec(InputStream input, int status, long contentLength, long rangeStart, long totalLength) {
            this.input = input; this.status = status; this.contentLength = contentLength;
            this.rangeStart = rangeStart; this.totalLength = totalLength;
        }
        static ResponseSpec ok(byte[] body) { return withInput(new ByteArrayInputStream(body), 200, body.length, 0L, body.length); }
        static ResponseSpec partial(long start, long total, byte[] body) { return withInput(new ByteArrayInputStream(body), 206, body.length, start, total); }
        static ResponseSpec failing(byte[] body) { return withInput(new FailingInput(body), 200, body.length, 0L, body.length); }
        static ResponseSpec withInput(InputStream input, int status, long length, long start, long total) { return new ResponseSpec(input, status, length, start, total); }
        AndroidMediaCache.Response response() {
            return new AndroidMediaCache.Response() {
                @Override public int statusCode() { return status; }
                @Override public long contentLength() { return contentLength; }
                @Override public long rangeStart() { return rangeStart; }
                @Override public long totalLength() { return totalLength; }
                @Override public InputStream body() { return input; }
                @Override public void close() throws IOException { input.close(); }
            };
        }
    }

    private static final class FailingInput extends InputStream {
        private final ByteArrayInputStream source;
        private boolean failed;
        FailingInput(byte[] body) { source = new ByteArrayInputStream(body); }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (failed) throw new IOException("interrupted fake body");
            int read = source.read(buffer, offset, Math.min(2, length));
            failed = true;
            return read;
        }
        @Override public int read() throws IOException {
            byte[] value = new byte[1]; int read = read(value, 0, 1); return read < 0 ? -1 : value[0];
        }
    }
}
