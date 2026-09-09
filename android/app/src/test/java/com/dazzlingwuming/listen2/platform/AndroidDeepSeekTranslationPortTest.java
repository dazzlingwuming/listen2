package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.dazzlingwuming.listen2.provider.AndroidDeepSeekPolicy;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class AndroidDeepSeekTranslationPortTest {
    @Test
    public void internalCredentialOperationsReturnOnlySafeStatusProjections() throws Exception {
        FakeStore store = new FakeStore();
        AndroidDeepSeekTranslationClient client = new AndroidDeepSeekTranslationClient(
                new AndroidDeepSeekApiKeySource() {
                    @Override
                    <T> T withApiKey(AndroidDeepSeekKeyAction<T> action) throws Exception {
                        return action.run("fixture-key");
                    }
                }, (request, cancellation) -> new AndroidDeepSeekTranslationClient.Response(
                        200, envelope("{\"ok\":true}")));
        AndroidDeepSeekTranslationPort port = new AndroidDeepSeekTranslationPort(store, client);

        assertFalse(port.status().hasApiKey);
        assertTrue(port.configure("ignored").hasApiKey);
        assertTrue(port.test(null).ok);
        assertFalse(port.delete().hasApiKey);
        assertEquals(1, store.configureCalls);
        assertEquals(1, store.deleteCalls);
    }

    @Test
    public void operationNamesAreStableForMainlineRpcDispatch() {
        assertEquals("deepseek.translation.status", AndroidDeepSeekTranslationPort.OPERATION_STATUS);
        assertEquals("deepseek.translation.configure", AndroidDeepSeekTranslationPort.OPERATION_CONFIGURE);
        assertEquals("deepseek.translation.test", AndroidDeepSeekTranslationPort.OPERATION_TEST);
        assertEquals("deepseek.translation.delete", AndroidDeepSeekTranslationPort.OPERATION_DELETE);
        assertEquals("deepseek.translation.translate", AndroidDeepSeekTranslationPort.OPERATION_TRANSLATE);
    }

    private static String envelope(String content) throws Exception {
        JSONObject choice = new JSONObject()
                .put("finish_reason", "stop")
                .put("message", new JSONObject().put("content", content));
        return new JSONObject().put("choices", new JSONArray().put(choice)).toString();
    }

    private static final class FakeStore implements AndroidDeepSeekCredentialStore {
        private boolean configured;
        int configureCalls;
        int deleteCalls;

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
