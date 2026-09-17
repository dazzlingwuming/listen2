package com.listen2mobile

import com.facebook.react.ReactApplication
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MainApplicationHostContractTest {
    @Test
    fun `compatibility and bridgeless host getters use one runtime contract`() {
        val packages = listOf("autolinked", "bilibili", "track-player")

        assertSame(packages, ReactRuntimeContract.sharedPackages(packages))
        assertEquals("index", ReactRuntimeContract.JS_MAIN_MODULE)
        assertEquals("index.android.bundle", ReactRuntimeContract.JS_BUNDLE_ASSET)
        assertTrue(ReactApplication::class.java.isAssignableFrom(MainApplication::class.java))

        val getters = MainApplication::class.java.methods.map { it.name }.toSet()
        assertTrue(getters.contains("getReactNativeHost"))
        assertTrue(getters.contains("getReactHost"))

        val source = mainApplicationSource()
        assertTrue(source.contains("DefaultReactNativeHost(this@MainApplication)"))
        assertTrue(source.contains("reactNativeHost = reactNativeHost"))
    }

    private fun mainApplicationSource(): String {
        var directory = File(System.getProperty("user.dir"))
        repeat(6) {
            val candidate = File(directory, "app/src/main/java/com/listen2mobile/MainApplication.kt")
            if (candidate.isFile) return candidate.readText()
            directory = directory.parentFile ?: return@repeat
        }
        error("MainApplication.kt was not found from the Gradle working directory")
    }
}
