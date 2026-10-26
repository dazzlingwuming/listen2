package com.dazzlingwuming.listen2.data;

import androidx.annotation.NonNull;
import androidx.room.Index;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

/** Provider-neutral, bounded semantic lyric state. It intentionally has no transport fields. */
public final class LyricRecord {
    private LyricRecord() {
    }

    @androidx.room.Entity(tableName = "lyric_records", primaryKeys = {
            "source", "providerTrackId", "providerPartId", "lyricRevision"},
            indices = @Index(value = {"source", "providerTrackId"}))
    public static final class Entity {
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        @NonNull public final String providerPartId;
        @NonNull public final String lyricRevision;
        @NonNull public final String mode;
        public final String selectedSourceId;
        public final int matchQuality;
        public final long matchedAtMs;
        public final String originalText;
        public final String translationText;
        public final long offsetMs;
        public final long semanticRevision;
        @NonNull public final String transitionToken;
        public final long updatedAtMs;

        public Entity(@NonNull String source, @NonNull String providerTrackId,
                @NonNull String providerPartId, @NonNull String lyricRevision, @NonNull String mode,
                String selectedSourceId, int matchQuality, long matchedAtMs, String originalText,
                String translationText, long offsetMs, long semanticRevision,
                @NonNull String transitionToken, long updatedAtMs) {
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.providerPartId = providerPartId;
            this.lyricRevision = lyricRevision;
            this.mode = mode;
            this.selectedSourceId = selectedSourceId;
            this.matchQuality = matchQuality;
            this.matchedAtMs = matchedAtMs;
            this.originalText = originalText;
            this.translationText = translationText;
            this.offsetMs = offsetMs;
            this.semanticRevision = semanticRevision;
            this.transitionToken = transitionToken;
            this.updatedAtMs = updatedAtMs;
        }
    }

    @androidx.room.Dao
    public interface Dao {
        @Query("SELECT * FROM lyric_records WHERE source = :source AND providerTrackId = :trackId "
                + "AND providerPartId = :partId AND lyricRevision = :lyricRevision")
        Entity get(String source, String trackId, String partId, String lyricRevision);

        @Insert(onConflict = OnConflictStrategy.REPLACE)
        void upsert(Entity record);

        @Query("DELETE FROM lyric_records WHERE source = :source AND providerTrackId = :trackId "
                + "AND providerPartId = :partId AND lyricRevision = :lyricRevision")
        void delete(String source, String trackId, String partId, String lyricRevision);
    }
}
