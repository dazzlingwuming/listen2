package com.listen2mobile.acceptance;

import android.app.Instrumentation;

import java.util.List;

/**
 * Fixture-free UI-only proof for the two anonymous production search routes.
 * It deliberately fails closed for empty/error/guide search states. Playback
 * remains NOT_VERIFIED when an actual provider result is access-controlled.
 */
public final class LiveProviderSmokeTest {
    private LiveProviderSmokeTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("live-launch");
        driver.launchTarget();
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        driver.tapLabel("搜索");
        require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
        progress.step("live-query");
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");
        driver.submitLiveSearch();
        progress.step("live-netease-results");
        List<String> neteaseTitles = driver.requireLiveSearchResults("网易云音乐");
        progress.step("live-bilibili-results");
        driver.tapLabel("哔哩哔哩");
        driver.requireLiveSearchResults("哔哩哔哩");
        progress.step("live-anonymous-playback");
        driver.tapLabel("网易云音乐");
        AccessibilityDriver.PlaybackProbe playback = driver.attemptNativePlayback(neteaseTitles.get(0));
        driver.record("live-playback=" + (playback.verified ? "PASS-" : "NOT_VERIFIED-") + playback.detail);
        progress.step("live-capture");
        driver.captureLiveProviderEvidence();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
