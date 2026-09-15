package com.listen2mobile.acceptance

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test

/** Black-box release-like acceptance: all observations come from the phone UI. */
class IntegratedJourneyTest {
    @Test
    fun completesTheRecordedProductionRouteJourney() {
        val driver = AccessibilityDriver(InstrumentationRegistry.getInstrumentation())
        driver.launchTarget()
        assertTrue(driver.waitForLabel("搜索", 20_000L))
        driver.tapLabel("搜索")
        assertTrue(driver.waitForLabel("搜索歌曲、歌手或歌单", 10_000L))
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
