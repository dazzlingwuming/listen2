package com.listen2mobile.acceptance;

import android.app.Instrumentation;

import java.lang.reflect.InvocationTargetException;

/** Runs the bounded legacy/readback regression methods through the sealed platform-only runner. */
public final class LibraryMigrationReadbackTest {
    private static final String TEST_CLASS = "com.listen2mobile.library.LibraryMigrationTest";

    private LibraryMigrationReadbackTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        try {
            progress.step("readback-baseline-legacy");
            invoke("readback_ignores_unrelated_room_rows_before_and_after_legacy_copy");
            progress.step("readback-migrated-row");
            invoke("readback_keeps_source_when_a_migrated_record_changes");
            progress.step("readback-regression-complete");
        } catch (Exception error) {
            throw new IllegalStateException("library readback regression could not run", error);
        }
    }

    private static void invoke(String methodName) throws Exception {
        try {
            Object test = Class.forName(TEST_CLASS).getDeclaredConstructor().newInstance();
            Class.forName(TEST_CLASS).getMethod(methodName).invoke(test);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) {
                throw (Exception) cause;
            }
            if (cause instanceof Error) {
                throw (Error) cause;
            }
            throw new RuntimeException(cause);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("library readback test is unavailable", error);
        }
    }
}
