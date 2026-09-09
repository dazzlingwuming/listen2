package com.dazzlingwuming.listen2.platform;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.NonNull;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Native-only streaming media cache. It never accepts caller headers or an
 * arbitrary destination, and its public results intentionally omit both the
 * provider candidate and the app-private file location.
 *
 * <p>A partial file is retained only for a future native retry. It is appended
 * only after an exact HTTP 206 Content-Range match; an origin that ignores a
 * range request is safely restarted from byte zero. A file becomes readable
 * only after a separately atomically-written digest record is present and
 * re-verifies its byte count and SHA-256.</p>
 */
public final class AndroidMediaCache {
    public static final String COMPLETED = "COMPLETED";
    public static final String ALREADY_CACHED = "ALREADY_CACHED";
    public static final String CANCELLED = "CANCELLED";
    public static final String INVALID_INPUT = "INVALID_INPUT";
    public static final String RESPONSE_REJECTED = "RESPONSE_REJECTED";
    public static final String TOO_LARGE = "TOO_LARGE";
    public static final String INTEGRITY_FAILED = "INTEGRITY_FAILED";
    public static final String TIMEOUT = "TIMEOUT";
    public static final String NETWORK_FAILED = "NETWORK_FAILED";
    public static final String IO_UNAVAILABLE = "IO_UNAVAILABLE";

    private static final long MAX_ALLOWED_BYTES = 2L * 1024L * 1024L * 1024L;
    private static final int DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
    private static final int DEFAULT_READ_TIMEOUT_MS = 20_000;
    private static final int BUFFER_BYTES = 32 * 1024;
    private static final String PART_SUFFIX = ".part";
    private static final String META_SUFFIX = ".sha256";
    private static final String META_TEMP_SUFFIX = ".sha256.tmp";
    private static final ConcurrentHashMap<String, Object> KEY_LOCKS = new ConcurrentHashMap<>();
    // Kept in memory only: a partial from another process/candidate is restarted,
    // rather than combining bytes from distinct signed renditions.
    private static final ConcurrentHashMap<String, String> PARTIAL_FINGERPRINTS = new ConcurrentHashMap<>();

    public enum Source { BILIBILI, NETEASE }

    /** Validated native candidate. There is no raw-string constructor. */
    public static final class Candidate {
        private final Source source;
        private final URI uri;

        private Candidate(Source source, URI uri) {
            this.source = source;
            this.uri = uri;
        }

        public static Candidate fromPlaybackCandidate(Source source, URI uri) {
            if (source == null || !isSafeCandidate(source, uri)) return null;
            return new Candidate(source, uri);
        }

        /** Native semantic check; it intentionally does not reveal the URI. */
        public boolean matchesProvider(String provider) {
            return (source == Source.BILIBILI && "bilibili".equals(provider))
                    || (source == Source.NETEASE && "netease".equals(provider));
        }
    }

    /** The cache never receives cookies, referers, authorization, or arbitrary headers. */
    public interface Transport {
        Response open(Candidate candidate, long requestedOffset, int connectTimeoutMs,
                int readTimeoutMs) throws IOException;
    }

    /** Only the transport can describe a response; production validates it again before use. */
    public interface Response extends Closeable {
        int statusCode();
        long contentLength();
        long rangeStart();
        long totalLength();
        InputStream body() throws IOException;
    }

    public interface Cancellation {
        boolean isCancelled();
    }

    public static final class Result {
        public final String status;
        public final long byteCount;
        public final String sha256;

        private Result(String status, long byteCount, String sha256) {
            this.status = status;
            this.byteCount = byteCount;
            this.sha256 = sha256;
        }

        static Result of(String status) { return new Result(status, 0L, ""); }
        static Result done(String status, Verification verification) {
            return new Result(status, verification.byteCount, verification.sha256);
        }
    }

    private final AndroidMediaFilePort files;
    private final Transport transport;
    private final int connectTimeoutMs;
    private final int readTimeoutMs;

    public AndroidMediaCache(@NonNull Context context) {
        this(new AndroidMediaFilePort(context), new HttpUrlConnectionTransport(),
                DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_READ_TIMEOUT_MS);
    }

    AndroidMediaCache(AndroidMediaFilePort files, Transport transport, int connectTimeoutMs,
            int readTimeoutMs) {
        if (files == null || transport == null || connectTimeoutMs <= 0 || readTimeoutMs <= 0) {
            throw new IllegalArgumentException("native cache dependencies required");
        }
        this.files = files;
        this.transport = transport;
        this.connectTimeoutMs = connectTimeoutMs;
        this.readTimeoutMs = readTimeoutMs;
    }

    /**
     * Downloads one pre-validated candidate into a digest-named app-private
     * file. `maxBytes` is mandatory and bounded so a provider response cannot
     * consume arbitrary disk space.
     */
    public Result cache(String opaqueContentKey, Candidate candidate, long maxBytes,
            Cancellation cancellation) {
        if (!AndroidMediaFilePort.isValidKey(opaqueContentKey) || candidate == null
                || maxBytes <= 0L || maxBytes > MAX_ALLOWED_BYTES || cancellation == null) {
            return Result.of(INVALID_INPUT);
        }
        Object lock = KEY_LOCKS.computeIfAbsent(opaqueContentKey, ignored -> new Object());
        synchronized (lock) {
            try {
                if (cancellation.isCancelled()) return Result.of(CANCELLED);
                Verification ready = verifyReady(opaqueContentKey, MAX_ALLOWED_BYTES);
                if (ready != null) {
                    return ready.byteCount <= maxBytes ? Result.done(ALREADY_CACHED, ready)
                            : Result.of(TOO_LARGE);
                }
                return cacheLocked(opaqueContentKey, candidate, maxBytes, cancellation);
            } finally {
                KEY_LOCKS.remove(opaqueContentKey, lock);
            }
        }
    }

    /**
     * Native Media3 integration seam. It is not exposed through the WebView
     * bridge or a repository DTO; callers must already possess an opaque key.
     */
    public File readyFile(String opaqueContentKey) {
        if (!AndroidMediaFilePort.isValidKey(opaqueContentKey)) return null;
        Object lock = lockFor(opaqueContentKey);
        synchronized (lock) {
            try {
                Verification verification = verifyReady(opaqueContentKey, MAX_ALLOWED_BYTES);
                return verification == null ? null : files.readyFile(opaqueContentKey);
            } finally {
                KEY_LOCKS.remove(opaqueContentKey, lock);
            }
        }
    }

    /** Native-only URI form for Media3; never serialize this outside the app process. */
    public Uri readyUri(String opaqueContentKey) {
        File file = readyFile(opaqueContentKey);
        return file == null ? null : Uri.fromFile(file);
    }

    private Result cacheLocked(String key, Candidate candidate, long maxBytes,
            Cancellation cancellation) {
        File directory = files.directory();
        File target = files.fileForKey(key);
        if (directory == null || target == null) return Result.of(IO_UNAVAILABLE);
        File part = sibling(target, PART_SUFFIX);
        File metadata = sibling(target, META_SUFFIX);
        File metadataTemp = sibling(target, META_TEMP_SUFFIX);
        cleanupBrokenReady(target, metadata, metadataTemp);

        long offset = safeLength(part);
        String fingerprint = fingerprint(candidate);
        if (offset > maxBytes || !fingerprint.equals(PARTIAL_FINGERPRINTS.get(key))) {
            deleteQuietly(part);
            offset = 0L;
        }
        try (Response response = transport.open(candidate, offset, connectTimeoutMs, readTimeoutMs)) {
            if (response == null) return Result.of(RESPONSE_REJECTED);
            InputStream body = response.body();
            if (body == null) return Result.of(RESPONSE_REJECTED);
            int status = response.statusCode();
            boolean append;
            if (offset == 0L) {
                if (status != HttpURLConnection.HTTP_OK) return Result.of(RESPONSE_REJECTED);
                append = false;
            } else if (status == HttpURLConnection.HTTP_PARTIAL && response.rangeStart() == offset
                    && response.totalLength() > offset) {
                append = true;
            } else if (status == HttpURLConnection.HTTP_OK) {
                // Origin ignored Range. Reuse this full response only after truncating the partial.
                append = false;
                offset = 0L;
            } else {
                deleteQuietly(part);
                PARTIAL_FINGERPRINTS.remove(key);
                return Result.of(RESPONSE_REJECTED);
            }
            if (!validAdvertisedSize(response, offset, maxBytes)) {
                deleteQuietly(part);
                PARTIAL_FINGERPRINTS.remove(key);
                return Result.of(TOO_LARGE);
            }
            PARTIAL_FINGERPRINTS.put(key, fingerprint);
            Result copied = copyAndCommit(target, part, metadata, metadataTemp, body, append,
                    offset, response.contentLength(), response.totalLength(), maxBytes, cancellation);
            if (COMPLETED.equals(copied.status) || TOO_LARGE.equals(copied.status)
                    || INTEGRITY_FAILED.equals(copied.status) || IO_UNAVAILABLE.equals(copied.status)) {
                PARTIAL_FINGERPRINTS.remove(key);
            }
            return copied;
        } catch (SocketTimeoutException ignored) {
            return Result.of(TIMEOUT);
        } catch (InterruptedIOException ignored) {
            return cancellation.isCancelled() ? Result.of(CANCELLED) : Result.of(TIMEOUT);
        } catch (IOException ignored) {
            return Result.of(NETWORK_FAILED);
        } catch (SecurityException ignored) {
            return Result.of(IO_UNAVAILABLE);
        }
    }

    private Result copyAndCommit(File target, File part, File metadata, File metadataTemp,
            InputStream body, boolean append, long offset, long expectedContentBytes,
            long expectedTotalBytes, long maxBytes, Cancellation cancellation)
            throws IOException {
        MessageDigest digest = digest();
        long count = 0L;
        if (append) {
            count = updateDigestFromFile(digest, part, maxBytes);
            if (count != offset) {
                deleteQuietly(part);
                return Result.of(INTEGRITY_FAILED);
            }
        }
        try (InputStream input = new BufferedInputStream(body);
                FileOutputStream file = new FileOutputStream(part, append);
                BufferedOutputStream output = new BufferedOutputStream(file)) {
            byte[] buffer = new byte[BUFFER_BYTES];
            while (true) {
                if (cancellation.isCancelled()) return Result.of(CANCELLED);
                int read = input.read(buffer);
                if (read < 0) break;
                if (read == 0) continue;
                if (count > maxBytes - read) {
                    deleteQuietly(part);
                    return Result.of(TOO_LARGE);
                }
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                count += read;
            }
            output.flush();
            file.getFD().sync();
        }
        if (cancellation.isCancelled()) return Result.of(CANCELLED);
        if ((expectedContentBytes >= 0L && count != offset + expectedContentBytes)
                || (expectedTotalBytes >= 0L && count != expectedTotalBytes)) {
            // Keep the bounded partial for a later exact-range retry, but never
            // publish a body shorter than the transport claimed.
            return Result.of(NETWORK_FAILED);
        }
        if (count <= 0L) {
            deleteQuietly(part);
            return Result.of(INTEGRITY_FAILED);
        }
        Verification verification = new Verification(count, hex(digest.digest()));
        if (!moveAtomically(part, target)) return Result.of(IO_UNAVAILABLE);
        if (!writeMetadataAtomically(metadata, metadataTemp, verification)) {
            // A target without a valid metadata record is never returned as ready.
            deleteQuietly(target);
            return Result.of(IO_UNAVAILABLE);
        }
        return Result.done(COMPLETED, verification);
    }

    private Verification verifyReady(String key, long maxBytes) {
        File target = files.readyFile(key);
        if (target == null) return null;
        File metadata = sibling(target, META_SUFFIX);
        Verification recorded = readMetadata(metadata);
        if (recorded == null || recorded.byteCount <= 0L || recorded.byteCount > maxBytes
                || safeLength(target) != recorded.byteCount) {
            cleanupBrokenReady(target, metadata, sibling(target, META_TEMP_SUFFIX));
            return null;
        }
        try {
            MessageDigest actualDigest = digest();
            Verification actual = new Verification(updateDigestFromFile(actualDigest, target, maxBytes),
                    hex(actualDigest.digest()));
            if (actual.byteCount != recorded.byteCount || !actual.sha256.equals(recorded.sha256)) {
                cleanupBrokenReady(target, metadata, sibling(target, META_TEMP_SUFFIX));
                return null;
            }
            return recorded;
        } catch (IOException | SecurityException ignored) {
            cleanupBrokenReady(target, metadata, sibling(target, META_TEMP_SUFFIX));
            return null;
        }
    }

    private static boolean validAdvertisedSize(Response response, long offset, long maxBytes) {
        long contentLength = response.contentLength();
        long totalLength = response.totalLength();
        if (contentLength > maxBytes - offset || totalLength > maxBytes || contentLength < -1L
                || totalLength < -1L) return false;
        return !(contentLength >= 0L && totalLength >= 0L
                && response.statusCode() == HttpURLConnection.HTTP_PARTIAL
                && contentLength != totalLength - offset);
    }

    private static boolean isSafeCandidate(Source source, URI uri) {
        if (uri == null || uri.toASCIIString().length() > 2048 || uri.getUserInfo() != null
                || uri.getRawFragment() != null || uri.getHost() == null || uri.getPort() != -1
                && uri.getPort() != 443 || !"https".equalsIgnoreCase(uri.getScheme())
                || uri.getRawPath() == null || !uri.getRawPath().startsWith("/")) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return source == Source.BILIBILI
                ? host.equals("bilivideo.com") || host.endsWith(".bilivideo.com")
                : host.equals("music.163.com") || host.endsWith(".music.163.com")
                        || host.equals("music.126.net") || host.endsWith(".music.126.net");
    }

    private static String fingerprint(Candidate candidate) {
        return hex(digest().digest(candidate.uri.toASCIIString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    private static Object lockFor(String key) {
        return KEY_LOCKS.computeIfAbsent(key, ignored -> new Object());
    }

    private static File sibling(File target, String suffix) {
        return new File(target.getParentFile(), target.getName() + suffix);
    }

    private static long safeLength(File file) {
        try { return file.isFile() ? file.length() : 0L; } catch (SecurityException ignored) { return 0L; }
    }

    private static void cleanupBrokenReady(File target, File metadata, File metadataTemp) {
        deleteQuietly(target);
        deleteQuietly(metadata);
        deleteQuietly(metadataTemp);
    }

    private static void deleteQuietly(File file) {
        try { if (file != null && file.exists()) file.delete(); } catch (SecurityException ignored) { }
    }

    private static boolean moveAtomically(File source, File target) {
        if (source == null || target == null || !source.getParentFile().equals(target.getParentFile())) return false;
        try {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
            return true;
        } catch (AtomicMoveNotSupportedException ignored) {
            // A non-atomic fallback would violate the completed-cache contract.
            return false;
        } catch (IOException | SecurityException ignored) {
            return false;
        }
    }

    private static boolean writeMetadataAtomically(File metadata, File temporary, Verification verification) {
        deleteQuietly(temporary);
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write((verification.byteCount + "\n" + verification.sha256 + "\n").getBytes("US-ASCII"));
            output.getFD().sync();
        } catch (IOException ignored) {
            deleteQuietly(temporary);
            return false;
        }
        if (!moveAtomically(temporary, metadata)) {
            deleteQuietly(temporary);
            return false;
        }
        return true;
    }

    private static Verification readMetadata(File metadata) {
        if (metadata == null || safeLength(metadata) <= 0L || safeLength(metadata) > 128L) return null;
        try (InputStream input = new FileInputStream(metadata)) {
            byte[] buffer = new byte[(int) safeLength(metadata)];
            int read = input.read(buffer);
            if (read != buffer.length) return null;
            String[] fields = new String(buffer, "US-ASCII").split("\\n", -1);
            if (fields.length != 3 || !fields[2].isEmpty() || !fields[0].matches("[1-9][0-9]{0,11}")
                    || !fields[1].matches("[0-9a-f]{64}")) return null;
            return new Verification(Long.parseLong(fields[0]), fields[1]);
        } catch (IOException | NumberFormatException ignored) {
            return null;
        }
    }

    private static long updateDigestFromFile(MessageDigest digest, File file, long maxBytes)
            throws IOException {
        long count = 0L;
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[BUFFER_BYTES];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read == 0) continue;
                if (count > maxBytes - read) throw new IOException("bounded cache input");
                digest.update(buffer, 0, read);
                count += read;
            }
        }
        return count;
    }

    private static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) value.append(String.format(Locale.ROOT, "%02x", b));
        return value.toString();
    }

    private static final class Verification {
        final long byteCount;
        final String sha256;
        Verification(long byteCount, String sha256) { this.byteCount = byteCount; this.sha256 = sha256; }
    }

    /** Production-only transport: HTTPS GET, bounded timeouts, Range-only header, redirects disabled. */
    private static final class HttpUrlConnectionTransport implements Transport {
        @Override
        public Response open(Candidate candidate, long requestedOffset, int connectTimeoutMs,
                int readTimeoutMs) throws IOException {
            HttpURLConnection connection = (HttpURLConnection) candidate.uri.toURL().openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (requestedOffset > 0L) connection.setRequestProperty("Range", "bytes=" + requestedOffset + "-");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
                connection.disconnect();
                throw new IOException("unexpected response status");
            }
            return new HttpResponse(connection, status, requestedOffset);
        }
    }

    private static final class HttpResponse implements Response {
        private final HttpURLConnection connection;
        private final int status;
        private final long rangeStart;
        private final long totalLength;

        HttpResponse(HttpURLConnection connection, int status, long requestedOffset) throws IOException {
            this.connection = connection;
            this.status = status;
            long[] range = status == HttpURLConnection.HTTP_PARTIAL
                    ? parseContentRange(connection.getHeaderField("Content-Range")) : null;
            if (status == HttpURLConnection.HTTP_PARTIAL && (range == null || range[0] != requestedOffset)) {
                connection.disconnect();
                throw new IOException("invalid content range");
            }
            rangeStart = range == null ? 0L : range[0];
            totalLength = range == null ? connection.getContentLengthLong() : range[1];
        }

        @Override public int statusCode() { return status; }
        @Override public long contentLength() { return connection.getContentLengthLong(); }
        @Override public long rangeStart() { return rangeStart; }
        @Override public long totalLength() { return totalLength; }
        @Override public InputStream body() throws IOException { return connection.getInputStream(); }
        @Override public void close() { connection.disconnect(); }
    }

    private static long[] parseContentRange(String value) {
        if (value == null || !value.matches("bytes [0-9]+-[0-9]+/[0-9]+")) return null;
        try {
            String ranges = value.substring(6);
            int dash = ranges.indexOf('-');
            int slash = ranges.indexOf('/');
            long start = Long.parseLong(ranges.substring(0, dash));
            long end = Long.parseLong(ranges.substring(dash + 1, slash));
            long total = Long.parseLong(ranges.substring(slash + 1));
            return start >= 0L && end >= start && total > end ? new long[] {start, total} : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }
}
