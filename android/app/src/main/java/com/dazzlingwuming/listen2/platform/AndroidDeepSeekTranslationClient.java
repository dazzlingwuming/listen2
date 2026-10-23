package com.dazzlingwuming.listen2.platform;

import com.dazzlingwuming.listen2.provider.AndroidDeepSeekPolicy;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

/**
 * Native-only DeepSeek client. The page supplies semantic input only; this
 * client mints the fixed endpoint, fixed body schema, and fixed headers, then
 * consumes the Keystore key inside this package without returning it.
 */
public final class AndroidDeepSeekTranslationClient {
    public static final int CONNECT_TIMEOUT_MILLIS = 10_000;
    public static final int READ_TIMEOUT_MILLIS = 15_000;

    public interface Transport {
        Response execute(Request request, CancellationToken cancellation) throws Exception;
    }

    public static final class CancellationToken {
        private volatile boolean cancelled;

        public void cancel() {
            cancelled = true;
        }

        public boolean isCancelled() {
            return cancelled;
        }
    }

    /** Request DTO is native-only and intentionally has no caller URL/header fields. */
    public static final class Request {
        private final URI endpoint;
        private final String body;
        private final String apiKey;

        private Request(AndroidDeepSeekPolicy.RequestSpec spec, String apiKey) {
            this.endpoint = spec.endpoint;
            this.body = spec.body;
            this.apiKey = apiKey;
        }

        public URI endpoint() {
            return endpoint;
        }

        public String method() {
            return "POST";
        }

        public String body() {
            return body;
        }

        /** Only non-secret fixed headers are observable outside this package. */
        public Map<String, String> fixedHeaders() {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Accept", "application/json");
            headers.put("Content-Type", "application/json; charset=UTF-8");
            headers.put("User-Agent", "Listen2Android/1");
            return Collections.unmodifiableMap(headers);
        }

        String authorizationHeader() {
            return "Bearer " + apiKey;
        }
    }

    public static final class Response {
        public final int statusCode;
        public final String body;
        public final String errorCode;

        public Response(int statusCode, String body) {
            this(statusCode, body, null);
        }

        public Response(int statusCode, String body, String errorCode) {
            this.statusCode = statusCode;
            this.body = body;
            this.errorCode = errorCode;
        }

        public static Response error(String errorCode) {
            return new Response(0, null, errorCode);
        }
    }

    public static final class TranslationOutcome {
        public final boolean ok;
        public final String status;
        public final int httpStatus;
        public final boolean retryable;
        public final AndroidDeepSeekPolicy.Translation translation;

        private TranslationOutcome(boolean ok, String status, int httpStatus, boolean retryable,
                AndroidDeepSeekPolicy.Translation translation) {
            this.ok = ok;
            this.status = status;
            this.httpStatus = httpStatus;
            this.retryable = retryable;
            this.translation = translation;
        }

        static TranslationOutcome ok(AndroidDeepSeekPolicy.Translation translation, int status) {
            return new TranslationOutcome(true, "ok", status, false, translation);
        }

        static TranslationOutcome error(String status, int httpStatus, boolean retryable) {
            return new TranslationOutcome(false, status, httpStatus, retryable, null);
        }
    }

    public static final class TestOutcome {
        public final boolean ok;
        public final String status;
        public final int httpStatus;
        public final boolean retryable;

        private TestOutcome(boolean ok, String status, int httpStatus, boolean retryable) {
            this.ok = ok;
            this.status = status;
            this.httpStatus = httpStatus;
            this.retryable = retryable;
        }

        static TestOutcome ok(int status) {
            return new TestOutcome(true, "ok", status, false);
        }

        static TestOutcome error(String status, int httpStatus, boolean retryable) {
            return new TestOutcome(false, status, httpStatus, retryable);
        }
    }

    private final AndroidDeepSeekApiKeySource keySource;
    private final Transport transport;

    public AndroidDeepSeekTranslationClient(AndroidDeepSeekVault vault) {
        this(vault, new UrlConnectionTransport());
    }

    public AndroidDeepSeekTranslationClient(AndroidDeepSeekVault vault, Transport transport) {
        this((AndroidDeepSeekApiKeySource) vault, transport);
    }

    AndroidDeepSeekTranslationClient(AndroidDeepSeekApiKeySource keySource, Transport transport) {
        this.keySource = keySource;
        this.transport = transport == null ? new UrlConnectionTransport() : transport;
    }

    /**
     * A failed request returns no translation. Callers keep their original
     * lyric object unchanged, so cost/transport/model failures cannot erase or
     * replace the source lyric.
     */
    public TranslationOutcome translate(AndroidDeepSeekPolicy.Input input,
            CancellationToken cancellation) {
        CancellationToken token = cancellation == null ? new CancellationToken() : cancellation;
        final AndroidDeepSeekPolicy.NormalizedInput normalized;
        try {
            normalized = AndroidDeepSeekPolicy.normalize(input);
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            return policyError(error.code);
        }
        if (token.isCancelled()) return TranslationOutcome.error("cancelled", 0, false);
        if (keySource == null) return TranslationOutcome.error("secure-storage-unavailable", 0, false);

        try {
            return keySource.withApiKey(apiKey -> {
                if (token.isCancelled()) return TranslationOutcome.error("cancelled", 0, false);
                AndroidDeepSeekPolicy.RequestSpec spec =
                        AndroidDeepSeekPolicy.buildTranslationRequest(normalized);
                Response response = transport.execute(new Request(spec, apiKey), token);
                return translateResponse(response, normalized);
            });
        } catch (Exception error) {
            return exceptionOutcome(error);
        }
    }

    /** User-triggered key test sends a fixed no-lyric fixture only. */
    public TestOutcome test(CancellationToken cancellation) {
        CancellationToken token = cancellation == null ? new CancellationToken() : cancellation;
        if (token.isCancelled()) return TestOutcome.error("cancelled", 0, false);
        if (keySource == null) return TestOutcome.error("secure-storage-unavailable", 0, false);
        try {
            return keySource.withApiKey(apiKey -> {
                if (token.isCancelled()) return TestOutcome.error("cancelled", 0, false);
                AndroidDeepSeekPolicy.RequestSpec spec = AndroidDeepSeekPolicy.buildTestRequest();
                Response response = transport.execute(new Request(spec, apiKey), token);
                return testResponse(response);
            });
        } catch (Exception error) {
            return testExceptionOutcome(error);
        }
    }

    private static TranslationOutcome translateResponse(Response response,
            AndroidDeepSeekPolicy.NormalizedInput input) {
        if (response == null) return TranslationOutcome.error("network-io-error", 0, true);
        if (response.errorCode != null) return responseError(response.errorCode, response.statusCode);
        if (response.statusCode < 200 || response.statusCode >= 300) {
            return httpError(response.statusCode);
        }
        try {
            return TranslationOutcome.ok(
                    AndroidDeepSeekPolicy.parseTranslationResponse(response.body, input),
                    response.statusCode);
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            return policyError(error.code, response.statusCode);
        }
    }

    private static TestOutcome testResponse(Response response) {
        if (response == null) return TestOutcome.error("network-io-error", 0, true);
        if (response.errorCode != null) return testResponseError(response.errorCode, response.statusCode);
        if (response.statusCode < 200 || response.statusCode >= 300) {
            return testHttpError(response.statusCode);
        }
        try {
            AndroidDeepSeekPolicy.validateTestResponse(response.body);
            return TestOutcome.ok(response.statusCode);
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            return TestOutcome.error(error.code, response.statusCode, false);
        }
    }

    private static TranslationOutcome policyError(String code) {
        return policyError(code, 0);
    }

    private static TranslationOutcome policyError(String code, int status) {
        return TranslationOutcome.error(code == null ? "invalid-response" : code, status, false);
    }

    private static TranslationOutcome responseError(String code, int status) {
        if ("cancelled".equals(code)) return TranslationOutcome.error("cancelled", status, false);
        if ("timeout".equals(code)) return TranslationOutcome.error("timeout", status, true);
        if ("endpoint-not-allowed".equals(code) || "request-too-large".equals(code)) {
            return TranslationOutcome.error(code, status, false);
        }
        if ("response-too-large".equals(code)) {
            return TranslationOutcome.error("response-too-large", status, false);
        }
        return TranslationOutcome.error("network-io-error", status, true);
    }

    private static TestOutcome testResponseError(String code, int status) {
        if ("cancelled".equals(code)) return TestOutcome.error("cancelled", status, false);
        if ("timeout".equals(code)) return TestOutcome.error("timeout", status, true);
        if ("endpoint-not-allowed".equals(code) || "request-too-large".equals(code)) {
            return TestOutcome.error(code, status, false);
        }
        if ("response-too-large".equals(code)) return TestOutcome.error("response-too-large", status, false);
        return TestOutcome.error("network-io-error", status, true);
    }

    private static TranslationOutcome httpError(int status) {
        return TranslationOutcome.error(httpErrorCode(status), status, status == 408 || status == 429
                || status >= 500);
    }

    private static TestOutcome testHttpError(int status) {
        return TestOutcome.error(httpErrorCode(status), status, status == 408 || status == 429
                || status >= 500);
    }

    private static String httpErrorCode(int status) {
        if (status >= 300 && status < 400) return "redirect-not-allowed";
        switch (status) {
            case 400: return "bad-request";
            case 401: return "invalid-api-key";
            case 402: return "quota-exceeded";
            case 422: return "invalid-request";
            case 429: return "rate-limited";
            case 408: return "timeout";
            case 500: return "server-error";
            case 503: return "service-unavailable";
            default: return "request-failed";
        }
    }

    private static TranslationOutcome exceptionOutcome(Exception error) {
        if (error instanceof AndroidDeepSeekVault.AndroidDeepSeekVaultException) {
            String code = ((AndroidDeepSeekVault.AndroidDeepSeekVaultException) error).code;
            return TranslationOutcome.error(code, 0, false);
        }
        if (error instanceof AndroidDeepSeekPolicy.PolicyException) {
            return policyError(((AndroidDeepSeekPolicy.PolicyException) error).code);
        }
        if (error instanceof InterruptedException) {
            Thread.currentThread().interrupt();
            return TranslationOutcome.error("cancelled", 0, false);
        }
        if (error instanceof java.util.concurrent.CancellationException) {
            return TranslationOutcome.error("cancelled", 0, false);
        }
        return TranslationOutcome.error("network-io-error", 0, true);
    }

    private static TestOutcome testExceptionOutcome(Exception error) {
        if (error instanceof AndroidDeepSeekVault.AndroidDeepSeekVaultException) {
            return TestOutcome.error(((AndroidDeepSeekVault.AndroidDeepSeekVaultException) error).code,
                    0, false);
        }
        if (error instanceof AndroidDeepSeekPolicy.PolicyException) {
            return TestOutcome.error(((AndroidDeepSeekPolicy.PolicyException) error).code, 0, false);
        }
        if (error instanceof InterruptedException) {
            Thread.currentThread().interrupt();
            return TestOutcome.error("cancelled", 0, false);
        }
        return TestOutcome.error("network-io-error", 0, true);
    }

    private static final class UrlConnectionTransport implements Transport {
        @Override
        public Response execute(Request request, CancellationToken cancellation) {
            if (request == null || !AndroidDeepSeekPolicy.isApprovedEndpoint(request.endpoint)) {
                return Response.error("endpoint-not-allowed");
            }
            HttpURLConnection connection = null;
            try {
                if (cancellation != null && cancellation.isCancelled()) return Response.error("cancelled");
                URL url = request.endpoint.toURL();
                connection = (HttpURLConnection) url.openConnection();
                if (!(connection instanceof HttpsURLConnection)) return Response.error("endpoint-not-allowed");
                connection.setRequestMethod("POST");
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
                connection.setReadTimeout(READ_TIMEOUT_MILLIS);
                connection.setDoOutput(true);
                for (Map.Entry<String, String> entry : request.fixedHeaders().entrySet()) {
                    connection.setRequestProperty(entry.getKey(), entry.getValue());
                }
                connection.setRequestProperty("Authorization", request.authorizationHeader());
                byte[] body = request.body.getBytes(StandardCharsets.UTF_8);
                if (body.length > AndroidDeepSeekPolicy.MAX_REQUEST_BYTES) {
                    return Response.error("request-too-large");
                }
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
                if (cancellation != null && cancellation.isCancelled()) return Response.error("cancelled");
                int status = connection.getResponseCode();
                // Do not read Location or follow a redirect. The fixed host/path
                // contract treats every 3xx as an actionable transport failure.
                if (status >= 300 && status < 400) return new Response(status, "");
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseBody = stream == null ? "" : readBounded(stream, cancellation);
                return new Response(status, responseBody);
            } catch (SocketTimeoutException error) {
                return Response.error("timeout");
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return Response.error("cancelled");
            } catch (BoundedResponseException error) {
                return Response.error("response-too-large");
            } catch (IOException error) {
                if (cancellation != null && cancellation.isCancelled()) return Response.error("cancelled");
                return Response.error("network-io-error");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        private static String readBounded(InputStream stream, CancellationToken cancellation)
                throws IOException, InterruptedException, BoundedResponseException {
            try (InputStream input = stream) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8 * 1024];
                int total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (cancellation != null && cancellation.isCancelled()) {
                        throw new InterruptedException("cancelled");
                    }
                    total += count;
                    if (total > AndroidDeepSeekPolicy.MAX_RESPONSE_BYTES) {
                        throw new BoundedResponseException();
                    }
                    output.write(buffer, 0, count);
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        }
    }

    private static final class BoundedResponseException extends Exception {}
}
