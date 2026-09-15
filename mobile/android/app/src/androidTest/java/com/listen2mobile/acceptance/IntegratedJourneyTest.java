package com.listen2mobile.acceptance;

import android.app.Instrumentation;

/** Black-box release-like acceptance: all observations come from the phone UI. */
public final class IntegratedJourneyTest {
    private IntegratedJourneyTest() {
    }

    public static void run(Instrumentation instrumentation) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        driver.launchTarget();
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        driver.tapLabel("搜索");
        require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
        driver.assertFiveSourceTabs();
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");
        driver.tapLabel("搜索音乐");
        driver.assertSearchTerminal("网易");
        driver.tapLabel("Bilibili");
        driver.assertSearchTerminal("Bilibili");
        driver.exerciseVisibleSafeDomains();
        driver.captureForegroundEvidence();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
