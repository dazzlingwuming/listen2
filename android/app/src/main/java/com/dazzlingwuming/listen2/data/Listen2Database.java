package com.dazzlingwuming.listen2.data;

import androidx.room.Database;
import androidx.room.RoomDatabase;

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
        DurableRecordEntities.ListeningHistoryEntity.class,
        DurableRecordEntities.CacheCatalogEntity.class,
        DurableRecordEntities.SafReferenceEntity.class
}, version = 1, exportSchema = true)
public abstract class Listen2Database extends RoomDatabase {
    public abstract Listen2Dao listen2Dao();
}
