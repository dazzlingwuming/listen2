package com.dazzlingwuming.listen2.provider;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.net.URI;

public final class AndroidDeepSeekPolicyTest {
    private static final AndroidDeepSeekPolicy.Consent CONSENT =
            AndroidDeepSeekPolicy.Consent.explicit(1_725_000_000_000L);

    @Test
    public void fixedEndpointAndRequestContainNoCallerTransportControls() throws Exception {
        AndroidDeepSeekPolicy.NormalizedInput input = AndroidDeepSeekPolicy.normalize(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]One\n[00:02.00]Two", "Title", "Artist", CONSENT));
        AndroidDeepSeekPolicy.RequestSpec request =
                AndroidDeepSeekPolicy.buildTranslationRequest(input);

        assertEquals("https://api.deepseek.com/chat/completions", request.endpoint.toString());
        assertTrue(AndroidDeepSeekPolicy.isApprovedEndpoint(request.endpoint));
        assertFalse(AndroidDeepSeekPolicy.isApprovedEndpoint(URI.create(
                "https://evil.example/chat/completions")));
        assertFalse(request.body.contains("callerUrl"));
        assertFalse(request.body.contains("callerHeaders"));
        assertTrue(request.body.contains("L0001"));
        assertTrue(request.body.contains("L0002"));
        assertTrue(request.body.contains("E0001"));
        assertTrue(request.body.contains("Never merge, split, reorder"));
    }

    @Test
    public void consentMustCoverAllDisclosuresBeforeLyricNormalization() {
        AndroidDeepSeekPolicy.Consent incomplete = new AndroidDeepSeekPolicy.Consent(
                true, true, true, false, true, true, 10L);
        try {
            AndroidDeepSeekPolicy.normalize(new AndroidDeepSeekPolicy.Input(
                    "[00:01.00]One", "Title", "Artist", incomplete));
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            assertEquals("consent-required", error.code);
            return;
        }
        throw new AssertionError("incomplete consent must be rejected");
    }

    @Test
    public void inputBoundsRejectOversizedMetadataLinesAndUnboundedSongs() throws Exception {
        assertPolicyCode(new AndroidDeepSeekPolicy.Input(
                "[00:01.00]One", repeat('t', 257), "Artist", CONSENT), "invalid-title");
        assertPolicyCode(new AndroidDeepSeekPolicy.Input(
                "[00:01.00]" + repeat('x', 501), "Title", "Artist", CONSENT),
                "lyric-line-too-long");
        assertPolicyCode(new AndroidDeepSeekPolicy.Input(
                "[00:01.00]One", "Title", "Artist", null), "consent-required");

        StringBuilder manyLines = new StringBuilder();
        for (int index = 0; index < 401; index += 1) {
            if (index > 0) manyLines.append('\n');
            manyLines.append(String.format(java.util.Locale.ROOT, "[%02d:00.00]Line", index % 60));
        }
        assertPolicyCode(new AndroidDeepSeekPolicy.Input(
                manyLines.toString(), "Title", "Artist", CONSENT), "too-many-timed-lines");
    }

    @Test
    public void alignedResponsePreservesSourceTimestampOrder() throws Exception {
        AndroidDeepSeekPolicy.NormalizedInput input = AndroidDeepSeekPolicy.normalize(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]One\n[00:02.00][00:03.00]Two", "Title", "Artist", CONSENT));
        String response = envelope("{\"L0002\":\"二\",\"L0001\":\"一\"}");
        AndroidDeepSeekPolicy.Translation translation =
                AndroidDeepSeekPolicy.parseTranslationResponse(response, input);

        assertEquals("[00:01.00]一\n[00:02.00][00:03.00]二", translation.tlyric);
        assertEquals(2, translation.lineCount);
        assertEquals(AndroidDeepSeekPolicy.PROVIDER, translation.provider);
        assertEquals(AndroidDeepSeekPolicy.TARGET_LANGUAGE, translation.targetLanguage);
        assertEquals(64, translation.promptFingerprint.length());
    }

    @Test
    public void responseRequiresExactUniqueLineIdsAndSingleLineStrings() throws Exception {
        AndroidDeepSeekPolicy.NormalizedInput input = AndroidDeepSeekPolicy.normalize(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]One\n[00:02.00]Two", "Title", "Artist", CONSENT));
        assertResponseCode(envelope("{\"L0001\":\"一\"}"), input, "invalid-alignment");
        assertResponseCode(envelope("{\"L0001\":\"一\",\"L0002\":\"二\",\"extra\":\"三\"}"),
                input, "invalid-alignment");
        assertResponseCode(envelope("{\"L0001\":\"一\",\"L0002\":\"二\\n三\"}"),
                input, "invalid-alignment");
        assertResponseCode(envelope("{\"L0001\":\"一\",\"L0001\":\"重复\",\"L0002\":\"二\"}"),
                input, "invalid-alignment");
    }

    @Test
    public void testResponseIsSmallFixedJsonOnly() throws Exception {
        AndroidDeepSeekPolicy.validateTestResponse(envelope("{\"ok\":true}"));
        try {
            AndroidDeepSeekPolicy.validateTestResponse(envelope("{\"ok\":true,\"leak\":\"x\"}"));
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            assertEquals("invalid-response", error.code);
            return;
        }
        throw new AssertionError("test response extra keys must be rejected");
    }

    @Test
    public void responseByteBoundIsAppliedBeforeJsonParsing() throws Exception {
        AndroidDeepSeekPolicy.NormalizedInput input = AndroidDeepSeekPolicy.normalize(
                new AndroidDeepSeekPolicy.Input(
                        "[00:01.00]One", "Title", "Artist", CONSENT));
        try {
            AndroidDeepSeekPolicy.parseTranslationResponse(
                    repeat('x', AndroidDeepSeekPolicy.MAX_RESPONSE_BYTES + 1), input);
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            assertEquals("response-too-large", error.code);
            return;
        }
        throw new AssertionError("oversized response must be rejected");
    }

    private static void assertPolicyCode(AndroidDeepSeekPolicy.Input input, String expected)
            throws Exception {
        try {
            AndroidDeepSeekPolicy.normalize(input);
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            assertEquals(expected, error.code);
            return;
        }
        throw new AssertionError("expected policy error " + expected);
    }

    private static void assertResponseCode(String response,
            AndroidDeepSeekPolicy.NormalizedInput input, String expected) throws Exception {
        try {
            AndroidDeepSeekPolicy.parseTranslationResponse(response, input);
        } catch (AndroidDeepSeekPolicy.PolicyException error) {
            assertEquals(expected, error.code);
            return;
        }
        throw new AssertionError("expected response error " + expected);
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
}
