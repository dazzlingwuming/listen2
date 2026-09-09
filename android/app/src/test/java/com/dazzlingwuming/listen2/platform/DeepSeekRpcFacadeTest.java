package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.provider.AndroidDeepSeekPolicy;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class DeepSeekRpcFacadeTest {
    private static final long CONSENT_TIME = 1_725_000_000_000L;

    @Test
    public void statusConfigureTestDeleteReturnPageSafeProjectionsOnly() throws Exception {
        FakeStore store = new FakeStore();
        DeepSeekRpcFacade facade = new DeepSeekRpcFacade(port(store,
                (request, cancellation) -> new AndroidDeepSeekTranslationClient.Response(
                        200, envelope("{\"ok\":true}"))));

        JSONObject initial = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_STATUS,
                "status-1", new JSONObject());
        assertTrue(initial.optBoolean("ok"));
        assertFalse(initial.optBoolean("hasApiKey"));
        assertFalse(initial.has("apiKey"));
        assertFalse(initial.has("ciphertext"));

        JSONObject configured = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_CONFIGURE,
                "configure-1", new JSONObject().put("apiKey", "fixture-secret"));
        assertTrue(configured.optBoolean("ok"));
        assertTrue(configured.optBoolean("hasApiKey"));
        assertFalse(configured.toString().contains("fixture-secret"));
        assertEquals(1, store.configureCalls);

        JSONObject tested = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_TEST,
                "test-1", new JSONObject());
        assertTrue(tested.optBoolean("ok"));
        assertEquals(200, tested.optInt("httpStatus"));
        assertFalse(tested.has("prompt"));
        assertFalse(tested.has("choices"));

        JSONObject deleted = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_DELETE,
                "delete-1", new JSONObject());
        assertTrue(deleted.optBoolean("ok"));
        assertFalse(deleted.optBoolean("hasApiKey"));
        assertEquals(1, store.deleteCalls);
    }

    @Test
    public void unknownFieldsWrongTypesAndOversizedPayloadsFailBeforePortCalls() throws Exception {
        FakeStore store = new FakeStore();
        DeepSeekRpcFacade facade = new DeepSeekRpcFacade(port(store,
                (request, cancellation) -> {
                    throw new AssertionError("invalid RPC payload must not reach transport");
                }));

        JSONObject extra = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_STATUS,
                "status-2", new JSONObject().put("extra", true));
        assertFalse(extra.optBoolean("ok"));
        assertEquals("unknown-field", extra.optString("status"));

        JSONObject wrongType = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_CONFIGURE,
                "configure-2", new JSONObject().put("apiKey", 42));
        assertFalse(wrongType.optBoolean("ok"));
        assertEquals("invalid-payload", wrongType.optString("status"));

        JSONObject oversized = translatePayload(repeat('x', AndroidDeepSeekPolicy.MAX_LYRIC_BYTES + 1));
        JSONObject oversizedResult = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE,
                "translate-oversized", oversized);
        assertFalse(oversizedResult.optBoolean("ok"));
        assertEquals("lyric-too-large", oversizedResult.optString("status"));
        assertEquals(0, oversizedResult.optInt("httpStatus"));
        assertFalse(oversizedResult.optBoolean("retryable"));
        assertFalse(oversizedResult.has("lyric"));
        assertEquals(0, store.configureCalls);
    }

    @Test
    public void translateSuccessProjectsOnlyValidatedTranslationMetadata() throws Exception {
        FakeStore store = new FakeStore();
        DeepSeekRpcFacade facade = new DeepSeekRpcFacade(port(store,
                (request, cancellation) -> new AndroidDeepSeekTranslationClient.Response(200,
                        envelope("{\"L0002\":\"第二行\",\"L0001\":\"第一行\"}"))));

        JSONObject result = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE,
                "translate-1", translatePayload("[00:01.00]One\n[00:02.00]Two"));

        assertTrue(result.optBoolean("ok"));
        assertEquals("ok", result.optString("status"));
        assertEquals("[00:01.00]第一行\n[00:02.00]第二行", result.optString("tlyric"));
        assertEquals("deepseek", result.optString("provider"));
        assertEquals("deepseek-v4-flash", result.optString("model"));
        assertEquals("deepseek-lyrics-v2", result.optString("promptVersion"));
        assertEquals("zh-CN", result.optString("targetLanguage"));
        assertEquals(2, result.optInt("lineCount"));
        assertEquals(64, result.optString("promptFingerprint").length());

        Set<String> forbidden = new HashSet<>();
        forbidden.add("lyric");
        forbidden.add("title");
        forbidden.add("artist");
        forbidden.add("styleHint");
        forbidden.add("consent");
        forbidden.add("prompt");
        forbidden.add("messages");
        forbidden.add("choices");
        forbidden.add("apiKey");
        forbidden.add("ciphertext");
        for (String key : forbidden) assertFalse("leaked field: " + key, result.has(key));
    }

    @Test
    public void malformedConsentAndMissingRequiredStyleHintAreRejected() throws Exception {
        DeepSeekRpcFacade facade = new DeepSeekRpcFacade(port(new FakeStore(),
                (request, cancellation) -> new AndroidDeepSeekTranslationClient.Response(200,
                        envelope("{\"L0001\":\"第一行\"}"))));

        JSONObject missingStyle = new JSONObject()
                .put("lyric", "[00:01.00]One")
                .put("title", "Title")
                .put("artist", "Artist")
                .put("consent", consent());
        JSONObject missingStyleResult = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE,
                "translate-2", missingStyle);
        assertFalse(missingStyleResult.optBoolean("ok"));
        assertEquals("unknown-field", missingStyleResult.optString("status"));
        assertEquals(0, missingStyleResult.optInt("httpStatus"));
        assertFalse(missingStyleResult.optBoolean("retryable"));

        JSONObject malformedConsent = translatePayload("[00:01.00]One");
        malformedConsent.getJSONObject("consent").put("possibleCost", "yes");
        JSONObject consentResult = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE,
                "translate-3", malformedConsent);
        assertFalse(consentResult.optBoolean("ok"));
        assertEquals("invalid-consent", consentResult.optString("status"));
        assertEquals(0, consentResult.optInt("httpStatus"));
        assertFalse(consentResult.optBoolean("retryable"));
    }

    @Test
    public void failedTranslationNeverProjectsSourceLyricOrRawModelResponse() throws Exception {
        String rawModelResponse = "{\"choices\":[{\"message\":{\"content\":\"bad\"}}]}";
        DeepSeekRpcFacade facade = new DeepSeekRpcFacade(port(new FakeStore(),
                (request, cancellation) -> new AndroidDeepSeekTranslationClient.Response(302,
                        rawModelResponse)));

        JSONObject result = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE,
                "translate-failure", translatePayload("[00:01.00]Source"));

        assertFalse(result.optBoolean("ok"));
        assertEquals("redirect-not-allowed", result.optString("status"));
        assertEquals(302, result.optInt("httpStatus"));
        assertFalse(result.has("tlyric"));
        assertFalse(result.has("lyric"));
        assertFalse(result.toString().contains(rawModelResponse));
        assertFalse(result.toString().contains("Source"));
    }

    @Test
    public void cancelTokenSettlesAnInFlightOperationWithoutLeakingPayload() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<JSONObject> response = new AtomicReference<>();
        JSONObject cancelPayload = translatePayload("[00:01.00]Source");
        DeepSeekRpcFacade facade = new DeepSeekRpcFacade(port(new FakeStore(),
                (request, cancellation) -> {
                    entered.countDown();
                    while (!cancellation.isCancelled()) Thread.sleep(5L);
                    finished.countDown();
                    return AndroidDeepSeekTranslationClient.Response.error("cancelled");
                }));

        Thread worker = new Thread(() -> response.set(facade.dispatch(
                AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE,
                "translate-cancel", cancelPayload)));
        worker.start();
        assertTrue(entered.await(2, TimeUnit.SECONDS));
        JSONObject cancel = facade.cancel("translate-cancel");
        assertTrue(cancel.optBoolean("ok"));
        assertEquals("cancel-requested", cancel.optString("status"));
        assertTrue(finished.await(2, TimeUnit.SECONDS));
        worker.join(2_000L);
        assertNotNull(response.get());
        assertFalse(response.get().optBoolean("ok"));
        assertEquals("cancelled", response.get().optString("status"));
        assertFalse(response.get().has("tlyric"));
        assertFalse(facade.isActive("translate-cancel"));
    }

    @Test
    public void unknownOperationAndUnsafeOperationIdFailClosed() throws Exception {
        DeepSeekRpcFacade facade = new DeepSeekRpcFacade(port(new FakeStore(),
                (request, cancellation) -> new AndroidDeepSeekTranslationClient.Response(200,
                        envelope("{\"ok\":true}"))));
        JSONObject unknown = facade.dispatch("deepseek.translation.unknown", "safe-id",
                new JSONObject());
        assertFalse(unknown.optBoolean("ok"));
        assertEquals("unsupported-operation", unknown.optString("status"));
        JSONObject unsafeId = facade.dispatch(AndroidDeepSeekTranslationPort.OPERATION_STATUS,
                "id with spaces", new JSONObject());
        assertFalse(unsafeId.optBoolean("ok"));
        assertEquals("invalid-request-id", unsafeId.optString("status"));
    }

    private static AndroidDeepSeekTranslationPort port(FakeStore store,
            AndroidDeepSeekTranslationClient.Transport transport) {
        AndroidDeepSeekApiKeySource source = new AndroidDeepSeekApiKeySource() {
            @Override
            <T> T withApiKey(AndroidDeepSeekKeyAction<T> action) throws Exception {
                return action.run("fixture-secret");
            }
        };
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(source, transport);
        return new AndroidDeepSeekTranslationPort(store, client);
    }

    private static JSONObject translatePayload(String lyric) throws Exception {
        return new JSONObject()
                .put("lyric", lyric)
                .put("title", "Title")
                .put("artist", "Artist")
                .put("styleHint", "")
                .put("consent", consent());
    }

    private static JSONObject consent() throws Exception {
        return new JSONObject()
                .put("lyrics", true)
                .put("title", true)
                .put("artist", true)
                .put("possibleCost", true)
                .put("cancellation", true)
                .put("failureImpact", true)
                .put("acceptedAtEpochMs", CONSENT_TIME);
    }

    private static String envelope(String content) throws Exception {
        JSONObject choice = new JSONObject()
                .put("finish_reason", "stop")
                .put("message", new JSONObject().put("content", content));
        return new JSONObject().put("choices", new JSONArray().put(choice)).toString();
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index += 1) result.append(value);
        return result.toString();
    }

    private static final class FakeStore implements AndroidDeepSeekCredentialStore {
        int configureCalls;
        int deleteCalls;
        boolean configured;

        @Override
        public AndroidDeepSeekVault.CredentialStatus status() {
            return new AndroidDeepSeekVault.CredentialStatus(true, configured, null);
        }

        @Override
        public AndroidDeepSeekVault.CredentialStatus configure(String apiKey) {
            configureCalls += 1;
            configured = true;
            return status();
        }

        @Override
        public AndroidDeepSeekVault.CredentialStatus delete() {
            deleteCalls += 1;
            configured = false;
            return status();
        }
    }
}
