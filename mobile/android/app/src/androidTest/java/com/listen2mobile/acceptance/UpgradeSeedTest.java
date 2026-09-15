package com.listen2mobile.acceptance;

import android.app.Instrumentation;

/** Seeds the upgrade baseline through the visible shell only. */
public final class UpgradeSeedTest {
    private UpgradeSeedTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("seed-launch");
        driver.launchTarget();
        progress.step("seed-search-tab");
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        driver.tapLabel("搜索");
        progress.step("seed-search-input");
        require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");
        progress.step("seed-complete");
        driver.record("debug-seed-search-shell");
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
