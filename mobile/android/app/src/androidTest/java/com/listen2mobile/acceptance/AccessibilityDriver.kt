package com.listen2mobile.acceptance

import android.app.Instrumentation
import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.util.Log
import java.io.FileInputStream
import java.util.regex.Pattern

/**
 * A deliberately small UiAutomation adapter. It observes only accessibility
 * text/content descriptions and derives taps from the current visible bounds;
 * it has no application database, bridge, transport, or credential access.
 */
class AccessibilityDriver(private val instrumentation: Instrumentation) {
    private val targetPackage = "com.dazzlingwuming.listen2"

    fun launchTarget() {
        val intent = instrumentation.targetContext.packageManager
            .getLaunchIntentForPackage(targetPackage)
            ?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            ?: throw AssertionError("target launch intent is unavailable")
        instrumentation.targetContext.startActivity(intent)
        instrumentation.waitForIdleSync()
    }

    fun waitForLabel(label: String, timeoutMs: Long): Boolean {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            if (dumpWindow().contains(label)) return true
            SystemClock.sleep(250)
        }
        return false
    }

    fun tapLabel(label: String) {
        val node = nodeFor(label) ?: throw AssertionError("missing visible control: $label")
        val bounds = Rect().also { rect ->
            val parts = node.split(",").map(String::toInt)
            rect.set(parts[0], parts[1], parts[2], parts[3])
        }
        shell("input tap ${bounds.centerX()} ${bounds.centerY()}")
        instrumentation.waitForIdleSync()
    }

    fun enterText(label: String, value: String) {
        tapLabel(label)
        // The fixed acceptance query is not caller supplied. Input remains a
        // normal visible IME event rather than a JS/native data injection.
        shell("input text ${shellText(value)}")
        instrumentation.waitForIdleSync()
    }

    fun assertFiveSourceTabs() {
        listOf("网易云音乐", "酷狗音乐", "酷我音乐", "QQ音乐", "哔哩哔哩").forEach { label ->
            check(waitForLabel(label, 5_000L)) { "missing source tab: $label" }
        }
    }

    fun assertSearchTerminal(source: String) {
        check(waitForLabel("青花瓷", 8_000L)) { "query did not remain visible for $source" }
        val deadline = SystemClock.elapsedRealtime() + 15_000L
        while (SystemClock.elapsedRealtime() < deadline) {
            val view = dumpWindow()
            if (!view.contains("正在搜索") &&
                (view.contains("还没有搜索结果") || view.contains("暂时无法完成") ||
                    view.contains("重试搜索") || view.contains("播放") || view.contains("下一首"))) {
                record("terminal-$source")
                return
            }
            SystemClock.sleep(300)
        }
        throw AssertionError("no truthful terminal search state for $source")
    }

    fun exerciseVisibleSafeDomains() {
        tapLabel("我的")
        check(waitForLabel("打开听歌历史与年度回响", 8_000L)) { "library shell unavailable" }
        tapLabel("设置")
        check(waitForLabel("打开账号与来源", 8_000L)) { "settings shell unavailable" }
        check(waitForLabel("设置或替换 DeepSeek API key", 8_000L)) { "consent control unavailable" }
        record("library-settings-navigation")
    }

    /** Captured while the target Activity is foreground, before test teardown. */
    fun captureForegroundEvidence() {
        shell("uiautomator dump /sdcard/listen2-phase8-integrated.xml >/dev/null")
        shell("screencap -p /sdcard/listen2-phase8-integrated.png")
    }

    fun record(event: String) = Log.i("Listen2Acceptance", "acceptance-event=$event")

    private fun nodeFor(label: String): String? {
        val escaped = Pattern.quote(label)
        val expression = Regex("(?:text|content-desc)=\\\"$escaped\\\"[^>]*bounds=\\\"\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]\\\"")
        return expression.find(dumpWindow())?.groupValues?.drop(1)?.joinToString(",")
    }

    private fun dumpWindow(): String {
        shell("uiautomator dump /sdcard/listen2-acceptance-window.xml >/dev/null")
        return shell("cat /sdcard/listen2-acceptance-window.xml")
    }

    private fun shell(command: String): String {
        val descriptor = instrumentation.uiAutomation.executeShellCommand(command)
        return descriptor.use { FileInputStream(it.fileDescriptor).bufferedReader().use { reader -> reader.readText() } }
    }

    private fun shellText(value: String): String {
        check(value == "青花瓷") { "only fixed sanitized fixture text is allowed" }
        return "'青花瓷'"
    }
}
