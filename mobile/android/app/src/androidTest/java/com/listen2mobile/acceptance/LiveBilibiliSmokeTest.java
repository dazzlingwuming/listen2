package com.listen2mobile.acceptance;

import android.app.Instrumentation;

import java.util.List;

/** Fixture-free Bilibili-only lane; it deliberately does not contact NetEase. */
public final class LiveBilibiliSmokeTest {
    private LiveBilibiliSmokeTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("live-bilibili-launch");
        driver.launchTarget();
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        driver.tapLabel("搜索");
        require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
        progress.step("live-bilibili-query");
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");
        driver.tapLabel("哔哩哔哩");
        driver.submitLiveSearch();
        progress.step("live-bilibili-results");
        List<String> titles = driver.requireLiveSearchResults("哔哩哔哩");
        progress.step("live-bilibili-anonymous-playback");
        AccessibilityDriver.PlaybackProbe playback = driver.attemptNativePlayback(titles.get(0));
        driver.record("live-playback=" + (playback.verified ? "PASS-" : "NOT_VERIFIED-") + playback.detail);
        progress.step("live-bilibili-capture");
        driver.captureLiveProviderEvidence();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
