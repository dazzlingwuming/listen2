package com.listen2mobile.acceptance;

import android.app.Instrumentation;

import java.util.List;

/**
 * Fixture-free Bilibili journey that follows the phone UI's required
 * video-result -> part -> player sequence.  The older search-only smoke could
 * never prove audio because it tried to play an unresolved video identity.
 */
public final class LiveBilibiliPlaybackMvSmokeTest {
    private LiveBilibiliPlaybackMvSmokeTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("bilibili-playback-launch");
        driver.launchTarget();
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        driver.tapLabel("搜索");
        require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
        progress.step("bilibili-playback-query");
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");
        driver.selectLiveSource("哔哩哔哩");
        driver.submitLiveSearch();
        List<String> titles = driver.requireLiveSearchResults("哔哩哔哩");
        progress.step("bilibili-part-selection");
        String partTitle = driver.openFirstBilibiliPart(titles.get(0));
        progress.step("bilibili-audio-progress");
        AccessibilityDriver.PlaybackProbe playback = driver.playBilibiliPart(partTitle);
        require(playback.verified, "bilibili-audio-" + playback.detail);
        driver.record("live-bilibili-audio=" + playback.detail);
        progress.step("bilibili-mv-progress");
        AccessibilityDriver.MvProbe mv = driver.openCurrentBilibiliMvAndRequireProgress();
        require(mv.verified, "bilibili-mv-" + mv.detail);
        driver.record("live-bilibili-mv=" + mv.detail);
        progress.step("bilibili-playback-capture");
        driver.captureLiveProviderEvidence();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
