package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.room.migration.Migration;
import androidx.room.testing.MigrationTestHelper;
import androidx.sqlite.db.SupportSQLiteDatabase;
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory;
import androidx.test.platform.app.InstrumentationRegistry;

import com.dazzlingwuming.listen2.data.Listen2Database;

import org.junit.Rule;
import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Opens the checked schema-1 baseline through Room's migration test path. */
public final class PlaybackMigrationInstrumentationTest {
    private static final String DATABASE_NAME = "listen2-schema-1-test";

    @Rule
    public final MigrationTestHelper helper = new MigrationTestHelper(
            InstrumentationRegistry.getInstrumentation(), Listen2Database.class.getCanonicalName(),
            new FrameworkSQLiteOpenHelperFactory());

    @Test
    public void schemaOneCreatesAllDurableTablesWithoutDestructiveFallback() throws Exception {
        SupportSQLiteDatabase database = helper.createDatabase(DATABASE_NAME, 1);
        database.execSQL("INSERT INTO playlists (playlistId, name, ordinal, createdAtMs, updatedAtMs)"
                + " VALUES ('playlist-1', 'Safe list', 0, 1, 1)");
        database.execSQL("INSERT INTO favorites (favoriteId, source, providerTrackId, addedAtMs)"
                + " VALUES ('favorite-1', 'bilibili', 'BV1xx411c7mD', 1)");
        database.execSQL("INSERT INTO lyric_metadata (lyricId, source, providerTrackId, language, updatedAtMs)"
                + " VALUES ('lyric-1', 'bilibili', 'BV1xx411c7mD', 'zh', 1)");
        database.execSQL("INSERT INTO listening_history (entryId, source, providerTrackId, listenedAtMs,"
                + " listenedDurationMs) VALUES ('history-1', 'bilibili', 'BV1xx411c7mD', 1, 1)");
        database.execSQL("INSERT INTO cache_catalog (cacheId, source, providerTrackId, contentKey, byteCount,"
                + " updatedAtMs) VALUES ('cache-1', 'bilibili', 'BV1xx411c7mD', 'content-1', 1, 1)");
        database.execSQL("INSERT INTO saf_references (referenceId, treeReference, documentReference,"
                + " updatedAtMs) VALUES ('saf-1', 'tree-1', 'document-1', 1)");
        assertNotNull(database.query("SELECT name FROM sqlite_master WHERE type='table'"
                + " AND name='playback_checkpoint'"));
        database.close();

        Migration[] migrations = new Migration[0];
        SupportSQLiteDatabase reopened = helper.runMigrationsAndValidate(DATABASE_NAME, 1, true, migrations);
        assertTrue(reopened.query("SELECT COUNT(*) FROM playlists").moveToFirst());
        reopened.close();
    }

    @Test
    public void schemaHasNoTransportOrCredentialColumns() throws Exception {
        SupportSQLiteDatabase database = helper.createDatabase("listen2-schema-scan", 1);
        Set<String> forbidden = new HashSet<>(Arrays.asList("url", "signedurl", "cookie", "header",
                "authorization", "password", "secret", "rawbody", "candidate"));
        String[] tables = {"playback_checkpoint", "playback_occurrences", "playback_history",
                "playlists", "playlist_tracks", "favorites", "lyric_metadata", "listening_history",
                "cache_catalog", "saf_references"};
        for (String table : tables) {
            android.database.Cursor cursor = database.query("PRAGMA table_info(`" + table + "`)");
            try {
                while (cursor.moveToNext()) {
                    assertFalse(table + " exposes a forbidden durable field: " + cursor.getString(1),
                            forbidden.contains(cursor.getString(1).toLowerCase()));
                }
            } finally {
                cursor.close();
            }
        }
        database.close();
    }
}
