package com.dazzlingwuming.listen2.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.ForeignKey;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/** Typed, migration-owned records reserved for later Android capability phases. */
public final class DurableRecordEntities {
    private DurableRecordEntities() {
    }

    @Entity(tableName = "playlists", indices = @Index(value = {"ordinal"}))
    public static final class PlaylistEntity {
        @PrimaryKey @NonNull public final String playlistId;
        @NonNull public final String name;
        public final int ordinal;
        public final long createdAtMs;
        public final long updatedAtMs;

        public PlaylistEntity(@NonNull String playlistId, @NonNull String name, int ordinal,
                long createdAtMs, long updatedAtMs) {
            this.playlistId = playlistId;
            this.name = name;
            this.ordinal = ordinal;
            this.createdAtMs = createdAtMs;
            this.updatedAtMs = updatedAtMs;
        }
    }

    @Entity(tableName = "playlist_tracks", primaryKeys = {"playlistId", "ordinal"}, foreignKeys = @ForeignKey(
            entity = PlaylistEntity.class, parentColumns = "playlistId", childColumns = "playlistId",
            onDelete = ForeignKey.CASCADE), indices = @Index(value = {"playlistId"}))
    public static final class PlaylistTrackEntity {
        @NonNull public final String playlistId;
        public final int ordinal;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;

        public PlaylistTrackEntity(@NonNull String playlistId, int ordinal, @NonNull String source,
                @NonNull String providerTrackId) {
            this.playlistId = playlistId;
            this.ordinal = ordinal;
            this.source = source;
            this.providerTrackId = providerTrackId;
        }
    }

    @Entity(tableName = "favorites", indices = @Index(value = {"source", "providerTrackId"}, unique = true))
    public static final class FavoriteEntity {
        @PrimaryKey @NonNull public final String favoriteId;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        public final long addedAtMs;

        public FavoriteEntity(@NonNull String favoriteId, @NonNull String source,
                @NonNull String providerTrackId, long addedAtMs) {
            this.favoriteId = favoriteId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.addedAtMs = addedAtMs;
        }
    }

    @Entity(tableName = "lyric_metadata", indices = @Index(value = {"source", "providerTrackId"}))
    public static final class LyricMetadataEntity {
        @PrimaryKey @NonNull public final String lyricId;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        @NonNull public final String language;
        public final long updatedAtMs;

        public LyricMetadataEntity(@NonNull String lyricId, @NonNull String source,
                @NonNull String providerTrackId, @NonNull String language, long updatedAtMs) {
            this.lyricId = lyricId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.language = language;
            this.updatedAtMs = updatedAtMs;
        }
    }

    @Entity(tableName = "listening_history", indices = @Index(value = {"source", "providerTrackId"}))
    public static final class ListeningHistoryEntity {
        @PrimaryKey @NonNull public final String entryId;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        public final long listenedAtMs;
        public final long listenedDurationMs;

        public ListeningHistoryEntity(@NonNull String entryId, @NonNull String source,
                @NonNull String providerTrackId, long listenedAtMs, long listenedDurationMs) {
            this.entryId = entryId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.listenedAtMs = listenedAtMs;
            this.listenedDurationMs = listenedDurationMs;
        }
    }

    @Entity(tableName = "cache_catalog", indices = @Index(value = {"source", "providerTrackId"}, unique = true))
    public static final class CacheCatalogEntity {
        @PrimaryKey @NonNull public final String cacheId;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        @NonNull public final String contentKey;
        public final long byteCount;
        public final long updatedAtMs;

        public CacheCatalogEntity(@NonNull String cacheId, @NonNull String source,
                @NonNull String providerTrackId, @NonNull String contentKey, long byteCount,
                long updatedAtMs) {
            this.cacheId = cacheId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.contentKey = contentKey;
            this.byteCount = byteCount;
            this.updatedAtMs = updatedAtMs;
        }
    }

    @Entity(tableName = "saf_references")
    public static final class SafReferenceEntity {
        @PrimaryKey @NonNull public final String referenceId;
        @NonNull public final String treeReference;
        @NonNull public final String documentReference;
        public final long updatedAtMs;

        public SafReferenceEntity(@NonNull String referenceId, @NonNull String treeReference,
                @NonNull String documentReference, long updatedAtMs) {
            this.referenceId = referenceId;
            this.treeReference = treeReference;
            this.documentReference = documentReference;
            this.updatedAtMs = updatedAtMs;
        }
    }
}
