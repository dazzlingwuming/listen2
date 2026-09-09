package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.provider.AndroidDeepSeekPolicy;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public final class AndroidDeepSeekTranslationClientTest {
    private static final AndroidDeepSeekPolicy.Consent CONSENT =
            AndroidDeepSeekPolicy.Consent.explicit(1_725_000_000_000L);

    @Test
    public void successfulFixtureUsesOnlyFixedRouteAndNativeAuthorization() throws Exception {
        List<AndroidDeepSeekTranslationClient.Request> requests = new ArrayList<>();
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(
                new FixtureKeySource("fixture-key"), (request, cancellation) -> {
                    requests.add(request);
                    return new AndroidDeepSeekTranslationClient.Response(200,
                            envelope("{\"L0001\":\"第一行\",\"L0002\":\"第二行\"}"));
                });

        AndroidDeepSeekTranslationClient.TranslationOutcome outcome = client.translate(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]One\n[00:02.00]Two", "Title", "Artist", CONSENT), null);

        assertTrue(outcome.ok);
        assertNotNull(outcome.translation);
        assertEquals("[00:01.00]第一行\n[00:02.00]第二行", outcome.translation.tlyric);
        assertEquals(1, requests.size());
        AndroidDeepSeekTranslationClient.Request request = requests.get(0);
        assertEquals("https://api.deepseek.com/chat/completions", request.endpoint().toString());
        assertEquals("POST", request.method());
        assertEquals("Bearer fixture-key", request.authorizationHeader());
        assertFalse(request.fixedHeaders().containsKey("X-Caller-Url"));
        assertFalse(request.fixedHeaders().containsKey("Cookie"));
        assertFalse(request.body().contains("fixture-key"));
    }

    @Test
    public void missingConsentStopsBeforeVaultOrTransportAndKeepsOriginalLyric() {
        CountingKeySource source = new CountingKeySource("fixture-key");
        CountingTransport transport = new CountingTransport(
                new AndroidDeepSeekTranslationClient.Response(200, "{}"));
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(source, transport);
        String original = "[00:01.00]Original";

        AndroidDeepSeekTranslationClient.TranslationOutcome outcome = client.translate(
                new AndroidDeepSeekPolicy.Input(original, "Title", "Artist", null), null);

        assertFalse(outcome.ok);
        assertEquals("consent-required", outcome.status);
        assertEquals(0, source.calls);
        assertEquals(0, transport.calls);
        assertEquals(null, outcome.translation);
        assertEquals("[00:01.00]Original", original);
    }

    @Test
    public void cancellationStopsBeforeNetworkAndDoesNotProduceFallbackTranslation() {
        CountingTransport transport = new CountingTransport(
                new AndroidDeepSeekTranslationClient.Response(200, "{}"));
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(
                new FixtureKeySource("fixture-key"), transport);
        AndroidDeepSeekTranslationClient.CancellationToken cancellation =
                new AndroidDeepSeekTranslationClient.CancellationToken();
        cancellation.cancel();

        AndroidDeepSeekTranslationClient.TranslationOutcome outcome = client.translate(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]Original", "Title", "Artist", CONSENT), cancellation);

        assertFalse(outcome.ok);
        assertEquals("cancelled", outcome.status);
        assertEquals(0, transport.calls);
        assertEquals(null, outcome.translation);
    }

    @Test
    public void redirectsAndTransportFailuresAreExplicitAndDoNotBecomeEmptySuccess() {
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(
                new FixtureKeySource("fixture-key"),
                (request, cancellation) -> new AndroidDeepSeekTranslationClient.Response(302, ""));

        AndroidDeepSeekTranslationClient.TranslationOutcome outcome = client.translate(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]Original", "Title", "Artist", CONSENT), null);

        assertFalse(outcome.ok);
        assertEquals("redirect-not-allowed", outcome.status);
        assertEquals(302, outcome.httpStatus);
        assertEquals(null, outcome.translation);
    }

    @Test
    public void explicitTestUsesFixedFixtureAndNeverReturnsTheKey() throws Exception {
        List<AndroidDeepSeekTranslationClient.Request> requests = new ArrayList<>();
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(
                new FixtureKeySource("fixture-key"), (request, cancellation) -> {
                    requests.add(request);
                    return new AndroidDeepSeekTranslationClient.Response(200,
                            envelope("{\"ok\":true}"));
                });

        AndroidDeepSeekTranslationClient.TestOutcome outcome = client.test(null);

        assertTrue(outcome.ok);
        assertEquals(1, requests.size());
        assertTrue(requests.get(0).body().contains("Return only this JSON object"));
        assertFalse(requests.get(0).body().contains("fixture-key"));
        assertFalse(requests.get(0).fixedHeaders().containsKey("Authorization"));
    }

    @Test
    public void vaultReadFailureIsStableAndSecretNeverBecomesAnErrorMessage() {
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(
                new MissingKeySource(), (request, cancellation) -> {
                    throw new AssertionError("network must not run without a key");
                });

        AndroidDeepSeekTranslationClient.TranslationOutcome outcome = client.translate(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]Original", "Title", "Artist", CONSENT), null);

        assertFalse(outcome.ok);
        assertEquals("missing-api-key", outcome.status);
    }

    @Test
    public void oversizedAndMalformedModelResultsAreRejected() {
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(
                new FixtureKeySource("fixture-key"), (request, cancellation) ->
                        new AndroidDeepSeekTranslationClient.Response(200,
                                envelope("{\"L0001\":\"only one\"}")));

        AndroidDeepSeekTranslationClient.TranslationOutcome outcome = client.translate(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]One\n[00:02.00]Two", "Title", "Artist", CONSENT), null);

        assertFalse(outcome.ok);
        assertEquals("invalid-alignment", outcome.status);
        assertEquals(null, outcome.translation);
    }

    private static String envelope(String content) throws Exception {
        JSONObject choice = new JSONObject()
                .put("finish_reason", "stop")
                .put("message", new JSONObject().put("content", content));
        return new JSONObject().put("choices", new JSONArray().put(choice)).toString();
    }

    private static class FixtureKeySource extends AndroidDeepSeekApiKeySource {
        private final String key;

        FixtureKeySource(String key) {
            this.key = key;
        }

        @Override
        <T> T withApiKey(AndroidDeepSeekKeyAction<T> action) throws Exception {
            return action.run(key);
        }
    }

    private static final class CountingKeySource extends FixtureKeySource {
        int calls;

        CountingKeySource(String key) {
            super(key);
        }

        @Override
        <T> T withApiKey(AndroidDeepSeekKeyAction<T> action) throws Exception {
            calls += 1;
            return super.withApiKey(action);
        }
    }

    private static final class MissingKeySource extends AndroidDeepSeekApiKeySource {
        @Override
        <T> T withApiKey(AndroidDeepSeekKeyAction<T> action) throws Exception {
            throw new AndroidDeepSeekVault.AndroidDeepSeekVaultException("missing-api-key");
        }
    }

    private static final class CountingTransport implements AndroidDeepSeekTranslationClient.Transport {
        private final AndroidDeepSeekTranslationClient.Response response;
        int calls;

        CountingTransport(AndroidDeepSeekTranslationClient.Response response) {
            this.response = response;
        }

        @Override
        public AndroidDeepSeekTranslationClient.Response execute(
                AndroidDeepSeekTranslationClient.Request request,
                AndroidDeepSeekTranslationClient.CancellationToken cancellation) {
            calls += 1;
            return response;
        }
    }
}
