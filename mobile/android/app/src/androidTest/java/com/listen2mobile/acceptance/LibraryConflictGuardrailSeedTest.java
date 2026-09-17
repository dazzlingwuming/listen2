package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.ContentValues;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;

/** Seeds the durable pre-existing row before an externally forced cold restart. */
public final class LibraryConflictGuardrailSeedTest {
    private LibraryConflictGuardrailSeedTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        Context context = instrumentation.getTargetContext();
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("legacy-conflict-prime-room");
        driver.launchTarget();
        require(driver.waitForLabel("我的", 20_000L), "empty library shell was not visible");
        putExistingFavorite(context);
        UpgradeSeedTest.seedLegacyLibrary(context);
        UpgradeSeedTest.assertLegacySeedPresent(context);
        progress.step("legacy-conflict-seeded");
    }

    private static void putExistingFavorite(Context context) {
        SQLiteDatabase database = SQLiteDatabase.openDatabase(
            context.getDatabasePath("listen2-library-01.db").getPath(), null, SQLiteDatabase.OPEN_READWRITE
        );
        try {
            ContentValues values = new ContentValues();
            values.put("source", "netease");
            values.put("semanticTrackId", UpgradeSeedTest.TRACK_ID);
            values.put("title", "手机收藏");
            values.put("artist", "手机歌手");
            database.insertOrThrow("favorites", null, values);
        } finally {
            database.close();
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
