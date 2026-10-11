package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** UI-only retained-data credential probe. Never reads an input value or exports a UI tree. */
public final class CredentialAcceptanceTest {
    private static final String PACKAGE = "com.dazzlingwuming.listen2";
    private static final Set<String> BUTTONS = new HashSet<>(Arrays.asList(
        "设置", "打开账号与来源", "测试 DeepSeek 连接", "打开播放器", "查看歌词",
        "恢复来源译文", "重新翻译当前歌词", "同意并翻译",
        "将发送当前完整同步歌词", "将发送歌曲标题", "将发送歌手名称",
        "此请求可能产生 API 费用", "确认前取消不会发送请求；切歌或关闭时可取消",
        "失败不会替换或保存当前译文"
    ));

    private CredentialAcceptanceTest() { }

    public static void run(Instrumentation instrumentation, ScenarioProgress progress, Bundle arguments) {
        String phase = arguments.getString("credentialPhase", "baseline");
        if (!"baseline".equals(phase) && !"resume".equals(phase)) throw new IllegalArgumentException("credential-phase-invalid");
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
        if (!ui.waitLabel("设置", false, 20_000L) || !ui.click("设置")) {
            emit(instrumentation, phase, "entry", "UNAVAILABLE"); return;
        }
        if (!ui.scrollFind("打开账号与来源") || !ui.click("打开账号与来源")) {
            emit(instrumentation, phase, "account", "UNAVAILABLE");
        } else {
            boolean authenticated = ui.waitLabel("已登录", true, 10_000L);
            if (!authenticated) { ui.scrollForward(); authenticated = ui.waitLabel("已登录", true, 3_000L); }
            emit(instrumentation, phase, "account", authenticated ? "AUTHENTICATED" : "NOT_AUTHENTICATED");
            ui.back();
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

    private static void emit(Instrumentation instrumentation, String phase, String name, String value) {
        // All values are compile-time enums. Account names, lyrics and secrets never reach stdout.
        Bundle status = new Bundle();
        status.putString("stream", "credential-observation=" + phase + ":" + name + ":" + value + "\n");
        instrumentation.sendStatus(0, status);
    }

    private static final class SafeUi {
        private final Instrumentation instrumentation;
        SafeUi(Instrumentation value) { instrumentation = value; }
        boolean sensitiveEntry() { return inspect(null, false, false, true) || hasLabel("Bilibili 登录二维码", false); }
        boolean hasLabel(String label, boolean prefix) { return inspect(label, prefix, false, false); }
        boolean enabled(String label) { return inspect(label, false, true, false); }
        boolean waitLabel(String label, boolean prefix, long timeout) {
            long deadline = SystemClock.elapsedRealtime() + timeout;
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
            long deadline = SystemClock.elapsedRealtime() + timeout;
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
