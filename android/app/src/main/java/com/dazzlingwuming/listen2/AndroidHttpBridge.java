package com.dazzlingwuming.listen2;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import com.dazzlingwuming.listen2.library.AndroidLocalDataFacade;
import com.dazzlingwuming.listen2.library.BackupSafFilePort;
import com.dazzlingwuming.listen2.provider.BilibiliAccountSession;
import com.dazzlingwuming.listen2.provider.ProviderCapabilityFacade;
import com.dazzlingwuming.listen2.platform.AndroidDeepSeekTranslationPort;
import com.dazzlingwuming.listen2.platform.AndroidDeepSeekVault;
import com.dazzlingwuming.listen2.platform.DeepSeekRpcFacade;
import com.dazzlingwuming.listen2.platform.SafMediaReferencePort;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.HttpsURLConnection;

/**
 * A narrowly-scoped, message-based HTTP capability for the packaged WebView
 * origin. It intentionally does not expose a Java object through
 * addJavascriptInterface.
 */
final class AndroidHttpBridge {
    private static final int CONNECT_TIMEOUT_MILLIS = 10_000;
    private static final int READ_TIMEOUT_MILLIS = 15_000;
    private static final String ACCEPT_HEADER = "application/json, text/plain, */*";
    // The native client uses the same browser family as the hosted WebView;
    // callers still cannot supply or alter this header.
    private static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.219 "
            + "Mobile Safari/537.36";

    private static final long TYPED_DEADLINE_MILLIS = 25_000L;
    private static final int MAX_LOCAL_ROWS = 500;
    private static final int MAX_LOCAL_TRACKS = 5_000;
    private static final int MAX_LOCAL_TEXT = 320;
    private final ThreadPoolExecutor networkExecutor;
    private final BridgeRequestRegistry typedRequests = new BridgeRequestRegistry();
    // The v2 NetEase seam is native-owned; its operation methods project only
    // closed metadata/status DTOs and never return transport details to the page.
    private final NetEaseProviderClient netEaseProviderClient = new NetEaseProviderClient();
    // This is the one native capability truth source. The packaged page still
    // needs an adapter call-site to consume its RPC reply; it cannot self-enable
    // a provider by constructing a transport request.
    private volatile ProviderCapabilityFacade providerCapabilities = ProviderCapabilityFacade.production();
    private final BilibiliDirectoryProvider bilibiliDirectoryProvider = new BilibiliDirectoryProvider(
            null, () -> CookieManager.getInstance().getCookie("https://www.bilibili.com"));
    private final BilibiliLyricProvider bilibiliLyricProvider = new BilibiliLyricProvider();
    private volatile BilibiliAccountSession bilibiliAccountSession = new BilibiliAccountSession(null, null);
    private volatile AndroidLocalDataFacade localDataFacade;
    // MainActivity owns this native-only Room/SAF resolver. The bridge emits
    // only lyric text and a small status, never a document URI or path.
    private volatile SafMediaReferencePort localLyricPort;
    private volatile PlatformActionPort platformActionPort;
    private volatile ExternalBackupPort externalBackupPort;
    private volatile LocalTrackMaintenancePort localTrackMaintenancePort;
    private volatile MediaDownloadPort mediaDownloadPort;
    private volatile DeepSeekRpcFacade deepSeekRpcFacade;
    private LyricPersistencePort lyricPersistencePort = LyricPersistencePort.unavailable();
    // Installed by the Activity after it connects to the sole playback service.
    // This remains the existing trusted WebMessage listener, not a second bridge.
    private PlaybackBridgeController playbackController;
    // Accessed only by the single-threaded network executor. This anonymous
    // value is intentionally not written to CookieManager.
    private String anonymousBilibiliBuvid3;
    private boolean bilibiliFingerprintAttempted;
    // Listener callbacks run on the WebView main thread; workers only observe the registry state.
    private int pageGeneration;

    private AndroidHttpBridge() {
        ThreadFactory threadFactory = new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "listen2-http-bridge");
                thread.setDaemon(true);
                return thread;
            }
        };
        // A fixed queue prevents a trusted page with a bug from allocating an
        // unbounded number of pending network requests.
        networkExecutor = new ThreadPoolExecutor(
                1,
                1,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(16),
                threadFactory,
                new ThreadPoolExecutor.AbortPolicy());
    }

    static AndroidHttpBridge install(WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            return null;
        }

        AndroidHttpBridge bridge = new AndroidHttpBridge();
        WebViewCompat.addWebMessageListener(
                webView,
                HttpBridgePolicy.JAVASCRIPT_OBJECT_NAME,
                HttpBridgePolicy.ALLOWED_ORIGIN_RULES,
                bridge.new Listener());
        return bridge;
    }

    void destroy(WebView webView) {
        if (playbackController != null) playbackController.detachCurrentPage();
        typedRequests.cancelAll();
        networkExecutor.shutdownNow();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(webView, HttpBridgePolicy.JAVASCRIPT_OBJECT_NAME);
        }
    }

    /** Invalidates all outstanding page work while keeping this one bridge available to the new page. */
    void onPageStarted() {
        if (typedRequests.isDestroyed()) return;
        pageGeneration += 1;
        typedRequests.cancelForPageTransition();
        if (playbackController != null) playbackController.detachCurrentPage();
    }

    void setPlaybackController(PlaybackBridgeController controller) {
        playbackController = controller;
    }

    void setLyricPersistencePort(LyricPersistencePort port) {
        lyricPersistencePort = port == null ? LyricPersistencePort.unavailable() : port;
    }

    /** MainActivity injects the only native DeepSeek port; null is unavailable. */
    void setDeepSeekTranslationPort(AndroidDeepSeekTranslationPort port) {
        deepSeekRpcFacade = port == null ? null : new DeepSeekRpcFacade(port);
        boolean available = false;
        if (port != null) {
            try {
                AndroidDeepSeekVault.CredentialStatus status = port.status();
                available = status.secureStorageAvailable;
            } catch (RuntimeException ignored) {
                available = false;
            }
        }
        providerCapabilities = providerCapabilities.withDeepSeekTranslation(available);
    }

    /** MainActivity injects the native QR gateway + protected-vault owner; null restores unavailable. */
    void setBilibiliAccountSession(BilibiliAccountSession session) {
        BilibiliAccountSession resolved = session == null
                ? new BilibiliAccountSession(null, null) : session;
        bilibiliAccountSession = resolved;
        providerCapabilities = providerCapabilities.withBilibiliAccount(resolved.isAvailable());
    }

    /** MainActivity injects the semantic Room/SAF/cache facade; null is an explicit unavailable state. */
    void setLocalDataFacade(AndroidLocalDataFacade facade) {
        localDataFacade = facade;
    }

    void setLocalLyricPort(SafMediaReferencePort port) {
        localLyricPort = port;
    }

    /** MainActivity owns the bounded Room/scanner executor for local-track maintenance. */
    void setLocalTrackMaintenancePort(LocalTrackMaintenancePort port) {
        localTrackMaintenancePort = port;
    }

    /** MainActivity injects the native-only explicit-download owner; null is unavailable. */
    void setMediaDownloadPort(MediaDownloadPort port) {
        mediaDownloadPort = port;
    }

    interface LocalTrackMaintenancePort {
        LocalDataRepository.Result<?> refresh();
        LocalDataRepository.Result<?> repair(String grantReferenceId);
    }

    /**
     * Narrow explicit-download seam. The descriptor is semantic only and all
     * candidate, cookie, header and app-private file work remains native.
     */
    interface MediaDownloadPort {
        MediaDownloadReply start(String operationId, PlaybackMediaResolver.Descriptor descriptor,
                NativeMediaDownloadCoordinator.Retention retention);
        MediaDownloadReply status(String operationId);
        MediaDownloadReply cancel(String operationId);
        MediaDownloadReply delete(PlaybackMediaResolver.Descriptor descriptor);
        MediaDownloadReply cleanup();
    }

    /** Page-safe operation state: no digest, candidate, URL, path or storage key is exposed. */
    static final class MediaDownloadReply {
        final String operationId;
        final String status;
        final String source;
        final String providerTrackId;
        final long byteCount;
        final String retention;

        private MediaDownloadReply(String operationId, String status,
                PlaybackMediaResolver.Descriptor descriptor, long byteCount,
                NativeMediaDownloadCoordinator.Retention retention) {
            this.operationId = operationId == null ? "" : operationId;
            this.status = status == null ? "failed" : status;
            this.source = descriptor == null ? "" : descriptor.getSource();
            this.providerTrackId = descriptor == null ? "" : descriptor.getProviderTrackId();
            this.byteCount = Math.max(0L, byteCount);
            this.retention = retention == null ? "" : retention.wireValue;
        }

        static MediaDownloadReply operation(String operationId, String status,
                PlaybackMediaResolver.Descriptor descriptor, long byteCount,
                NativeMediaDownloadCoordinator.Retention retention) {
            return new MediaDownloadReply(operationId, status, descriptor, byteCount, retention);
        }
        static MediaDownloadReply cacheAction(String status, PlaybackMediaResolver.Descriptor descriptor) {
            return new MediaDownloadReply("", status, descriptor, 0L, null);
        }
        static MediaDownloadReply invalid(String operationId, PlaybackMediaResolver.Descriptor descriptor,
                NativeMediaDownloadCoordinator.Retention retention) {
            return new MediaDownloadReply(operationId, "invalid-input", descriptor, 0L, retention);
        }
        static MediaDownloadReply notFound(String operationId) {
            return new MediaDownloadReply(operationId, "not-found", null, 0L, null);
        }
    }

    /** Same-process, main-thread-only requests for OS UI. No URI/path is accepted or returned. */
    interface PlatformActionPort {
        boolean launchAudioPicker();
        boolean launchTreePicker();
        boolean launchBackupExportPicker();
        boolean launchBackupImportPicker();
    }

    interface ExternalBackupPort {
        BackupSafFilePort.PageSafeStatus status();
        LocalDataRepository.Result<LocalDataRepository.BackupPreview> preview();
        LocalDataRepository.Result<LocalDataRepository.BackupPreview> importBackup(String mode, boolean confirmed);
    }

    void setPlatformActionPort(PlatformActionPort port) {
        platformActionPort = port;
    }

    void setExternalBackupPort(ExternalBackupPort port) { externalBackupPort = port; }

    private final class Listener implements WebViewCompat.WebMessageListener {
        @Override
        public void onPostMessage(
                WebView view,
                WebMessageCompat message,
                Uri sourceOrigin,
                boolean isMainFrame,
                JavaScriptReplyProxy replyProxy) {
            if (typedRequests.isDestroyed()) return;
            if (isTypedProtocol(message == null ? null : message.getData())) {
                handleTypedRequest(view, message == null ? null : message.getData(), sourceOrigin,
                        isMainFrame, replyProxy);
                return;
            }
            ParsedRequest parsed = parseRequest(message == null ? null : message.getData());
            if (!HttpBridgePolicy.isTrustedSourceOrigin(
                    sourceOrigin == null ? null : sourceOrigin.getScheme(),
                    sourceOrigin == null ? null : sourceOrigin.getHost(),
                    sourceOrigin == null ? -2 : sourceOrigin.getPort(),
                    isMainFrame)) {
                replyOnMain(view, replyProxy, BridgeReply.error(parsed.requestId, 0, "UNTRUSTED_ORIGIN"));
                return;
            }
            if (parsed.errorCode != null) {
                replyOnMain(view, replyProxy, BridgeReply.error(parsed.requestId, 0, parsed.errorCode));
                return;
            }

            HttpBridgePolicy.ValidationResult validation =
                    HttpBridgePolicy.validateRequest(parsed.method, parsed.url);
            if (!validation.isValid()) {
                replyOnMain(view, replyProxy,
                        BridgeReply.error(parsed.requestId, 0, validation.getErrorCode()));
                return;
            }

            // Version-1 compatibility calls have no page epoch. Namespace their request IDs by
            // the native page generation so a reload cannot collide with or receive an old reply.
            BridgeRequestRegistry.RequestKey key = new BridgeRequestRegistry.RequestKey(
                    -pageGeneration, parsed.requestId);
            if (typedRequests.register(key) == null) {
                replyOnMain(view, replyProxy, BridgeReply.error(parsed.requestId, 0, "BRIDGE_BUSY"));
                return;
            }
            try {
                Future<?> future = networkExecutor.submit(() -> {
                    String cookieHeader = resolveCookieHeader(validation, parsed.url);
                    if (validation.getRoute() == HttpBridgePolicy.RequestRoute.BILIBILI_GET
                            && cookieHeader == null) {
                        if (typedRequests.settle(key, AndroidRpcContract.Terminal.ERROR)
                                == BridgeRequestRegistry.SettleResult.OK) {
                            replyOnMain(view, replyProxy, BridgeReply.error(
                                    parsed.requestId, 0, "BILIBILI_ANONYMOUS_COOKIE_UNAVAILABLE"));
                        }
                        return;
                    }
                    BridgeReply reply = executeRequest(parsed.requestId, validation, cookieHeader, key);
                    if (typedRequests.settle(key, AndroidRpcContract.Terminal.ERROR)
                            == BridgeRequestRegistry.SettleResult.OK) {
                        replyOnMain(view, replyProxy, reply);
                    }
                });
                typedRequests.attachFuture(key, future);
            } catch (RejectedExecutionException ignored) {
                replyOnMain(view, replyProxy, BridgeReply.error(parsed.requestId, 0, "BRIDGE_BUSY"));
                typedRequests.settle(key, AndroidRpcContract.Terminal.ERROR);
            }
        }
    }

    private static boolean isTypedProtocol(String rawMessage) {
        if (rawMessage == null || rawMessage.length() > HttpBridgePolicy.MAX_MESSAGE_LENGTH) return false;
        try {
            Object version = new JSONObject(rawMessage).opt("version");
            return version instanceof Number
                    && ((Number) version).intValue() == AndroidRpcContract.PROTOCOL_VERSION;
        } catch (JSONException ignored) {
            return false;
        }
    }

    private void handleTypedRequest(
            WebView view,
            String rawMessage,
            Uri sourceOrigin,
            boolean isMainFrame,
            JavaScriptReplyProxy replyProxy) {
        if (typedRequests.isDestroyed()) return;
        AndroidRpcContract.ParseResult parsed = AndroidRpcContract.parseRequest(rawMessage);
        if (!HttpBridgePolicy.isTrustedSourceOrigin(
                sourceOrigin == null ? null : sourceOrigin.getScheme(),
                sourceOrigin == null ? null : sourceOrigin.getHost(),
                sourceOrigin == null ? -2 : sourceOrigin.getPort(), isMainFrame)) {
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(
                    parsed.request, AndroidRpcContract.Terminal.ERROR, 0, null, "UNTRUSTED_ORIGIN"));
            return;
        }
        if (!parsed.isValid()) {
            replyTypedOnMain(view, replyProxy,
                    AndroidRpcContract.errorReply(parsed, parsed.errorCode));
            return;
        }
        if (parsed.request.operation == AndroidRpcContract.Operation.PLAYBACK_COMMAND) {
            handlePlaybackCommand(view, replyProxy, parsed.request);
            return;
        }
        if (parsed.request.operation == AndroidRpcContract.Operation.RPC_CANCEL) {
            boolean deepSeekCancelled = false;
            if (isDeepSeekOperation(parsed.request.targetRequestId)) {
                DeepSeekRpcFacade facade = deepSeekRpcFacade;
                if (facade != null) {
                    JSONObject cancellation = facade.cancel(deepSeekOperationId(
                            parsed.request.targetPageEpoch, parsed.request.targetRequestId));
                    deepSeekCancelled = cancellation.optBoolean("ok", false)
                            && "cancel-requested".equals(cancellation.optString("status", ""));
                }
            }
            BridgeRequestRegistry.SettleResult result = typedRequests.cancel(
                    new BridgeRequestRegistry.RequestKey(parsed.request.targetPageEpoch,
                            parsed.request.targetRequestId));
            JSONObject acknowledgement = new JSONObject();
            try {
                acknowledgement.put("cancelled", deepSeekCancelled
                        || result == BridgeRequestRegistry.SettleResult.CANCELLED);
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(parsed.request,
                    AndroidRpcContract.Terminal.OK, 0, acknowledgement, null));
            return;
        }
        if (isPlatformActionRequest(parsed.request)) {
            handlePlatformAction(view, replyProxy, parsed.request);
            return;
        }
        BridgeRequestRegistry.RequestKey key = new BridgeRequestRegistry.RequestKey(
                parsed.request.pageEpoch, parsed.request.requestId);
        if (typedRequests.register(key) == null) {
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(parsed.request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, "DUPLICATE_REQUEST"));
            return;
        }
        typedRequests.attachTerminalListener(key, result -> {
            if (!typedRequests.canPostReplies()) return;
            AndroidRpcContract.TypedReply terminal = result == BridgeRequestRegistry.SettleResult.CANCELLED
                    ? AndroidRpcContract.reply(parsed.request, AndroidRpcContract.Terminal.CANCELLED,
                            0, null, "CANCELLED")
                    : AndroidRpcContract.reply(parsed.request, AndroidRpcContract.Terminal.ERROR,
                            0, null, "TIMEOUT");
            replyTypedOnMain(view, replyProxy, terminal);
        });
        try {
            Future<?> future = networkExecutor.submit(() -> {
                AndroidRpcContract.TypedReply reply = executeTypedOperation(parsed.request, key);
                BridgeRequestRegistry.SettleResult settled = typedRequests.settle(
                        key, reply.terminal);
                if (settled == BridgeRequestRegistry.SettleResult.OK
                        || settled == BridgeRequestRegistry.SettleResult.CANCELLED) {
                    replyTypedOnMain(view, replyProxy, reply);
                }
            });
            typedRequests.attachFuture(key, future);
        } catch (RejectedExecutionException ignored) {
            typedRequests.settle(key, AndroidRpcContract.Terminal.ERROR);
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(parsed.request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, "BRIDGE_BUSY"));
        }
    }

    private static boolean isPlatformActionRequest(AndroidRpcContract.TypedRequest request) {
        if (request == null || request.operation != AndroidRpcContract.Operation.LOCAL_DATA_COMMAND
                || request.operationPayload == null) return false;
        String action = request.operationPayload.optString("action", "");
        JSONObject payload = request.operationPayload.optJSONObject("payload");
        return ("saf.pickAudio".equals(action) || "saf.pickTree".equals(action)
                || "backup.export".equals(action) || "backup.import.pick".equals(action))
                && hasExactlyKeys(payload);
    }

    /** Posts the host action to WebView's main queue and emits only an accepted/pending status. */
    private void handlePlatformAction(WebView view, JavaScriptReplyProxy replyProxy,
            AndroidRpcContract.TypedRequest request) {
        PlatformActionPort port = platformActionPort;
        if (port == null) {
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, "PLATFORM_ACTION_UNAVAILABLE"));
            return;
        }
        String action = request.operationPayload.optString("action", "");
        view.post(() -> {
            boolean accepted;
            try {
                if ("saf.pickAudio".equals(action)) accepted = port.launchAudioPicker();
                else if ("saf.pickTree".equals(action)) accepted = port.launchTreePicker();
                else if ("backup.export".equals(action)) accepted = port.launchBackupExportPicker();
                else accepted = port.launchBackupImportPicker();
            } catch (RuntimeException ignored) {
                accepted = false;
            }
            JSONObject result = new JSONObject();
            try {
                result.put("status", accepted ? "pending" : "rejected");
                result.put("accepted", accepted);
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.OK, 0, result, null));
        });
    }

    private void handlePlaybackCommand(WebView view, JavaScriptReplyProxy replyProxy,
            AndroidRpcContract.TypedRequest request) {
        PlaybackBridgeController controller = playbackController;
        if (controller == null) {
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, "PLAYBACK_UNAVAILABLE"));
            return;
        }
        java.util.Map<String, Object> envelope = AndroidRpcContract.toPlaybackEnvelope(request);
        if (envelope == null) {
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, "INVALID_PAYLOAD"));
            return;
        }
        String command = (String) envelope.get("command");
        if ("subscribe".equals(command) && !controller.isAttached(request.pageEpoch)) {
            controller.attach(request.pageEpoch, snapshot -> postPlaybackSnapshot(view, replyProxy,
                    request.pageEpoch, snapshot));
        }
        if (!controller.isAttached(request.pageEpoch)) {
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, "STALE_PAGE_EPOCH"));
            return;
        }
        PlaybackBridgeController.Reply result = controller.handle(envelope);
        if (!result.isAccepted()) {
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, 0, null, result.getErrorCode()));
            return;
        }
        JSONObject acknowledgement = new JSONObject();
        try {
            acknowledgement.put("accepted", true);
            acknowledgement.put("revision", result.getSnapshot().getRevision());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        // Terminal acknowledgement is enqueued before the snapshot. A page never
        // treats this acknowledgement as final playback truth.
        replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(request,
                AndroidRpcContract.Terminal.OK, 0, acknowledgement, null));
        controller.publish(result.getSnapshot());
    }

    private static ParsedRequest parseRequest(String rawMessage) {
        if (rawMessage == null) {
            return ParsedRequest.error("", "INVALID_REQUEST");
        }
        if (rawMessage.length() > HttpBridgePolicy.MAX_MESSAGE_LENGTH) {
            return ParsedRequest.error("", "MESSAGE_TOO_LARGE");
        }
        try {
            JSONObject request = new JSONObject(rawMessage);
            Object requestIdValue = request.opt("requestId");
            String requestId = requestIdValue instanceof String ? (String) requestIdValue : "";
            if (requestId.isEmpty() || requestId.length() > HttpBridgePolicy.MAX_REQUEST_ID_LENGTH) {
                return ParsedRequest.error("", "INVALID_REQUEST_ID");
            }
            Object version = request.opt("version");
            if (!(version instanceof Number)
                    || ((Number) version).intValue() != HttpBridgePolicy.PROTOCOL_VERSION) {
                return ParsedRequest.error(requestId, "UNSUPPORTED_VERSION");
            }
            Object method = request.opt("method");
            Object url = request.opt("url");
            if (request.has("body")) {
                return ParsedRequest.error(requestId, "BODY_NOT_ALLOWED");
            }
            if (!(method instanceof String) || !(url instanceof String)) {
                return ParsedRequest.error(requestId, "INVALID_REQUEST");
            }
            return ParsedRequest.valid(requestId, (String) method, (String) url);
        } catch (JSONException ignored) {
            return ParsedRequest.error("", "INVALID_JSON");
        }
    }

    private String resolveCookieHeader(
            HttpBridgePolicy.ValidationResult validation,
            String validatedUrl) {
        if (validation.getRoute() != HttpBridgePolicy.RequestRoute.BILIBILI_GET) {
            // The Bilibili anonymous cookie is never sent to another route.
            return safeCookieHeader(validatedUrl);
        }

        String existingBuvid3 = HttpBridgePolicy.extractValidBilibiliBuvid3(
                safeCookieHeader(validatedUrl));
        if (existingBuvid3 != null) {
            return toBilibiliAnonymousCookieHeader(existingBuvid3);
        }
        if (HttpBridgePolicy.isValidBilibiliBuvid3(anonymousBilibiliBuvid3)) {
            return toBilibiliAnonymousCookieHeader(anonymousBilibiliBuvid3);
        }
        if (bilibiliFingerprintAttempted) {
            return null;
        }

        bilibiliFingerprintAttempted = true;
        anonymousBilibiliBuvid3 = requestAnonymousBilibiliBuvid3();
        if (!HttpBridgePolicy.isValidBilibiliBuvid3(anonymousBilibiliBuvid3)) {
            anonymousBilibiliBuvid3 = null;
            return null;
        }
        return toBilibiliAnonymousCookieHeader(anonymousBilibiliBuvid3);
    }

    private static String toBilibiliAnonymousCookieHeader(String buvid3) {
        return HttpBridgePolicy.BILIBILI_BUVID3_COOKIE_NAME + "=" + buvid3;
    }

    private static String safeCookieHeader(String validatedUrl) {
        try {
            return CookieManager.getInstance().getCookie(validatedUrl);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static String requestAnonymousBilibiliBuvid3() {
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new URL(HttpBridgePolicy.BILIBILI_FINGERPRINT_URL)
                    .openConnection();
            connection.setRequestMethod("GET");
            configureConnection(connection, HttpBridgePolicy.RequestRoute.BILIBILI_GET);

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300
                    || connection.getContentLengthLong()
                    > HttpBridgePolicy.MAX_BILIBILI_FINGERPRINT_RESPONSE_BYTES) {
                return null;
            }
            try (InputStream input = connection.getInputStream()) {
                String responseBody = readBoundedUtf8(
                        input, HttpBridgePolicy.MAX_BILIBILI_FINGERPRINT_RESPONSE_BYTES);
                return parseAnonymousBilibiliBuvid3(responseBody);
            }
        } catch (IOException | RuntimeException | ResponseTooLargeException ignored) {
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String parseAnonymousBilibiliBuvid3(String responseBody) {
        try {
            JSONObject response = new JSONObject(responseBody);
            Object code = response.opt("code");
            JSONObject data = response.optJSONObject("data");
            Object buvid3 = data == null ? null : data.opt("b_3");
            if (!(code instanceof Number)
                    || ((Number) code).doubleValue() != 0
                    || !(buvid3 instanceof String)) {
                return null;
            }
            String value = (String) buvid3;
            return HttpBridgePolicy.isValidBilibiliBuvid3(value) ? value : null;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private BridgeReply executeRequest(
            String requestId,
            HttpBridgePolicy.ValidationResult validation,
            String cookieHeader,
            BridgeRequestRegistry.RequestKey key) {
        HttpsURLConnection connection = null;
        try {
            String url = validation.getUri().toASCIIString();
            HttpBridgePolicy.RequestRoute route = validation.getRoute();
            connection = (HttpsURLConnection) new URL(url).openConnection();
            if (!typedRequests.attachConnection(key, connection)) {
                return BridgeReply.error(requestId, 0, "CANCELLED");
            }
            connection.setRequestMethod(route.getMethod());
            configureConnection(connection, route);
            if (cookieHeader != null && !cookieHeader.isEmpty()) {
                connection.setRequestProperty("Cookie", cookieHeader);
            }

            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                return BridgeReply.error(requestId, status, "REDIRECT_NOT_ALLOWED");
            }
            long contentLength = connection.getContentLengthLong();
            if (contentLength > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
                return BridgeReply.error(requestId, status, "RESPONSE_TOO_LARGE");
            }
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String responseBody = input == null
                    ? ""
                    : readBoundedUtf8(input, HttpBridgePolicy.MAX_RESPONSE_BYTES);
            if (status >= 200 && status < 300) {
                return BridgeReply.success(requestId, status, responseBody);
            }
            return BridgeReply.error(requestId, status, "HTTP_STATUS_" + status, responseBody);
        } catch (ResponseTooLargeException ignored) {
            return BridgeReply.error(requestId, 0, "RESPONSE_TOO_LARGE");
        } catch (SocketTimeoutException ignored) {
            return BridgeReply.error(requestId, 0, "NETWORK_TIMEOUT");
        } catch (IOException | RuntimeException ignored) {
            return BridgeReply.error(requestId, 0, "NETWORK_IO_ERROR");
        } finally {
            if (connection != null) {
                typedRequests.detachConnection(key, connection);
                connection.disconnect();
            }
        }
    }

    private AndroidRpcContract.TypedReply executeTypedOperation(
            AndroidRpcContract.TypedRequest request, BridgeRequestRegistry.RequestKey key) {
        if (isDeepSeekOperation(request.operation) || isMediaDownloadOperation(request.operation)
                || request.operation == AndroidRpcContract.Operation.LOCAL_LYRIC_PRIMARY) {
            return executeTypedOperationOnce(request, key);
        }
        long startedAt = System.nanoTime();
        AndroidRpcContract.TypedReply lastReply = null;
        for (int attempt = 1; attempt <= BridgeRetryPolicy.MAX_ATTEMPTS; attempt += 1) {
            if (!typedRequests.hasActive(key)) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.CANCELLED, 0,
                        null, "CANCELLED");
            }
            lastReply = executeTypedOperationOnce(request, key);
            long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
            if (elapsed >= TYPED_DEADLINE_MILLIS) {
                typedRequests.timeout(key);
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                        null, "TIMEOUT");
            }
            int retryStatus = "NETWORK_IO_ERROR".equals(lastReply.errorCode)
                    || "NETWORK_TIMEOUT".equals(lastReply.errorCode) ? 0 : lastReply.status;
            BridgeRetryPolicy.Decision decision = BridgeRetryPolicy.decide(
                    attempt, elapsed, TYPED_DEADLINE_MILLIS, !typedRequests.hasActive(key), retryStatus);
            if (!decision.retry) return lastReply;
            try {
                Thread.sleep(decision.delayMillis);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.CANCELLED, 0,
                        null, "CANCELLED");
            }
        }
        return lastReply == null ? AndroidRpcContract.reply(request,
                AndroidRpcContract.Terminal.ERROR, 0, null, "NETWORK_IO_ERROR") : lastReply;
    }

    private AndroidRpcContract.TypedReply executeTypedOperationOnce(
            AndroidRpcContract.TypedRequest request, BridgeRequestRegistry.RequestKey key) {
        if (isDeepSeekOperation(request.operation)) {
            DeepSeekRpcFacade facade = deepSeekRpcFacade;
            String operation = request.operation.wireName;
            JSONObject result = facade == null
                    ? unavailableDeepSeekResult(operation)
                    : facade.dispatch(operation, deepSeekOperationId(request.pageEpoch,
                            request.requestId), request.operationPayload);
            int status = result.optInt("httpStatus", 0);
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, status,
                    result, null);
        }
        if (request.operation == AndroidRpcContract.Operation.PROVIDER_CAPABILITIES) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 0,
                    providerCapabilities.toJson(), null);
        }
        if (isMediaDownloadOperation(request.operation)) {
            return executeMediaDownloadOperation(request);
        }
        if (request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_STATUS
                || request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_BEGIN
                || request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_POLL
                || request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_CANCEL
                || request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_LOGOUT) {
            return executeBilibiliAccountOperation(request);
        }
        if (request.operation == AndroidRpcContract.Operation.LOCAL_DATA_QUERY
                || request.operation == AndroidRpcContract.Operation.LOCAL_DATA_COMMAND) {
            return executeLocalDataOperation(request);
        }
        if (request.operation == AndroidRpcContract.Operation.LOCAL_LYRIC_PRIMARY) {
            return executeLocalLyricOperation(request);
        }
        if (request.operation == AndroidRpcContract.Operation.BILIBILI_DIRECTORY_PAGE) {
            BilibiliDirectoryProvider.Result result = bilibiliDirectoryProvider.executeDirectoryPage(
                    request.operationPayload.optInt("page", 0));
            return bilibiliDirectoryReply(request, result);
        }
        if (request.operation == AndroidRpcContract.Operation.BILIBILI_DIRECTORY_DETAIL) {
            long playlistId;
            try {
                playlistId = Long.parseLong(request.operationPayload.optString("playlistId", ""));
            } catch (NumberFormatException ignored) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                        null, "INVALID_PAYLOAD");
            }
            return bilibiliDirectoryReply(request,
                    bilibiliDirectoryProvider.executeDirectoryDetail(playlistId));
        }
        if (request.operation == AndroidRpcContract.Operation.NETEASE_SEARCH) {
            return netEaseProviderClient.executeSearch(request);
        }
        if (request.operation == AndroidRpcContract.Operation.NETEASE_DIRECTORY_DETAIL) {
            return netEaseProviderClient.executeDirectoryDetail(request);
        }
        if (request.operation == AndroidRpcContract.Operation.NETEASE_RENDITION_DEFAULT) {
            return netEaseProviderClient.executeDefaultRendition(request);
        }
        if (request.operation == AndroidRpcContract.Operation.NETEASE_LYRIC_PRIMARY) {
            return netEaseProviderClient.executePrimaryLyric(request);
        }
        if (request.operation == AndroidRpcContract.Operation.NETEASE_LYRIC_SEARCH) {
            // Manual lyric search has no safely verified fixed route yet. Keep
            // the capability false and fail explicitly instead of guessing a
            // provider endpoint or returning a synthetic empty success.
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "NETEASE_ROUTE_UNAVAILABLE");
        }
        if (request.operation == AndroidRpcContract.Operation.BILIBILI_LYRIC_PRIMARY) {
            JSONObject payload = request.operationPayload;
            BilibiliLyricProvider.Selection selection = new BilibiliLyricProvider.Selection(
                    payload.optString("bvid", ""), payload.optLong("cid", 0L),
                    payload.optString("title", ""), payload.optString("artist", ""),
                    payload.optLong("durationSeconds", 0L),
                    payload.optString("selectionIdentity", ""));
            BilibiliLyricProvider.Resolution resolution = bilibiliLyricProvider.resolve(selection,
                    () -> !typedRequests.hasActive(key) || Thread.currentThread().isInterrupted());
            if (!resolution.isFound()) {
                return AndroidRpcContract.reply(request,
                        resolution.status == BilibiliLyricProvider.Status.CANCELLED
                                ? AndroidRpcContract.Terminal.CANCELLED : AndroidRpcContract.Terminal.ERROR,
                        0, null, resolution.errorCode);
            }
            JSONObject result = new JSONObject();
            try {
                result.put("lyric", resolution.lrc);
                result.put("tlyric", resolution.tlyric);
                result.put("source", resolution.source);
                result.put("matchedTitle", resolution.matchedTitle);
                result.put("matchedArtist", resolution.matchedArtist);
                result.put("matchedDurationSeconds", resolution.matchedDurationSeconds);
                result.put("matchScorePercent", resolution.matchScorePercent);
                result.put("selectionIdentity", payload.optString("selectionIdentity", ""));
                result.put("selectionRevision", payload.optLong("selectionRevision", 0L));
                result.put("selectionToken", payload.optString("selectionToken", ""));
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 200, result, null);
        }
        if (request.operation == AndroidRpcContract.Operation.LYRIC_SELECTION_GET
                || request.operation == AndroidRpcContract.Operation.LYRIC_SELECTION_SET
                || request.operation == AndroidRpcContract.Operation.LYRIC_SELECTION_CLEAR
                || request.operation == AndroidRpcContract.Operation.LYRIC_OFFSET_SET) {
            return executeLyricPersistence(request);
        }
        if (request.operation == AndroidRpcContract.Operation.LYRIC_CONTENT_GET
                || request.operation == AndroidRpcContract.Operation.LYRIC_CONTENT_PUT) {
            return executeLyricContent(request);
        }
        AndroidRpcContract.TypedReply reply = executeTypedMetadataOperation(request, key, true);
        // A provider-status response can reject an otherwise valid anonymous
        // fingerprint. Retry the same closed metadata operation once without
        // sending any cookie; this neither broadens the route nor grants
        // authenticated access.
        if (shouldRetryWithoutAnonymousCookie(request, reply)) {
            return executeTypedMetadataOperation(request, key, false);
        }
        return reply;
    }

    /** Resolves an adjacent LRC inside the already-authorized SAF tree only. */
    private AndroidRpcContract.TypedReply executeLocalLyricOperation(
            AndroidRpcContract.TypedRequest request) {
        SafMediaReferencePort port = localLyricPort;
        if (port == null || request.operationPayload == null) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "LOCAL_LYRIC_UNAVAILABLE");
        }
        SafMediaReferencePort.LocalLyricResult result;
        try {
            result = port.readAdjacentLrc(request.operationPayload.optString("localTrackId", ""));
        } catch (RuntimeException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "LOCAL_LYRIC_UNAVAILABLE");
        }
        if (result == null || result.status == SafMediaReferencePort.LocalLyricResult.Status.UNAVAILABLE) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "LOCAL_LYRIC_UNAVAILABLE");
        }
        JSONObject response = new JSONObject();
        try {
            response.put("status", result.status == SafMediaReferencePort.LocalLyricResult.Status.FOUND
                    ? "found" : "no-lyric");
            response.put("lyric", result.lyric);
            response.put("tlyric", "");
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 200, response, null);
    }

    private static AndroidRpcContract.TypedReply bilibiliDirectoryReply(
            AndroidRpcContract.TypedRequest request, BilibiliDirectoryProvider.Result result) {
        if (result != null && result.isSuccess()) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK,
                    result.httpStatus, result.value, null);
        }
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR,
                result == null ? 0 : result.httpStatus, null,
                result == null ? "NETWORK_IO_ERROR" : result.status);
    }

    private static boolean isDeepSeekOperation(AndroidRpcContract.Operation operation) {
        return operation == AndroidRpcContract.Operation.DEEPSEEK_TRANSLATION_STATUS
                || operation == AndroidRpcContract.Operation.DEEPSEEK_TRANSLATION_CONFIGURE
                || operation == AndroidRpcContract.Operation.DEEPSEEK_TRANSLATION_TEST
                || operation == AndroidRpcContract.Operation.DEEPSEEK_TRANSLATION_DELETE
                || operation == AndroidRpcContract.Operation.DEEPSEEK_TRANSLATION_TRANSLATE;
    }

    private static boolean isMediaDownloadOperation(AndroidRpcContract.Operation operation) {
        return operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_START
                || operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_STATUS
                || operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_CANCEL
                || operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_DELETE
                || operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_CLEANUP;
    }

    /** Executes semantic download management without ever projecting cache transport or paths. */
    private AndroidRpcContract.TypedReply executeMediaDownloadOperation(
            AndroidRpcContract.TypedRequest request) {
        MediaDownloadPort port = mediaDownloadPort;
        if (port == null || request.operationPayload == null) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "MEDIA_DOWNLOAD_UNAVAILABLE");
        }
        try {
            JSONObject payload = request.operationPayload;
            MediaDownloadReply result;
            if (request.operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_START) {
                PlaybackMediaResolver.Descriptor descriptor = mediaDownloadDescriptor(
                        payload.optJSONObject("descriptor"));
                NativeMediaDownloadCoordinator.Retention retention = mediaDownloadRetention(
                        payload.optString("retention", ""));
                result = descriptor == null || retention == null
                        ? MediaDownloadReply.invalid(payload.optString("operationId", ""), descriptor, retention)
                        : port.start(payload.getString("operationId"), descriptor, retention);
            } else if (request.operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_STATUS) {
                result = port.status(payload.getString("operationId"));
            } else if (request.operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_CANCEL) {
                result = port.cancel(payload.getString("operationId"));
            } else if (request.operation == AndroidRpcContract.Operation.MEDIA_DOWNLOAD_DELETE) {
                PlaybackMediaResolver.Descriptor descriptor = mediaDownloadDescriptor(
                        payload.optJSONObject("descriptor"));
                result = descriptor == null ? MediaDownloadReply.invalid("", null, null) : port.delete(descriptor);
            } else {
                result = port.cleanup();
            }
            return mediaDownloadReply(request, result);
        } catch (JSONException | RuntimeException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "MEDIA_DOWNLOAD_FAILED");
        }
    }

    private static PlaybackMediaResolver.Descriptor mediaDownloadDescriptor(JSONObject value) {
        if (value == null) return null;
        return new PlaybackMediaResolver.Descriptor(value.optString("source", ""),
                value.optString("providerTrackId", ""), value.optLong("providerPartId", 0L),
                value.optString("title", ""), value.optString("artist", ""),
                value.optLong("durationMs", -1L), value.optString("mediaKind", ""));
    }

    private static NativeMediaDownloadCoordinator.Retention mediaDownloadRetention(String value) {
        if ("temporary".equals(value)) return NativeMediaDownloadCoordinator.Retention.TEMPORARY;
        if ("playlist".equals(value)) return NativeMediaDownloadCoordinator.Retention.PLAYLIST;
        if ("download".equals(value)) return NativeMediaDownloadCoordinator.Retention.DOWNLOAD;
        return null;
    }

    private static AndroidRpcContract.TypedReply mediaDownloadReply(
            AndroidRpcContract.TypedRequest request, MediaDownloadReply value) throws JSONException {
        if (value == null) return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR,
                0, null, "MEDIA_DOWNLOAD_FAILED");
        JSONObject result = new JSONObject();
        result.put("operationId", value.operationId);
        result.put("status", value.status);
        if (!value.source.isEmpty()) result.put("source", value.source);
        if (!value.providerTrackId.isEmpty()) result.put("providerTrackId", value.providerTrackId);
        if (value.byteCount > 0L) result.put("byteCount", value.byteCount);
        if (!value.retention.isEmpty()) result.put("retention", value.retention);
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 0, result, null);
    }

    private static boolean isDeepSeekOperation(String operation) {
        return AndroidDeepSeekTranslationPort.OPERATION_STATUS.equals(operation)
                || AndroidDeepSeekTranslationPort.OPERATION_CONFIGURE.equals(operation)
                || AndroidDeepSeekTranslationPort.OPERATION_TEST.equals(operation)
                || AndroidDeepSeekTranslationPort.OPERATION_DELETE.equals(operation)
                || AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE.equals(operation);
    }

    private static String deepSeekOperationId(int pageEpoch, String requestId) {
        if (requestId != null && requestId.matches("[A-Za-z0-9:._-]{1,128}")) {
            return requestId;
        }
        // JS emits safe IDs; this fallback preserves the facade boundary for a
        // legacy caller without copying arbitrary request text into the ID.
        return "rpc-" + pageEpoch + "-" + Integer.toHexString(
                requestId == null ? 0 : requestId.hashCode());
    }

    private static JSONObject unavailableDeepSeekResult(String operation) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", false);
            result.put("status", "native-capability-unavailable");
            if (AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE.equals(operation)) {
                result.put("httpStatus", 0);
                result.put("retryable", false);
            }
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return result;
    }

    /**
     * The current host deliberately has no QR gateway or Android Keystore vault
     * wiring. Return its public state rather than inventing a browser-cookie
     * fallback; no token, cookie, QR challenge, URL or exception text is emitted.
     */
    private AndroidRpcContract.TypedReply executeBilibiliAccountOperation(
            AndroidRpcContract.TypedRequest request) {
        BilibiliAccountSession.PublicState state;
        long now = System.currentTimeMillis();
        JSONObject payload = request.operationPayload;
        String sessionId = payload == null ? "" : payload.optString("sessionId", "");
        if (request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_BEGIN) {
            state = bilibiliAccountSession.begin(now);
        } else if (request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_POLL) {
            state = bilibiliAccountSession.poll(sessionId, now);
        } else if (request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_QR_CANCEL) {
            state = bilibiliAccountSession.cancel(sessionId);
        } else if (request.operation == AndroidRpcContract.Operation.BILIBILI_ACCOUNT_LOGOUT) {
            state = bilibiliAccountSession.logout();
        } else {
            state = bilibiliAccountSession.snapshot();
        }
        JSONObject result = new JSONObject();
        try {
            result.put("sessionId", state.getSessionId());
            result.put("status", state.getStatus().name().toLowerCase());
            result.put("expiresAtEpochMs", state.getExpiresAtEpochMs());
            result.put("qrUrl", state.getQrUrl());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 0, result, null);
    }

    /** Executes only pre-validated semantic local-data actions; no path/URI/file descriptor crosses here. */
    private AndroidRpcContract.TypedReply executeLocalDataOperation(AndroidRpcContract.TypedRequest request) {
        AndroidLocalDataFacade facade = localDataFacade;
        if (facade == null || request.operationPayload == null) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "LOCAL_DATA_UNAVAILABLE");
        }
        String action = request.operationPayload.optString("action", "");
        JSONObject payload = request.operationPayload.optJSONObject("payload");
        if (payload == null) return localError(request, "INVALID_PAYLOAD");
        try {
            if (request.operation == AndroidRpcContract.Operation.LOCAL_DATA_QUERY) {
                return executeLocalDataQuery(request, facade, action, payload);
            }
            return executeLocalDataCommand(request, facade, action, payload);
        } catch (JSONException | IllegalArgumentException ignored) {
            return localError(request, "INVALID_PAYLOAD");
        }
    }

    private AndroidRpcContract.TypedReply executeLocalDataQuery(AndroidRpcContract.TypedRequest request,
            AndroidLocalDataFacade facade, String action, JSONObject payload) throws JSONException {
        if ("capabilities".equals(action) && hasExactlyKeys(payload)) {
            JSONObject value = new JSONObject();
            value.put("playlists", true);
            value.put("favorites", true);
            value.put("saf", true);
            value.put("localTracks", true);
            value.put("historyAnnual", true);
            value.put("cache", true);
            value.put("settings", true);
            value.put("backupSafExport", externalBackupPort != null);
            value.put("backupSafImport", externalBackupPort != null);
            value.put("backupFileStatus", externalBackupPort != null);
            return localSuccess(request, value);
        }
        if ("playlists".equals(action) && hasExactlyKeys(payload)) {
            return localResult(request, facade.listPlaylists());
        }
        if ("favorites".equals(action) && hasExactlyKeys(payload)) {
            return localResult(request, facade.listFavorites());
        }
        if ("saf".equals(action) && hasExactlyKeys(payload)) {
            return localResult(request, facade.listSafGrants());
        }
        if ("localTracks".equals(action) && hasExactlyKeys(payload)) {
            return localResult(request, facade.listLocalMediaTracks());
        }
        if ("historyAnnual".equals(action) && hasExactlyKeys(payload, "year")) {
            Integer year = boundedInt(payload.opt("year"), 1970, 3000);
            return year == null ? localError(request, "INVALID_PAYLOAD")
                    : localResult(request, facade.annualSummary(year));
        }
        if ("cache".equals(action) && hasExactlyKeys(payload)) {
            return localResult(request, facade.cacheSummary());
        }
        if ("settings".equals(action) && hasExactlyKeys(payload)) {
            return localSuccess(request, localDataJson(facade.settings()));
        }
        if ("backup.fileStatus".equals(action) && hasExactlyKeys(payload)) {
            ExternalBackupPort backup = externalBackupPort;
            return backup == null ? localError(request, "LOCAL_DATA_UNAVAILABLE")
                    : localSuccess(request, localDataJson(backup.status()));
        }
        if ("backup.preview".equals(action) && hasExactlyKeys(payload)) {
            ExternalBackupPort backup = externalBackupPort;
            return backup == null ? localError(request, "LOCAL_DATA_UNAVAILABLE")
                    : localResult(request, backup.preview());
        }
        return localError(request, "UNSUPPORTED_LOCAL_ACTION");
    }

    private AndroidRpcContract.TypedReply executeLocalDataCommand(AndroidRpcContract.TypedRequest request,
            AndroidLocalDataFacade facade, String action, JSONObject payload) throws JSONException {
        if ("saf.pickAudio".equals(action) || "saf.pickTree".equals(action)) {
            return localError(request, "INVALID_PAYLOAD");
        }
        if ("localTracks.refresh".equals(action) && hasExactlyKeys(payload)) {
            LocalTrackMaintenancePort maintenance = localTrackMaintenancePort;
            return maintenance == null ? localError(request, "LOCAL_TRACKS_UNAVAILABLE")
                    : localResult(request, maintenance.refresh());
        }
        if ("localTracks.repair".equals(action)
                && hasExactlyKeys(payload, "grantReferenceId")) {
            String referenceId = safeId(payload.opt("grantReferenceId"));
            LocalTrackMaintenancePort maintenance = localTrackMaintenancePort;
            return referenceId == null || maintenance == null
                    ? localError(request, referenceId == null ? "INVALID_PAYLOAD" : "LOCAL_TRACKS_UNAVAILABLE")
                    : localResult(request, maintenance.repair(referenceId));
        }
        if ("playlist.create".equals(action)
                && hasExactlyKeys(payload, "playlistId", "name", "tracks")) {
            List<LocalDataRepository.Track> tracks = tracksFromJson(payload.optJSONArray("tracks"));
            String id = safeId(payload.opt("playlistId"));
            String name = safeText(payload.opt("name"));
            return id == null || name == null || tracks == null ? localError(request, "INVALID_PAYLOAD")
                    : localResult(request, facade.createPlaylist(id, name, tracks));
        }
        if ("playlist.replace".equals(action)
                && hasExactlyKeys(payload, "playlistId", "expectedRevision", "name", "tracks")) {
            List<LocalDataRepository.Track> tracks = tracksFromJson(payload.optJSONArray("tracks"));
            String id = safeId(payload.opt("playlistId"));
            String name = safeText(payload.opt("name"));
            Long revision = boundedLong(payload.opt("expectedRevision"), 0L, Integer.MAX_VALUE);
            return id == null || name == null || tracks == null || revision == null
                    ? localError(request, "INVALID_PAYLOAD")
                    : localResult(request, facade.replacePlaylist(id, revision, name, tracks));
        }
        if ("playlist.delete".equals(action) && hasExactlyKeys(payload, "playlistId", "expectedRevision")) {
            String id = safeId(payload.opt("playlistId"));
            Long revision = boundedLong(payload.opt("expectedRevision"), 0L, Integer.MAX_VALUE);
            return id == null || revision == null ? localError(request, "INVALID_PAYLOAD")
                    : localResult(request, facade.deletePlaylist(id, revision));
        }
        if ("playlist.reorder".equals(action) && hasExactlyKeys(payload, "playlistIds")) {
            List<String> ids = idsFromJson(payload.optJSONArray("playlistIds"), MAX_LOCAL_ROWS);
            return ids == null ? localError(request, "INVALID_PAYLOAD") : localResult(request, facade.reorderPlaylists(ids));
        }
        if ("favorite.set".equals(action) && hasExactlyKeys(payload, "track", "wanted")) {
            LocalDataRepository.Track track = trackFromJson(payload.optJSONObject("track"));
            Object wanted = payload.opt("wanted");
            return track == null || !(wanted instanceof Boolean) ? localError(request, "INVALID_PAYLOAD")
                    : localResult(request, facade.setFavorite(track, (Boolean) wanted));
        }
        if ("history.enable".equals(action) && hasExactlyKeys(payload, "enabled")
                && payload.opt("enabled") instanceof Boolean) {
            return localResult(request, facade.setHistoryEnabled((Boolean) payload.opt("enabled")));
        }
        if ("history.ingest".equals(action) && hasExactlyKeys(payload, "sessionId", "track",
                "cumulativePlayedMs", "durationMs", "occurredAtMs")) {
            LocalDataRepository.Track track = trackFromJson(payload.optJSONObject("track"));
            String sessionId = safeId(payload.opt("sessionId"));
            Long cumulative = boundedLong(payload.opt("cumulativePlayedMs"), 0L, 28_800_000L);
            Long duration = boundedLong(payload.opt("durationMs"), 1L, 28_800_000L);
            Long occurredAt = boundedLong(payload.opt("occurredAtMs"), 0L, Long.MAX_VALUE);
            return track == null || sessionId == null || cumulative == null || duration == null || occurredAt == null
                    ? localError(request, "INVALID_PAYLOAD") : localResult(request,
                    facade.ingestHistory(new LocalDataRepository.HistoryInput(sessionId, track, cumulative,
                            duration, occurredAt)));
        }
        if ("history.clear".equals(action) && hasExactlyKeys(payload)) {
            return localResult(request, facade.clearHistory());
        }
        if ("cache.refresh".equals(action) && hasExactlyKeys(payload)) {
            return localResult(request, facade.refreshCacheIntegrity());
        }
        if ("cache.capacity".equals(action) && hasExactlyKeys(payload, "capacityBytes")) {
            Long bytes = boundedLong(payload.opt("capacityBytes"), 32L * 1024L * 1024L,
                    8L * 1024L * 1024L * 1024L);
            return bytes == null ? localError(request, "INVALID_PAYLOAD")
                    : localResult(request, facade.setCacheCapacity(bytes));
        }
        if ("cache.directory".equals(action) && hasExactlyKeys(payload, "state")) {
            String state = payload.optString("state", "");
            return !("ready".equals(state) || "unavailable".equals(state) || "read-only".equals(state))
                    ? localError(request, "INVALID_PAYLOAD") : localResult(request, facade.setCacheDirectoryState(state));
        }
        if ("settings.update".equals(action) && hasExactlyKeys(payload, "theme", "language")) {
            String theme = safeSetting(payload.opt("theme"));
            String language = safeSetting(payload.opt("language"));
            return theme == null || language == null ? localError(request, "INVALID_PAYLOAD")
                    : localResult(request, facade.updateSettings(new LocalDataRepository.SettingsInput(theme, language)));
        }
        if ("backup.import".equals(action) && hasExactlyKeys(payload, "mode", "confirmed")) {
            String mode = payload.optString("mode", "");
            Object confirmed = payload.opt("confirmed");
            if (!(confirmed instanceof Boolean)
                    || !("merge".equals(mode) || "overwrite".equals(mode))) {
                return localError(request, "INVALID_PAYLOAD");
            }
            ExternalBackupPort backup = externalBackupPort;
            return backup == null ? localError(request, "LOCAL_DATA_UNAVAILABLE")
                    : localResult(request, backup.importBackup(mode, (Boolean) confirmed));
        }
        return localError(request, "UNSUPPORTED_LOCAL_ACTION");
    }

    private static AndroidRpcContract.TypedReply localError(AndroidRpcContract.TypedRequest request, String code) {
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0, null, code);
    }

    private static AndroidRpcContract.TypedReply localSuccess(AndroidRpcContract.TypedRequest request,
            JSONObject data) throws JSONException {
        assertSafeLocalJson(data);
        JSONObject result = new JSONObject();
        result.put("ok", true);
        result.put("status", "OK");
        result.put("data", data == null ? JSONObject.NULL : data);
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 0, result, null);
    }

    private static AndroidRpcContract.TypedReply localResult(AndroidRpcContract.TypedRequest request,
            LocalDataRepository.Result<?> result) throws JSONException {
        if (result == null || !safeLocalStatus(result.status)) return localError(request, "LOCAL_DATA_CORRUPT");
        JSONObject value = new JSONObject();
        value.put("ok", result.ok);
        value.put("status", result.status);
        if (result.revision >= 0L) value.put("revision", result.revision);
        if (result.value != null) {
            JSONObject data = localDataJson(result.value);
            assertSafeLocalJson(data);
            value.put("data", data);
        }
        return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 0, value, null);
    }

    private static boolean safeLocalStatus(String status) {
        return "OK".equals(status) || "DUPLICATE".equals(status) || "REPAIRED".equals(status)
                || "INVALID_INPUT".equals(status) || "NOT_FOUND".equals(status)
                || "STALE_REVISION".equals(status) || "CONFIRMATION_REQUIRED".equals(status)
                || "GRANT_INVALID".equals(status) || "NEEDS_REPAIR".equals(status)
                || "CORRUPT".equals(status)
                || "IO_UNAVAILABLE".equals(status) || "INTEGRITY_FAILED".equals(status)
                || "DISABLED".equals(status) || "PARTIAL".equals(status);
    }

    private static JSONObject localDataJson(Object value) throws JSONException {
        if (value instanceof List) {
            List<?> rows = (List<?>) value;
            if (rows.size() > MAX_LOCAL_TRACKS) throw new IllegalArgumentException();
            JSONObject container = new JSONObject();
            JSONArray items = new JSONArray();
            for (Object row : rows) items.put(localDataJson(row));
            container.put("items", items);
            return container;
        }
        JSONObject result = new JSONObject();
        if (value instanceof LocalDataRepository.PlaylistView) {
            LocalDataRepository.PlaylistView row = (LocalDataRepository.PlaylistView) value;
            result.put("playlistId", row.playlistId); result.put("name", row.name);
            result.put("ordinal", row.ordinal); result.put("revision", row.revision);
            JSONArray tracks = new JSONArray();
            if (row.tracks.size() > MAX_LOCAL_TRACKS) throw new IllegalArgumentException();
            for (LocalDataRepository.Track track : row.tracks) tracks.put(trackJson(track));
            result.put("tracks", tracks); return result;
        }
        if (value instanceof LocalDataRepository.FavoriteView) {
            LocalDataRepository.FavoriteView row = (LocalDataRepository.FavoriteView) value;
            result.put("source", row.source); result.put("providerTrackId", row.providerTrackId);
            result.put("title", row.title); result.put("artist", row.artist); result.put("addedAtMs", row.addedAtMs);
            return result;
        }
        if (value instanceof LocalDataRepository.SafGrantView) {
            LocalDataRepository.SafGrantView row = (LocalDataRepository.SafGrantView) value;
            result.put("referenceId", row.referenceId); result.put("displayName", row.displayName);
            result.put("state", row.state); result.put("updatedAtMs", row.updatedAtMs); return result;
        }
        if (value instanceof LocalDataRepository.LocalTrackView) {
            LocalDataRepository.LocalTrackView row = (LocalDataRepository.LocalTrackView) value;
            result.put("localTrackId", row.localTrackId); result.put("source", "local");
            result.put("title", row.title); result.put("artist", row.artist);
            result.put("durationMs", row.durationMs); result.put("displayName", row.displayName);
            result.put("mime", row.mimeType); result.put("cover", row.embeddedCover);
            result.put("lrc", row.adjacentLrc); result.put("availability", row.availability);
            result.put("grantReferenceId", row.grantReferenceId);
            return result;
        }
        if (value instanceof LocalDataRepository.HistoryStatus) {
            result.put("enabled", ((LocalDataRepository.HistoryStatus) value).enabled); return result;
        }
        if (value instanceof LocalDataRepository.HistoryIngest) {
            LocalDataRepository.HistoryIngest row = (LocalDataRepository.HistoryIngest) value;
            result.put("deltaPlayedMs", row.deltaPlayedMs); result.put("qualified", row.qualified);
            result.put("disposition", row.disposition); return result;
        }
        if (value instanceof LocalDataRepository.AnnualSummary) {
            LocalDataRepository.AnnualSummary row = (LocalDataRepository.AnnualSummary) value;
            result.put("year", row.year); result.put("enabled", row.enabled); result.put("playedMs", row.playedMs);
            result.put("playCount", row.playCount); result.put("uniqueTracks", row.uniqueTracks);
            result.put("uniqueArtists", row.uniqueArtists); return result;
        }
        if (value instanceof LocalDataRepository.CacheSummary) {
            LocalDataRepository.CacheSummary row = (LocalDataRepository.CacheSummary) value;
            result.put("capacityBytes", row.capacityBytes); result.put("usedBytes", row.usedBytes);
            result.put("corruptEntries", row.corruptEntries); JSONArray entries = new JSONArray();
            if (row.entries.size() > MAX_LOCAL_ROWS) throw new IllegalArgumentException();
            for (LocalDataRepository.CacheView entry : row.entries) entries.put(localDataJson(entry));
            result.put("entries", entries); return result;
        }
        if (value instanceof LocalDataRepository.CacheView) {
            LocalDataRepository.CacheView row = (LocalDataRepository.CacheView) value;
            result.put("cacheId", row.cacheId); result.put("source", row.source);
            result.put("providerTrackId", row.providerTrackId); result.put("byteCount", row.byteCount);
            result.put("retention", row.retention); result.put("state", row.state);
            result.put("integrity", row.integrity); result.put("lastAccessedAtMs", row.lastAccessedAtMs); return result;
        }
        if (value instanceof LocalDataRepository.DirectoryStatus) {
            result.put("state", ((LocalDataRepository.DirectoryStatus) value).state); return result;
        }
        if (value instanceof LocalDataRepository.SettingsView) {
            LocalDataRepository.SettingsView row = (LocalDataRepository.SettingsView) value;
            result.put("theme", row.theme); result.put("language", row.language);
            result.put("historyEnabled", row.historyEnabled); result.put("cacheCapacityBytes", row.cacheCapacityBytes); return result;
        }
        if (value instanceof LocalDataRepository.BackupPreview) {
            LocalDataRepository.BackupPreview row = (LocalDataRepository.BackupPreview) value;
            result.put("playlists", row.playlists); result.put("favorites", row.favorites); result.put("tracks", row.tracks); return result;
        }
        if (value instanceof BackupSafFilePort.PageSafeStatus) {
            BackupSafFilePort.PageSafeStatus row = (BackupSafFilePort.PageSafeStatus) value;
            result.put("state", row.state); result.put("status", row.status);
            if (row.preview != null) result.put("preview", localDataJson(row.preview));
            return result;
        }
        if (value instanceof LocalDataRepository.Backup) {
            LocalDataRepository.Backup row = (LocalDataRepository.Backup) value;
            result.put("version", row.version); JSONArray playlists = new JSONArray(); JSONArray favorites = new JSONArray();
            if (row.playlists.size() > MAX_LOCAL_ROWS || row.favorites.size() > MAX_LOCAL_ROWS) throw new IllegalArgumentException();
            for (LocalDataRepository.PlaylistView playlist : row.playlists) playlists.put(localDataJson(playlist));
            for (LocalDataRepository.FavoriteView favorite : row.favorites) favorites.put(localDataJson(favorite));
            result.put("playlists", playlists); result.put("favorites", favorites); return result;
        }
        throw new IllegalArgumentException();
    }

    private static JSONObject trackJson(LocalDataRepository.Track track) throws JSONException {
        if (track == null || safeId(track.source) == null || safeId(track.providerTrackId) == null
                || safeText(track.title) == null || safeText(track.artist) == null
                || track.durationMs < 0L || track.durationMs > 28_800_000L) throw new IllegalArgumentException();
        JSONObject result = new JSONObject();
        result.put("source", track.source); result.put("providerTrackId", track.providerTrackId);
        result.put("title", track.title); result.put("artist", track.artist); result.put("durationMs", track.durationMs);
        return result;
    }

    /** Final recursive output guard: semantic DTOs cannot grow into path, URI or credential transport. */
    private static void assertSafeLocalJson(Object value) throws JSONException {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            java.util.Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (key.length() > 64 || forbiddenLocalKey(key)) throw new IllegalArgumentException();
                assertSafeLocalJson(object.opt(key));
            }
            return;
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            if (array.length() > MAX_LOCAL_TRACKS) throw new IllegalArgumentException();
            for (int index = 0; index < array.length(); index += 1) assertSafeLocalJson(array.opt(index));
            return;
        }
        if (value instanceof String) {
            String text = (String) value;
            String normalized = text.toLowerCase();
            if (text.length() > MAX_LOCAL_TEXT || normalized.contains("://") || normalized.startsWith("file:")
                    || normalized.startsWith("content:") || normalized.contains("cookie=")
                    || normalized.contains("authorization:")) throw new IllegalArgumentException();
            return;
        }
        if (value == null || value == JSONObject.NULL || value instanceof Number || value instanceof Boolean) return;
        throw new IllegalArgumentException();
    }

    private static boolean forbiddenLocalKey(String key) {
        String normalized = key.toLowerCase();
        return normalized.contains("path") || normalized.contains("uri") || normalized.contains("url")
                || normalized.contains("cookie") || normalized.contains("header") || normalized.contains("token")
                || normalized.contains("credential") || normalized.contains("contentkey");
    }

    static AndroidLocalDataFacade.PageBackupInput pageBackupFromJson(JSONObject object) {
        if (!hasExactlyKeys(object, "version", "playlists", "favorites")) return null;
        Integer version = boundedInt(object.opt("version"), 1, 1);
        JSONArray playlistsJson = object.optJSONArray("playlists");
        JSONArray favoritesJson = object.optJSONArray("favorites");
        if (version == null || playlistsJson == null || favoritesJson == null
                || playlistsJson.length() > MAX_LOCAL_ROWS || favoritesJson.length() > MAX_LOCAL_ROWS) return null;
        List<AndroidLocalDataFacade.PagePlaylistInput> playlists = new ArrayList<>();
        List<AndroidLocalDataFacade.PageFavoriteInput> favorites = new ArrayList<>();
        int totalTracks = 0;
        for (int index = 0; index < playlistsJson.length(); index += 1) {
            JSONObject row = playlistsJson.optJSONObject(index);
            if (!hasExactlyKeys(row, "playlistId", "name", "ordinal", "revision", "tracks")) return null;
            String id = safeId(row.opt("playlistId")); String name = safeText(row.opt("name"));
            Integer ordinal = boundedInt(row.opt("ordinal"), 0, MAX_LOCAL_ROWS);
            Long revision = boundedLong(row.opt("revision"), 0L, Integer.MAX_VALUE);
            List<LocalDataRepository.Track> tracks = tracksFromJson(row.optJSONArray("tracks"));
            if (id == null || name == null || ordinal == null || revision == null || tracks == null) return null;
            totalTracks += tracks.size(); if (totalTracks > MAX_LOCAL_TRACKS) return null;
            List<AndroidLocalDataFacade.PageTrackInput> pageTracks = new ArrayList<>();
            for (LocalDataRepository.Track track : tracks) {
                pageTracks.add(new AndroidLocalDataFacade.PageTrackInput(track.source, track.providerTrackId,
                        track.title, track.artist, track.durationMs));
            }
            playlists.add(new AndroidLocalDataFacade.PagePlaylistInput(id, name, pageTracks));
        }
        for (int index = 0; index < favoritesJson.length(); index += 1) {
            JSONObject row = favoritesJson.optJSONObject(index);
            if (!hasExactlyKeys(row, "source", "providerTrackId", "title", "artist", "addedAtMs")) return null;
            String source = safeId(row.opt("source")); String trackId = safeId(row.opt("providerTrackId"));
            String title = safeText(row.opt("title")); String artist = safeText(row.opt("artist"));
            Long addedAt = boundedLong(row.opt("addedAtMs"), 0L, Long.MAX_VALUE);
            if (source == null || trackId == null || title == null || artist == null || addedAt == null) return null;
            favorites.add(new AndroidLocalDataFacade.PageFavoriteInput(source, trackId, title, artist));
        }
        return new AndroidLocalDataFacade.PageBackupInput(playlists, favorites);
    }

    private static LocalDataRepository.Track trackFromJson(JSONObject object) {
        if (!hasExactlyKeys(object, "source", "providerTrackId", "title", "artist", "durationMs")) return null;
        String source = safeId(object.opt("source")); String trackId = safeId(object.opt("providerTrackId"));
        String title = safeText(object.opt("title")); String artist = safeText(object.opt("artist"));
        Long duration = boundedLong(object.opt("durationMs"), 0L, 28_800_000L);
        return source == null || trackId == null || title == null || artist == null || duration == null ? null
                : new LocalDataRepository.Track(source, trackId, title, artist, duration);
    }

    private static List<LocalDataRepository.Track> tracksFromJson(JSONArray array) {
        if (array == null || array.length() > MAX_LOCAL_TRACKS) return null;
        List<LocalDataRepository.Track> tracks = new ArrayList<>();
        for (int index = 0; index < array.length(); index += 1) {
            LocalDataRepository.Track track = trackFromJson(array.optJSONObject(index));
            if (track == null) return null;
            tracks.add(track);
        }
        return tracks;
    }

    private static List<String> idsFromJson(JSONArray array, int max) {
        if (array == null || array.length() > max) return null;
        List<String> ids = new ArrayList<>();
        for (int index = 0; index < array.length(); index += 1) {
            String id = safeId(array.opt(index));
            if (id == null || ids.contains(id)) return null;
            ids.add(id);
        }
        return ids;
    }

    private static String safeId(Object value) {
        if (!(value instanceof String)) return null;
        String text = (String) value;
        return text.matches("[A-Za-z0-9._:-]{1,160}") ? text : null;
    }

    private static String safeText(Object value) {
        if (!(value instanceof String)) return null;
        String text = ((String) value).trim();
        String normalized = text.toLowerCase();
        return text.isEmpty() || text.length() > MAX_LOCAL_TEXT || text.indexOf('\u0000') >= 0
                || text.indexOf('<') >= 0 || text.indexOf('>') >= 0 || normalized.contains("://")
                || normalized.startsWith("file:") || normalized.startsWith("content:") || text.startsWith("/")
                || text.startsWith("\\") || text.matches("^[A-Za-z]:[\\\\/].*") ? null : text;
    }

    private static String safeSetting(Object value) {
        if (!(value instanceof String)) return null;
        String text = (String) value;
        return text.matches("[A-Za-z0-9._-]{1,32}") ? text : null;
    }

    private static Integer boundedInt(Object value, int minimum, int maximum) {
        if (!(value instanceof Number)) return null;
        long number = ((Number) value).longValue();
        return number >= minimum && number <= maximum ? (int) number : null;
    }

    private static Long boundedLong(Object value, long minimum, long maximum) {
        if (!(value instanceof Number)) return null;
        long number = ((Number) value).longValue();
        return number >= minimum && number <= maximum ? number : null;
    }

    private static boolean hasExactlyKeys(JSONObject object, String... expected) {
        if (object == null || object.length() != expected.length) return false;
        for (String key : expected) if (!object.has(key)) return false;
        return true;
    }

    /** Converts the closed RPC payload into semantic-only durable lyric state. */
    private AndroidRpcContract.TypedReply executeLyricPersistence(
            AndroidRpcContract.TypedRequest request) {
        JSONObject payload = request.operationPayload;
        if (payload == null) return AndroidRpcContract.reply(request,
                AndroidRpcContract.Terminal.ERROR, 0, null, "INVALID_LYRIC_INTENT");
        try {
            LyricPersistencePort.Operation operation;
            String selectedSourceId = null;
            long offsetMs = 0L;
            if (request.operation == AndroidRpcContract.Operation.LYRIC_SELECTION_GET) {
                operation = LyricPersistencePort.Operation.GET;
            } else if (request.operation == AndroidRpcContract.Operation.LYRIC_SELECTION_SET) {
                operation = LyricPersistencePort.Operation.SET;
                selectedSourceId = payload.getString("lyricId");
            } else if (request.operation == AndroidRpcContract.Operation.LYRIC_SELECTION_CLEAR) {
                operation = LyricPersistencePort.Operation.CLEAR;
            } else if (request.operation == AndroidRpcContract.Operation.LYRIC_OFFSET_SET) {
                operation = LyricPersistencePort.Operation.OFFSET;
                offsetMs = payload.getLong("offsetMs");
            } else {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0, null,
                        "INVALID_LYRIC_INTENT");
            }
            // Phase 3's closed lyric operations are NetEase-only. The opaque selection identity
            // is the durable lyric revision; it never carries candidates or provider bodies.
            LyricPersistencePort.Result result = lyricPersistencePort.execute(
                    new LyricPersistencePort.Intent(operation, AndroidRpcContract.NETEASE_SOURCE,
                            payload.getString("trackId"), "", payload.getString("selectionIdentity"),
                            payload.getLong("selectionRevision"), payload.getString("selectionToken"),
                            selectedSourceId, offsetMs));
            if (result.errorCode != null && !"STALE_REVISION".equals(result.errorCode)) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0, null,
                        result.errorCode);
            }
            JSONObject projected = new JSONObject();
            projected.put("status", result.status);
            projected.put("revision", result.revision);
            if (result.mode != null) projected.put("mode", result.mode);
            if (result.selectedSourceId != null) projected.put("lyricId", result.selectedSourceId);
            projected.put("offsetMs", result.offsetMs);
            if (result.errorCode != null) projected.put("conflict", result.errorCode);
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 0, projected, null);
        } catch (JSONException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0, null,
                    "INVALID_LYRIC_INTENT");
        }
    }

    /** Persists only bounded semantic lyric text; transport and credentials never enter Room. */
    private AndroidRpcContract.TypedReply executeLyricContent(
            AndroidRpcContract.TypedRequest request) {
        JSONObject payload = request.operationPayload;
        if (payload == null) return AndroidRpcContract.reply(request,
                AndroidRpcContract.Terminal.ERROR, 0, null, "INVALID_LYRIC_CONTENT");
        try {
            long part = payload.getLong("providerPartId");
            LyricPersistencePort.Intent intent = new LyricPersistencePort.Intent(
                    LyricPersistencePort.Operation.GET, payload.getString("source"),
                    payload.getString("providerTrackId"), part == 0L ? "" : Long.toString(part),
                    payload.getString("lyricRevision"), payload.getLong("expectedRevision"),
                    payload.getString("transitionToken"), null, 0L);
            JSONObject projected = new JSONObject();
            if (request.operation == AndroidRpcContract.Operation.LYRIC_CONTENT_GET) {
                LyricPersistencePort.ContentResult result = lyricPersistencePort.readContent(intent);
                if (result.errorCode != null) return AndroidRpcContract.reply(request,
                        AndroidRpcContract.Terminal.ERROR, 0, null, result.errorCode);
                projected.put("status", result.status);
                projected.put("revision", result.revision);
                if ("found".equals(result.status)) {
                    projected.put("originalText", result.originalText);
                    projected.put("translationText", result.translationText);
                }
            } else {
                LyricPersistencePort.Result result = lyricPersistencePort.persistContent(intent,
                        payload.getString("originalText"), payload.getString("translationText"),
                        100, System.currentTimeMillis());
                if (result.errorCode != null && !"STALE_REVISION".equals(result.errorCode)) {
                    return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                            null, result.errorCode);
                }
                projected.put("status", result.status);
                projected.put("revision", result.revision);
                if (result.errorCode != null) projected.put("conflict", result.errorCode);
            }
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, 0, projected,
                    null);
        } catch (JSONException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0, null,
                    "INVALID_LYRIC_CONTENT");
        }
    }

    static boolean shouldRetryWithoutAnonymousCookie(
            AndroidRpcContract.TypedRequest request, AndroidRpcContract.TypedReply reply) {
        if (request == null || reply == null
                || reply.terminal != AndroidRpcContract.Terminal.ERROR) {
            return false;
        }
        boolean closedMetadataOperation = request.operation
                == AndroidRpcContract.Operation.BILIBILI_SEARCH
                || request.operation == AndroidRpcContract.Operation.BILIBILI_VIDEO_DETAIL;
        return closedMetadataOperation
                && ("PROVIDER_STATUS".equals(reply.errorCode)
                        || "BILIBILI_ANONYMOUS_COOKIE_UNAVAILABLE".equals(reply.errorCode));
    }

    private AndroidRpcContract.TypedReply executeTypedMetadataOperation(
            AndroidRpcContract.TypedRequest request, BridgeRequestRegistry.RequestKey key,
            boolean includeAnonymousCookie) {
        HttpsURLConnection connection = null;
        try {
            java.net.URI uri = request.operation == AndroidRpcContract.Operation.BILIBILI_SEARCH
                    ? AndroidRpcContract.buildSearchUri(request)
                    : AndroidRpcContract.buildVideoDetailUri(request);
            connection = (HttpsURLConnection) new URL(uri.toASCIIString()).openConnection();
            if (!typedRequests.attachConnection(key, connection)) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.CANCELLED, 0,
                        null, "CANCELLED");
            }
            connection.setRequestMethod("GET");
            configureConnection(connection, HttpBridgePolicy.RequestRoute.BILIBILI_GET);
            if (includeAnonymousCookie) {
                String cookieHeader = resolveCookieHeader(
                        HttpBridgePolicy.ValidationResult.valid(
                                uri, HttpBridgePolicy.RequestRoute.BILIBILI_GET),
                        uri.toASCIIString());
                if (cookieHeader == null) {
                    return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                            null, "BILIBILI_ANONYMOUS_COOKIE_UNAVAILABLE");
                }
                connection.setRequestProperty("Cookie", cookieHeader);
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, status,
                        null, "REDIRECT_NOT_ALLOWED");
            }
            if (connection.getContentLengthLong() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, status,
                        null, "RESPONSE_TOO_LARGE");
            }
            if (status < 200 || status >= 300) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, status,
                        null, "HTTP_STATUS");
            }
            try (InputStream input = connection.getInputStream()) {
                BilibiliResponseMapper.MappingResult projection = request.operation
                        == AndroidRpcContract.Operation.BILIBILI_SEARCH
                        ? BilibiliResponseMapper.mapSearch(request,
                                readBoundedUtf8(input, HttpBridgePolicy.MAX_RESPONSE_BYTES))
                        : BilibiliResponseMapper.mapVideoDetail(request,
                                readBoundedUtf8(input, HttpBridgePolicy.MAX_RESPONSE_BYTES));
                return projection.isValid()
                        ? AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK, status,
                                projection.value, null)
                        : AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, status,
                                null, projection.errorCode);
            }
        } catch (ResponseTooLargeException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "RESPONSE_TOO_LARGE");
        } catch (SocketTimeoutException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "NETWORK_TIMEOUT");
        } catch (IOException | RuntimeException | java.net.URISyntaxException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "NETWORK_IO_ERROR");
        } finally {
            typedRequests.detachConnection(key, connection);
            if (connection != null) connection.disconnect();
        }
    }

    private static void configureConnection(
            HttpsURLConnection connection,
            HttpBridgePolicy.RequestRoute route) {
        connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
        connection.setReadTimeout(READ_TIMEOUT_MILLIS);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", ACCEPT_HEADER);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("User-Agent", USER_AGENT);
        connection.setRequestProperty("Referer", route.getReferer());
    }

    private static String readBoundedUtf8(InputStream input, int maximumBytes)
            throws IOException, ResponseTooLargeException {
        try (InputStream closeableInput = input;
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = closeableInput.read(buffer)) != -1) {
                if (read > maximumBytes - total) {
                    throw new ResponseTooLargeException();
                }
                output.write(buffer, 0, read);
                total += read;
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void replyOnMain(WebView view, JavaScriptReplyProxy replyProxy, BridgeReply reply) {
        final String payload = reply.toJson();
        view.post(() -> {
            try {
                replyProxy.postMessage(payload);
            } catch (RuntimeException ignored) {
                // The WebView may have been destroyed while an async request ran.
            }
        });
    }

    private static void replyTypedOnMain(
            WebView view, JavaScriptReplyProxy replyProxy, AndroidRpcContract.TypedReply reply) {
        final String payload = reply.toJson();
        view.post(() -> {
            try {
                replyProxy.postMessage(payload);
            } catch (RuntimeException ignored) {
                // Destruction can race an async terminal reply.
            }
        });
    }

    private static void postPlaybackSnapshot(WebView view, JavaScriptReplyProxy replyProxy,
            int pageEpoch, PlaybackSnapshot snapshot) {
        if (snapshot == null) return;
        JSONObject event = new JSONObject();
        try {
            event.put("version", AndroidRpcContract.PROTOCOL_VERSION);
            event.put("operation", "playback.snapshot");
            event.put("pageEpoch", pageEpoch);
            event.put("snapshot", new JSONObject(snapshot.toMap()));
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        final String payload = event.toString();
        view.post(() -> {
            try {
                replyProxy.postMessage(payload);
            } catch (RuntimeException ignored) {
                // The renderer may have detached after the command terminalled.
            }
        });
    }

    private static final class ParsedRequest {
        final String requestId;
        final String method;
        final String url;
        final String errorCode;

        private ParsedRequest(String requestId, String method, String url, String errorCode) {
            this.requestId = requestId;
            this.method = method;
            this.url = url;
            this.errorCode = errorCode;
        }

        static ParsedRequest valid(String requestId, String method, String url) {
            return new ParsedRequest(requestId, method, url, null);
        }

        static ParsedRequest error(String requestId, String errorCode) {
            return new ParsedRequest(requestId, null, null, errorCode);
        }
    }

    private static final class BridgeReply {
        final String requestId;
        final boolean ok;
        final int status;
        final String body;
        final String errorCode;

        private BridgeReply(String requestId, boolean ok, int status, String body, String errorCode) {
            this.requestId = requestId;
            this.ok = ok;
            this.status = status;
            this.body = body;
            this.errorCode = errorCode;
        }

        static BridgeReply success(String requestId, int status, String body) {
            return new BridgeReply(requestId, true, status, body, null);
        }

        static BridgeReply error(String requestId, int status, String errorCode) {
            return new BridgeReply(requestId, false, status, "", errorCode);
        }

        static BridgeReply error(String requestId, int status, String errorCode, String body) {
            return new BridgeReply(requestId, false, status, body, errorCode);
        }

        String toJson() {
            JSONObject response = new JSONObject();
            try {
                response.put("version", HttpBridgePolicy.PROTOCOL_VERSION);
                response.put("requestId", requestId);
                response.put("ok", ok);
                response.put("status", status);
                response.put("body", body);
                if (errorCode != null) {
                    response.put("error", errorCode);
                }
            } catch (JSONException impossible) {
                throw new IllegalStateException("Unable to encode bridge response", impossible);
            }
            return response.toString();
        }
    }

    private static final class ResponseTooLargeException extends Exception {}
}
