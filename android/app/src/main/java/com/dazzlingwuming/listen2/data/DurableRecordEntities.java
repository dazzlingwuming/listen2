package com.dazzlingwuming.listen2.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.ColumnInfo;
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
        @NonNull @ColumnInfo(defaultValue = "'custom'") public final String kind;
        @ColumnInfo(defaultValue = "0") public final long revision;

        public PlaylistEntity(@NonNull String playlistId, @NonNull String name, int ordinal,
                long createdAtMs, long updatedAtMs, @NonNull String kind, long revision) {
            this.playlistId = playlistId;
            this.name = name;
            this.ordinal = ordinal;
            this.createdAtMs = createdAtMs;
            this.updatedAtMs = updatedAtMs;
            this.kind = kind;
            this.revision = revision;
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
        @NonNull @ColumnInfo(defaultValue = "''") public final String title;
        @NonNull @ColumnInfo(defaultValue = "''") public final String artist;
        @ColumnInfo(defaultValue = "0") public final long durationMs;

        public PlaylistTrackEntity(@NonNull String playlistId, int ordinal, @NonNull String source,
                @NonNull String providerTrackId, @NonNull String title, @NonNull String artist,
                long durationMs) {
            this.playlistId = playlistId;
            this.ordinal = ordinal;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.title = title;
            this.artist = artist;
            this.durationMs = durationMs;
        }
    }

    @Entity(tableName = "favorites", indices = @Index(value = {"source", "providerTrackId"}, unique = true))
    public static final class FavoriteEntity {
        @PrimaryKey @NonNull public final String favoriteId;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        public final long addedAtMs;
        @NonNull @ColumnInfo(defaultValue = "''") public final String title;
        @NonNull @ColumnInfo(defaultValue = "''") public final String artist;

        public FavoriteEntity(@NonNull String favoriteId, @NonNull String source,
                @NonNull String providerTrackId, long addedAtMs, @NonNull String title,
                @NonNull String artist) {
            this.favoriteId = favoriteId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.addedAtMs = addedAtMs;
            this.title = title;
            this.artist = artist;
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

    @Entity(tableName = "listening_history", indices = {@Index(value = {"source", "providerTrackId"}),
            @Index(value = {"sessionId"})})
    public static final class ListeningHistoryEntity {
        @PrimaryKey @NonNull public final String entryId;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        public final long listenedAtMs;
        public final long listenedDurationMs;
        @NonNull @ColumnInfo(defaultValue = "''") public final String sessionId;
        @ColumnInfo(defaultValue = "0") public final long cumulativePlayedMs;
        @ColumnInfo(defaultValue = "0") public final boolean qualified;
        @NonNull @ColumnInfo(defaultValue = "''") public final String title;
        @NonNull @ColumnInfo(defaultValue = "''") public final String artist;

        public ListeningHistoryEntity(@NonNull String entryId, @NonNull String source,
                @NonNull String providerTrackId, long listenedAtMs, long listenedDurationMs,
                @NonNull String sessionId, long cumulativePlayedMs, boolean qualified,
                @NonNull String title, @NonNull String artist) {
            this.entryId = entryId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.listenedAtMs = listenedAtMs;
            this.listenedDurationMs = listenedDurationMs;
            this.sessionId = sessionId;
            this.cumulativePlayedMs = cumulativePlayedMs;
            this.qualified = qualified;
            this.title = title;
            this.artist = artist;
        }
    }

    @Entity(tableName = "cache_catalog", indices = {@Index(value = {"source", "providerTrackId"}, unique = true),
            @Index(value = {"lastAccessedAtMs"})})
    public static final class CacheCatalogEntity {
        @PrimaryKey @NonNull public final String cacheId;
        @NonNull public final String source;
        @NonNull public final String providerTrackId;
        @NonNull public final String contentKey;
        public final long byteCount;
        public final long updatedAtMs;
        @NonNull @ColumnInfo(defaultValue = "'temporary'") public final String retention;
        @NonNull @ColumnInfo(defaultValue = "'ready'") public final String state;
        @ColumnInfo(defaultValue = "0") public final long lastAccessedAtMs;
        @NonNull @ColumnInfo(defaultValue = "'unknown'") public final String integrity;

        public CacheCatalogEntity(@NonNull String cacheId, @NonNull String source,
                @NonNull String providerTrackId, @NonNull String contentKey, long byteCount,
                long updatedAtMs, @NonNull String retention, @NonNull String state,
                long lastAccessedAtMs, @NonNull String integrity) {
            this.cacheId = cacheId;
            this.source = source;
            this.providerTrackId = providerTrackId;
            this.contentKey = contentKey;
            this.byteCount = byteCount;
            this.updatedAtMs = updatedAtMs;
            this.retention = retention;
            this.state = state;
            this.lastAccessedAtMs = lastAccessedAtMs;
            this.integrity = integrity;
        }
    }

    @Entity(tableName = "saf_references")
    public static final class SafReferenceEntity {
        @PrimaryKey @NonNull public final String referenceId;
        @NonNull public final String treeReference;
        @NonNull public final String documentReference;
        public final long updatedAtMs;
        @NonNull @ColumnInfo(defaultValue = "''") public final String displayName;
        @NonNull @ColumnInfo(defaultValue = "'needs-repair'") public final String grantState;
        @NonNull @ColumnInfo(defaultValue = "'document'") public final String grantKind;

        public SafReferenceEntity(@NonNull String referenceId, @NonNull String treeReference,
                @NonNull String documentReference, long updatedAtMs, @NonNull String displayName,
                @NonNull String grantState, @NonNull String grantKind) {
            this.referenceId = referenceId;
            this.treeReference = treeReference;
            this.documentReference = documentReference;
            this.updatedAtMs = updatedAtMs;
            this.displayName = displayName;
            this.grantState = grantState;
            this.grantKind = grantKind;
        }
    }

    /** Native catalog. documentReference is never projected by LocalDataRepository views. */
    @Entity(tableName = "local_media_tracks", indices = {
            @Index(value = {"grantReferenceId"}),
            @Index(value = {"opaqueReference"}, unique = true)
    })
    public static final class LocalMediaTrackEntity {
        @PrimaryKey @NonNull public final String localTrackId;
        @NonNull public final String grantReferenceId;
        @NonNull public final String opaqueReference;
        @NonNull public final String documentReference;
        @NonNull public final String displayName;
        @NonNull public final String mimeType;
        public final long byteCount;
        public final long durationMs;
        @NonNull public final String title;
        @NonNull public final String artist;
        public final boolean embeddedCover;
        public final boolean adjacentLrc;
        @NonNull public final String availability;
        public final long scannedAtMs;

        public LocalMediaTrackEntity(@NonNull String localTrackId, @NonNull String grantReferenceId,
                @NonNull String opaqueReference, @NonNull String documentReference,
                @NonNull String displayName, @NonNull String mimeType, long byteCount,
                long durationMs, @NonNull String title, @NonNull String artist,
                boolean embeddedCover, boolean adjacentLrc, @NonNull String availability,
                long scannedAtMs) {
            this.localTrackId = localTrackId;
            this.grantReferenceId = grantReferenceId;
            this.opaqueReference = opaqueReference;
            this.documentReference = documentReference;
            this.displayName = displayName;
            this.mimeType = mimeType;
            this.byteCount = byteCount;
            this.durationMs = durationMs;
            this.title = title;
            this.artist = artist;
            this.embeddedCover = embeddedCover;
            this.adjacentLrc = adjacentLrc;
            this.availability = availability;
            this.scannedAtMs = scannedAtMs;
        }
    }

    /** Small non-sensitive values only. Secrets must remain behind a platform-keystore boundary. */
    @Entity(tableName = "local_settings")
    public static final class SettingEntity {
        @PrimaryKey @NonNull public final String settingKey;
        @NonNull public final String settingValue;
        public final long updatedAtMs;

        public SettingEntity(@NonNull String settingKey, @NonNull String settingValue, long updatedAtMs) {
            this.settingKey = settingKey;
            this.settingValue = settingValue;
            this.updatedAtMs = updatedAtMs;
        }
    }
}
