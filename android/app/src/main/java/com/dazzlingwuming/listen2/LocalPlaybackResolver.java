package com.dazzlingwuming.listen2;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.data.DurableRecordEntities;
import com.dazzlingwuming.listen2.data.Listen2Database;

import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Native-only resolver for SAF-backed local media.
 *
 * <p>The page submits only a logical {@code localTrackId}.  The catalog and
 * grant are looked up again for every resolution, and the injected media port
 * is responsible for the final ContentResolver/SAF containment check before
 * opening the native handle.  Neither the stored document reference nor a
 * native handle is present in {@link LocalTrack} or any semantic map.</p>
 *
 * <p>The type parameter keeps the Media3-facing handle out of the page-facing
 * contract.  Android can use {@code ParcelFileDescriptor}, while JVM tests
 * use a small fake handle without needing an Android provider.</p>
 */
public final class LocalPlaybackResolver<H> {
    public static final String SOURCE = "local";

    public static final String STATUS_AVAILABLE = "available";
    public static final String STATUS_INVALID_INPUT = "INVALID_INPUT";
    public static final String STATUS_NOT_FOUND = "NOT_FOUND";
    public static final String STATUS_NEEDS_REPAIR = "needs-repair";
    public static final String STATUS_REVOKED = "revoked";
    public static final String STATUS_GRANT_INVALID = "GRANT_INVALID";
    public static final String STATUS_IO_UNAVAILABLE = "IO_UNAVAILABLE";
    public static final String STATUS_CORRUPT = "CORRUPT";
    public static final String STATUS_LYRIC_NOT_PRESENT = "not-present";
    public static final String STATUS_LYRIC_UNAVAILABLE = "unavailable";
    public static final String STATUS_LYRIC_AVAILABLE = "available";

    private static final Pattern LOCAL_TRACK_ID = Pattern.compile("local\\.track\\.[a-f0-9]{64}");
    private static final Pattern OPAQUE_REFERENCE = Pattern.compile("local\\.[a-f0-9]{64}");
    private static final Pattern GRANT_REFERENCE = Pattern.compile("[A-Za-z0-9:._-]{1,160}");
    private static final Pattern MIME_TYPE = Pattern.compile("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+");
    private static final int MAX_SEMANTIC_TEXT = 320;
    private static final long MAX_DURATION_MS = 28_800_000L;
    private static final int MAX_LYRIC_CHARS = 256 * 1024;

    /** Reads only native catalog rows. Implementations must not project URI columns. */
    public interface Catalog {
        DurableRecordEntities.LocalMediaTrackEntity findLocalTrack(String localTrackId);

        DurableRecordEntities.SafReferenceEntity findGrant(String grantReferenceId);
    }

    /** Opens a native media handle after rechecking the stored grant and document. */
    public interface MediaPort<H> {
        H openReadOnlyForLocalTrack(String localTrackId) throws IOException;
    }

    /** Optional native-only adjacent-LRC reader. It receives an ID, never a page URI/path. */
    public interface LyricPort {
        String readAdjacentLrc(String localTrackId) throws IOException;
    }

    private final Catalog catalog;
    private final MediaPort<H> mediaPort;
    private final LyricPort lyricPort;

    public LocalPlaybackResolver(@NonNull Catalog catalog, @NonNull MediaPort<H> mediaPort) {
        this(catalog, mediaPort, null);
    }

    public LocalPlaybackResolver(@NonNull Catalog catalog, @NonNull MediaPort<H> mediaPort,
            LyricPort lyricPort) {
        if (catalog == null || mediaPort == null) throw new NullPointerException("resolver port");
        this.catalog = catalog;
        this.mediaPort = mediaPort;
        this.lyricPort = lyricPort;
    }

    /** Convenience constructor for the real Room catalog; the media port remains injectable. */
    public LocalPlaybackResolver(@NonNull Listen2Database database,
            @NonNull MediaPort<H> mediaPort, LyricPort lyricPort) {
        this(new RoomCatalog(database), mediaPort, lyricPort);
    }

    public LocalPlaybackResolver(@NonNull Listen2Database database,
            @NonNull MediaPort<H> mediaPort) {
        this(new RoomCatalog(database), mediaPort, null);
    }

    /**
     * Resolves and opens a track. The only caller-controlled value is the
     * allow-listed logical ID; provider-facing identifiers and URI data are
     * read from native storage and stay inside the native port.
     */
    public Resolution<H> resolve(String localTrackId) {
        if (!isValidLocalTrackId(localTrackId)) {
            // Do not echo an untrusted value: a rejected string could itself
            // be a URI or filesystem path supplied by a compromised caller.
            return Resolution.error(null, STATUS_INVALID_INPUT);
        }
        Lookup lookup = lookup(localTrackId);
        if (!lookup.ok) return Resolution.error(localTrackId, lookup.status);
        try {
            H handle = mediaPort.openReadOnlyForLocalTrack(localTrackId);
            if (handle == null) return Resolution.error(localTrackId, STATUS_IO_UNAVAILABLE);
            return Resolution.ready(localTrackId, metadata(lookup.track), handle);
        } catch (IOException | RuntimeException ignored) {
            // Do not expose provider exception text: it can contain a URI or path.
            return Resolution.error(localTrackId, STATUS_IO_UNAVAILABLE);
        }
    }

    /**
     * Reads adjacent LRC content only through an explicitly supplied native
     * port. A catalog flag alone never fabricates lyric text.
     */
    public LyricResult readAdjacentLyric(String localTrackId) {
        if (!isValidLocalTrackId(localTrackId)) {
            return LyricResult.error(STATUS_INVALID_INPUT);
        }
        Lookup lookup = lookup(localTrackId);
        if (!lookup.ok) return LyricResult.error(lookup.status);
        if (!lookup.track.adjacentLrc) return LyricResult.error(STATUS_LYRIC_NOT_PRESENT);
        if (lyricPort == null) return LyricResult.error(STATUS_LYRIC_UNAVAILABLE);
        try {
            String content = lyricPort.readAdjacentLrc(localTrackId);
            if (!isSafeLyric(content)) return LyricResult.error(STATUS_LYRIC_UNAVAILABLE);
            return LyricResult.available(content);
        } catch (IOException | RuntimeException ignored) {
            // Lyric enrichment is optional; never turn an unreadable LRC into fake text.
            return LyricResult.error(STATUS_LYRIC_UNAVAILABLE);
        }
    }

    public static boolean isValidLocalTrackId(String value) {
        return value != null && LOCAL_TRACK_ID.matcher(value).matches();
    }

    private Lookup lookup(String localTrackId) {
        final DurableRecordEntities.LocalMediaTrackEntity track;
        try {
            track = catalog.findLocalTrack(localTrackId);
        } catch (RuntimeException ignored) {
            return Lookup.error(STATUS_CORRUPT);
        }
        if (track == null || !localTrackId.equals(track.localTrackId)) {
            return Lookup.error(STATUS_NOT_FOUND);
        }
        if (!isValidNativeTrack(track)) return Lookup.error(STATUS_NEEDS_REPAIR);
        if (!STATUS_AVAILABLE.equals(track.availability)) {
            return Lookup.error(normalizeAvailability(track.availability));
        }

        final DurableRecordEntities.SafReferenceEntity grant;
        try {
            grant = catalog.findGrant(track.grantReferenceId);
        } catch (RuntimeException ignored) {
            return Lookup.error(STATUS_CORRUPT);
        }
        if (grant == null || !track.grantReferenceId.equals(grant.referenceId)) {
            return Lookup.error(STATUS_GRANT_INVALID);
        }
        if (!"active".equals(grant.grantState)) {
            return Lookup.error(normalizeGrantState(grant.grantState));
        }
        if (!hasMatchingGrantReference(track, grant)) {
            return Lookup.error(STATUS_NEEDS_REPAIR);
        }
        return Lookup.success(track);
    }

    private static boolean isValidNativeTrack(DurableRecordEntities.LocalMediaTrackEntity track) {
        if (track == null || track.localTrackId == null || track.opaqueReference == null
                || track.mimeType == null || track.grantReferenceId == null
                || !isValidLocalTrackId(track.localTrackId)
                || !OPAQUE_REFERENCE.matcher(track.opaqueReference).matches()
                || !track.localTrackId.equals("local.track." + track.opaqueReference.substring("local.".length()))
                || !isSemanticText(track.displayName)
                || !isSemanticText(track.title)
                || !isSemanticText(track.artist)
                || !MIME_TYPE.matcher(track.mimeType).matches()
                || track.byteCount < 0L || track.durationMs < 0L || track.durationMs > MAX_DURATION_MS
                || !GRANT_REFERENCE.matcher(track.grantReferenceId).matches()) return false;
        return track.documentReference != null && !track.documentReference.trim().isEmpty();
    }

    private static boolean hasMatchingGrantReference(
            DurableRecordEntities.LocalMediaTrackEntity track,
            DurableRecordEntities.SafReferenceEntity grant) {
        if (grant.grantKind == null) return false;
        if ("document".equals(grant.grantKind)) {
            return grant.documentReference != null && !grant.documentReference.isEmpty()
                    && grant.documentReference.equals(track.documentReference);
        }
        if ("tree".equals(grant.grantKind)) {
            // The Android SAF port proves exact descendant containment with
            // DocumentsContract.isChildDocument before opening the handle.
            return grant.treeReference != null && !grant.treeReference.isEmpty();
        }
        return false;
    }

    private static String normalizeAvailability(String value) {
        if (STATUS_REVOKED.equals(value)) return STATUS_REVOKED;
        if (STATUS_NEEDS_REPAIR.equals(value)) return STATUS_NEEDS_REPAIR;
        return STATUS_NEEDS_REPAIR;
    }

    private static String normalizeGrantState(String value) {
        if (STATUS_REVOKED.equals(value)) return STATUS_REVOKED;
        if (STATUS_NEEDS_REPAIR.equals(value)) return STATUS_NEEDS_REPAIR;
        return STATUS_GRANT_INVALID;
    }

    private static boolean isSemanticText(String value) {
        if (value == null || value.length() > MAX_SEMANTIC_TEXT || value.indexOf('\n') >= 0
                || value.indexOf('\r') >= 0 || value.indexOf('\u0000') >= 0) return false;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return true;
        String lower = trimmed.toLowerCase(java.util.Locale.ROOT);
        return !lower.contains("://") && !lower.startsWith("file:") && !lower.startsWith("content:")
                && !trimmed.startsWith("/") && !trimmed.startsWith("\\")
                && !trimmed.matches("^[A-Za-z]:[\\\\/].*");
    }

    private static boolean isSafeLyric(String content) {
        return content != null && !content.isEmpty() && content.length() <= MAX_LYRIC_CHARS
                && content.indexOf('\u0000') < 0;
    }

    private static LocalTrack metadata(DurableRecordEntities.LocalMediaTrackEntity track) {
        return new LocalTrack(track.localTrackId, SOURCE, track.title, track.artist,
                track.durationMs, track.displayName, track.mimeType, track.embeddedCover,
                track.adjacentLrc, track.availability, track.grantReferenceId);
    }

    private static final class RoomCatalog implements Catalog {
        private final Listen2Database database;

        RoomCatalog(Listen2Database database) {
            if (database == null) throw new NullPointerException("database");
            this.database = database;
        }

        @Override
        public DurableRecordEntities.LocalMediaTrackEntity findLocalTrack(String localTrackId) {
            return database.listen2Dao().getLocalMediaTrack(localTrackId);
        }

        @Override
        public DurableRecordEntities.SafReferenceEntity findGrant(String grantReferenceId) {
            return database.listen2Dao().getSafReference(grantReferenceId);
        }
    }

    private static final class Lookup {
        final boolean ok;
        final String status;
        final DurableRecordEntities.LocalMediaTrackEntity track;

        private Lookup(boolean ok, String status, DurableRecordEntities.LocalMediaTrackEntity track) {
            this.ok = ok;
            this.status = status;
            this.track = track;
        }

        static Lookup success(DurableRecordEntities.LocalMediaTrackEntity track) {
            return new Lookup(true, STATUS_AVAILABLE, track);
        }

        static Lookup error(String status) {
            return new Lookup(false, status, null);
        }
    }

    /** Semantic local-track metadata safe for a page DTO or playback snapshot. */
    public static final class LocalTrack {
        public final String localTrackId;
        public final String source;
        public final String title;
        public final String artist;
        public final long durationMs;
        public final String displayName;
        public final String mimeType;
        public final boolean cover;
        public final boolean lrc;
        public final String availability;
        public final String grantReferenceId;

        private LocalTrack(String localTrackId, String source, String title, String artist,
                long durationMs, String displayName, String mimeType, boolean cover, boolean lrc,
                String availability, String grantReferenceId) {
            this.localTrackId = localTrackId;
            this.source = source;
            this.title = title;
            this.artist = artist;
            this.durationMs = durationMs;
            this.displayName = displayName;
            this.mimeType = mimeType;
            this.cover = cover;
            this.lrc = lrc;
            this.availability = availability;
            this.grantReferenceId = grantReferenceId;
        }

        /** Explicit allow-list for future bridge serialization; no URI/path fields exist here. */
        public Map<String, Object> toSemanticMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("localTrackId", localTrackId);
            map.put("source", source);
            map.put("title", title);
            map.put("artist", artist);
            map.put("durationMs", durationMs);
            map.put("displayName", displayName);
            map.put("mime", mimeType);
            map.put("cover", cover);
            map.put("lrc", lrc);
            map.put("availability", availability);
            map.put("grantReferenceId", grantReferenceId);
            return Collections.unmodifiableMap(map);
        }
    }

    public static final class Resolution<H> {
        public final boolean ok;
        public final String status;
        public final String localTrackId;
        public final LocalTrack track;
        /** Native-only handle; never place this value in a bridge reply or snapshot. */
        public final H mediaHandle;

        private Resolution(boolean ok, String status, String localTrackId, LocalTrack track, H handle) {
            this.ok = ok;
            this.status = status;
            this.localTrackId = localTrackId;
            this.track = track;
            this.mediaHandle = handle;
        }

        private static <H> Resolution<H> ready(String localTrackId, LocalTrack track, H handle) {
            // The handle is native-only and deliberately has no serializer.
            return new Resolution<>(true, STATUS_AVAILABLE, localTrackId, track, handle);
        }

        private static <H> Resolution<H> error(String localTrackId, String status) {
            return new Resolution<>(false, status, localTrackId, null, null);
        }
    }

    public static final class LyricResult {
        public final boolean ok;
        public final String status;
        public final String content;

        private LyricResult(boolean ok, String status, String content) {
            this.ok = ok;
            this.status = status;
            this.content = content;
        }

        private static LyricResult available(String content) {
            return new LyricResult(true, STATUS_LYRIC_AVAILABLE, content);
        }

        private static LyricResult error(String status) {
            return new LyricResult(false, status, null);
        }
    }
}
