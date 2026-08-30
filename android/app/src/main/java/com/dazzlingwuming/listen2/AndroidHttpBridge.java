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
import java.util.concurrent.ExecutorService;
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
    private static final String USER_AGENT = "Listen2Android/2.34";

    private final ExecutorService networkExecutor;
    // Accessed only by the single-threaded network executor. This anonymous
    // value is intentionally not written to CookieManager.
    private String anonymousBilibiliBuvid3;
    private boolean bilibiliFingerprintAttempted;

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
        networkExecutor.shutdownNow();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(webView, HttpBridgePolicy.JAVASCRIPT_OBJECT_NAME);
        }
    }

    private final class Listener implements WebViewCompat.WebMessageListener {
        @Override
        public void onPostMessage(
                WebView view,
                WebMessageCompat message,
                Uri sourceOrigin,
                boolean isMainFrame,
                JavaScriptReplyProxy replyProxy) {
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

            try {
                networkExecutor.execute(() -> {
                    String cookieHeader = resolveCookieHeader(validation, parsed.url);
                    if (validation.getRoute() == HttpBridgePolicy.RequestRoute.BILIBILI_GET
                            && cookieHeader == null) {
                        replyOnMain(view, replyProxy, BridgeReply.error(
                                parsed.requestId, 0, "BILIBILI_ANONYMOUS_COOKIE_UNAVAILABLE"));
                        return;
                    }
                    BridgeReply reply = executeRequest(parsed.requestId, validation, cookieHeader);
                    replyOnMain(view, replyProxy, reply);
                });
            } catch (RejectedExecutionException ignored) {
                replyOnMain(view, replyProxy, BridgeReply.error(parsed.requestId, 0, "BRIDGE_BUSY"));
            }
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

    private static BridgeReply executeRequest(
            String requestId,
            HttpBridgePolicy.ValidationResult validation,
            String cookieHeader) {
        HttpsURLConnection connection = null;
        try {
            String url = validation.getUri().toASCIIString();
            HttpBridgePolicy.RequestRoute route = validation.getRoute();
            connection = (HttpsURLConnection) new URL(url).openConnection();
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
                connection.disconnect();
            }
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
