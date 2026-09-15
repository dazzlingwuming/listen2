package com.listen2mobile.acceptance

import android.app.Instrumentation

/**
 * The diagnostic baseline may only seed state by exercising the installed UI.
 * It deliberately has no database, preference, file-system, or bridge backdoor.
 */
class UpgradeSeedTest private constructor() {
    companion object {
        fun run(instrumentation: Instrumentation) {
            val driver = AccessibilityDriver(instrumentation)
            driver.launchTarget()
            check(driver.waitForLabel("搜索", 20_000L)) { "search tab was not visible" }
            driver.tapLabel("搜索")
            check(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L)) { "search field was not visible" }
            driver.enterText("搜索歌曲、歌手或歌单", "青花瓷")
            driver.record("debug-seed-search-shell")
        }
    }
}
