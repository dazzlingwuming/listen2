package com.dazzlingwuming.listen2;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
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

import com.dazzlingwuming.listen2.data.LyricRepository;

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
    private PlaybackBridgeController playbackController;
    private LyricRepository lyricRepository;
    private boolean playbackServiceBound;
    private boolean navigationInProgress;

    private final ServiceConnection playbackServiceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            if (!(binder instanceof PlaybackService.PageBinder) || httpBridge == null) return;
            PlaybackBridgeController.ServicePort port =
                    ((PlaybackService.PageBinder) binder).getPort();
            playbackController = new PlaybackBridgeController(port);
            httpBridge.setPlaybackController(playbackController);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            playbackController = null;
            if (httpBridge != null) httpBridge.setPlaybackController(null);
        }
    };

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
        lyricRepository = LyricRepository.open(getApplicationContext());
        if (httpBridge != null) httpBridge.setLyricPersistencePort(lyricRepository);
        connectPlaybackService();
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        loadingView = createLoadingView();
        root.addView(loadingView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView.loadUrl(START_PAGE);
    }

    private void connectPlaybackService() {
        Intent intent = new Intent(this, PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_PAGE_PORT);
        playbackServiceBound = bindService(intent, playbackServiceConnection, Context.BIND_AUTO_CREATE);
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
        if (webView != null && navigationInProgress) {
            // Cancelling a renderer navigation must not affect service-owned audio.
            webView.stopLoading();
            if (httpBridge != null) httpBridge.onPageStarted();
            navigationInProgress = false;
            if (loadingView != null) loadingView.setVisibility(View.GONE);
            return;
        }
        if (requestPackagedPlayerBack()) return;
        finishBackNavigation();
    }

    private boolean requestPackagedPlayerBack() {
        if (webView == null) return false;
        // Plan 02-07 supplies this bounded UI-only hook. No native back path
        // pauses/releases the service, and absent/retiring pages fall through.
        webView.evaluateJavascript("(function(){var handler=window.Listen2AndroidPlaybackBack;"
                + "return typeof handler === 'function' && handler() ? 'true' : 'false';})()",
                value -> {
                    if (!"\"true\"".equals(value)) finishBackNavigation();
                });
        return true;
    }

    private void finishBackNavigation() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        WebView retiringWebView = webView;
        webView = null;
        navigationInProgress = false;
        if (playbackServiceBound) {
            unbindService(playbackServiceConnection);
            playbackServiceBound = false;
        }
        // The bridge detaches page authority before renderer destruction. It never
        // releases, pauses, or otherwise owns the service player.
        playbackController = null;
        if (retiringWebView != null) {
            retiringWebView.stopLoading();
            if (httpBridge != null) {
                httpBridge.destroy(retiringWebView);
                httpBridge = null;
            }
            // Detach callback owners before destroying the renderer. Late bridge posts are inert.
            retiringWebView.setWebViewClient(null);
            retiringWebView.setWebChromeClient(null);
            retiringWebView.clearHistory();
            retiringWebView.removeAllViews();
            ViewParent parent = retiringWebView.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(retiringWebView);
            }
            retiringWebView.destroy();
        }
        if (lyricRepository != null) {
            lyricRepository.close();
            lyricRepository = null;
        }
        loadingView = null;
        loadingMessage = null;
        super.onDestroy();
    }

    /** Dispatches the already-sanitized external URI without forwarding WebView state or extras. */
    boolean launchExternalNavigation(NavigationPolicy.ExternalNavigationDecision decision) {
        if (decision == null || !decision.isExternal() || decision.getExternalUri() == null) {
            return false;
        }
        Intent external = new Intent(Intent.ACTION_VIEW,
                Uri.parse(decision.getExternalUri().toASCIIString()));
        external.addCategory(Intent.CATEGORY_BROWSABLE);
        if (external.resolveActivity(getPackageManager()) == null) return false;
        try {
            startActivity(external);
            return true;
        } catch (RuntimeException ignored) {
            // Missing/disabled system handlers leave the packaged page unchanged.
            return false;
        }
    }

    private final class PackagedUiClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(
                WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl().toString(), request.isForMainFrame());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(url, true);
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            navigationInProgress = true;
            if (httpBridge != null) httpBridge.onPageStarted();
            if (NavigationPolicy.isPackagedAssetUrl(url) && loadingView != null) {
                loadingView.setVisibility(View.VISIBLE);
            }
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (NavigationPolicy.isPackagedAssetUrl(url) && loadingView != null) {
                navigationInProgress = false;
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

        private boolean handleNavigation(String url, boolean isMainFrame) {
            // Iframes never receive bridge authority and are not an alternate in-app surface.
            if (!isMainFrame) return true;
            NavigationPolicy.ExternalNavigationDecision decision =
                    NavigationPolicy.decideNavigation(url);
            if (decision.isPackaged()) {
                return false;
            }
            if (decision.isExternal()) {
                launchExternalNavigation(decision);
            }
            // Block every non-packaged navigation, including file:, content: and intent:.
            return true;
        }
    }
}
