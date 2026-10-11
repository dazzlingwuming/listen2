package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.HashSet;
import java.util.Set;

/** UI-only retained-data credential probe. Never reads an input value or exports a UI tree. */
public final class CredentialAcceptanceTest {
    private static final String PACKAGE = "com.dazzlingwuming.listen2";
    private static final Set<String> BUTTONS = new HashSet<>(Arrays.asList(
        "搜索", "搜索音乐", "哔哩哔哩", "暂停播放", "继续播放", "离线下载当前分P",
        "设置", "打开账号与来源", "测试 DeepSeek 连接", "打开播放器", "查看歌词",
        "恢复来源译文", "重新翻译当前歌词", "同意并翻译",
        "将发送当前完整同步歌词", "将发送歌曲标题", "将发送歌手名称",
        "此请求可能产生 API 费用", "确认前取消不会发送请求；切歌或关闭时可取消",
        "失败不会替换或保存当前译文"
    ));

    private CredentialAcceptanceTest() { }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress, Bundle arguments) {
        String phase = arguments.getString("credentialPhase", "baseline");
        if (!Arrays.asList("baseline", "resume", "playback", "offline").contains(phase)) throw new IllegalArgumentException("credential-phase-invalid");
        SafeUi ui = new SafeUi(instrumentation);
        progress.step("credential-" + phase);
        if (ui.sensitiveEntry()) {
            emit(instrumentation, phase, "entry", "IN_PROGRESS");
            return;
        }
        Intent launch = instrumentation.getTargetContext().getPackageManager().getLaunchIntentForPackage(PACKAGE);
        if (launch == null) throw new IllegalStateException("credential-target-unavailable");
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        instrumentation.getTargetContext().startActivity(launch);
        instrumentation.waitForIdleSync();
        if ("offline".equals(phase)) { observeOffline(instrumentation, ui); return; }
        if (!ui.waitLabel("设置", false, 20_000L) || !ui.click("设置")) {
            emit(instrumentation, phase, "entry", "UNAVAILABLE"); return;
        }
        boolean accountAuthenticated = false;
        if (!ui.scrollFind("打开账号与来源") || !ui.click("打开账号与来源")) {
            emit(instrumentation, phase, "account", "UNAVAILABLE");
        } else {
            boolean authenticated = ui.waitLabel("已登录", true, 10_000L);
            if (!authenticated) { ui.scrollForward(); authenticated = ui.waitLabel("已登录", true, 3_000L); }
            accountAuthenticated = authenticated;
            emit(instrumentation, phase, "account", authenticated ? "AUTHENTICATED" : "NOT_AUTHENTICATED");
            ui.back();
        }
        if ("playback".equals(phase)) {
            if (!accountAuthenticated) { emit(instrumentation, phase, "playback", "NOT_AUTHENTICATED"); return; }
            observeBilibili(instrumentation, ui); return;
        }
        boolean configured = ui.scrollFind("测试 DeepSeek 连接") && ui.enabled("测试 DeepSeek 连接");
        emit(instrumentation, phase, "configuration", configured ? "CONFIGURED" : "NOT_CONFIGURED");
        if ("resume".equals(phase) || !configured) return;
        if (!ui.click("测试 DeepSeek 连接")) { emit(instrumentation, phase, "connection", "UNAVAILABLE"); return; }
        boolean connected = ui.waitLabel("DeepSeek 测试成功", false, 40_000L);
        emit(instrumentation, phase, "connection", connected ? "PASS" : "NOT_VERIFIED");
        ui.back();
        if (!"true".equals(arguments.getString("allowTranslation", "false"))) {
            emit(instrumentation, phase, "translation", "NOT_REQUESTED"); return;
        }
        if (!ui.scrollFind("打开播放器") || !ui.click("打开播放器") || !ui.waitLabel("查看歌词", false, 10_000L) || !ui.click("查看歌词") || !ui.waitLabel("重新翻译当前歌词", false, 20_000L)) {
            emit(instrumentation, phase, "translation", "ELIGIBLE_LYRIC_UNAVAILABLE"); return;
        }
        // Reset only the visible translated view. Cached data and credentials remain untouched.
        if (ui.hasLabel("恢复来源译文", false)) ui.click("恢复来源译文");
        if (!ui.click("重新翻译当前歌词") || !ui.waitLabel("同意并翻译", false, 8_000L)) {
            emit(instrumentation, phase, "translation", "CONSENT_UNAVAILABLE"); return;
        }
        for (String label : Arrays.asList("将发送当前完整同步歌词", "将发送歌曲标题", "将发送歌手名称", "此请求可能产生 API 费用", "确认前取消不会发送请求；切歌或关闭时可取消", "失败不会替换或保存当前译文")) {
            if (!ui.scrollFind(label) || !ui.click(label)) { emit(instrumentation, phase, "translation", "CONSENT_UNAVAILABLE"); return; }
        }
        if (!ui.scrollFind("同意并翻译") || !ui.click("同意并翻译")) { emit(instrumentation, phase, "translation", "CONSENT_UNAVAILABLE"); return; }
        boolean busy = ui.waitLabel("正在处理歌词翻译…", false, 5_000L);
        boolean rendered = busy && ui.waitTranslationTerminal(60_000L);
        emit(instrumentation, phase, "translation", rendered ? "PASS" : "NOT_VERIFIED");
    }

    private static void observeBilibili(Instrumentation instrumentation, SafeUi ui) {
        String phase = "playback";
        // Public source titles stay only in memory and are never included in a status/error.
        if (!ui.waitLabel("搜索", false, 10_000L) || !ui.click("搜索") || !ui.setFixedSearchQuery() || !ui.click("哔哩哔哩") || !ui.waitSelected("哔哩哔哩", 5_000L) || !ui.click("搜索音乐")) {
            emit(instrumentation, phase, "selection", "NOT_VERIFIED"); return;
        }
        String action = ui.waitPublicValue("search", 25_000L);
        if (action == null || !ui.clickPublic(action) || !ui.waitLabel("视频分段", false, 15_000L)) {
            emit(instrumentation, phase, "selection", "NOT_VERIFIED"); return;
        }
        String part = ui.waitPublicValue("part", 25_000L);
        if (part == null || !ui.clickPublic("播放" + part)) {
            emit(instrumentation, phase, "selection", "NOT_VERIFIED"); return;
        }
        emit(instrumentation, phase, "selection", "UNIQUE_P1");
        String video = action.substring(2, action.length() - 2);
        if (!ui.waitLabel(video + " · " + part, false, 35_000L) || !observeProgress(instrumentation, ui, phase)) return;
        if (!ui.scrollFind("离线下载当前分P")) { emit(instrumentation, phase, "download", "NOT_ELIGIBLE"); return; }
        if (!ui.downloadReady() && !ui.click("离线下载当前分P")) { emit(instrumentation, phase, "download", "NOT_VERIFIED"); return; }
        long deadline = ui.boundedDeadline(90_000L);
        do {
            if (ui.downloadReady()) { emit(instrumentation, phase, "download", "READY_CHECKED"); return; }
            if (ui.hasLabel("无法离线下载", false)) { emit(instrumentation, phase, "download", "DOWNLOAD_FAILED"); return; }
            SystemClock.sleep(250L);
        } while (SystemClock.elapsedRealtime() < deadline);
        emit(instrumentation, phase, "download", "NOT_VERIFIED");
    }

    private static void observeOffline(Instrumentation instrumentation, SafeUi ui) {
        String phase = "offline";
        if (!ui.hasLabel("离线下载当前分P", false)) {
            if (!ui.waitLabel("打开播放器", false, 20_000L) || !ui.click("打开播放器")) { emit(instrumentation, phase, "playback", "NOT_VERIFIED"); return; }
        }
        if (!ui.waitLabel("哔哩哔哩", false, 10_000L) || !ui.scrollFind("离线下载当前分P") || !ui.downloadReady()) {
            emit(instrumentation, phase, "download", "NOT_VERIFIED"); return;
        }
        emit(instrumentation, phase, "download", "READY_CHECKED");
        // Same visible restored selection is partial proof only: expected CID is not exposed by UI.
        if (ui.hasLabel("继续播放", false)) ui.click("继续播放");
        observeProgress(instrumentation, ui, phase);
    }

    private static boolean observeProgress(Instrumentation instrumentation, SafeUi ui, String phase) {
        if (!ui.waitLabel("暂停播放", false, 35_000L)) { emit(instrumentation, phase, "playback", "PROVIDER_UNAVAILABLE"); return false; }
        long deadline = ui.boundedDeadline(20_000L), first = -1L;
        do { first = ui.progressMillis(); if (first > 0L) break; SystemClock.sleep(150L); } while (SystemClock.elapsedRealtime() < deadline);
        if (first <= 0L) { emit(instrumentation, phase, "playback", "NOT_VERIFIED"); return false; }
        SystemClock.sleep(2_500L);
        long later = ui.progressMillis();
        if (later <= first || !ui.hasLabel("暂停播放", false) || ui.hasLabel("这首歌暂时无法播放", false)) { emit(instrumentation, phase, "playback", "NOT_VERIFIED"); return false; }
        emit(instrumentation, phase, "positionstartms", String.valueOf(first));
        emit(instrumentation, phase, "positionendms", String.valueOf(later));
        emit(instrumentation, phase, "playback", "PLAYING_ADVANCING");
        return true;
    }

    private static void emit(Instrumentation instrumentation, String phase, String name, String value) {
        // Values are fixed enums or bounded numeric observations. Account names, lyrics and secrets never reach stdout.
        Bundle status = new Bundle();
        status.putString("stream", "credential-observation=" + phase + ":" + name + ":" + value + "\n");
        instrumentation.sendStatus(0, status);
    }

    private static final class SafeUi {
        private final Instrumentation instrumentation;
        private final long scenarioDeadline = SystemClock.elapsedRealtime() + 150_000L;
        SafeUi(Instrumentation value) { instrumentation = value; }
        long boundedDeadline(long timeout) { return Math.min(scenarioDeadline, SystemClock.elapsedRealtime() + timeout); }
        boolean downloadReady() { return hasLabel("当前分P下载状态", false) && hasLabel("已下载并校验", false) && hasLabel("此分P已下载", false); }
        boolean waitSelected(String label, long timeout) {
            long deadline = boundedDeadline(timeout);
            do {
                AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
                try { if (root != null && selectedNode(root, label, 0, new int[] { 0 })) return true; }
                finally { if (root != null) root.recycle(); }
                SystemClock.sleep(100L);
            } while (SystemClock.elapsedRealtime() < deadline);
            return false;
        }
        boolean selectedNode(AccessibilityNodeInfo node, String label, int depth, int[] count) {
            if (++count[0] > 800 || depth > 40 || node.isPassword() || node.isEditable()) return false;
            if (node.isVisibleToUser() && node.isSelected() && matches(node, label, false)) return true;
            for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo child = node.getChild(i); if (child == null) continue; try { if (selectedNode(child, label, depth + 1, count)) return true; } finally { child.recycle(); } }
            return false;
        }
        boolean setFixedSearchQuery() {
            // Require the selected search tab and its distinct submit control before any input action.
            if (!waitSelected("搜索", 5_000L) || !waitLabel("搜索音乐", false, 5_000L)) return false;
            // Locate by structural editable type only. Never read editable text/contentDescription.
            AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
            List<AccessibilityNodeInfo> inputs = new ArrayList<>();
            try {
                if (root == null) return false;
                collectInputs(root, inputs, 0, new int[] { 0 });
                if (inputs.size() != 1) return false;
                Bundle arguments = new Bundle();
                arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "青花瓷");
                return (inputs.get(0).isFocused() || inputs.get(0).performAction(AccessibilityNodeInfo.ACTION_FOCUS)) && inputs.get(0).performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
            } finally { if (root != null) root.recycle(); for (AccessibilityNodeInfo input : inputs) input.recycle(); }
        }
        void collectInputs(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> result, int depth, int[] count) {
            if (++count[0] > 800 || depth > 40 || result.size() > 1 || node.isPassword()) return;
            if (node.isVisibleToUser() && node.isEnabled() && node.isEditable() && PACKAGE.contentEquals(node.getPackageName() == null ? "" : node.getPackageName())) { result.add(AccessibilityNodeInfo.obtain(node)); return; }
            for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo child = node.getChild(i); if (child == null) continue; try { collectInputs(child, result, depth + 1, count); } finally { child.recycle(); } }
        }
        String waitPublicValue(String kind, long timeout) {
            long deadline = boundedDeadline(timeout);
            do {
                List<String> values = publicValues(kind);
                if ("search".equals(kind) && !values.isEmpty()) return values.get(0);
                if ("part".equals(kind) && values.size() == 1) return values.get(0);
                SystemClock.sleep(200L);
            } while (SystemClock.elapsedRealtime() < deadline);
            return null;
        }
        List<String> publicValues(String kind) {
            AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
            List<String> values = new ArrayList<>();
            try { if (root != null) collectPublic(root, kind, values, 0, new int[] { 0 }); }
            finally { if (root != null) root.recycle(); }
            return values;
        }
        void collectPublic(AccessibilityNodeInfo node, String kind, List<String> values, int depth, int[] count) {
            if (++count[0] > 800 || depth > 40 || node.isPassword() || node.isEditable() || values.size() > 32) return;
            if (node.isVisibleToUser() && PACKAGE.contentEquals(node.getPackageName() == null ? "" : node.getPackageName())) {
                CharSequence description = node.getContentDescription(), text = node.getText();
                String value = description == null ? text == null ? "" : text.toString() : description.toString();
                if ("search".equals(kind) && value.startsWith("查看") && value.endsWith("详情") && value.contains("青花瓷") && value.length() <= 300) values.add(value);
                if ("part".equals(kind)) {
                    String part = text == null ? "" : text.toString();
                    if (part.startsWith("P1 · ") && part.length() > 5 && part.length() <= 300) values.add(part.substring(5));
                }
                if ("progress".equals(kind) && value.startsWith("播放进度 ") && value.length() <= 80) values.add(value);
            }
            for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo child = node.getChild(i); if (child == null) continue; try { collectPublic(child, kind, values, depth + 1, count); } finally { child.recycle(); } }
        }
        long progressMillis() {
            List<String> values = publicValues("progress");
            if (values.size() != 1) return -1L;
            Matcher matcher = Pattern.compile("^播放进度 ([0-9]{1,3}:[0-5][0-9](?::[0-5][0-9])?) / [0-9]{1,3}:[0-5][0-9](?::[0-5][0-9])?$").matcher(values.get(0));
            if (!matcher.matches()) return -1L;
            String[] parts = matcher.group(1).split(":"); long seconds = 0L;
            for (String part : parts) seconds = seconds * 60L + Long.parseLong(part);
            return seconds <= 86400L ? seconds * 1000L : -1L;
        }
        boolean clickPublic(String label) {
            if (label == null || label.length() > 310 || !(label.startsWith("查看") && label.endsWith("详情") || label.startsWith("播放"))) return false;
            AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
            try { return root != null && clickNode(root, label, 0, new int[] { 0 }); } finally { if (root != null) root.recycle(); }
        }
        boolean sensitiveEntry() { return inspect(null, false, false, true) || hasLabel("Bilibili 登录二维码", false); }
        boolean hasLabel(String label, boolean prefix) { return inspect(label, prefix, false, false); }
        boolean enabled(String label) { return inspect(label, false, true, false); }
        boolean waitLabel(String label, boolean prefix, long timeout) {
            long deadline = boundedDeadline(timeout);
            do { if (hasLabel(label, prefix)) return true; SystemClock.sleep(150L); } while (SystemClock.elapsedRealtime() < deadline);
            return false;
        }
        boolean inspect(String label, boolean prefix, boolean enabled, boolean passwordOnly) {
            AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
            if (root == null) return false;
            try { return inspectNode(root, label, prefix, enabled, passwordOnly, 0, new int[] { 0 }); }
            finally { root.recycle(); }
        }
        boolean inspectNode(AccessibilityNodeInfo node, String label, boolean prefix, boolean enabled, boolean passwordOnly, int depth, int[] count) {
            if (++count[0] > 800 || depth > 40) return false;
            if (node.isPassword()) return passwordOnly;
            if (node.isEditable()) return false;
            if (!passwordOnly && node.isVisibleToUser() && (!enabled || node.isEnabled()) && matches(node, label, prefix)) return true;
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i); if (child == null) continue;
                try { if (inspectNode(child, label, prefix, enabled, passwordOnly, depth + 1, count)) return true; }
                finally { child.recycle(); }
            }
            return false;
        }
        boolean matches(AccessibilityNodeInfo node, String label, boolean prefix) {
            if (label == null || node.isEditable() || node.isPassword()) return false;
            CharSequence description = node.getContentDescription();
            if (description != null && (prefix ? description.toString().startsWith(label) : label.contentEquals(description))) return true;
            CharSequence text = node.getText();
            return text != null && (prefix ? text.toString().startsWith(label) : label.contentEquals(text));
        }
        boolean click(String label) {
            if (!BUTTONS.contains(label)) throw new IllegalArgumentException("credential-control-not-allowed");
            AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
            if (root == null) return false;
            try { return clickNode(root, label, 0, new int[] { 0 }); } finally { root.recycle(); }
        }
        boolean clickNode(AccessibilityNodeInfo node, String label, int depth, int[] count) {
            if (++count[0] > 800 || depth > 40 || node.isPassword() || node.isEditable()) return false;
            if (node.isVisibleToUser() && node.isEnabled() && matches(node, label, false)) {
                if (node.isClickable()) return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                AccessibilityNodeInfo parent = node.getParent();
                for (int i = 0; parent != null && i < 6; i++) {
                    AccessibilityNodeInfo next = null;
                    try { if (parent.isVisibleToUser() && parent.isEnabled() && parent.isClickable()) return parent.performAction(AccessibilityNodeInfo.ACTION_CLICK); next = parent.getParent(); }
                    finally { parent.recycle(); }
                    parent = next;
                }
                if (parent != null) parent.recycle();
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i); if (child == null) continue;
                try { if (clickNode(child, label, depth + 1, count)) return true; } finally { child.recycle(); }
            }
            return false;
        }
        boolean scrollFind(String label) {
            for (int i = 0; i < 5; i++) { if (hasLabel(label, false)) return true; if (!scrollForward()) break; SystemClock.sleep(200L); }
            return hasLabel(label, false);
        }
        boolean scrollForward() {
            AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow(); if (root == null) return false;
            try { return scrollNode(root, 0, new int[] { 0 }); } finally { root.recycle(); }
        }
        boolean scrollNode(AccessibilityNodeInfo node, int depth, int[] count) {
            if (++count[0] > 800 || depth > 40 || node.isPassword() || node.isEditable()) return false;
            if (node.isVisibleToUser() && node.isScrollable() && node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return true;
            for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo child = node.getChild(i); if (child == null) continue; try { if (scrollNode(child, depth + 1, count)) return true; } finally { child.recycle(); } }
            return false;
        }
        boolean waitTranslationTerminal(long timeout) {
            long deadline = boundedDeadline(timeout);
            do {
                if (hasLabel("翻译未应用：", true)) return false;
                if (!hasLabel("正在处理歌词翻译…", false) && hasLabel("DeepSeek 机器翻译", false) && hasLabel("恢复来源译文", false)) return true;
                SystemClock.sleep(150L);
            } while (SystemClock.elapsedRealtime() < deadline);
            return false;
        }
        void back() { instrumentation.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK); SystemClock.sleep(250L); }
    }
}
