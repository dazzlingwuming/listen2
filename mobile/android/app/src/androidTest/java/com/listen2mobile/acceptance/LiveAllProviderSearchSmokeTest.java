package com.listen2mobile.acceptance;

import android.app.Instrumentation;

/**
 * API-35, UI-only matrix for the five anonymous production search sources.
 * It accepts only the exact, visible upstream restrictions documented for
 * NetEase and Bilibili; every other source must visibly return a relevant
 * result for 青花瓷.
 */
public final class LiveAllProviderSearchSmokeTest {
    private static final String[] AVAILABLE_SOURCES = {
        "酷狗音乐",
        "酷我音乐",
        "QQ音乐",
        "哔哩哔哩",
    };

    private LiveAllProviderSearchSmokeTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("live-all-launch");
        driver.launchTarget();
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        driver.tapLabel("搜索");
        require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");

        progress.step("live-all-netease");
        driver.selectLiveSource("网易云音乐");
        driver.submitLiveSearch();
        driver.requireLiveNeteaseSearchOutcome();

        for (int index = 0; index < AVAILABLE_SOURCES.length; index++) {
            String source = AVAILABLE_SOURCES[index];
            // ScenarioProgress is intentionally limited to ASCII so that it
            // remains a bounded diagnostic channel. Keep the user-visible
            // source label out of that channel while preserving it for the
            // actual accessibility assertions below.
            progress.step("live-all-source-" + (index + 1));
            driver.selectLiveSource(source);
            driver.submitLiveSearch();
            if ("哔哩哔哩".equals(source)) {
                driver.requireLiveBilibiliSearchOutcome();
            } else {
                driver.requireLiveSearchResults(source);
            }
        }
        progress.step("live-all-capture");
        driver.captureLiveProviderEvidence();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
