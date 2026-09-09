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
import androidx.room.Room;

import com.dazzlingwuming.listen2.data.Listen2Database;
import com.dazzlingwuming.listen2.data.LocalDataRepository;
import com.dazzlingwuming.listen2.data.LyricRepository;
import com.dazzlingwuming.listen2.library.AndroidLocalDataFacade;
import com.dazzlingwuming.listen2.library.BackupJsonCodec;
import com.dazzlingwuming.listen2.library.BackupSafFilePort;
import com.dazzlingwuming.listen2.platform.AndroidKeystoreCredentialVault;
import com.dazzlingwuming.listen2.platform.AndroidMediaFilePort;
import com.dazzlingwuming.listen2.platform.AndroidMediaCache;
import com.dazzlingwuming.listen2.platform.AndroidDeepSeekTranslationPort;
import com.dazzlingwuming.listen2.platform.AndroidSafBackupPort;
import com.dazzlingwuming.listen2.platform.BilibiliQrGateway;
import com.dazzlingwuming.listen2.platform.SafLocalMusicIndexer;
import com.dazzlingwuming.listen2.platform.SafMediaReferencePort;
import com.dazzlingwuming.listen2.provider.BilibiliAccountSession;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * A deliberately narrow Android host for the browser-compatible Listen1 UI.
 *
 * Only assets packaged in this APK are rendered inside WebView. Remote links
 * never replace that app surface: supported links open in the device browser.
 */
public final class MainActivity extends Activity {
    private static final String START_PAGE =
            "https://" + NavigationPolicy.APP_ASSET_HOST + "/assets/listen1/listen1.html";
    private static final int REQUEST_OPEN_AUDIO_DOCUMENT = 4101;
    private static final int REQUEST_OPEN_AUDIO_TREE = 4102;
    private static final int REQUEST_CREATE_BACKUP_DOCUMENT = 4103;
    private static final int REQUEST_OPEN_BACKUP_DOCUMENT = 4104;

    private WebView webView;
    private View loadingView;
    private TextView loadingMessage;
    private WebViewAssetLoader assetLoader;
    private AndroidHttpBridge httpBridge;
    private PlaybackBridgeController playbackController;
    private LyricRepository lyricRepository;
    private Listen2Database sharedDatabase;
    private AndroidLocalDataFacade localDataFacade;
    private SafLocalMusicIndexer safLocalMusicIndexer;
    // Retained as a native-only future Media3 seam. It is not installed in the bridge.
    private SafMediaReferencePort safMediaReferencePort;
    private AndroidSafBackupPort backupSafPort;
    private final Object backupFileLock = new Object();
    private BackupSafFilePort.PendingOperation backupPickerOperation;
    private LocalDataRepository.Backup stagedBackup;
    private BackupSafFilePort.PageSafeStatus backupFileStatus =
            new BackupSafFilePort.PageSafeStatus("idle", "IDLE", null);
    private final ExecutorService localDataExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "listen2-local-data");
        thread.setDaemon(true);
        return thread;
    });
    private final Object localDataLifecycleLock = new Object();
    private int pendingLocalDataTasks;
    private boolean localDataClosing;
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
        if (httpBridge != null) {
            // The page receives only semantic DeepSeek DTOs. The port owns the
            // Keystore and native client; no key or transport handle enters WebView.
            httpBridge.setDeepSeekTranslationPort(new AndroidDeepSeekTranslationPort(this));
        }
        initializeNativeDataOwners();
        connectPlaybackService();
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        loadingView = createLoadingView();
        root.addView(loadingView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView.loadUrl(START_PAGE);
    }

    /**
     * One application-context Room v5 owner keeps lyric and local-library data
     * in the same migration chain. Nothing here grants paths, URIs, cookies, or
     * credentials to the packaged page; the bridge receives semantic facades.
     */
    private void initializeNativeDataOwners() {
        sharedDatabase = Room.databaseBuilder(getApplicationContext(), Listen2Database.class, "listen2.db")
                .addMigrations(Listen2Database.MIGRATION_1_2, Listen2Database.MIGRATION_2_3,
                        Listen2Database.MIGRATION_3_4, Listen2Database.MIGRATION_4_5)
                .build();
        lyricRepository = new LyricRepository(sharedDatabase);
        AndroidMediaFilePort mediaFiles = new AndroidMediaFilePort(getApplicationContext());
        LocalDataRepository localRepository = new LocalDataRepository(sharedDatabase, mediaFiles);
        localDataFacade = new AndroidLocalDataFacade(localRepository);
        backupSafPort = new AndroidSafBackupPort(getApplicationContext());
        final AndroidLocalDataFacade facade = localDataFacade;
        SafLocalMusicIndexer indexer = new SafLocalMusicIndexer(getApplicationContext(), sharedDatabase,
                localDataFacade);
        safLocalMusicIndexer = indexer;
        safMediaReferencePort = new SafMediaReferencePort(getApplicationContext(), sharedDatabase);
        submitLocalDataTask(indexer::recheckAndIndexAll);
        BilibiliAccountSession accountSession = new BilibiliAccountSession(
                new BilibiliQrGateway(CookieManager.getInstance()),
                new AndroidKeystoreCredentialVault(getApplicationContext()));
        if (httpBridge != null) {
            httpBridge.setLyricPersistencePort(lyricRepository);
            httpBridge.setLocalDataFacade(localDataFacade);
            httpBridge.setLocalLyricPort(safMediaReferencePort);
            httpBridge.setBilibiliAccountSession(accountSession);
            httpBridge.setMediaDownloadPort(new AndroidMediaDownloadPort(
                    new AndroidMediaCache(getApplicationContext()), localRepository,
                    new BilibiliPlaybackResolver(() -> {
                        try {
                            return CookieManager.getInstance().getCookie("https://api.bilibili.com");
                        } catch (RuntimeException ignored) {
                            return null;
                        }
                    }), new NetEasePlaybackResolver(), command -> {
                        if (!submitLocalDataTask(command)) throw new RejectedExecutionException();
                    }));
            httpBridge.setLocalTrackMaintenancePort(new AndroidHttpBridge.LocalTrackMaintenancePort() {
                @Override
                public LocalDataRepository.Result<?> refresh() {
                    return runLocalDataTask(() -> {
                        indexer.recheckAndIndexAll();
                        return facade.listLocalMediaTracks();
                    });
                }

                @Override
                public LocalDataRepository.Result<?> repair(String grantReferenceId) {
                    return runLocalDataTask(() -> {
                        indexer.recheckAndIndex(grantReferenceId);
                        LocalDataRepository.Result<java.util.List<LocalDataRepository.SafGrantView>> grants =
                                facade.listSafGrants();
                        if (!grants.ok || grants.value == null) {
                            return LocalDataRepository.Result.error(LocalDataRepository.CORRUPT);
                        }
                        for (LocalDataRepository.SafGrantView grant : grants.value) {
                            if (!grantReferenceId.equals(grant.referenceId)) continue;
                            if ("active".equals(grant.state)) return facade.listLocalMediaTracks();
                            if ("revoked".equals(grant.state)) {
                                return LocalDataRepository.Result.error(LocalDataRepository.GRANT_INVALID);
                            }
                            return LocalDataRepository.Result.error(LocalDataRepository.NEEDS_REPAIR);
                        }
                        return LocalDataRepository.Result.error(LocalDataRepository.NOT_FOUND);
                    });
                }
            });
            httpBridge.setPlatformActionPort(new AndroidHttpBridge.PlatformActionPort() {
                @Override
                public boolean launchAudioPicker() {
                    return requestSafAudioDocument();
                }

                @Override
                public boolean launchTreePicker() {
                    return requestSafMusicTree();
                }

                @Override
                public boolean launchBackupExportPicker() { return requestBackupExport(); }

                @Override
                public boolean launchBackupImportPicker() { return requestBackupImport(); }
            });
            httpBridge.setExternalBackupPort(new AndroidHttpBridge.ExternalBackupPort() {
                @Override public BackupSafFilePort.PageSafeStatus status() { return currentBackupFileStatus(); }
                @Override public LocalDataRepository.Result<LocalDataRepository.BackupPreview> preview() {
                    LocalDataRepository.Backup backup = currentStagedBackup();
                    return backup == null ? LocalDataRepository.Result.error(LocalDataRepository.NOT_FOUND)
                            : facade.previewBackup(backup);
                }
                @Override public LocalDataRepository.Result<LocalDataRepository.BackupPreview> importBackup(
                        String mode, boolean confirmed) {
                    LocalDataRepository.Backup backup = currentStagedBackup();
                    LocalDataRepository.Result<LocalDataRepository.BackupPreview> result = backup == null
                            ? LocalDataRepository.Result.error(LocalDataRepository.NOT_FOUND)
                            : facade.importBackup(backup, mode, confirmed);
                    if (result.ok) setBackupFileStatus("imported", "OK", null);
                    return result;
                }
            });
        }
    }

    /** Runs scanner work on the same counted executor used by picker imports. */
    private LocalDataRepository.Result<?> runLocalDataTask(
            Callable<LocalDataRepository.Result<?>> task) {
        Future<LocalDataRepository.Result<?>> future;
        synchronized (localDataLifecycleLock) {
            if (localDataClosing || localDataExecutor.isShutdown()) {
                return LocalDataRepository.Result.error(LocalDataRepository.IO_UNAVAILABLE);
            }
            pendingLocalDataTasks += 1;
            try {
                future = localDataExecutor.submit(() -> {
                    try {
                        LocalDataRepository.Result<?> result = task.call();
                        return result == null
                                ? LocalDataRepository.Result.error(LocalDataRepository.CORRUPT)
                                : result;
                    } finally {
                        finishLocalDataTask();
                    }
                });
            } catch (RejectedExecutionException rejected) {
                pendingLocalDataTasks -= 1;
                return LocalDataRepository.Result.error(LocalDataRepository.IO_UNAVAILABLE);
            }
        }
        try {
            LocalDataRepository.Result<?> result = future.get(20L, TimeUnit.SECONDS);
            return result == null ? LocalDataRepository.Result.error(LocalDataRepository.CORRUPT) : result;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return LocalDataRepository.Result.error(LocalDataRepository.IO_UNAVAILABLE);
        } catch (ExecutionException | TimeoutException ignored) {
            // A timed-out scan remains counted and is allowed to finish before
            // the shared Room owner is closed during Activity destruction.
            return LocalDataRepository.Result.error(LocalDataRepository.IO_UNAVAILABLE);
        }
    }

    /** Opens the system document picker for one or more user-selected audio documents. */
    public boolean requestSafAudioDocument() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            // Some providers classify audio-bearing MP4/WebM files as video;
            // retain a narrow multi-MIME allow-list instead of granting a
            // broad filesystem or media-library permission.
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES,
                    new String[]{"audio/*", "video/mp4", "video/webm"});
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(intent, REQUEST_OPEN_AUDIO_DOCUMENT);
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    /** Opens the system document-tree picker for a user-selected music directory. */
    public boolean requestSafMusicTree() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(intent, REQUEST_OPEN_AUDIO_TREE);
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    /** Starts a native-only snapshot/export. The page neither supplies nor sees a document URI. */
    private boolean requestBackupExport() {
        AndroidLocalDataFacade facade = localDataFacade;
        AndroidSafBackupPort port = backupSafPort;
        if (facade == null || port == null) return false;
        setBackupFileStatus("preparing", "PREPARING", null);
        return submitLocalDataTask(() -> {
            BackupSafFilePort.StartResult started = port.beginExport(facade.exportBackup());
            if (!started.ok) { setBackupFileStatus("failed", started.status, null); return; }
            runOnUiThread(() -> launchBackupPicker(started.pendingOperation,
                    REQUEST_CREATE_BACKUP_DOCUMENT));
        });
    }

    private boolean requestBackupImport() {
        AndroidSafBackupPort port = backupSafPort;
        if (port == null) return false;
        BackupSafFilePort.StartResult started = port.beginImport();
        if (!started.ok) { setBackupFileStatus("failed", started.status, null); return false; }
        setBackupFileStatus("preparing", "PREPARING", null);
        runOnUiThread(() -> launchBackupPicker(started.pendingOperation, REQUEST_OPEN_BACKUP_DOCUMENT));
        return true;
    }

    private void launchBackupPicker(BackupSafFilePort.PendingOperation operation, int requestCode) {
        if (operation == null || backupSafPort == null) return;
        synchronized (backupFileLock) { backupPickerOperation = operation; }
        try {
            Intent intent = new Intent(requestCode == REQUEST_CREATE_BACKUP_DOCUMENT
                    ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(operation.mimeType());
            if (requestCode == REQUEST_CREATE_BACKUP_DOCUMENT) {
                intent.putExtra(Intent.EXTRA_TITLE, "listen2-backup-v1.json");
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else {
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            startActivityForResult(intent, requestCode);
            setBackupFileStatus("pending", "PICKER_PENDING", null);
        } catch (RuntimeException error) {
            backupSafPort.cancel(operation);
            synchronized (backupFileLock) { if (backupPickerOperation == operation) backupPickerOperation = null; }
            setBackupFileStatus("failed", "PICKER_UNAVAILABLE", null);
        }
    }

    private void completeBackupPicker(Intent data, int resultCode) {
        final BackupSafFilePort.PendingOperation operation;
        synchronized (backupFileLock) { operation = backupPickerOperation; backupPickerOperation = null; }
        AndroidSafBackupPort port = backupSafPort;
        if (operation == null || port == null) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            port.cancel(operation); setBackupFileStatus("cancelled", "CANCELLED", null); return;
        }
        Uri selected = data.getData();
        setBackupFileStatus("reading", "READING", null);
        if (!submitLocalDataTask(() -> {
            BackupSafFilePort.Completion completed = port.completeActivityResult(operation, selected);
            if (!completed.ok) { setBackupFileStatus("failed", completed.status, null); return; }
            if (completed.exported) { setBackupFileStatus("exported", "OK", null); return; }
            synchronized (backupFileLock) { stagedBackup = completed.importedBackup; }
            setBackupFileStatus("ready", "OK", completed.preview);
        })) setBackupFileStatus("failed", "IO_UNAVAILABLE", null);
    }

    private BackupSafFilePort.PageSafeStatus currentBackupFileStatus() {
        synchronized (backupFileLock) { return backupFileStatus; }
    }

    private LocalDataRepository.Backup currentStagedBackup() {
        synchronized (backupFileLock) { return stagedBackup; }
    }

    private void setBackupFileStatus(String state, String status,
            BackupJsonCodec.BackupPreview preview) {
        synchronized (backupFileLock) {
            backupFileStatus = new BackupSafFilePort.PageSafeStatus(state, status, preview);
            if (!"ready".equals(state) && !"imported".equals(state)) stagedBackup = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CREATE_BACKUP_DOCUMENT || requestCode == REQUEST_OPEN_BACKUP_DOCUMENT) {
            completeBackupPicker(data, resultCode);
            return;
        }
        if ((requestCode != REQUEST_OPEN_AUDIO_DOCUMENT && requestCode != REQUEST_OPEN_AUDIO_TREE)
                || resultCode != RESULT_OK || data == null) return;
        Set<Uri> selectedUris = new LinkedHashSet<>();
        if (data.getData() != null) selectedUris.add(data.getData());
        android.content.ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index += 1) {
                Uri uri = clipData.getItemAt(index).getUri();
                if (uri != null) selectedUris.add(uri);
            }
        }
        if (selectedUris.isEmpty()) return;
        int grantFlags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
        if (grantFlags == 0) return;
        String kind = requestCode == REQUEST_OPEN_AUDIO_DOCUMENT ? "document" : "tree";
        for (Uri selected : selectedUris) {
            if (selected == null) continue;
            try {
                getContentResolver().takePersistableUriPermission(selected, grantFlags);
            } catch (SecurityException ignored) {
                // One provider item may decline persistence; keep importing the
                // other selected items and leave no non-persisted catalog row.
                continue;
            }
            persistSafGrant(kind, selected);
        }
    }

    private void persistSafGrant(String kind, Uri selected) {
        AndroidLocalDataFacade facade = localDataFacade;
        if (facade == null || selected == null || !"content".equalsIgnoreCase(selected.getScheme())) return;
        String rawReference = selected.toString();
        String referenceId = "saf." + kind + "." + sha256(rawReference);
        String displayName = "document".equals(kind) ? "Selected audio" : "Selected music folder";
        // Keep the two grant kinds structurally distinct. The unused column is
        // deliberately empty, so a tree grant can never be mistaken for a
        // single-document grant during a later re-check.
        String treeReference = "tree".equals(kind) ? rawReference : "";
        String documentReference = "document".equals(kind) ? rawReference : "";
        LocalDataRepository.SafGrant grant = new LocalDataRepository.SafGrant(referenceId,
                treeReference, documentReference, displayName, kind);
        SafLocalMusicIndexer indexer = safLocalMusicIndexer;
        submitLocalDataTask(() -> {
            LocalDataRepository.Result<LocalDataRepository.SafGrantView> saved = facade.recordSafGrant(grant);
            if (saved.ok && indexer != null) indexer.recheckAndIndex(referenceId);
        });
    }

    /**
     * Tracks every Room-using task so Activity destruction cannot close the
     * application-context database underneath a scan or grant write.
     */
    private boolean submitLocalDataTask(Runnable task) {
        synchronized (localDataLifecycleLock) {
            if (localDataClosing || localDataExecutor.isShutdown()) return false;
            pendingLocalDataTasks += 1;
            try {
                localDataExecutor.execute(() -> {
                    try {
                        task.run();
                    } finally {
                        finishLocalDataTask();
                    }
                });
                return true;
            } catch (RejectedExecutionException rejected) {
                pendingLocalDataTasks -= 1;
                return false;
            }
        }
    }

    private void finishLocalDataTask() {
        Listen2Database databaseToClose = null;
        synchronized (localDataLifecycleLock) {
            pendingLocalDataTasks -= 1;
            if (localDataClosing && pendingLocalDataTasks == 0) {
                databaseToClose = sharedDatabase;
                sharedDatabase = null;
            }
        }
        if (databaseToClose != null) databaseToClose.close();
    }

    private static String sha256(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(bytes.length * 2);
            for (byte valueByte : bytes) {
                result.append(String.format(java.util.Locale.ROOT, "%02x", valueByte));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
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
        Listen2Database databaseToClose = null;
        synchronized (localDataLifecycleLock) {
            localDataClosing = true;
            // Let already accepted scans finish; finishLocalDataTask closes the
            // Room owner only after the last task releases it.
            localDataExecutor.shutdown();
            if (pendingLocalDataTasks == 0) {
                databaseToClose = sharedDatabase;
                sharedDatabase = null;
            }
        }
        if (databaseToClose != null) databaseToClose.close();
        lyricRepository = null;
        localDataFacade = null;
        safLocalMusicIndexer = null;
        safMediaReferencePort = null;
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
