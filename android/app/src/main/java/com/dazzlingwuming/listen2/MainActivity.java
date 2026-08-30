package com.dazzlingwuming.listen2;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;

/**
 * A deliberately narrow Android host for the browser-compatible Listen1 UI.
 *
 * Only assets packaged in this APK are rendered inside WebView. Remote links
 * never replace that app surface: supported links open in the device browser.
 */
public final class MainActivity extends Activity {
    private static final String START_PAGE =
            "https://" + NavigationPolicy.APP_ASSET_HOST + "/assets/listen1/listen1.html";

    private WebView webView;
    private View loadingView;
    private TextView loadingMessage;
    private WebViewAssetLoader assetLoader;
    private AndroidHttpBridge httpBridge;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.Theme_Listen2);
        super.onCreate(savedInstanceState);
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(13, 16, 23));
        applySystemBarInsets(root);
        webView = new WebView(this);
        configureWebView(webView);
        httpBridge = AndroidHttpBridge.install(webView);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        loadingView = createLoadingView();
        root.addView(loadingView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView.loadUrl(START_PAGE);
    }

    private void applySystemBarInsets(View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return;
        }
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        root.requestApplyInsets();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(
                NavigationPolicy.ALLOW_FILE_ACCESS_FROM_FILE_URLS);
        settings.setAllowUniversalAccessFromFileURLs(
                NavigationPolicy.ALLOW_UNIVERSAL_ACCESS_FROM_FILE_URLS);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setSafeBrowsingEnabled(true);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(view, false);

        view.setBackgroundColor(Color.rgb(13, 16, 23));
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        view.setWebViewClient(new PackagedUiClient());
    }

    private View createLoadingView() {
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setGravity(Gravity.CENTER);
        container.setBackgroundColor(Color.rgb(13, 16, 23));

        ProgressBar progress = new ProgressBar(this);
        container.addView(progress);
        loadingMessage = new TextView(this);
        loadingMessage.setText(R.string.loading);
        loadingMessage.setTextColor(Color.WHITE);
        loadingMessage.setPadding(0, 24, 0, 0);
        container.addView(loadingMessage);
        return container;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            if (httpBridge != null) {
                httpBridge.destroy(webView);
                httpBridge = null;
            }
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class PackagedUiClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(
                WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl().toString());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(url);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (NavigationPolicy.isPackagedAssetUrl(url) && loadingView != null) {
                loadingView.setVisibility(View.GONE);
            }
        }

        @Override
        public void onReceivedError(
                WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
            if (request.isForMainFrame() && loadingMessage != null) {
                loadingMessage.setText(R.string.load_failed);
            }
        }

        private boolean handleNavigation(String url) {
            if (NavigationPolicy.isPackagedAssetUrl(url)) {
                return false;
            }
            if (NavigationPolicy.isApprovedExternalUrl(url)) {
                Intent external = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                external.addCategory(Intent.CATEGORY_BROWSABLE);
                if (external.resolveActivity(getPackageManager()) != null) {
                    startActivity(external);
                }
            }
            // Block every non-packaged navigation, including file:, content: and intent:.
            return true;
        }
    }
}
