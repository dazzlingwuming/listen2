package com.dazzlingwuming.listen2.library;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import java.nio.charset.StandardCharsets;

/** File transfer accepts desktop V2/legacy and the early Android V1 format. */
public final class PlaylistFileCodec {
    private PlaylistFileCodec() { }

    public static BackupJsonCodec.EncodeResult encodeDesktop(LocalDataRepository.Backup backup) {
        BackupJsonCodec.EncodeResult checked = BackupJsonCodec.encode(backup);
        if (!checked.ok) return checked;
        try {
            byte[] bytes = GitHubPlaylistCodec.mergeForUpload(GitHubPlaylistCodec.empty(), backup)
                    .toString().getBytes(StandardCharsets.UTF_8);
            return BackupJsonCodec.EncodeResult.ok(bytes);
        } catch (Exception ignored) { return BackupJsonCodec.EncodeResult.error("INVALID_BACKUP"); }
    }

    public static BackupJsonCodec.DecodeResult decode(byte[] bytes) {
        BackupJsonCodec.DecodeResult nativeFormat = BackupJsonCodec.decode(bytes);
        if (nativeFormat.ok || !"INVALID_SCHEMA".equals(nativeFormat.status)) return nativeFormat;
        try {
            GitHubPlaylistCodec.ImportResult imported = GitHubPlaylistCodec.toNative(
                    GitHubPlaylistCodec.parse(new String(bytes, StandardCharsets.UTF_8)));
            // Reuse bounded validation and preview of the native semantic projection.
            BackupJsonCodec.EncodeResult encoded = BackupJsonCodec.encode(imported.backup);
            if (!encoded.ok) return BackupJsonCodec.DecodeResult.error(encoded.status);
            return BackupJsonCodec.decode(encoded.bytes);
        } catch (Exception ignored) { return nativeFormat; }
    }
}
