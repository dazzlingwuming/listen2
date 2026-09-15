package com.listen2mobile.acceptance

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The diagnostic baseline may only seed state by exercising the installed UI.
 * It deliberately has no database, preference, file-system, or bridge backdoor.
 */
class UpgradeSeedTest {
    @Test
    fun seedsAnEmptyBaselineThroughTheVisibleShell() {
        val driver = AccessibilityDriver(InstrumentationRegistry.getInstrumentation())
        driver.launchTarget()
        assertTrue(driver.waitForLabel("搜索", 20_000L))
        driver.tapLabel("搜索")
        assertTrue(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L))
        driver.enterText("搜索歌曲、歌手或歌单", "青花瓷")
        driver.record("debug-seed-search-shell")
    }
}
