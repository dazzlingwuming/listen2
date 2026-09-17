package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

/** Exercises a real native collision without allowing the legacy row to overwrite it. */
public final class LibraryConflictGuardrailTest {
    private LibraryConflictGuardrailTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        Context context = instrumentation.getTargetContext();
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("legacy-conflict-recovery");
        driver.launchTarget();
        require(driver.waitForLabel("我的", 20_000L), "library shell was not visible after collision recovery");
        requireEquals("手机收藏", favoriteTitle(context), "legacy collision overwrote the existing favorite");
        UpgradeSeedTest.assertLegacySeedPresent(context);
        progress.step("legacy-conflict-guardrail-complete");
    }

    private static String favoriteTitle(Context context) {
        SQLiteDatabase database = SQLiteDatabase.openDatabase(
            context.getDatabasePath("listen2-library-01.db").getPath(), null, SQLiteDatabase.OPEN_READONLY
        );
        try (Cursor cursor = database.rawQuery(
            "SELECT title FROM favorites WHERE source = ? AND semanticTrackId = ?", new String[] { "netease", UpgradeSeedTest.TRACK_ID }
        )) {
            require(cursor.moveToFirst(), "existing favorite was removed during collision recovery");
            return cursor.getString(0);
        } finally {
            database.close();
        }
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
