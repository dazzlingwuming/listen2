package com.listen2mobile.acceptance

import android.app.Instrumentation

/** Black-box release-like acceptance: all observations come from the phone UI. */
class IntegratedJourneyTest private constructor() {
    companion object {
        fun run(instrumentation: Instrumentation) {
            val driver = AccessibilityDriver(instrumentation)
            driver.launchTarget()
            check(driver.waitForLabel("搜索", 20_000L)) { "search tab was not visible" }
            driver.tapLabel("搜索")
            check(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L)) { "search field was not visible" }
            driver.assertFiveSourceTabs()
            driver.enterText("搜索歌曲、歌手或歌单", "青花瓷")
            driver.tapLabel("搜索音乐")
            driver.assertSearchTerminal("网易")
            driver.tapLabel("Bilibili")
            driver.assertSearchTerminal("Bilibili")
            driver.exerciseVisibleSafeDomains()
            driver.captureForegroundEvidence()
        }
    }
}
