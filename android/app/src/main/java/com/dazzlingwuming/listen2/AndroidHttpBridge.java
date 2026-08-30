package com.dazzlingwuming.listen2;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
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
    private final ThreadPoolExecutor networkExecutor;
    private final BridgeRequestRegistry typedRequests = new BridgeRequestRegistry();
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
    }

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
        if (parsed.request.operation == AndroidRpcContract.Operation.RPC_CANCEL) {
            BridgeRequestRegistry.SettleResult result = typedRequests.cancel(
                    new BridgeRequestRegistry.RequestKey(parsed.request.targetPageEpoch,
                            parsed.request.targetRequestId));
            JSONObject acknowledgement = new JSONObject();
            try {
                acknowledgement.put("cancelled", result == BridgeRequestRegistry.SettleResult.CANCELLED);
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            replyTypedOnMain(view, replyProxy, AndroidRpcContract.reply(parsed.request,
                    AndroidRpcContract.Terminal.OK, 0, acknowledgement, null));
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
        if (request.operation == AndroidRpcContract.Operation.BILIBILI_AUDIO_MANIFEST) {
            return executeTypedManifest(request, key);
        }
        AndroidRpcContract.TypedReply reply = executeTypedMetadataOperation(request, key, true);
        // A provider-status response can reject an otherwise valid anonymous
        // fingerprint. Retry the same closed search operation once without
        // sending any cookie; this neither broadens the route nor grants
        // authenticated access.
        if (request.operation == AndroidRpcContract.Operation.BILIBILI_SEARCH
                && reply.terminal == AndroidRpcContract.Terminal.ERROR
                && ("PROVIDER_STATUS".equals(reply.errorCode)
                        || "BILIBILI_ANONYMOUS_COOKIE_UNAVAILABLE".equals(reply.errorCode))) {
            return executeTypedMetadataOperation(request, key, false);
        }
        return reply;
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

    private AndroidRpcContract.TypedReply executeTypedManifest(
            AndroidRpcContract.TypedRequest request, BridgeRequestRegistry.RequestKey key) {
        try {
            AndroidRpcContract.TypedRequest detailRequest = AndroidRpcContract.TypedRequest.videoDetail(
                    request.requestId, request.pageEpoch, request.bvid);
            RawTypedBody detail = fetchTypedBody(detailRequest, key,
                    AndroidRpcContract.buildVideoDetailUri(detailRequest));
            if (!detail.isSuccess()) return detail.toReply(request);
            BilibiliResponseMapper.MappingResult detailProjection = BilibiliResponseMapper.mapVideoDetail(
                    detailRequest, detail.body);
            if (!detailProjection.isValid()) return AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, detail.status, null, detailProjection.errorCode);
            long cid = "default-first".equals(request.selectionMode)
                    ? detailProjection.value.getJSONArray("pages").getJSONObject(0).getLong("cid")
                    : request.cid;
            if (cid <= 0 || ("explicit".equals(request.selectionMode)
                    && !hasCid(detailProjection.value.getJSONArray("pages"), cid))) {
                return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, detail.status,
                        null, "INVALID_PART");
            }
            AndroidRpcContract.TypedRequest selected = AndroidRpcContract.TypedRequest.audioManifest(
                    request.requestId, request.pageEpoch, request.bvid, request.selectionMode, cid);
            RawTypedBody manifest = fetchTypedBody(selected, key,
                    AndroidRpcContract.buildAudioManifestUri(selected));
            if (!manifest.isSuccess()) return manifest.toReply(request);
            BilibiliResponseMapper.MappingResult mapped = BilibiliResponseMapper.mapAudioManifest(
                    selected, detail.body, manifest.body);
            return mapped.isValid() ? AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.OK,
                    manifest.status, mapped.value, null) : AndroidRpcContract.reply(request,
                    AndroidRpcContract.Terminal.ERROR, manifest.status, null, mapped.errorCode);
        } catch (JSONException | java.net.URISyntaxException ignored) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR, 0,
                    null, "MALFORMED_PROVIDER_RESPONSE");
        }
    }

    private static boolean hasCid(org.json.JSONArray pages, long cid) throws JSONException {
        for (int index = 0; index < pages.length(); index += 1) {
            if (pages.getJSONObject(index).getLong("cid") == cid) return true;
        }
        return false;
    }

    private RawTypedBody fetchTypedBody(AndroidRpcContract.TypedRequest request,
            BridgeRequestRegistry.RequestKey key, java.net.URI uri) {
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new URL(uri.toASCIIString()).openConnection();
            if (!typedRequests.attachConnection(key, connection)) return RawTypedBody.error("CANCELLED");
            connection.setRequestMethod("GET");
            configureConnection(connection, HttpBridgePolicy.RequestRoute.BILIBILI_GET);
            String cookieHeader = resolveCookieHeader(HttpBridgePolicy.ValidationResult.valid(
                    uri, HttpBridgePolicy.RequestRoute.BILIBILI_GET), uri.toASCIIString());
            if (cookieHeader == null) return RawTypedBody.error("BILIBILI_ANONYMOUS_COOKIE_UNAVAILABLE");
            connection.setRequestProperty("Cookie", cookieHeader);
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) return RawTypedBody.error(status, "REDIRECT_NOT_ALLOWED");
            if (status < 200 || status >= 300) return RawTypedBody.error(status, "HTTP_STATUS");
            if (connection.getContentLengthLong() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
                return RawTypedBody.error(status, "RESPONSE_TOO_LARGE");
            }
            try (InputStream input = connection.getInputStream()) {
                return RawTypedBody.success(status,
                        readBoundedUtf8(input, HttpBridgePolicy.MAX_RESPONSE_BYTES));
            }
        } catch (ResponseTooLargeException ignored) {
            return RawTypedBody.error("RESPONSE_TOO_LARGE");
        } catch (SocketTimeoutException ignored) {
            return RawTypedBody.error("NETWORK_TIMEOUT");
        } catch (IOException | RuntimeException ignored) {
            return RawTypedBody.error("NETWORK_IO_ERROR");
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

    private static final class RawTypedBody {
        final int status;
        final String body;
        final String errorCode;

        private RawTypedBody(int status, String body, String errorCode) {
            this.status = status;
            this.body = body;
            this.errorCode = errorCode;
        }

        static RawTypedBody success(int status, String body) {
            return new RawTypedBody(status, body, null);
        }

        static RawTypedBody error(String errorCode) {
            return new RawTypedBody(0, null, errorCode);
        }

        static RawTypedBody error(int status, String errorCode) {
            return new RawTypedBody(status, null, errorCode);
        }

        boolean isSuccess() { return errorCode == null; }

        AndroidRpcContract.TypedReply toReply(AndroidRpcContract.TypedRequest request) {
            return AndroidRpcContract.reply(request, AndroidRpcContract.Terminal.ERROR,
                    status, null, errorCode);
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
