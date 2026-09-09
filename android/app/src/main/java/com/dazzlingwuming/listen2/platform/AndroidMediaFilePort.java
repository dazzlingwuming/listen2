package com.dazzlingwuming.listen2.platform;

import android.content.Context;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.data.LocalDataRepository;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Native-only owner for cached media bytes. A catalogue key is transformed into
 * a digest filename, so neither a renderer string nor a database row can choose
 * an app-private path.
 */
public final class AndroidMediaFilePort implements LocalDataRepository.MediaFilePort {
    private static final String DIRECTORY_NAME = "listen2-media-cache-v1";
    static final String FILE_SUFFIX = ".media";
    private final File directory;

    public AndroidMediaFilePort(@NonNull Context context) {
        // Explicit downloads must not disappear under Android's cache
        // eviction. noBackupFilesDir is app-private, durable, and excluded
        // from device/cloud backup; LocalDataRepository still owns LRU removal.
        directory = new File(context.getApplicationContext().getNoBackupFilesDir(), DIRECTORY_NAME);
    }

    /** JVM-test seam. The supplied directory remains the only permitted parent. */
    AndroidMediaFilePort(@NonNull File directory) {
        this.directory = directory;
    }

    @Override
    public LocalDataRepository.Inspection inspect(String opaqueContentKey) {
        File target = resolve(opaqueContentKey);
        if (target == null || !ensureDirectory()) {
            return LocalDataRepository.Inspection.unavailable();
        }
        try {
            if (!target.exists() || !target.isFile() || target.length() <= 0L
                    || !isDirectChild(target)) {
                return LocalDataRepository.Inspection.corrupt();
            }
            return LocalDataRepository.Inspection.ready(target.length());
        } catch (SecurityException ignored) {
            return LocalDataRepository.Inspection.unavailable();
        }
    }

    @Override
    public boolean delete(String opaqueContentKey) {
        File target = resolve(opaqueContentKey);
        if (target == null || !ensureDirectory()) return false;
        try {
            if (target.exists() && (!isDirectChild(target) || !target.delete())) return false;
            // Sidecars are owned by AndroidMediaCache and share the digest-only
            // filename. Clear them with the primary file so eviction cannot
            // leave metadata or resumable bytes behind.
            return deleteDirectChild(new File(directory, target.getName() + ".part"))
                    && deleteDirectChild(new File(directory, target.getName() + ".sha256"))
                    && deleteDirectChild(new File(directory, target.getName() + ".sha256.tmp"));
        } catch (SecurityException ignored) {
            return false;
        }
    }

    /**
     * Native-only hand-off for a verified cache entry. This is intentionally
     * not part of LocalDataRepository.MediaFilePort: repository/page DTOs must
     * stay unable to obtain file locations.
     */
    File readyFile(String opaqueContentKey) {
        File target = fileForKey(opaqueContentKey);
        if (target == null || !ensureDirectory()) return null;
        try {
            return target.isFile() && target.length() > 0L && isDirectChild(target) ? target : null;
        } catch (SecurityException ignored) {
            return null;
        }
    }

    File directory() {
        return ensureDirectory() ? directory : null;
    }

    /** Internal writer target; the digest filename remains derived solely from the opaque key. */
    File fileForKey(String opaqueContentKey) {
        return resolve(opaqueContentKey);
    }

    /** Package-visible for focused JVM tests; it returns only a filename, never a path. */
    static String fileNameForKey(String opaqueContentKey) {
        if (!isValidKey(opaqueContentKey)) return null;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(opaqueContentKey.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2 + FILE_SUFFIX.length());
            for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value));
            return result.append(FILE_SUFFIX).toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private File resolve(String opaqueContentKey) {
        String fileName = fileNameForKey(opaqueContentKey);
        return fileName == null ? null : new File(directory, fileName);
    }

    private boolean ensureDirectory() {
        try {
            return (directory.isDirectory() || directory.mkdirs()) && isPrivateDirectory();
        } catch (SecurityException ignored) {
            return false;
        }
    }

    private boolean isPrivateDirectory() {
        try {
            // macOS legitimately canonicalizes /var to /private/var. Compare
            // the directory's canonical parent plus its requested child name,
            // rather than comparing raw absolute strings; a real child
            // symlink has a different canonical final name and still fails.
            File absolute = directory.getAbsoluteFile();
            File parent = absolute.getParentFile();
            if (parent == null) return false;
            File canonical = directory.getCanonicalFile();
            File canonicalParent = parent.getCanonicalFile();
            return canonicalParent.equals(canonical.getParentFile())
                    && absolute.getName().equals(canonical.getName());
        } catch (IOException ignored) {
            return false;
        }
    }

    private boolean isDirectChild(File target) {
        try {
            File canonicalDirectory = directory.getCanonicalFile();
            File canonicalTarget = target.getCanonicalFile();
            return canonicalDirectory.equals(target.getParentFile().getCanonicalFile())
                    && canonicalTarget.getParentFile().equals(canonicalDirectory)
                    && canonicalTarget.getName().equals(target.getName());
        } catch (IOException ignored) {
            return false;
        }
    }

    private boolean deleteDirectChild(File target) {
        return !target.exists() || (isDirectChild(target) && target.delete());
    }

    static boolean isValidKey(String value) {
        return value != null && value.length() > 0 && value.length() <= 160
                && value.matches("[A-Za-z0-9:._-]+");
    }
}
