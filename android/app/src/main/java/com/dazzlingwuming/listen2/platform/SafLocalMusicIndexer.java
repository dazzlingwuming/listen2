package com.dazzlingwuming.listen2.platform;

import android.content.ContentResolver;
import android.content.Context;
import android.content.UriPermission;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.data.DurableRecordEntities;
import com.dazzlingwuming.listen2.data.Listen2Database;
import com.dazzlingwuming.listen2.data.LocalDataRepository;
import com.dazzlingwuming.listen2.library.AndroidLocalDataFacade;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Native SAF scanner. It persists semantic metadata but keeps content URIs out of all page views. */
public final class SafLocalMusicIndexer {
    private static final int MAX_TRACKS = 5_000;
    private static final int MAX_DIRECTORIES = 1_024;
    private static final String[] DOCUMENT_COLUMNS = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE
    };

    private final ContentResolver resolver;
    private final Context context;
    private final Listen2Database database;
    private final AndroidLocalDataFacade localData;

    public SafLocalMusicIndexer(@NonNull Context context, @NonNull Listen2Database database,
            @NonNull AndroidLocalDataFacade localData) {
        this.context = context.getApplicationContext();
        resolver = this.context.getContentResolver();
        this.database = database;
        this.localData = localData;
    }

    public void recheckAndIndexAll() {
        for (DurableRecordEntities.SafReferenceEntity grant : database.listen2Dao().getSafReferences()) {
            recheckAndIndex(grant.referenceId);
        }
    }

    public void recheckAndIndex(String grantReferenceId) {
        DurableRecordEntities.SafReferenceEntity grant = database.listen2Dao().getSafReference(grantReferenceId);
        if (grant == null) return;
        try {
            Uri grantUri = parseUri("tree".equals(grant.grantKind)
                    ? grant.treeReference : grant.documentReference);
            if (!hasPersistedReadGrant(grantUri)) {
                localData.updateSafGrantState(grant.referenceId, "needs-repair");
                localData.clearLocalMediaTracksForGrant(grant.referenceId);
                return;
            }
            List<LocalDataRepository.LocalTrackInput> tracks = "tree".equals(grant.grantKind)
                    ? scanTree(grant) : scanDocument(grant);
            LocalDataRepository.Result<List<LocalDataRepository.LocalTrackView>> replaced =
                    localData.replaceLocalMediaTracks(grant.referenceId, tracks);
            if (!replaced.ok) {
                localData.updateSafGrantState(grant.referenceId, "needs-repair");
                return;
            }
            localData.updateSafGrantState(grant.referenceId, "active");
        } catch (SecurityException ignored) {
            localData.updateSafGrantState(grant.referenceId, "revoked");
            localData.clearLocalMediaTracksForGrant(grant.referenceId);
        } catch (RuntimeException ignored) {
            // Malformed provider/document rows are an actionable repair state,
            // not an empty successful library.
            localData.updateSafGrantState(grant.referenceId, "needs-repair");
        }
    }

    private List<LocalDataRepository.LocalTrackInput> scanDocument(
            DurableRecordEntities.SafReferenceEntity grant) {
        Uri uri = Uri.parse(grant.documentReference);
        Candidate candidate = inspectDocument(uri, null);
        if (candidate == null || !isSupportedAudio(candidate.displayName, candidate.mimeType)) {
            return new ArrayList<>();
        }
        List<LocalDataRepository.LocalTrackInput> result = new ArrayList<>();
        result.add(toInput(grant.referenceId, candidate, false));
        return result;
    }

    private List<LocalDataRepository.LocalTrackInput> scanTree(
            DurableRecordEntities.SafReferenceEntity grant) {
        Uri treeUri = Uri.parse(grant.treeReference);
        ArrayDeque<Directory> pending = new ArrayDeque<>();
        pending.add(new Directory(treeUri, DocumentsContract.getTreeDocumentId(treeUri)));
        List<LocalDataRepository.LocalTrackInput> tracks = new ArrayList<>();
        int visitedDirectories = 0;
        while (!pending.isEmpty() && visitedDirectories++ < MAX_DIRECTORIES
                && tracks.size() < MAX_TRACKS) {
            Directory directory = pending.removeFirst();
            List<Candidate> files = new ArrayList<>();
            Set<String> names = new HashSet<>();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, directory.documentId);
            try (Cursor cursor = resolver.query(children, DOCUMENT_COLUMNS, null, null, null)) {
                if (cursor == null) throw new SecurityException();
                while (cursor.moveToNext()) {
                    String id = cursor.getString(0);
                    String displayName = safeText(cursor.getString(1), "Unknown audio");
                    String mimeType = safeText(cursor.getString(2), "application/octet-stream");
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                        pending.addLast(new Directory(treeUri, id));
                        continue;
                    }
                    Uri document = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                    Candidate candidate = new Candidate(document, displayName, mimeType,
                            cursor.isNull(3) ? 0L : Math.max(0L, cursor.getLong(3)));
                    files.add(candidate);
                    names.add(displayName.toLowerCase(Locale.ROOT));
                }
            }
            for (Candidate candidate : files) {
                if (tracks.size() >= MAX_TRACKS || !isSupportedAudio(candidate.displayName, candidate.mimeType)) continue;
                boolean hasLrc = names.contains(baseName(candidate.displayName).toLowerCase(Locale.ROOT) + ".lrc");
                tracks.add(toInput(grant.referenceId, candidate, hasLrc));
            }
        }
        return tracks;
    }

    private Candidate inspectDocument(Uri uri, String fallbackName) {
        try (Cursor cursor = resolver.query(uri, DOCUMENT_COLUMNS, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            return new Candidate(uri, safeText(cursor.getString(1), fallbackName == null ? "Unknown audio" : fallbackName),
                    safeText(cursor.getString(2), "application/octet-stream"),
                    cursor.isNull(3) ? 0L : Math.max(0L, cursor.getLong(3)));
        }
    }

    private LocalDataRepository.LocalTrackInput toInput(String grantReferenceId,
            Candidate candidate, boolean adjacentLrc) {
        String title = candidate.displayName;
        String artist = "Unknown artist";
        long duration = 0L;
        boolean cover = false;
        MediaMetadataRetriever metadata = new MediaMetadataRetriever();
        try {
            metadata.setDataSource(context, candidate.uri);
            title = safeText(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE), title);
            artist = safeText(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST), artist);
            duration = safeLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            cover = metadata.getEmbeddedPicture() != null;
        } catch (Exception ignored) {
            // Metadata is enrichment; the readable, typed document remains a valid catalog item.
        } finally {
            try {
                metadata.release();
            } catch (Exception ignored) {
                // Releasing a provider-backed retriever is best effort; the
                // catalog item itself remains valid when metadata cleanup fails.
            }
        }
        String opaque = opaqueReference(grantReferenceId, candidate.uri.toString());
        return new LocalDataRepository.LocalTrackInput("local.track." + opaque.substring("local.".length()),
                grantReferenceId, opaque, candidate.uri.toString(), candidate.displayName,
                candidate.mimeType, candidate.byteCount, duration, title, artist, cover, adjacentLrc);
    }

    private boolean hasPersistedReadGrant(Uri uri) {
        if (uri == null) return false;
        for (UriPermission permission : resolver.getPersistedUriPermissions()) {
            if (permission.isReadPermission() && uri.equals(permission.getUri())) return true;
        }
        return false;
    }

    private static Uri parseUri(String raw) {
        if (raw == null) return null;
        try {
            return Uri.parse(raw);
        } catch (RuntimeException error) {
            return null;
        }
    }

    static boolean isSupportedAudio(String displayName, String mimeType) {
        if (mimeType != null && mimeType.toLowerCase(Locale.ROOT).startsWith("audio/")) return true;
        String lower = displayName == null ? "" : displayName.toLowerCase(Locale.ROOT);
        return lower.endsWith(".mp3") || lower.endsWith(".m4a") || lower.endsWith(".flac")
                || lower.endsWith(".ogg") || lower.endsWith(".opus") || lower.endsWith(".wav")
                || lower.endsWith(".aac") || lower.endsWith(".ape") || lower.endsWith(".wma")
                || lower.endsWith(".mp4") || lower.endsWith(".webm");
    }

    private static String opaqueReference(String grantReferenceId, String documentReference) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                    (grantReferenceId + "\u0000" + documentReference).getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder("local.");
            for (byte value : digest) result.append(String.format(Locale.ROOT, "%02x", value));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static String safeText(String value, String fallback) {
        if (value == null || value.trim().isEmpty() || value.length() > 320
                || value.contains("\n") || value.contains("\r")) return fallback;
        String trimmed = value.trim();
        String lower = trimmed.toLowerCase(Locale.ROOT);
        if (lower.contains("://") || lower.startsWith("file:") || lower.startsWith("content:")
                || trimmed.startsWith("/") || trimmed.startsWith("\\")
                || trimmed.matches("^[A-Za-z]:[\\\\/].*")) return fallback;
        return trimmed;
    }

    private static long safeLong(String value) {
        try { return Math.max(0L, Math.min(28_800_000L, Long.parseLong(value))); }
        catch (NumberFormatException ignored) { return 0L; }
    }

    private static String baseName(String name) {
        int dot = name.lastIndexOf('.');
        return dot <= 0 ? name : name.substring(0, dot);
    }

    private static final class Directory {
        final Uri treeUri;
        final String documentId;
        Directory(Uri treeUri, String documentId) { this.treeUri = treeUri; this.documentId = documentId; }
    }

    private static final class Candidate {
        final Uri uri;
        final String displayName;
        final String mimeType;
        final long byteCount;
        Candidate(Uri uri, String displayName, String mimeType, long byteCount) {
            this.uri = uri; this.displayName = displayName; this.mimeType = mimeType; this.byteCount = byteCount;
        }
    }
}
