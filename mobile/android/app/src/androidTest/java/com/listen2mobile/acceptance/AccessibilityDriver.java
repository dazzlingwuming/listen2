package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deliberately small UiAutomation adapter: it only uses visible accessibility
 * content and normal visible input events, never app storage or a data bridge.
 */
public final class AccessibilityDriver {
    private static final String TARGET_PACKAGE = "com.dazzlingwuming.listen2";
    private static final int MAX_NODES_PER_DUMP = 800;
    private static final int MAX_DUMP_DEPTH = 40;
    private static final int MAX_ATTRIBUTE_LENGTH = 512;

    private final Instrumentation instrumentation;

    AccessibilityDriver(Instrumentation instrumentation) {
        this.instrumentation = instrumentation;
    }

    void launchTarget() {
        Intent intent = instrumentation.getTargetContext().getPackageManager()
            .getLaunchIntentForPackage(TARGET_PACKAGE);
        if (intent == null) {
            throw new AssertionError("target launch intent is unavailable");
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        instrumentation.getTargetContext().startActivity(intent);
        instrumentation.waitForIdleSync();
    }

    boolean waitForLabel(String label, long timeoutMillis) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (dumpWindow().contains(label)) {
                return true;
            }
            SystemClock.sleep(250L);
        }
        return false;
    }

    void tapLabel(String label) {
        String node = nodeFor(label);
        if (node == null) {
            throw new AssertionError("missing visible control: " + label);
        }
        String[] parts = node.split(",");
        Rect bounds = new Rect(
            Integer.parseInt(parts[0]), Integer.parseInt(parts[1]),
            Integer.parseInt(parts[2]), Integer.parseInt(parts[3])
        );
        shell("input tap " + bounds.centerX() + " " + bounds.centerY());
        instrumentation.waitForIdleSync();
    }

    void enterText(String label, String value) {
        tapLabel(label);
        shell("input text " + shellText(value));
        instrumentation.waitForIdleSync();
    }

    void assertFiveSourceTabs() {
        String[] labels = { "网易云音乐", "酷狗音乐", "酷我音乐", "QQ音乐", "哔哩哔哩" };
        for (String label : labels) {
            require(waitForLabel(label, 5_000L), "missing source tab: " + label);
        }
    }

    void assertSearchTerminal(String source) {
        require(waitForLabel("青花瓷", 8_000L), "query did not remain visible for " + source);
        long deadline = SystemClock.elapsedRealtime() + 15_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            String view = dumpWindow();
            if (!view.contains("正在搜索") &&
                (view.contains("还没有搜索结果") || view.contains("暂时无法完成") ||
                    view.contains("重试搜索") || view.contains("播放") || view.contains("下一首"))) {
                record("terminal-" + source);
                return;
            }
            SystemClock.sleep(300L);
        }
        throw new AssertionError("no truthful terminal search state for " + source);
    }

    void exerciseVisibleSafeDomains() {
        tapLabel("我的");
        require(waitForLabel("打开听歌历史与年度回响", 8_000L), "library shell unavailable");
        tapLabel("设置");
        require(waitForLabel("打开账号与来源", 8_000L), "settings shell unavailable");
        require(waitForLabel("设置或替换 DeepSeek API key", 8_000L), "consent control unavailable");
        record("library-settings-navigation");
    }

    /** Captured while the target activity is foreground, before test teardown. */
    void captureForegroundEvidence() {
        File directory = instrumentation.getTargetContext().getExternalFilesDir(null);
        if (directory == null) {
            throw new AssertionError("target external-files evidence directory is unavailable");
        }
        String window = dumpWindow();
        require(!window.isEmpty(), "foreground accessibility window is unavailable");
        writeText(new File(directory, "listen2-phase8-integrated.xml"), window);
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        if (screenshot == null) {
            throw new AssertionError("foreground screenshot is unavailable");
        }
        try (FileOutputStream output = new FileOutputStream(new File(directory, "listen2-phase8-integrated.png"))) {
            require(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output), "could not write foreground screenshot");
        } catch (Exception error) {
            throw new AssertionError("could not write foreground screenshot", error);
        } finally {
            screenshot.recycle();
        }
    }

    /** Failure capture is best-effort and must never replace the primary assertion. */
    void captureFailureEvidence() {
        File directory = instrumentation.getTargetContext().getExternalFilesDir(null);
        if (directory == null) {
            throw new AssertionError("target external-files failure evidence directory is unavailable");
        }
        writeText(new File(directory, "listen2-phase8-failure.xml"), dumpWindow());
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        if (screenshot == null) {
            throw new AssertionError("failure screenshot is unavailable");
        }
        try (FileOutputStream output = new FileOutputStream(new File(directory, "listen2-phase8-failure.png"))) {
            require(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output), "could not write failure screenshot");
        } catch (Exception error) {
            throw new AssertionError("could not write failure screenshot", error);
        } finally {
            screenshot.recycle();
        }
    }

    void record(String event) {
        Log.i("Listen2Acceptance", "acceptance-event=" + event);
    }

    private String nodeFor(String label) {
        String expression = "(?:text|content-desc)=\\\"" + Pattern.quote(label) + "\\\"[^>]*bounds=\\\"\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]\\\"";
        Matcher match = Pattern.compile(expression).matcher(dumpWindow());
        if (!match.find()) {
            return null;
        }
        return match.group(1) + "," + match.group(2) + "," + match.group(3) + "," + match.group(4);
    }

    private String dumpWindow() {
        AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
        if (root == null) {
            return "";
        }
        try {
            StringBuilder output = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?><hierarchy>");
            int[] visited = { 0 };
            appendNode(root, output, 0, visited);
            return output.append("</hierarchy>").toString();
        } finally {
            root.recycle();
        }
    }

    /** Do not invoke a nested uiautomator service from instrumentation on API 35. */
    private void appendNode(AccessibilityNodeInfo node, StringBuilder output, int depth, int[] visited) {
        if (visited[0] >= MAX_NODES_PER_DUMP || depth > MAX_DUMP_DEPTH) {
            return;
        }
        visited[0] += 1;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        output.append("<node text=\"").append(xmlAttribute(stringValue(node.getText())))
            .append("\" content-desc=\"").append(xmlAttribute(stringValue(node.getContentDescription())))
            .append("\" bounds=\"[").append(bounds.left).append(',').append(bounds.top)
            .append("][").append(bounds.right).append(',').append(bounds.bottom).append("]\">");
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) {
                continue;
            }
            try {
                appendNode(child, output, depth + 1, visited);
            } finally {
                child.recycle();
            }
        }
        output.append("</node>");
    }

    private String shell(String command) {
        ParcelFileDescriptor descriptor = instrumentation.getUiAutomation().executeShellCommand(command);
        try (FileInputStream input = new FileInputStream(descriptor.getFileDescriptor());
             BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append('\n');
            }
            return output.toString();
        } catch (Exception error) {
            throw new AssertionError("shell command failed", error);
        } finally {
            try {
                descriptor.close();
            } catch (Exception ignored) {
                // The command result was already consumed; close is best-effort.
            }
        }
    }

    private String shellText(String value) {
        require("青花瓷".equals(value), "only fixed sanitized fixture text is allowed");
        return "'青花瓷'";
    }

    private static String stringValue(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private static String xmlAttribute(String value) {
        String bounded = value.length() > MAX_ATTRIBUTE_LENGTH ? value.substring(0, MAX_ATTRIBUTE_LENGTH) : value;
        return bounded.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static void writeText(File file, String value) {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new AssertionError("could not write foreground accessibility evidence", error);
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
