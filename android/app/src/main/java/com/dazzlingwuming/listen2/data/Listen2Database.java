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
        DurableRecordEntities.SafReferenceEntity.class
}, version = 2, exportSchema = true)
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

    public abstract Listen2Dao listen2Dao();
    public abstract LyricRecord.Dao lyricDao();
}
