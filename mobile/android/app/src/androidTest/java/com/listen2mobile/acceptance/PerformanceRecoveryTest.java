package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.os.Bundle;
import android.os.SystemClock;

/**
 * Platform-only observability probes used by the host performance runner.
 *
 * <p>The host owns the fixed 20-row timing ledger and all device mutations.
 * This runner intentionally has no provider bridge, application storage, or
 * AndroidX dependency: it merely proves that the release-like phone shell can
 * become visible and emits bounded, monotonic markers for the host record.</p>
 */
public final class PerformanceRecoveryTest {
    private static final int REQUIRED_ATTEMPTS = 20;

    private PerformanceRecoveryTest() {
    }

    public static void api35Full(Instrumentation instrumentation, ScenarioProgress progress, Bundle arguments) {
        requireInteger(arguments, "phase08Api", 35);
        requireInteger(arguments, "phase08Attempts", REQUIRED_ATTEMPTS);
        requireInteger(arguments, "phase08RecoveryCycles", 5);
        requireInteger(arguments, "phase08SoakSeconds", 600);
        observeVisibleShell(instrumentation, progress, "api35-full");
    }

    public static void compatibilityColdStart(Instrumentation instrumentation, ScenarioProgress progress, Bundle arguments) {
        int api = integerArgument(arguments, "phase08Api");
        if (api != 26 && api != 36) {
            throw new AssertionError("compatibility API must be 26 or 36");
        }
        requireInteger(arguments, "phase08Attempts", REQUIRED_ATTEMPTS);
        observeVisibleShell(instrumentation, progress, "compatibility-cold-start");
    }

    private static void observeVisibleShell(Instrumentation instrumentation, ScenarioProgress progress, String stage) {
        long started = SystemClock.elapsedRealtime();
        progress.step(stage + "-launch");
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        driver.launchTarget();
        progress.step(stage + "-shell");
        if (!driver.waitForLabel("搜索", 20_000L) || !driver.waitForLabel("我的", 5_000L)) {
            throw new AssertionError("phone shell did not become visibly interactive");
        }
        long elapsed = SystemClock.elapsedRealtime() - started;
        if (elapsed < 0L) {
            throw new AssertionError("monotonic clock moved backwards");
        }
        driver.record("performance-shell-ready-ms=" + elapsed);
        progress.step(stage + "-complete");
    }

    private static void requireInteger(Bundle arguments, String key, int expected) {
        if (integerArgument(arguments, key) != expected) {
            throw new AssertionError("unexpected " + key);
        }
    }

    private static int integerArgument(Bundle arguments, String key) {
        Object value = arguments.get(key);
        if (value instanceof Integer) {
            return (Integer) value;
        }
        if (value instanceof String) {
            try {
                return Integer.parseInt((String) value);
            } catch (NumberFormatException ignored) {
                // A malformed external runner argument remains a terminal assertion.
            }
        }
        return Integer.MIN_VALUE;
    }
}
