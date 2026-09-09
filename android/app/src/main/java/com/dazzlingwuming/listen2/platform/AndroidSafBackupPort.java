package com.dazzlingwuming.listen2.platform;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import com.dazzlingwuming.listen2.library.BackupJsonCodec;
import com.dazzlingwuming.listen2.library.BackupSafFilePort;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Thin Android SAF adapter; all schema/session policy remains JVM-testable in BackupSafFilePort. */
public final class AndroidSafBackupPort {
    private final ContentResolver resolver;
    private final BackupSafFilePort sessions = new BackupSafFilePort();

    public AndroidSafBackupPort(@NonNull Context context) {
        resolver = context.getApplicationContext().getContentResolver();
    }

    public BackupSafFilePort.StartResult beginExport(LocalDataRepository.Backup backup) {
        return sessions.beginExport(backup);
    }

    public BackupSafFilePort.StartResult beginImport() {
        return sessions.beginImport();
    }

    /**
     * Activity-only completion. The typed Uri is accepted solely here after a
     * system picker result; non-content URIs and malformed provider results are rejected.
     */
    public BackupSafFilePort.Completion completeActivityResult(
            BackupSafFilePort.PendingOperation operation, Uri pickedByActivity) {
        if (!isSafeContentUri(pickedByActivity)) {
            return sessions.cancel(operation);
        }
        return sessions.completeActivityResult(operation,
                new ContentResolverDocument(resolver, pickedByActivity));
    }

    public BackupSafFilePort.Completion cancel(BackupSafFilePort.PendingOperation operation) {
        return sessions.cancel(operation);
    }

    private static boolean isSafeContentUri(Uri uri) {
        return uri != null && "content".equalsIgnoreCase(uri.getScheme())
                && uri.getAuthority() != null && !uri.getAuthority().isEmpty()
                && uri.getPath() != null && !uri.getPath().isEmpty();
    }

    private static final class ContentResolverDocument implements BackupSafFilePort.NativeDocument {
        private final ContentResolver resolver;
        private final Uri uri;
        ContentResolverDocument(ContentResolver resolver, Uri uri) {
            this.resolver = resolver; this.uri = uri;
        }

        @Override
        public byte[] readAtMost(int maxBytes) {
            if (maxBytes <= 0) return null;
            try (InputStream input = resolver.openInputStream(uri)) {
                if (input == null) return null;
                ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maxBytes, 16 * 1024));
                byte[] buffer = new byte[8 * 1024];
                int remaining = maxBytes;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (read > remaining) return null;
                    output.write(buffer, 0, read);
                    remaining -= read;
                    if (remaining == 0 && input.read() != -1) return null;
                }
                return output.toByteArray();
            } catch (IOException | SecurityException error) {
                return null;
            }
        }

        @Override
        public boolean replace(byte[] bytes) {
            if (bytes == null || bytes.length > BackupJsonCodec.MAX_BYTES) return false;
            // "rwt" requests read/write + truncation from a DocumentsProvider.
            // Providers cannot promise cross-provider rename atomicity, so the
            // bounded complete-document write is the strongest common SAF form.
            try (OutputStream output = resolver.openOutputStream(uri, "rwt")) {
                if (output == null) return false;
                output.write(bytes);
                output.flush();
                return true;
            } catch (IOException | SecurityException | IllegalArgumentException error) {
                return false;
            }
        }
    }
}
