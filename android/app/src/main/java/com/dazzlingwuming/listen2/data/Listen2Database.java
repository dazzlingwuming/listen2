package com.dazzlingwuming.listen2.data;

import androidx.room.Database;
import androidx.room.RoomDatabase;
import androidx.room.migration.Migration;
import androidx.sqlite.db.SupportSQLiteDatabase;

@Database(entities = {
        PlaybackEntities.CheckpointEntity.class,
        PlaybackEntities.OccurrenceEntity.class,
        PlaybackEntities.HistoryEntity.class,
        PlaybackEntities.ShuffleEntity.class,
        PlaybackEntities.TransitionTokenEntity.class,
        DurableRecordEntities.PlaylistEntity.class,
        DurableRecordEntities.PlaylistTrackEntity.class,
        DurableRecordEntities.FavoriteEntity.class,
        DurableRecordEntities.LyricMetadataEntity.class,
        LyricRecord.Entity.class,
        DurableRecordEntities.ListeningHistoryEntity.class,
        DurableRecordEntities.CacheCatalogEntity.class,
        DurableRecordEntities.SafReferenceEntity.class,
        DurableRecordEntities.LocalMediaTrackEntity.class,
        DurableRecordEntities.SettingEntity.class
}, version = 5, exportSchema = true)
public abstract class Listen2Database extends RoomDatabase {
    public static final Migration MIGRATION_1_2 = new Migration(1, 2) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            database.execSQL("CREATE TABLE IF NOT EXISTS `lyric_records` ("
                    + "`source` TEXT NOT NULL, `providerTrackId` TEXT NOT NULL, "
                    + "`providerPartId` TEXT NOT NULL, `lyricRevision` TEXT NOT NULL, "
                    + "`mode` TEXT NOT NULL, `selectedSourceId` TEXT, `matchQuality` INTEGER NOT NULL, "
                    + "`matchedAtMs` INTEGER NOT NULL, `originalText` TEXT, `translationText` TEXT, "
                    + "`offsetMs` INTEGER NOT NULL, `semanticRevision` INTEGER NOT NULL, "
                    + "`transitionToken` TEXT NOT NULL, `updatedAtMs` INTEGER NOT NULL, "
                    + "PRIMARY KEY(`source`, `providerTrackId`, `providerPartId`, `lyricRevision`))");
            database.execSQL("CREATE INDEX IF NOT EXISTS `index_lyric_records_source_providerTrackId` "
                    + "ON `lyric_records` (`source`, `providerTrackId`)");
        }
    };

    /** Adds bounded metadata without deleting the v2 durable records. */
    public static final Migration MIGRATION_2_3 = new Migration(2, 3) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            database.execSQL("ALTER TABLE `playlists` ADD COLUMN `kind` TEXT NOT NULL DEFAULT 'custom'");
            database.execSQL("ALTER TABLE `playlists` ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0");
            database.execSQL("ALTER TABLE `playlist_tracks` ADD COLUMN `title` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `playlist_tracks` ADD COLUMN `artist` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `playlist_tracks` ADD COLUMN `durationMs` INTEGER NOT NULL DEFAULT 0");
            database.execSQL("ALTER TABLE `favorites` ADD COLUMN `title` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `favorites` ADD COLUMN `artist` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `listening_history` ADD COLUMN `sessionId` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `listening_history` ADD COLUMN `cumulativePlayedMs` INTEGER NOT NULL DEFAULT 0");
            database.execSQL("ALTER TABLE `listening_history` ADD COLUMN `qualified` INTEGER NOT NULL DEFAULT 0");
            database.execSQL("ALTER TABLE `listening_history` ADD COLUMN `title` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `listening_history` ADD COLUMN `artist` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `cache_catalog` ADD COLUMN `retention` TEXT NOT NULL DEFAULT 'temporary'");
            database.execSQL("ALTER TABLE `cache_catalog` ADD COLUMN `state` TEXT NOT NULL DEFAULT 'ready'");
            database.execSQL("ALTER TABLE `cache_catalog` ADD COLUMN `lastAccessedAtMs` INTEGER NOT NULL DEFAULT 0");
            database.execSQL("ALTER TABLE `cache_catalog` ADD COLUMN `integrity` TEXT NOT NULL DEFAULT 'unknown'");
            database.execSQL("ALTER TABLE `saf_references` ADD COLUMN `displayName` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `saf_references` ADD COLUMN `grantState` TEXT NOT NULL DEFAULT 'needs-repair'");
            database.execSQL("CREATE TABLE IF NOT EXISTS `local_settings` (`settingKey` TEXT NOT NULL, `settingValue` TEXT NOT NULL, `updatedAtMs` INTEGER NOT NULL, PRIMARY KEY(`settingKey`))");
            database.execSQL("CREATE INDEX IF NOT EXISTS `index_listening_history_sessionId` ON `listening_history` (`sessionId`)");
            database.execSQL("CREATE INDEX IF NOT EXISTS `index_cache_catalog_lastAccessedAtMs` ON `cache_catalog` (`lastAccessedAtMs`)");
        }
    };

    /** Adds SAF grant kind and a native-only local-media catalog without replacing prior records. */
    public static final Migration MIGRATION_3_4 = new Migration(3, 4) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            database.execSQL("ALTER TABLE `saf_references` ADD COLUMN `grantKind` TEXT NOT NULL DEFAULT 'document'");
            // v1/v2 had two nullable-in-practice reference slots but no kind.
            // Preserve only an unambiguous single slot; ambiguous legacy rows
            // must be repaired instead of silently being opened as documents.
            database.execSQL("UPDATE `saf_references` SET `grantKind` = CASE "
                    + "WHEN `treeReference` <> '' AND `documentReference` = '' THEN 'tree' "
                    + "ELSE 'document' END");
            database.execSQL("UPDATE `saf_references` SET "
                    + "`grantState` = CASE WHEN (`treeReference` = '' AND `documentReference` = '') "
                    + "OR (`treeReference` <> '' AND `documentReference` <> '') "
                    + "THEN 'needs-repair' ELSE `grantState` END, "
                    + "`treeReference` = CASE WHEN `grantKind` = 'tree' THEN `treeReference` ELSE '' END, "
                    + "`documentReference` = CASE WHEN `grantKind` = 'document' "
                    + "AND `treeReference` = '' THEN `documentReference` ELSE '' END");
            database.execSQL("CREATE TABLE IF NOT EXISTS `local_media_tracks` ("
                    + "`localTrackId` TEXT NOT NULL, `grantReferenceId` TEXT NOT NULL, "
                    + "`opaqueReference` TEXT NOT NULL, `documentReference` TEXT NOT NULL, "
                    + "`displayName` TEXT NOT NULL, `mimeType` TEXT NOT NULL, `byteCount` INTEGER NOT NULL, "
                    + "`durationMs` INTEGER NOT NULL, `title` TEXT NOT NULL, `artist` TEXT NOT NULL, "
                    + "`embeddedCover` INTEGER NOT NULL, `adjacentLrc` INTEGER NOT NULL, "
                    + "`availability` TEXT NOT NULL, `scannedAtMs` INTEGER NOT NULL, "
                    + "PRIMARY KEY(`localTrackId`))");
            database.execSQL("CREATE INDEX IF NOT EXISTS `index_local_media_tracks_grantReferenceId` "
                    + "ON `local_media_tracks` (`grantReferenceId`)");
            database.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_local_media_tracks_opaqueReference` "
                    + "ON `local_media_tracks` (`opaqueReference`)");
        }
    };

    /**
     * Keeps a restart checkpoint independently actionable: resolving a fresh
     * provider manifest requires the original semantic descriptor, never a
     * retained URL, header, cookie, or provider body.
     */
    public static final Migration MIGRATION_4_5 = new Migration(4, 5) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            database.execSQL("ALTER TABLE `playback_occurrences` ADD COLUMN `title` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `playback_occurrences` ADD COLUMN `artist` TEXT NOT NULL DEFAULT ''");
            database.execSQL("ALTER TABLE `playback_occurrences` ADD COLUMN `durationMs` INTEGER NOT NULL DEFAULT 0");
            database.execSQL("ALTER TABLE `playback_occurrences` ADD COLUMN `mediaKind` TEXT NOT NULL DEFAULT 'audio'");
        }
    };

    public abstract Listen2Dao listen2Dao();
    public abstract LyricRecord.Dao lyricDao();
}
