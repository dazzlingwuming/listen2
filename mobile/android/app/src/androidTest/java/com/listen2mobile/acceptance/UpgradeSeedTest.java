package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Seeds the exact Redux Persist/AsyncStorage format written by the prior app.
 * The upgrade runner installs a prior signed APK first; this fixture then adds
 * bounded user-library rows directly to that APK's actual durable store before
 * `adb install -r` moves the same package to the candidate build.
 */
public final class UpgradeSeedTest {
    static final String PLAYLIST_ID = "upgrade-road";
    static final String PLAYLIST_TITLE = "迁移验收歌单";
    static final String TRACK_ID = "upgrade-track";
    static final String TRACK_TITLE = "迁移验收曲目";
    static final String TRACK_ARTIST = "迁移验收歌手";
    static final String LOCAL_TITLE = "迁移本地引用";
    static final String LOCAL_ARTIST = "迁移本地歌手";
    private static final String ASYNC_STORAGE_DATABASE = "AsyncStorage";
    private static final String LEGACY_LIBRARY_KEY = "persist:listen2-mobile-library";
    private static final String LEGACY_PLAYER_KEY = "persist:listen2-mobile";
    private static final String LEGACY_LIBRARY_VALUE = legacyLibraryValue();

    private UpgradeSeedTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        progress.step("seed-legacy-async-storage");
        seedLegacyLibrary(instrumentation.getTargetContext());
        progress.step("seed-legacy-verified");
        assertLegacySeedPresent(instrumentation.getTargetContext());
        progress.step("seed-complete");
    }

    static void assertMigratedLibrary(Context context) {
        SQLiteDatabase database = SQLiteDatabase.openDatabase(
            context.getDatabasePath("listen2-library-01.db").getPath(),
            null,
            SQLiteDatabase.OPEN_READONLY
        );
        try {
            requireEquals(PLAYLIST_TITLE, singleString(database,
                "SELECT title FROM personal_playlists WHERE playlistId = ?", PLAYLIST_ID),
                "migrated playlist title changed");
            requireEquals(TRACK_ID, singleString(database,
                "SELECT semanticTrackId FROM playlist_memberships WHERE playlistId = ?", PLAYLIST_ID),
                "migrated playlist membership missing");
            requireEquals(TRACK_TITLE, singleString(database,
                "SELECT title FROM favorites WHERE source = ? AND semanticTrackId = ?", "netease", TRACK_ID),
                "migrated favorite missing");
            requireEquals("upgrade-queue", singleString(database,
                "SELECT occurrenceId FROM queue_checkpoint WHERE occurrenceId = ?", "upgrade-queue"),
                "migrated queue checkpoint missing");
            requireEquals("legacy-lyric", singleString(database,
                "SELECT selectedVariantId FROM lyric_metadata WHERE source = ? AND semanticTrackId = ?", "netease", TRACK_ID),
                "migrated lyric metadata missing");
            requireEquals(LOCAL_TITLE, singleString(database,
                "SELECT title FROM local_records WHERE title = ?", LOCAL_TITLE),
                "migrated local reference missing");
            requireEquals("needs-repair", singleString(database,
                "SELECT accessState FROM local_records WHERE title = ?", LOCAL_TITLE),
                "migrated local reference was not safely downgraded");
            requireEquals("validated", singleString(database,
                "SELECT phase FROM migration_journal LIMIT 1"),
                "migration journal did not validate the copy");
        } finally {
            database.close();
        }
        assertLegacySeedPresent(context);
    }

    static void seedLegacyLibrary(Context context) {
        SQLiteDatabase database = context.openOrCreateDatabase(ASYNC_STORAGE_DATABASE, Context.MODE_PRIVATE, null);
        try {
            database.execSQL("CREATE TABLE IF NOT EXISTS Storage (`key` TEXT NOT NULL, `value` TEXT, PRIMARY KEY(`key`))");
            put(database, LEGACY_LIBRARY_KEY, LEGACY_LIBRARY_VALUE);
            put(database, LEGACY_PLAYER_KEY, "{\"_persist\":\"{\\\"version\\\":1,\\\"rehydrated\\\":true}\"}");
        } finally {
            database.close();
        }
    }

    static void assertLegacySeedPresent(Context context) {
        SQLiteDatabase database = SQLiteDatabase.openDatabase(
            context.getDatabasePath(ASYNC_STORAGE_DATABASE).getPath(),
            null,
            SQLiteDatabase.OPEN_READONLY
        );
        try {
            requireEquals(LEGACY_LIBRARY_VALUE, singleString(database,
                "SELECT value FROM Storage WHERE `key` = ?", LEGACY_LIBRARY_KEY),
                "legacy source was changed or removed");
        } finally {
            database.close();
        }
    }

    private static void put(SQLiteDatabase database, String key, String value) {
        ContentValues values = new ContentValues();
        values.put("key", key);
        values.put("value", value);
        require(database.insertWithOnConflict("Storage", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L,
            "could not write legacy source fixture");
    }

    private static String singleString(SQLiteDatabase database, String query, String... arguments) {
        try (Cursor cursor = database.rawQuery(query, arguments)) {
            require(cursor.moveToFirst(), "expected durable row was absent");
            return cursor.getString(0);
        }
    }

    private static String legacyLibraryValue() {
        try {
            JSONObject track = track();
            JSONObject playlist = new JSONObject()
                .put("id", PLAYLIST_ID)
                .put("title", PLAYLIST_TITLE)
                .put("tracks", new JSONArray().put(track));
            JSONObject queue = new JSONObject()
                .put("occurrenceId", "upgrade-queue")
                .put("source", "netease")
                .put("id", TRACK_ID);
            JSONObject lyric = new JSONObject()
                .put("source", "netease")
                .put("id", TRACK_ID)
                .put("selectedVariantId", "legacy-lyric")
                .put("offsetMillis", 120);
            JSONObject local = new JSONObject()
                .put("title", LOCAL_TITLE)
                .put("artist", LOCAL_ARTIST)
                .put("contentUri", "content://fixture/not-exported");
            JSONObject root = new JSONObject();
            root.put("favorites", new JSONArray().put(track).toString());
            root.put("recentTracks", "[]");
            root.put("playlists", new JSONArray().put(playlist).toString());
            root.put("localTracks", new JSONArray().put(local).toString());
            root.put("remoteCollections", new JSONArray().put(new JSONObject()
                .put("id", "upgrade-remote")
                .put("source", "netease")
                .put("title", "迁移来源歌单")
                .put("syncState", "ready")).toString());
            root.put("queueCheckpoint", new JSONArray().put(queue).toString());
            root.put("lyricMetadata", new JSONArray().put(lyric).toString());
            root.put("_persist", "{\"version\":1,\"rehydrated\":true}");
            return root.toString();
        } catch (Exception error) {
            throw new AssertionError("could not create legacy migration fixture", error);
        }
    }

    private static JSONObject track() throws Exception {
        return new JSONObject()
            .put("source", "netease")
            .put("id", TRACK_ID)
            .put("title", TRACK_TITLE)
            .put("artist", TRACK_ARTIST);
    }

    private static void requireEquals(String expected, String actual, String message) {
        require(expected.equals(actual), message);
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
