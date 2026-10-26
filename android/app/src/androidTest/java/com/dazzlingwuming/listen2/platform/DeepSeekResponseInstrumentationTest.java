package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertTrue;

import androidx.test.platform.app.InstrumentationRegistry;
import com.dazzlingwuming.listen2.provider.AndroidDeepSeekPolicy;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Real Android JSON coverage; the small network probe is explicitly opt-in. */
public final class DeepSeekResponseInstrumentationTest {
    @Test public void deviceJsonParsesConnectionAndTranslationFixtures() throws Exception {
        AndroidDeepSeekPolicy.validateTestResponse(envelope("{\"ok\":true}"));
        AndroidDeepSeekPolicy.NormalizedInput input = AndroidDeepSeekPolicy.normalize(
                new AndroidDeepSeekPolicy.Input("[00:01.00]Hello", "Test", "Test",
                        AndroidDeepSeekPolicy.Consent.explicit(1)));
        assertTrue(AndroidDeepSeekPolicy.parseTranslationResponse(
                envelope("{\"L0001\":\"你好\"}"), input).lineCount == 1);
    }

    @Test public void fixedConnectionProbeWithSavedKey() throws Exception {
        Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments()
                .getString("deepSeekNetworkTest")));
        AndroidDeepSeekVault vault = new AndroidDeepSeekVault(
                InstrumentationRegistry.getInstrumentation().getTargetContext());
        assertTrue("A saved key is required", vault.status().hasApiKey);
        JSONObject diagnostics = new JSONObject();
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(vault,
                (request, cancellation) -> {
                    HttpsURLConnection connection = (HttpsURLConnection) request.endpoint().toURL().openConnection();
                    connection.setRequestMethod("POST");
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(15000);
                    connection.setDoOutput(true);
                    for (java.util.Map.Entry<String, String> header : request.fixedHeaders().entrySet())
                        connection.setRequestProperty(header.getKey(), header.getValue());
                    connection.setRequestProperty("Authorization", request.authorizationHeader());
                    try {
                        try (OutputStream output = connection.getOutputStream()) {
                            output.write(request.body().getBytes(StandardCharsets.UTF_8));
                        }
                        int status = connection.getResponseCode();
                        diagnostics.put("httpStatus", status);
                        if (status != 200) return new AndroidDeepSeekTranslationClient.Response(status, "");
                        String body;
                        try (InputStream input = connection.getInputStream()) {
                            body = new String(input.readNBytes(AndroidDeepSeekPolicy.MAX_RESPONSE_BYTES + 1),
                                    StandardCharsets.UTF_8);
                        }
                        // Record only shape and booleans, never headers, credentials or raw content.
                        JSONObject choice = new JSONObject(body).getJSONArray("choices").getJSONObject(0);
                        String content = choice.getJSONObject("message").getString("content");
                        diagnostics.put("stopped", "stop".equals(choice.optString("finish_reason")));
                        diagnostics.put("contentLength", content.length());
                        diagnostics.put("firstCharacter", content.isEmpty() ? -1 : (int) content.charAt(0));
                        try {
                            JSONObject value = new JSONObject(content);
                            diagnostics.put("validJsonObject", true);
                            diagnostics.put("keyCount", value.length());
                            diagnostics.put("okBooleanTrue", Boolean.TRUE.equals(value.opt("ok")));
                        } catch (Exception ignored) {
                            diagnostics.put("validJsonObject", false);
                        }
                        return new AndroidDeepSeekTranslationClient.Response(status, body);
                    } finally { connection.disconnect(); }
                });
        AndroidDeepSeekTranslationClient.TestOutcome outcome = client.test(null);
        diagnostics.put("status", outcome.status);
        assertTrue(diagnostics.toString(), outcome.ok);
    }

    @Test public void translatesTwoAuthoredFixtureLinesWithSavedKey() {
        Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments()
                .getString("deepSeekNetworkTest")));
        AndroidDeepSeekVault vault = new AndroidDeepSeekVault(
                InstrumentationRegistry.getInstrumentation().getTargetContext());
        AndroidDeepSeekTranslationClient.TranslationOutcome outcome =
                new AndroidDeepSeekTranslationClient(vault).translate(
                        new AndroidDeepSeekPolicy.Input(
                                "[00:01.00]Hello, morning sun.\n[00:02.00]Thank you for this new day.",
                                "Connection test", "Listen2 test fixture",
                                AndroidDeepSeekPolicy.Consent.explicit(System.currentTimeMillis())), null);
        assertTrue("status=" + outcome.status + ", httpStatus=" + outcome.httpStatus, outcome.ok);
        assertTrue("Both timed lines must be translated", outcome.translation.lineCount == 2);
        assertTrue(outcome.translation.tlyric.startsWith("[00:01.00]"));
        assertTrue(outcome.translation.tlyric.contains("\n[00:02.00]"));
    }

    private static String envelope(String content) throws Exception {
        return new JSONObject().put("choices", new JSONArray().put(new JSONObject()
                .put("finish_reason", "stop")
                .put("message", new JSONObject().put("content", content)))).toString();
    }
}
