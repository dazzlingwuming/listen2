package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;
import android.os.Bundle;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
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

    /**
     * Starts the visible target activity through the platform Activity Manager and waits for the
     * two phone-shell tabs that make the first screen usable. This is deliberately test-only:
     * callers receive bounded numeric timings rather than application state or logcat data.
     */
    StartupTiming startColdTargetAndWaitForShell() {
        long startedAt = SystemClock.elapsedRealtime();
        String activityOutput = shell("am start -W -n " + TARGET_PACKAGE + "/com.listen2mobile.MainActivity");
        require(activityOutput.matches("(?sm).*^Status:\\s*ok\\s*$.*"), "Activity Manager did not report Status: ok");
        require(activityOutput.matches("(?sm).*^LaunchState:\\s*COLD\\s*$.*"), "Activity Manager did not report LaunchState: COLD");
        long totalTimeMillis = requiredActivityTiming(activityOutput, "TotalTime");
        long waitTimeMillis = requiredActivityTiming(activityOutput, "WaitTime");
        require(waitForLabel("搜索", 20_000L), "phone shell search tab did not become visible");
        require(waitForLabel("我的", 5_000L), "phone shell library tab did not become visible");
        long shellReadyMillis = SystemClock.elapsedRealtime() - startedAt;
        require(shellReadyMillis >= 0L, "monotonic clock moved backwards");
        return new StartupTiming(totalTimeMillis, waitTimeMillis, shellReadyMillis);
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
        String before = dumpWindow();
        ClickTarget target = clickableTargetFor(label);
        if (target == null) {
            throw new AssertionError("missing enabled clickable control: " + label);
        }
        boolean actionClick;
        try {
            actionClick = target.node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        } finally {
            target.node.recycle();
        }
        if (!actionClick) {
            // The shell fallback is restricted to the exact resolved control, never a
            // nearby label or caller-supplied coordinate. It must visibly change state.
            shell("input tap " + target.bounds.centerX() + " " + target.bounds.centerY());
            require(waitForWindowChange(before, 3_000L), "shell tap did not change visible state: " + label);
        }
        instrumentation.waitForIdleSync();
    }

    void submitLiveSearch() {
        String before = dumpWindow();
        tapLabel("搜索音乐");
        require(waitForSearchSubmission(before, 3_000L), "search action did not leave the guide state");
    }

    void enterText(String label, String value) {
        require("青花瓷".equals(value), "only the fixed sanitized fixture query is allowed");
        AccessibilityNodeInfo editable = findEditableNode(label);
        if (editable == null) {
            throw new AssertionError("missing editable search field: " + label);
        }
        try {
            require(editable.performAction(AccessibilityNodeInfo.ACTION_FOCUS), "search field refused accessibility focus");
            Bundle arguments = new Bundle();
            arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
            require(editable.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments), "search field refused Unicode accessibility text");
        } finally {
            editable.recycle();
        }
        instrumentation.waitForIdleSync();
        require(waitForExactEditableText(label, value, 5_000L), "search field did not retain exact Unicode text");
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

    /**
     * Unlike the broad Phase 8 terminal assertion, live-provider acceptance only
     * succeeds when the visible production response contains a real TrackRow.
     * A guide, empty state, or provider error is a failed live-search proof.
     */
    List<String> requireLiveSearchResults(String source) {
        require(waitForLabel("青花瓷", 8_000L), "query did not remain visible for " + source);
        long deadline = SystemClock.elapsedRealtime() + 20_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            String view = dumpWindow();
            List<String> titles = visiblePlayableTitles(view);
            if (!titles.isEmpty()) {
                appendLiveResults(source, titles);
                record("live-search-results-" + source + "-" + titles.size());
                return titles;
            }
            if (!view.contains("正在搜索")) {
                String terminal = liveSearchTerminal(view);
                if (terminal != null) {
                    throw new AssertionError("live-search-" + source + "-" + terminal);
                }
            }
            SystemClock.sleep(300L);
        }
        throw new AssertionError("live-search-" + source + "-timed-out");
    }

    /**
     * This makes one anonymous, visible playback attempt only after a real
     * provider result advertises its own Play action. Access restrictions stay
     * NOT_VERIFIED instead of being worked around or represented as a pass.
     */
    PlaybackProbe attemptNativePlayback(String title) {
        String safeTitle = sanitizeVisibleTitle(title);
        String playLabel = "播放" + title;
        if (!hasClickableTarget(playLabel)) {
            return PlaybackProbe.notVerified("no-visible-play-action-" + safeTitle);
        }
        tapLabel(playLabel);
        if (!waitForLabel("打开播放器", 12_000L)) {
            return PlaybackProbe.notVerified("no-mini-player-" + safeTitle);
        }
        if (!waitForLabel("暂停播放", 8_000L)) {
            return PlaybackProbe.notVerified("ui-not-playing-" + safeTitle);
        }
        tapLabel("打开播放器");
        Long firstPosition = waitForProgressPosition(8_000L);
        if (firstPosition == null) {
            return PlaybackProbe.notVerified("no-progress-control-" + safeTitle);
        }
        SystemClock.sleep(2_500L);
        Long laterPosition = progressPosition(dumpWindow());
        if (laterPosition == null || laterPosition <= firstPosition) {
            return PlaybackProbe.notVerified("position-not-advancing-" + safeTitle);
        }
        String mediaSession = shell("dumpsys media_session");
        if (!mediaSession.contains(TARGET_PACKAGE) || !isNativePlayingState(mediaSession)) {
            return PlaybackProbe.notVerified("native-session-not-playing-" + safeTitle);
        }
        return PlaybackProbe.verified(safeTitle, firstPosition, laterPosition);
    }

    /** Captures the final foreground state and the bounded visible titles. */
    void captureLiveProviderEvidence() {
        File directory = evidenceDirectory();
        writeText(new File(directory, "listen2-phase8-live-provider.xml"), dumpWindow());
        captureScreenshot(new File(directory, "listen2-phase8-live-provider.png"));
        StringBuilder result = new StringBuilder();
        for (String line : liveResultLines) {
            result.append(line).append('\n');
        }
        writeText(new File(directory, "listen2-phase8-live-provider-results.txt"), result.toString());
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
        File directory = evidenceDirectory();
        String window = dumpWindow();
        require(!window.isEmpty(), "foreground accessibility window is unavailable");
        writeText(new File(directory, "listen2-phase8-integrated.xml"), window);
        captureScreenshot(new File(directory, "listen2-phase8-integrated.png"));
    }

    /** Failure capture is best-effort and must never replace the primary assertion. */
    void captureFailureEvidence() {
        File directory = evidenceDirectory();
        writeText(new File(directory, "listen2-phase8-failure.xml"), dumpWindow());
        captureScreenshot(new File(directory, "listen2-phase8-failure.png"));
    }

    private File evidenceDirectory() {
        File directory = instrumentation.getTargetContext().getExternalFilesDir(null);
        if (directory == null) {
            throw new AssertionError("target external-files evidence directory is unavailable");
        }
        return directory;
    }

    private void captureScreenshot(File destination) {
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        if (screenshot == null) {
            throw new AssertionError("foreground screenshot is unavailable");
        }
        try (FileOutputStream output = new FileOutputStream(destination)) {
            require(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output), "could not write foreground screenshot");
        } catch (Exception error) {
            throw new AssertionError("could not write foreground screenshot", error);
        } finally {
            screenshot.recycle();
        }
    }

    void record(String event) {
        Log.i("Listen2Acceptance", "acceptance-event=" + event);
    }

    private static long requiredActivityTiming(String output, String field) {
        Matcher match = Pattern.compile("(?m)^" + Pattern.quote(field) + ":\\s*(\\d+)\\s*$").matcher(output);
        if (!match.find()) {
            throw new AssertionError("Activity Manager did not report " + field);
        }
        try {
            return Long.parseLong(match.group(1));
        } catch (NumberFormatException error) {
            throw new AssertionError("Activity Manager reported an invalid " + field, error);
        }
    }

    static final class StartupTiming {
        final long totalTimeMillis;
        final long waitTimeMillis;
        final long shellReadyMillis;

        StartupTiming(long totalTimeMillis, long waitTimeMillis, long shellReadyMillis) {
            this.totalTimeMillis = totalTimeMillis;
            this.waitTimeMillis = waitTimeMillis;
            this.shellReadyMillis = shellReadyMillis;
        }
    }

    /**
     * The API 35 shell `input text` route cannot type the fixed CJK fixture.
     * Set text through the visible editable accessibility node instead; this
     * has no access to application state or storage and fails closed when the
     * field becomes unavailable.
     */
    private AccessibilityNodeInfo findEditableNode(String label) {
        AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
        if (root == null) {
            return null;
        }
        try {
            return findEditableNode(root, label, 0, new int[] { 0 });
        } finally {
            root.recycle();
        }
    }

    private AccessibilityNodeInfo findEditableNode(AccessibilityNodeInfo node, String label, int depth, int[] visited) {
        if (visited[0] >= MAX_NODES_PER_DUMP || depth > MAX_DUMP_DEPTH) {
            return null;
        }
        visited[0] += 1;
        if (node.isEditable() && labelMatches(node, label)) {
            return AccessibilityNodeInfo.obtain(node);
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) {
                continue;
            }
            try {
                AccessibilityNodeInfo found = findEditableNode(child, label, depth + 1, visited);
                if (found != null) {
                    return found;
                }
            } finally {
                child.recycle();
            }
        }
        return null;
    }

    private ClickTarget clickableTargetFor(String label) {
        AccessibilityNodeInfo matched = findLabeledNode(label);
        if (matched == null) {
            return null;
        }
        AccessibilityNodeInfo current = matched;
        for (int depth = 0; current != null && depth <= 8; depth += 1) {
            if (current.isEnabled() && current.isClickable()) {
                Rect bounds = new Rect();
                current.getBoundsInScreen(bounds);
                return new ClickTarget(current, bounds);
            }
            AccessibilityNodeInfo parent = current.getParent();
            current.recycle();
            current = parent;
        }
        return null;
    }

    private boolean hasClickableTarget(String label) {
        ClickTarget target = clickableTargetFor(label);
        if (target == null) {
            return false;
        }
        target.node.recycle();
        return true;
    }

    private AccessibilityNodeInfo findLabeledNode(String label) {
        AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
        if (root == null) {
            return null;
        }
        try {
            return findLabeledNode(root, label, 0, new int[] { 0 });
        } finally {
            root.recycle();
        }
    }

    private AccessibilityNodeInfo findLabeledNode(AccessibilityNodeInfo node, String label, int depth, int[] visited) {
        if (visited[0] >= MAX_NODES_PER_DUMP || depth > MAX_DUMP_DEPTH) {
            return null;
        }
        visited[0] += 1;
        if (labelMatches(node, label)) {
            return AccessibilityNodeInfo.obtain(node);
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) {
                continue;
            }
            try {
                AccessibilityNodeInfo found = findLabeledNode(child, label, depth + 1, visited);
                if (found != null) {
                    return found;
                }
            } finally {
                child.recycle();
            }
        }
        return null;
    }

    private boolean waitForWindowChange(String before, long timeoutMillis) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (!before.equals(dumpWindow())) {
                return true;
            }
            SystemClock.sleep(100L);
        }
        return false;
    }

    private boolean waitForSearchSubmission(String before, long timeoutMillis) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            String current = dumpWindow();
            if (!current.equals(before) && (!current.contains("开始搜索") || current.contains("正在搜索"))) {
                return true;
            }
            SystemClock.sleep(100L);
        }
        return false;
    }

    private boolean waitForExactEditableText(String label, String expected, long timeoutMillis) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            AccessibilityNodeInfo refreshed = findEditableNode(label);
            if (refreshed != null) {
                try {
                    if (expected.contentEquals(refreshed.getText())) {
                        return true;
                    }
                } finally {
                    refreshed.recycle();
                }
            }
            SystemClock.sleep(100L);
        }
        return false;
    }

    private static boolean labelMatches(AccessibilityNodeInfo node, String label) {
        return label.contentEquals(stringValue(node.getText())) ||
            label.contentEquals(stringValue(node.getContentDescription())) ||
            label.contentEquals(stringValue(node.getHintText()));
    }

    private final List<String> liveResultLines = new ArrayList<>();

    private static List<String> visiblePlayableTitles(String view) {
        Pattern detail = Pattern.compile("content-desc=\\\"查看([^\\\"]{1,160})详情\\\"");
        Matcher match = detail.matcher(view);
        LinkedHashSet<String> titles = new LinkedHashSet<>();
        while (match.find() && titles.size() < 3) {
            String title = match.group(1);
            if (view.contains("content-desc=\"播放" + title + "\"")) {
                titles.add(title);
            }
        }
        return new ArrayList<>(titles);
    }

    private void appendLiveResults(String source, List<String> titles) {
        StringBuilder line = new StringBuilder(source).append(':');
        for (int index = 0; index < titles.size(); index += 1) {
            if (index > 0) {
                line.append('|');
            }
            line.append(sanitizeVisibleTitle(titles.get(index)));
        }
        liveResultLines.add(line.toString());
    }

    private static String sanitizeVisibleTitle(String title) {
        String value = title == null ? "untitled" : title.replaceAll("[^\\p{L}\\p{N} .,_-]", "_").trim();
        return value.length() > 80 ? value.substring(0, 80) : (value.isEmpty() ? "untitled" : value);
    }

    private static String liveSearchTerminal(String view) {
        if (view.contains("还没有搜索结果")) {
            return "empty";
        }
        if (view.contains("暂时无法完成") || view.contains("重试搜索")) {
            return "provider-error";
        }
        if (view.contains("开始搜索") || view.contains("输入关键词后选择来源")) {
            return "guide";
        }
        return null;
    }

    private Long waitForProgressPosition(long timeoutMillis) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            Long position = progressPosition(dumpWindow());
            if (position != null) {
                return position;
            }
            SystemClock.sleep(250L);
        }
        return null;
    }

    private static Long progressPosition(String view) {
        Matcher match = Pattern.compile("content-desc=\\\"播放进度 ([0-9:]+) /").matcher(view);
        if (!match.find()) {
            return null;
        }
        String[] values = match.group(1).split(":");
        try {
            if (values.length == 2) {
                return Long.parseLong(values[0]) * 60L + Long.parseLong(values[1]);
            }
            if (values.length == 3) {
                return Long.parseLong(values[0]) * 3600L + Long.parseLong(values[1]) * 60L + Long.parseLong(values[2]);
            }
        } catch (NumberFormatException ignored) {
            return null;
        }
        return null;
    }

    private static boolean isNativePlayingState(String mediaSession) {
        return Pattern.compile("(?i)(state=3|state=playing|STATE_PLAYING)").matcher(mediaSession).find();
    }

    static final class PlaybackProbe {
        final boolean verified;
        final String detail;

        private PlaybackProbe(boolean verified, String detail) {
            this.verified = verified;
            this.detail = detail;
        }

        static PlaybackProbe verified(String title, long firstPosition, long laterPosition) {
            return new PlaybackProbe(true, "playing-" + title + "-" + firstPosition + "-" + laterPosition);
        }

        static PlaybackProbe notVerified(String detail) {
            return new PlaybackProbe(false, detail);
        }
    }

    private static final class ClickTarget {
        final AccessibilityNodeInfo node;
        final Rect bounds;

        ClickTarget(AccessibilityNodeInfo node, Rect bounds) {
            this.node = node;
            this.bounds = bounds;
        }
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
            .append("\" class=\"").append(xmlAttribute(stringValue(node.getClassName())))
            .append("\" clickable=\"").append(node.isClickable())
            .append("\" enabled=\"").append(node.isEnabled())
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
