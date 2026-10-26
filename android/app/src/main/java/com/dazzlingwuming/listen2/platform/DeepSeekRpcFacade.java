package com.dazzlingwuming.listen2.platform;

import com.dazzlingwuming.listen2.provider.AndroidDeepSeekPolicy;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/**
 * Named semantic operation facade for the Android DeepSeek capability.
 *
 * <p>The bridge should pass an already parsed operation name and payload here;
 * this class still applies a second, capability-specific exact-key boundary
 * before touching the Keystore or network client. Its returned objects contain
 * only page-safe status/result fields and never contain a key, ciphertext,
 * prompt, source lyric, raw exception, or complete model envelope.</p>
 */
public final class DeepSeekRpcFacade {
    public static final int MAX_OPERATION_ID_LENGTH = 128;
    public static final int MAX_PAYLOAD_BYTES = 128 * 1024;

    private static final Set<String> OPERATIONS = operationSet();
    private static final Set<String> EMPTY_KEYS = new HashSet<>();

    private final AndroidDeepSeekTranslationPort port;
    private final Map<String, AndroidDeepSeekTranslationClient.CancellationToken> activeOperations =
            new HashMap<>();

    public DeepSeekRpcFacade(AndroidDeepSeekTranslationPort port) {
        this.port = port;
    }

    /**
     * Dispatches one named semantic action. No transport controls are accepted
     * in payload; cancellation is supplied through {@link #cancel(String)}.
     */
    public JSONObject dispatch(String operation, String operationId, JSONObject payload) {
        String inputError = validateOperationEnvelope(operation, operationId, payload);
        if (inputError != null) {
            return isTranslateOperation(operation)
                    ? translationError(inputError, 0, false) : error(inputError);
        }

        final AndroidDeepSeekPolicy.Input translationInput;
        if (isTranslateOperation(operation)) {
            ParseInputResult parsed = parseTranslationInput(payload);
            if (!parsed.ok) return translationError(parsed.errorCode, 0, false);
            translationInput = parsed.input;
        } else {
            translationInput = null;
            String payloadError = validateNonTranslationPayload(operation, payload);
            if (payloadError != null) return error(payloadError);
        }

        final AndroidDeepSeekTranslationClient.CancellationToken cancellation =
                new AndroidDeepSeekTranslationClient.CancellationToken();
        synchronized (activeOperations) {
            if (activeOperations.containsKey(operationId)) return error("operation-in-flight");
            activeOperations.put(operationId, cancellation);
        }
        try {
            if (port == null) {
                return AndroidDeepSeekTranslationPort.OPERATION_STATUS.equals(operation)
                        ? credentialStatus(null, false)
                        : isTranslateOperation(operation)
                        ? translationError("native-capability-unavailable", 0, false)
                        : error("native-capability-unavailable");
            }
            if (AndroidDeepSeekTranslationPort.OPERATION_STATUS.equals(operation)) {
                return credentialStatus(port.status(), true);
            }
            if (AndroidDeepSeekTranslationPort.OPERATION_CONFIGURE.equals(operation)) {
                String apiKey = payload.optString("apiKey", null);
                if (AndroidDeepSeekVault.normalizeApiKey(apiKey) == null) {
                    return error("invalid-api-key");
                }
                return credentialStatus(port.configure(apiKey), true);
            }
            if (AndroidDeepSeekTranslationPort.OPERATION_TEST.equals(operation)) {
                return testResult(port.test(cancellation));
            }
            if (AndroidDeepSeekTranslationPort.OPERATION_DELETE.equals(operation)) {
                return credentialStatus(port.delete(), true);
            }
            if (AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE.equals(operation)) {
                return translationResult(port.translate(translationInput, cancellation));
            }
            return error("unsupported-operation");
        } catch (Exception ignored) {
            // Native implementations already classify expected failures. This
            // final boundary deliberately discards raw exception details.
            return isTranslateOperation(operation)
                    ? translationError("internal-error", 0, false) : error("internal-error");
        } finally {
            synchronized (activeOperations) {
                if (activeOperations.get(operationId) == cancellation) {
                    activeOperations.remove(operationId);
                }
            }
        }
    }

    /** Requests cancellation without exposing the token or transport handle. */
    public JSONObject cancel(String operationId) {
        if (!isSafeOperationId(operationId)) return error("invalid-request-id");
        synchronized (activeOperations) {
            AndroidDeepSeekTranslationClient.CancellationToken token = activeOperations.get(operationId);
            if (token == null) return error("operation-not-found");
            token.cancel();
            return result("cancel-requested");
        }
    }

    /** Package-safe lifecycle seam for tests and bridge teardown diagnostics. */
    boolean isActive(String operationId) {
        synchronized (activeOperations) {
            return activeOperations.containsKey(operationId);
        }
    }

    private static String validateOperationEnvelope(String operation, String operationId,
            JSONObject payload) {
        if (!isSafeOperationId(operationId)) return "invalid-request-id";
        if (operation == null || operation.length() > MAX_OPERATION_ID_LENGTH
                || !OPERATIONS.contains(operation)) return "unsupported-operation";
        if (payload == null) return "invalid-payload";
        try {
            if (utf8Bytes(payload.toString()) > MAX_PAYLOAD_BYTES) return "payload-too-large";
        } catch (RuntimeException ignored) {
            return "invalid-payload";
        }
        return null;
    }

    private static String validateNonTranslationPayload(String operation, JSONObject payload) {
        if (AndroidDeepSeekTranslationPort.OPERATION_STATUS.equals(operation)
                || AndroidDeepSeekTranslationPort.OPERATION_TEST.equals(operation)
                || AndroidDeepSeekTranslationPort.OPERATION_DELETE.equals(operation)) {
            return hasExactlyKeys(payload, EMPTY_KEYS) ? null : "unknown-field";
        }
        if (AndroidDeepSeekTranslationPort.OPERATION_CONFIGURE.equals(operation)) {
            if (!hasExactlyKeys(payload, "apiKey") || !(payload.opt("apiKey") instanceof String)) {
                return "invalid-payload";
            }
            return AndroidDeepSeekVault.normalizeApiKey((String) payload.opt("apiKey")) == null
                    ? "invalid-api-key" : null;
        }
        return "unsupported-operation";
    }

    private static ParseInputResult parseTranslationInput(JSONObject payload) {
        if (!hasExactlyKeys(payload, "lyric", "title", "artist", "styleHint", "consent")) {
            return ParseInputResult.error("unknown-field");
        }
        if (!(payload.opt("lyric") instanceof String)
                || !(payload.opt("title") instanceof String)
                || !(payload.opt("artist") instanceof String)
                || !(payload.opt("styleHint") instanceof String)) {
            return ParseInputResult.error("invalid-payload");
        }
        JSONObject consent = payload.optJSONObject("consent");
        if (consent == null || !hasExactlyKeys(consent, "lyrics", "title", "artist",
                "possibleCost", "cancellation", "failureImpact", "acceptedAtEpochMs")) {
            return ParseInputResult.error("invalid-consent");
        }
        if (!(consent.opt("lyrics") instanceof Boolean)
                || !(consent.opt("title") instanceof Boolean)
                || !(consent.opt("artist") instanceof Boolean)
                || !(consent.opt("possibleCost") instanceof Boolean)
                || !(consent.opt("cancellation") instanceof Boolean)
                || !(consent.opt("failureImpact") instanceof Boolean)) {
            return ParseInputResult.error("invalid-consent");
        }
        Long acceptedAt = boundedEpoch(consent.opt("acceptedAtEpochMs"));
        if (acceptedAt == null) return ParseInputResult.error("invalid-consent");

        AndroidDeepSeekPolicy.Consent receipt = new AndroidDeepSeekPolicy.Consent(
                (Boolean) consent.opt("lyrics"),
                (Boolean) consent.opt("title"),
                (Boolean) consent.opt("artist"),
                (Boolean) consent.opt("possibleCost"),
                (Boolean) consent.opt("cancellation"),
                (Boolean) consent.opt("failureImpact"),
                acceptedAt);
        AndroidDeepSeekPolicy.Input input = new AndroidDeepSeekPolicy.Input(
                (String) payload.opt("lyric"),
                (String) payload.opt("title"),
                (String) payload.opt("artist"),
                (String) payload.opt("styleHint"),
                receipt);
        try {
            AndroidDeepSeekPolicy.normalize(input);
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            return ParseInputResult.error(error.code);
        }
        return ParseInputResult.success(input);
    }

    private static JSONObject credentialStatus(AndroidDeepSeekVault.CredentialStatus status,
            boolean nativeClientAvailable) {
        boolean secureStorageAvailable = status != null && status.secureStorageAvailable;
        boolean hasApiKey = status != null && status.hasApiKey;
        String safeError = status == null ? "secure-storage-unavailable"
                : safeStatusOrNull(status.errorCode);
        boolean ok = secureStorageAvailable && safeError == null;
        String pageError = ok ? null
                : safeError == null ? "secure-storage-unavailable" : safeError;
        String resultStatus = ok ? "ok" : pageError;
        JSONObject result = base(ok, resultStatus);
        try {
            result.put("provider", AndroidDeepSeekPolicy.PROVIDER);
            result.put("model", AndroidDeepSeekPolicy.MODEL);
            result.put("targetLanguage", AndroidDeepSeekPolicy.TARGET_LANGUAGE);
            result.put("secureStorageAvailable", secureStorageAvailable);
            result.put("hasApiKey", hasApiKey);
            result.put("nativeClientAvailable", nativeClientAvailable);
            result.put("errorCode", pageError == null ? JSONObject.NULL : pageError);
            return result;
        } catch (JSONException impossible) {
            return error("internal-error");
        }
    }

    private static JSONObject testResult(AndroidDeepSeekTranslationClient.TestOutcome outcome) {
        if (outcome == null) return error("internal-error");
        JSONObject result = base(outcome.ok, outcome.status);
        try {
            result.put("httpStatus", boundedStatus(outcome.httpStatus));
            result.put("retryable", outcome.retryable);
            return result;
        } catch (JSONException impossible) {
            return error("internal-error");
        }
    }

    private static JSONObject translationResult(
            AndroidDeepSeekTranslationClient.TranslationOutcome outcome) {
        if (outcome == null) return translationError("internal-error", 0, false);
        JSONObject result = base(outcome.ok, outcome.status);
        try {
            result.put("httpStatus", boundedStatus(outcome.httpStatus));
            result.put("retryable", outcome.retryable);
            if (!outcome.ok || outcome.translation == null) return result;
            AndroidDeepSeekPolicy.Translation translation = outcome.translation;
            result.put("tlyric", translation.tlyric);
            result.put("provider", translation.provider);
            result.put("model", translation.model);
            result.put("promptVersion", translation.promptVersion);
            result.put("promptFingerprint", translation.promptFingerprint);
            result.put("targetLanguage", translation.targetLanguage);
            result.put("lineCount", translation.lineCount);
            result.put("promptTokens", boundedToken(translation.promptTokens));
            result.put("completionTokens", boundedToken(translation.completionTokens));
            result.put("totalTokens", boundedToken(translation.totalTokens));
            return result;
        } catch (JSONException impossible) {
            return translationError("internal-error", 0, false);
        }
    }

    private static JSONObject translationError(String status, int httpStatus, boolean retryable) {
        JSONObject result = base(false, status == null ? "internal-error" : status);
        try {
            result.put("httpStatus", boundedStatus(httpStatus));
            result.put("retryable", retryable);
            return result;
        } catch (JSONException impossible) {
            return error("internal-error");
        }
    }

    private static JSONObject result(String status) {
        return base(true, status);
    }

    private static JSONObject error(String status) {
        return base(false, status == null ? "internal-error" : status);
    }

    private static JSONObject base(boolean ok, String status) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", ok);
            result.put("status", safeStatus(status));
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return result;
    }

    private static boolean hasExactlyKeys(JSONObject object, Set<String> expected) {
        if (object == null || object.length() != expected.size()) return false;
        Set<String> actual = new HashSet<>();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) actual.add(keys.next());
        return actual.equals(expected);
    }

    private static boolean hasExactlyKeys(JSONObject object, String... expected) {
        Set<String> keys = new HashSet<>();
        for (String key : expected) keys.add(key);
        return hasExactlyKeys(object, keys);
    }

    private static boolean isSafeOperationId(String value) {
        return value != null && !value.isEmpty() && value.length() <= MAX_OPERATION_ID_LENGTH
                && value.matches("[A-Za-z0-9:._-]+");
    }

    private static Long boundedEpoch(Object value) {
        if (!(value instanceof Number)) return null;
        double asDouble = ((Number) value).doubleValue();
        if (Double.isNaN(asDouble) || Double.isInfinite(asDouble)
                || asDouble != Math.rint(asDouble) || asDouble <= 0d
                || asDouble > Long.MAX_VALUE) return null;
        long result = ((Number) value).longValue();
        return result > 0L ? result : null;
    }

    private static int boundedStatus(int status) {
        return status < 0 || status > 999 ? 0 : status;
    }

    private static int boundedToken(int value) {
        return value < 0 ? 0 : value;
    }

    private static int utf8Bytes(String value) {
        return value == null ? 0 : value.getBytes(StandardCharsets.UTF_8).length;
    }

    private static String safeStatus(String value) {
        if (value == null || value.isEmpty() || value.length() > 64
                || !value.matches("[A-Za-z0-9._-]+")) return "internal-error";
        return value;
    }

    private static String safeStatusOrNull(String value) {
        return value == null ? null : safeStatus(value);
    }

    private static boolean isTranslateOperation(String operation) {
        return AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE.equals(operation);
    }

    private static Set<String> operationSet() {
        Set<String> result = new HashSet<>();
        result.add(AndroidDeepSeekTranslationPort.OPERATION_STATUS);
        result.add(AndroidDeepSeekTranslationPort.OPERATION_CONFIGURE);
        result.add(AndroidDeepSeekTranslationPort.OPERATION_TEST);
        result.add(AndroidDeepSeekTranslationPort.OPERATION_DELETE);
        result.add(AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE);
        return result;
    }

    private static final class ParseInputResult {
        final boolean ok;
        final String errorCode;
        final AndroidDeepSeekPolicy.Input input;

        private ParseInputResult(boolean ok, String errorCode, AndroidDeepSeekPolicy.Input input) {
            this.ok = ok;
            this.errorCode = errorCode;
            this.input = input;
        }

        static ParseInputResult success(AndroidDeepSeekPolicy.Input input) {
            return new ParseInputResult(true, null, input);
        }

        static ParseInputResult error(String errorCode) {
            return new ParseInputResult(false, errorCode, null);
        }
    }
}
