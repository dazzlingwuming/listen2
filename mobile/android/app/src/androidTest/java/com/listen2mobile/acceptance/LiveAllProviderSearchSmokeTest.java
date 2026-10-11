package com.listen2mobile.acceptance;

import android.app.Instrumentation;

/** UI-only five-source matrix; independent failures never promote the matrix to success. */
public final class LiveAllProviderSearchSmokeTest {
    private static final String[] SOURCES = {
        "网易云音乐", "酷狗音乐", "酷我音乐", "QQ音乐", "哔哩哔哩",
    };
    private static final String[] SOURCE_KEYS = {
        "netease", "kugou", "kuwo", "qq", "bilibili",
    };

    private LiveAllProviderSearchSmokeTest() {
    }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress) {
        AccessibilityDriver driver = new AccessibilityDriver(instrumentation);
        progress.step("live-all-launch");
        driver.launchTarget();
        require(driver.waitForLabel("搜索", 20_000L), "search tab was not visible");
        boolean failed = false;
        for (int index = 0; index < SOURCES.length; index++) {
            String source = SOURCES[index];
            String marker = "live-all-source-" + SOURCE_KEYS[index];
            String step = "search-tab";
            progress.step(marker + "-start");
            try {
                // Search errors remain on this tab. Restore only normal UI state;
                // selecting the next source cancels the prior request and clears its rows.
                driver.tapLabel("搜索");
                require(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L), "search field was not visible");
                step = "query";
                driver.enterText("搜索歌曲、歌手或歌单", "青花瓷");
                step = "source";
                driver.selectLiveSource(source);
                step = "submit";
                driver.submitLiveSearch();
                step = "outcome";
                if (index == 0) {
                    driver.requireLiveNeteaseSearchOutcome();
                } else if (index == SOURCES.length - 1) {
                    driver.requireLiveBilibiliSearchOutcome();
                } else {
                    driver.requireLiveSearchResults(source);
                }
                driver.record(marker + "-completed");
            } catch (AssertionError | RuntimeException error) {
                failed = true;
                // All values are closed source/stage/type constants. Never serialize
                // exception messages, stacks, visible titles or the UI tree here.
                String reason = error instanceof AssertionError ? "assertion" : "runtime";
                String failure = marker + "-failed-" + step + "-" + reason;
                progress.step(failure);
                driver.record(failure);
            }
        }
        progress.step("live-all-capture");
        try {
            driver.captureLiveProviderEvidence();
        } catch (AssertionError | RuntimeException error) {
            failed = true;
            driver.record("live-all-capture-failed");
        }
        if (failed) {
            progress.step("live-all-aggregate-failed");
            throw new AssertionError("live-all-provider-matrix-failed");
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
