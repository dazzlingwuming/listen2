package com.listen2mobile.acceptance;

import android.app.Instrumentation;

/**
 * Runs only after UpgradeSeedTest has written the prior Redux Persist payload
 * and the product APK was replaced in place with `adb install -r`.
 */
public final class LegacyLibraryUpgradeTest {
    private LegacyLibraryUpgradeTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("legacy-upgrade-launch");
        driver.launchTarget();
        require(driver.waitForLabel("我的", 20_000L), "library tab was not visible after cold launch");
        progress.step("legacy-upgrade-durable-library");
        UpgradeSeedTest.assertMigratedLibrary(instrumentation.getTargetContext());
        progress.step("legacy-upgrade-visible-library");
        driver.assertLegacyLibraryVisibleWithoutRecoveryFailure();
        progress.step("legacy-upgrade-complete");
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
