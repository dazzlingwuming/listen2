package com.dazzlingwuming.listen2;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;


/** API-35 runtime assertions for the packaged WebView boundary; they never contact a provider. */
public final class Phase01WebViewInstrumentationTest {
    private static final long TIMEOUT_MILLIS = 10_000L;
    private static final String PACKAGED_PREFIX = "https://"
            + NavigationPolicy.APP_ASSET_HOST + "/assets/listen1/";

    @Test
    public void testPackagedMainFrameExposesOneBridgeAndRejectsInvalidTypedEnvelope() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Activity activity = launch(instrumentation);
        try {
            WebView view = findWebView(instrumentation, activity);
            waitForPackagedPage(activity, view);
            assertEquals("\"bridge-present\"", evaluate(activity, view,
                    "(window.Listen2AndroidHttp && typeof window.Listen2AndroidHttp.postMessage === 'function')"
                            + " ? 'bridge-present' : 'bridge-missing'"));
            assertEquals("\"posted\"", evaluate(activity, view,
                    "(() => { window.__phase01Reply = 'waiting';"
                            + "const bridge = window.Listen2AndroidHttp; const previous = bridge.onmessage;"
                            + "bridge.onmessage = event => {"
                            + "if (typeof event.data === 'string' && event.data.indexOf('phase01-invalid') >= 0)"
                            + " window.__phase01Reply = event.data;"
                            + "if (typeof previous === 'function') previous.call(bridge, event); };"
                            + "bridge.postMessage(JSON.stringify({version:2,requestId:'phase01-invalid',"
                            + "pageEpoch:1,operation:'invalid.operation',payload:{}})); return 'posted'; })()"));
            String reply = waitForJavaScript(activity, view,
                    "window.__phase01Reply === 'waiting' ? '' : window.__phase01Reply");
            assertTrue(reply.contains("UNSUPPORTED_OPERATION"));
            assertTrue(reply.contains("phase01-invalid"));
        } finally {
            activity.finish();
        }
    }

    @Test
    public void testRuntimeSettingsAndNavigationHandoffAreHardened() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Activity activity = launch(instrumentation);
        try {
            WebView view = findWebView(instrumentation, activity);
            waitForPackagedPage(activity, view);
            assertRuntimeSettings(instrumentation, view);
            assertEquals("\"blocked\"", waitForJavaScript(activity, view,
                    "(() => { if (!window.__phase01Geo) { window.__phase01Geo = 'waiting';"
                            + "navigator.geolocation.getCurrentPosition("
                            + "() => window.__phase01Geo = 'unexpected-success',"
                            + "() => window.__phase01Geo = 'blocked',{timeout:100}); return ''; }"
                            + "return window.__phase01Geo === 'waiting' ? '' : window.__phase01Geo; })()"));

            IntentFilter filter = new IntentFilter(Intent.ACTION_VIEW);
            filter.addCategory(Intent.CATEGORY_BROWSABLE);
            filter.addDataScheme("https");
            Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(filter, null, true);
            try {
                AtomicReference<Boolean> opened = new AtomicReference<>(false);
                instrumentation.runOnMainSync(() -> opened.set(((MainActivity) activity).launchExternalNavigation(
                        NavigationPolicy.decideNavigation(
                                "https://example.com/help?topic=android#discarded"))));
                assertTrue(opened.get());
                assertTrue(waitForMonitorHit(monitor));
            } finally {
                instrumentation.removeMonitor(monitor);
            }
            assertTrue(currentUrl(instrumentation, view).startsWith(PACKAGED_PREFIX));
            evaluate(activity, view, "(() => { const link = document.createElement('a');"
                    + "link.href = 'intent://untrusted'; document.body.appendChild(link); link.click();"
                    + "return 'unsafe-requested'; })()");
            Thread.sleep(250L);
            assertTrue(currentUrl(instrumentation, view).startsWith(PACKAGED_PREFIX));
            evaluate(activity, view, "(() => { const link = document.createElement('a');"
                    + "link.href = 'https://appassets.androidplatform.net/assets/listen10/escape.html';"
                    + "document.body.appendChild(link); link.click(); return 'adjacent-requested'; })()");
            Thread.sleep(250L);
            assertTrue(currentUrl(instrumentation, view).startsWith(PACKAGED_PREFIX));
        } finally {
            activity.finish();
        }
    }

    @Test
    public void testReloadAndDestroySuppressOldBridgeWork() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Activity activity = launch(instrumentation);
        try {
            WebView view = findWebView(instrumentation, activity);
            waitForPackagedPage(activity, view);
            evaluate(activity, view, "(() => {"
                    + "sessionStorage.setItem('phase01-reload-replies', '0');"
                    + "const bridge = window.Listen2AndroidHttp;"
                    + "bridge.addEventListener('message', event => {"
                    + "if (typeof event.data === 'string' && event.data.indexOf('phase01-reload') >= 0) {"
                    + "const value = Number(sessionStorage.getItem('phase01-reload-replies') || '0');"
                    + "sessionStorage.setItem('phase01-reload-replies', String(value + 1)); }});"
                    + "bridge.postMessage(JSON.stringify({version:2,requestId:'phase01-reload',"
                    + "pageEpoch:1,operation:'invalid.operation',payload:{}}));"
                    + "location.reload(); return 'reload-requested'; })()");
            waitForPackagedPage(activity, view);
            String replyCount = evaluate(activity, view,
                    "sessionStorage.getItem('phase01-reload-replies') || '0'");
            assertTrue("\"0\"".equals(replyCount) || "\"1\"".equals(replyCount));

            activity.finish();
            instrumentation.waitForIdleSync();
            assertTrue(activity.isFinishing() || activity.isDestroyed());
        } finally {
            if (!activity.isFinishing() && !activity.isDestroyed()) activity.finish();
        }
    }

    private static Activity launch(Instrumentation instrumentation) {
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = instrumentation.startActivitySync(intent);
        assertNotNull(activity);
        return activity;
    }

    private static WebView findWebView(Instrumentation instrumentation, Activity activity) {
        AtomicReference<WebView> webView = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> webView.set(findWebView(activity.getWindow().getDecorView())));
        assertNotNull(webView.get());
        return webView.get();
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (!(view instanceof ViewGroup)) return null;
        ViewGroup group = (ViewGroup) view;
        for (int index = 0; index < group.getChildCount(); index += 1) {
            WebView match = findWebView(group.getChildAt(index));
            if (match != null) return match;
        }
        return null;
    }

    private static void assertRuntimeSettings(Instrumentation instrumentation, WebView view) {
        instrumentation.runOnMainSync(() -> {
            WebSettings settings = view.getSettings();
            assertFalse(settings.getAllowFileAccess());
            assertFalse(settings.getAllowContentAccess());
            assertFalse(settings.getAllowFileAccessFromFileURLs());
            assertFalse(settings.getAllowUniversalAccessFromFileURLs());
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, settings.getMixedContentMode());
            assertFalse(settings.getJavaScriptCanOpenWindowsAutomatically());
            assertFalse(settings.supportMultipleWindows());
            assertTrue(settings.getMediaPlaybackRequiresUserGesture());
            assertTrue(settings.getSafeBrowsingEnabled());
            assertFalse(CookieManager.getInstance().acceptThirdPartyCookies(view));
        });
    }

    private static void waitForPackagedPage(Activity activity, WebView view) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MILLIS);
        while (System.nanoTime() < deadline) {
            String url = evaluate(activity, view, "location.href");
            if (url.startsWith("\"" + PACKAGED_PREFIX)) return;
            Thread.sleep(100L);
        }
        throw new AssertionError("timed out waiting for packaged WebView page");
    }

    private static String waitForJavaScript(Activity activity, WebView view, String script) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MILLIS);
        String result = "\"\"";
        while (System.nanoTime() < deadline) {
            result = evaluate(activity, view, script);
            if (!"\"\"".equals(result) && !"null".equals(result)) return result;
            Thread.sleep(100L);
        }
        throw new AssertionError("timed out waiting for packaged WebView step");
    }

    private static String evaluate(Activity activity, WebView view, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        activity.runOnUiThread(() -> view.evaluateJavascript(script, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String result) {
                value.set(result);
                latch.countDown();
            }
        }));
        assertTrue(latch.await(TIMEOUT_MILLIS, TimeUnit.MILLISECONDS));
        return value.get();
    }

    private static String currentUrl(Instrumentation instrumentation, WebView view) {
        AtomicReference<String> url = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> url.set(view.getUrl()));
        return url.get() == null ? "" : url.get();
    }

    private static boolean waitForMonitorHit(Instrumentation.ActivityMonitor monitor) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MILLIS);
        while (System.nanoTime() < deadline) {
            if (monitor.getHits() > 0) return true;
            Thread.sleep(100L);
        }
        return false;
    }
}
