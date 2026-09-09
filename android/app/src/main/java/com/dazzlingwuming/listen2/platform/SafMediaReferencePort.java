package com.dazzlingwuming.listen2.platform;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.LocalPlaybackResolver;
import com.dazzlingwuming.listen2.data.DurableRecordEntities;
import com.dazzlingwuming.listen2.data.Listen2Database;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Locale;

/** Native-only opaque-reference resolver reserved for the future Media3 owner. */
public final class SafMediaReferencePort
        implements LocalPlaybackResolver.MediaPort<ParcelFileDescriptor> {
    private static final long MAX_LRC_BYTES = 256L * 1024L;
    private static final int MAX_DIRECTORY_VISITS = 1_024;
    private static final String[] DOCUMENT_COLUMNS = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE
    };
    private final Context context;
    private final Listen2Database database;

    public SafMediaReferencePort(@NonNull Context context, @NonNull Listen2Database database) {
        this.context = context.getApplicationContext();
        this.database = database;
    }

    @Override
    public ParcelFileDescriptor openReadOnlyForLocalTrack(String localTrackId)
            throws java.io.FileNotFoundException {
        Uri document = resolveAuthorizedUri(localTrackId);
        try {
            ParcelFileDescriptor descriptor = context.getContentResolver()
                    .openFileDescriptor(document, "r");
            if (descriptor == null) throw new java.io.FileNotFoundException(
                    "Unavailable local media reference");
            return descriptor;
        } catch (SecurityException | IllegalArgumentException error) {
            throw new java.io.FileNotFoundException("Unavailable local media reference");
        }
    }

    /** Native-only URI for Media3; callers must never serialize or log it. */
    public Uri resolveAuthorizedUri(String localTrackId)
            throws java.io.FileNotFoundException {
        if (localTrackId == null || !localTrackId.matches("local\\.track\\.[a-f0-9]{64}")) {
            throw new java.io.FileNotFoundException("Unknown local media reference");
        }
        DurableRecordEntities.LocalMediaTrackEntity track = database.listen2Dao().getLocalMediaTrack(localTrackId);
        DurableRecordEntities.SafReferenceEntity grant = track == null ? null
                : database.listen2Dao().getSafReference(track.grantReferenceId);
        if (track == null || grant == null || !"active".equals(grant.grantState)) {
            throw new java.io.FileNotFoundException("Unavailable local media reference");
        }
        Uri document = parseUri(track.documentReference);
        if (document == null || !"content".equalsIgnoreCase(document.getScheme())
                || document.getAuthority() == null || document.getPath() == null) {
            throw new java.io.FileNotFoundException("Unavailable local media reference");
        }
        if (!"document".equals(grant.grantKind) && !"tree".equals(grant.grantKind)) {
            throw new java.io.FileNotFoundException("Unavailable local media reference");
        }
        if ("document".equals(grant.grantKind)
                && (grant.documentReference == null
                || !grant.documentReference.equals(track.documentReference))) {
            throw new java.io.FileNotFoundException("Unavailable local media reference");
        }
        if ("tree".equals(grant.grantKind)) {
            Uri tree = parseUri(grant.treeReference);
            if (!isTreeChild(tree, document)) {
                throw new java.io.FileNotFoundException("Unavailable local media reference");
            }
        }
        return document;
    }

    /**
     * Resolves a same-directory LRC without ever handing a document reference to
     * the packaged page. A single-document grant deliberately has no sibling
     * enumeration capability, so it is an explicit no-lyric result instead of a
     * guessed path or broadened permission.
     */
    public LocalLyricResult readAdjacentLrc(String localTrackId) {
        DurableRecordEntities.LocalMediaTrackEntity track = localTrack(localTrackId);
        DurableRecordEntities.SafReferenceEntity grant = track == null ? null
                : database.listen2Dao().getSafReference(track.grantReferenceId);
        if (track == null || grant == null || !"active".equals(grant.grantState)) {
            return LocalLyricResult.unavailable();
        }
        if (!"tree".equals(grant.grantKind)) return LocalLyricResult.noLyric();

        Uri tree = parseUri(grant.treeReference);
        Uri document = parseUri(track.documentReference);
        if (!isTreeChild(tree, document)) return LocalLyricResult.unavailable();
        String expectedName = lrcName(track.displayName);
        if (expectedName == null) return LocalLyricResult.noLyric();
        try {
            Uri lrc = findSiblingLrc(tree, document, expectedName);
            if (lrc == null) return LocalLyricResult.noLyric();
            String lyric = readBoundedUtf8(lrc);
            return lyric == null ? LocalLyricResult.noLyric() : LocalLyricResult.found(lyric);
        } catch (SecurityException | IllegalArgumentException | IOException error) {
            return LocalLyricResult.unavailable();
        }
    }

    private DurableRecordEntities.LocalMediaTrackEntity localTrack(String localTrackId) {
        if (localTrackId == null || !localTrackId.matches("local\\.track\\.[a-f0-9]{64}")) return null;
        return database.listen2Dao().getLocalMediaTrack(localTrackId);
    }

    private Uri findSiblingLrc(Uri tree, Uri target, String expectedName) throws IOException {
        String targetId;
        try {
            targetId = DocumentsContract.getDocumentId(target);
        } catch (RuntimeException error) {
            return null;
        }
        ArrayDeque<String> directories = new ArrayDeque<>();
        directories.add(DocumentsContract.getTreeDocumentId(tree));
        int visited = 0;
        while (!directories.isEmpty() && visited++ < MAX_DIRECTORY_VISITS) {
            String directoryId = directories.removeFirst();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, directoryId);
            boolean containsTarget = false;
            Uri matchingLrc = null;
            try (Cursor cursor = context.getContentResolver().query(
                    children, DOCUMENT_COLUMNS, null, null, null)) {
                if (cursor == null) throw new IOException("SAF sibling query unavailable");
                while (cursor.moveToNext()) {
                    String documentId = cursor.getString(0);
                    String name = cursor.getString(1);
                    String mimeType = cursor.getString(2);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                        if (documentId != null) directories.addLast(documentId);
                        continue;
                    }
                    if (targetId.equals(documentId)) containsTarget = true;
                    long byteCount = cursor.isNull(3) ? -1L : cursor.getLong(3);
                    if (documentId != null && name != null
                            && expectedName.equals(name.toLowerCase(Locale.ROOT))
                            && byteCount >= 0L && byteCount <= MAX_LRC_BYTES) {
                        matchingLrc = DocumentsContract.buildDocumentUriUsingTree(tree, documentId);
                    }
                }
            }
            if (containsTarget) return matchingLrc;
        }
        return null;
    }

    private String readBoundedUtf8(Uri lrc) throws IOException {
        try (InputStream input = context.getContentResolver().openInputStream(lrc)) {
            if (input == null) throw new IOException("SAF lyric unavailable");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8_192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (output.size() + read > MAX_LRC_BYTES) return null;
                output.write(buffer, 0, read);
            }
            return decodeUtf8Lrc(output.toByteArray());
        }
    }

    static String decodeUtf8Lrc(byte[] bytes) {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_LRC_BYTES) return null;
        try {
            CharBuffer decoded = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes));
            String value = decoded.toString();
            if (value.indexOf('\u0000') >= 0) return null;
            return value.startsWith("\uFEFF") ? value.substring(1) : value;
        } catch (CharacterCodingException error) {
            return null;
        }
    }

    private static String lrcName(String displayName) {
        if (displayName == null) return null;
        int dot = displayName.lastIndexOf('.');
        if (dot <= 0) return null;
        return (displayName.substring(0, dot) + ".lrc").toLowerCase(Locale.ROOT);
    }

    /** Page-safe lyric outcome; it intentionally contains no URI, path, or grant metadata. */
    public static final class LocalLyricResult {
        public enum Status { FOUND, NO_LYRIC, UNAVAILABLE }

        public final Status status;
        public final String lyric;

        private LocalLyricResult(Status status, String lyric) {
            this.status = status;
            this.lyric = lyric == null ? "" : lyric;
        }

        public static LocalLyricResult found(String lyric) { return new LocalLyricResult(Status.FOUND, lyric); }
        public static LocalLyricResult noLyric() { return new LocalLyricResult(Status.NO_LYRIC, ""); }
        public static LocalLyricResult unavailable() { return new LocalLyricResult(Status.UNAVAILABLE, ""); }
    }

    private boolean isTreeChild(Uri tree, Uri document) {
        if (tree == null || document == null || !"content".equalsIgnoreCase(tree.getScheme())
                || !DocumentsContract.isTreeUri(tree)
                || tree.getAuthority() == null
                || !tree.getAuthority().equals(document.getAuthority())) return false;
        try {
            String treeDocumentId = DocumentsContract.getTreeDocumentId(tree);
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, treeDocumentId);
            return DocumentsContract.isChildDocument(context.getContentResolver(), parent, document);
        } catch (java.io.FileNotFoundException error) {
            return false;
        } catch (RuntimeException error) {
            return false;
        }
    }

    private static Uri parseUri(String raw) {
        if (raw == null) return null;
        try {
            return Uri.parse(raw);
        } catch (RuntimeException error) {
            return null;
        }
    }
}
