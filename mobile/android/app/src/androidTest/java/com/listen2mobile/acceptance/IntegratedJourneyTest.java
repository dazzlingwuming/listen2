package com.listen2mobile.acceptance;

import android.app.Instrumentation;

/** Black-box release-like acceptance: all observations come from the phone UI. */
public final class IntegratedJourneyTest {
    private IntegratedJourneyTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("journey-launch");
        driver.launchTarget();
        progress.step("journey-library-upgrade");
        driver.assertLegacyLibraryVisibleWithoutRecoveryFailure();
        progress.step("journey-search-tab");
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        driver.tapLabel("搜索");
        progress.step("journey-search-input");
        require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
        driver.assertFiveSourceTabs();
        progress.step("journey-query");
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");
        driver.tapLabel("搜索音乐");
        progress.step("journey-netease-terminal");
        driver.assertSearchTerminal("网易");
        driver.tapLabel("哔哩哔哩");
        progress.step("journey-bilibili-terminal");
        driver.assertSearchTerminal("哔哩哔哩");
        driver.exerciseVisibleSafeDomains();
        progress.step("journey-capture");
        driver.captureForegroundEvidence();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
