package com.dazzlingwuming.listen2.library;

import com.dazzlingwuming.listen2.data.LocalDataRepository;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Map;

/**
 * Native backup picker session coordinator. The renderer never provides a URI,
 * path, descriptor, or stream: only the Activity may complete an opaque pending
 * operation with a native document supplied by the system picker.
 */
public final class BackupSafFilePort {
    public static final String MIME_TYPE = "application/json";
    private static final int MAX_PENDING = 1;

    private final Map<PendingOperation, Kind> pending =
            Collections.synchronizedMap(new IdentityHashMap<PendingOperation, Kind>());

    public StartResult beginExport(LocalDataRepository.Backup backup) {
        BackupJsonCodec.EncodeResult encoded = BackupJsonCodec.encode(backup);
        if (!encoded.ok) return StartResult.error(encoded.status);
        PendingOperation operation = reserve(Kind.EXPORT, encoded.bytes);
        return operation == null ? StartResult.error("BUSY") : StartResult.ok(operation);
    }

    public StartResult beginImport() {
        PendingOperation operation = reserve(Kind.IMPORT, null);
        return operation == null ? StartResult.error("BUSY") : StartResult.ok(operation);
    }

    /** Call only from the Activity result callback after a user-selected document. */
    public Completion completeActivityResult(PendingOperation operation, NativeDocument document) {
        Kind kind = consume(operation);
        if (kind == null) return Completion.error("INVALID_SESSION");
        if (document == null) return Completion.error("CANCELLED");
        try {
            if (kind == Kind.EXPORT) {
                if (!document.replace(operation.exportBytes)) return Completion.error("WRITE_FAILED");
                return Completion.exported();
            }
            byte[] bytes = document.readAtMost(BackupJsonCodec.MAX_BYTES);
            if (bytes == null) return Completion.error("READ_FAILED");
            BackupJsonCodec.DecodeResult decoded = BackupJsonCodec.decode(bytes);
            return decoded.ok ? Completion.imported(decoded.backup, decoded.preview)
                    : Completion.error(decoded.status);
        } catch (RuntimeException error) {
            return Completion.error(kind == Kind.EXPORT ? "WRITE_FAILED" : "READ_FAILED");
        }
    }

    /** Consumes the operation without observing or exposing a document location. */
    public Completion cancel(PendingOperation operation) {
        return consume(operation) == null ? Completion.error("INVALID_SESSION")
                : Completion.error("CANCELLED");
    }

    private PendingOperation reserve(Kind kind, byte[] exportBytes) {
        synchronized (pending) {
            if (pending.size() >= MAX_PENDING) return null;
            PendingOperation operation = new PendingOperation(kind, exportBytes);
            pending.put(operation, kind);
            return operation;
        }
    }

    private Kind consume(PendingOperation operation) {
        if (operation == null) return null;
        synchronized (pending) {
            return pending.remove(operation);
        }
    }

    /** Native-only document capability. It is intentionally URI/path-free. */
    public interface NativeDocument {
        /** Returns null for I/O failure or if the input exceeds maxBytes. */
        byte[] readAtMost(int maxBytes);
        /** Must replace/truncate the document content as one native write operation. */
        boolean replace(byte[] bytes);
    }

    /** Opaque Activity-owned object; it carries no URI, path, or page-visible ID. */
    public static final class PendingOperation {
        private final Kind kind;
        private final byte[] exportBytes;
        private PendingOperation(Kind kind, byte[] exportBytes) {
            this.kind = kind;
            this.exportBytes = exportBytes == null ? null : exportBytes.clone();
        }
        public String pickerAction() { return kind == Kind.EXPORT ? "create" : "open"; }
        public String mimeType() { return MIME_TYPE; }
    }

    public static final class StartResult {
        public final boolean ok;
        public final String status;
        /** Activity-only opaque pending session; never place this in an RPC reply. */
        public final PendingOperation pendingOperation;
        private StartResult(boolean ok, String status, PendingOperation pendingOperation) {
            this.ok = ok; this.status = status; this.pendingOperation = pendingOperation;
        }
        static StartResult ok(PendingOperation operation) { return new StartResult(true, "OK", operation); }
        static StartResult error(String status) { return new StartResult(false, status, null); }
    }

    /** Page-safe completion: counts/status only; the import object remains native-owned. */
    public static final class Completion {
        public final boolean ok;
        public final String status;
        public final boolean exported;
        public final BackupJsonCodec.BackupPreview preview;
        /** Native semantic backup for facade preview/import, never serialize directly to a picker reply. */
        public final LocalDataRepository.Backup importedBackup;
        private Completion(boolean ok, String status, boolean exported,
                LocalDataRepository.Backup importedBackup, BackupJsonCodec.BackupPreview preview) {
            this.ok = ok; this.status = status; this.exported = exported;
            this.importedBackup = importedBackup; this.preview = preview;
        }
        static Completion exported() { return new Completion(true, "OK", true, null, null); }
        static Completion imported(LocalDataRepository.Backup backup, BackupJsonCodec.BackupPreview preview) {
            return new Completion(true, "OK", false, backup, preview);
        }
        static Completion error(String status) { return new Completion(false, status, false, null, null); }
    }

    /** Pollable, page-safe state. It deliberately has no document identity or location. */
    public static final class PageSafeStatus {
        public final String state;
        public final String status;
        public final BackupJsonCodec.BackupPreview preview;
        public PageSafeStatus(String state, String status, BackupJsonCodec.BackupPreview preview) {
            this.state = state; this.status = status; this.preview = preview;
        }
    }

    private enum Kind { EXPORT, IMPORT }
}
