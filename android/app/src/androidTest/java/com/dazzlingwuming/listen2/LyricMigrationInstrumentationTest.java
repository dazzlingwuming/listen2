package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.room.Room;
import androidx.room.testing.MigrationTestHelper;
import androidx.sqlite.db.SupportSQLiteDatabase;
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory;
import androidx.test.platform.app.InstrumentationRegistry;

import com.dazzlingwuming.listen2.data.Listen2Database;
import com.dazzlingwuming.listen2.data.LyricRepository;

import org.junit.Rule;
import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Non-destructive schema 1-to-4 migration proof using the checked Room assets. */
public final class LyricMigrationInstrumentationTest {
    private static final String DATABASE_NAME = "listen2-lyric-schema-1-test";

    @Rule
    public final MigrationTestHelper helper = new MigrationTestHelper(
            InstrumentationRegistry.getInstrumentation(), Listen2Database.class.getCanonicalName(),
            new FrameworkSQLiteOpenHelperFactory());

    @Test
    public void migratesSchemaOneToFourWithoutDroppingExistingMetadataAndPersistsLyrics() throws Exception {
        SupportSQLiteDatabase database = helper.createDatabase(DATABASE_NAME, 1);
        database.execSQL("INSERT INTO playlists (playlistId, name, ordinal, createdAtMs, updatedAtMs)"
                + " VALUES ('playlist-1', 'Safe list', 0, 1, 1)");
        database.execSQL("INSERT INTO lyric_metadata (lyricId, source, providerTrackId, language, updatedAtMs)"
                + " VALUES ('lyric-1', 'netease', '1001', 'zh', 1)");
        database.execSQL("INSERT INTO saf_references (referenceId, treeReference, documentReference, updatedAtMs)"
                + " VALUES ('saf-ambiguous', 'tree-1', 'document-1', 1)");
        database.execSQL("INSERT INTO saf_references (referenceId, treeReference, documentReference, updatedAtMs)"
                + " VALUES ('saf-tree', 'tree-2', '', 1)");
        database.execSQL("INSERT INTO saf_references (referenceId, treeReference, documentReference, updatedAtMs)"
                + " VALUES ('saf-document', '', 'document-2', 1)");
        database.close();

        SupportSQLiteDatabase migrated = helper.runMigrationsAndValidate(DATABASE_NAME, 4, true,
                Listen2Database.MIGRATION_1_2, Listen2Database.MIGRATION_2_3,
                Listen2Database.MIGRATION_3_4);
        assertEquals(1, count(migrated, "SELECT COUNT(*) FROM playlists"));
        assertEquals(1, count(migrated, "SELECT COUNT(*) FROM lyric_metadata"));
        assertEquals(1, count(migrated, "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
                + " AND name='lyric_records'"));
        assertEquals(1, count(migrated, "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
                + " AND name='local_settings'"));
        assertEquals(1, count(migrated, "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
                + " AND name='local_media_tracks'"));
        android.database.Cursor grants = migrated.query("SELECT grantKind, grantState, treeReference, "
                + "documentReference FROM saf_references WHERE referenceId = 'saf-ambiguous'");
        try {
            assertTrue(grants.moveToFirst());
            assertEquals("document", grants.getString(0));
            assertEquals("needs-repair", grants.getString(1));
            assertEquals("", grants.getString(2));
            assertEquals("", grants.getString(3));
        } finally {
            grants.close();
        }
        grants = migrated.query("SELECT grantKind, treeReference, documentReference FROM saf_references "
                + "WHERE referenceId = 'saf-tree'");
        try {
            assertTrue(grants.moveToFirst());
            assertEquals("tree", grants.getString(0));
            assertEquals("tree-2", grants.getString(1));
            assertEquals("", grants.getString(2));
        } finally {
            grants.close();
        }
        grants = migrated.query("SELECT grantKind, treeReference, documentReference FROM saf_references "
                + "WHERE referenceId = 'saf-document'");
        try {
            assertTrue(grants.moveToFirst());
            assertEquals("document", grants.getString(0));
            assertEquals("", grants.getString(1));
            assertEquals("document-2", grants.getString(2));
        } finally {
            grants.close();
        }
        migrated.close();

        Listen2Database reopened = Room.databaseBuilder(
                InstrumentationRegistry.getInstrumentation().getTargetContext(), Listen2Database.class,
                DATABASE_NAME).addMigrations(Listen2Database.MIGRATION_1_2,
                        Listen2Database.MIGRATION_2_3, Listen2Database.MIGRATION_3_4,
                        Listen2Database.MIGRATION_4_5)
                .allowMainThreadQueries().build();
        try {
            LyricRepository repository = new LyricRepository(reopened);
            LyricPersistencePort.Result saved = repository.execute(new LyricPersistencePort.Intent(
                    LyricPersistencePort.Operation.SET, "netease", "1001", "", "identity-1", 0L,
                    "migration-set", "source-1", 0L));
            assertEquals("accepted", saved.status);
            assertEquals("manual", repository.execute(new LyricPersistencePort.Intent(
                    LyricPersistencePort.Operation.GET, "netease", "1001", "", "identity-1", 1L,
                    "migration-get", null, 0L)).mode);
        } finally {
            reopened.close();
            InstrumentationRegistry.getInstrumentation().getTargetContext().deleteDatabase(DATABASE_NAME);
        }
    }

    @Test
    public void lyricSchemaExcludesTransportCredentialsAndPersonalPaths() throws Exception {
        SupportSQLiteDatabase database = helper.createDatabase("listen2-lyric-schema-scan", 2);
        Set<String> forbidden = new HashSet<>(Arrays.asList("url", "query", "signed", "cookie", "header",
                "authorization", "password", "secret", "token", "body", "error", "path"));
        android.database.Cursor cursor = database.query("PRAGMA table_info(`lyric_records`)");
        try {
            while (cursor.moveToNext()) {
                assertFalse("lyric schema exposes a forbidden durable field: " + cursor.getString(1),
                        forbidden.contains(cursor.getString(1).toLowerCase()));
            }
        } finally {
            cursor.close();
            database.close();
        }
    }

    private static int count(SupportSQLiteDatabase database, String query) {
        android.database.Cursor cursor = database.query(query);
        try {
            assertTrue(cursor.moveToFirst());
            return cursor.getInt(0);
        } finally {
            cursor.close();
        }
    }
}
