package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;

public final class AndroidDeepSeekVaultContractTest {
    @Test
    public void keyNormalizationIsBoundedAndRejectsHeaderBreakingCharacters() {
        assertEquals("fixture-key", AndroidDeepSeekVault.normalizeApiKey("  fixture-key  "));
        assertNull(AndroidDeepSeekVault.normalizeApiKey(null));
        assertNull(AndroidDeepSeekVault.normalizeApiKey(""));
        assertNull(AndroidDeepSeekVault.normalizeApiKey("key\nwith-newline"));
        assertNull(AndroidDeepSeekVault.normalizeApiKey(repeat('k',
                AndroidDeepSeekVault.MAX_API_KEY_BYTES + 1)));
        assertTrue(AndroidDeepSeekVault.normalizeApiKey("密钥")
                .getBytes(StandardCharsets.UTF_8).length <= AndroidDeepSeekVault.MAX_API_KEY_BYTES);
    }

    @Test
    public void vaultUsesDedicatedKeystoreAesGcmNamespaceWithoutPublicReadMethod() {
        assertEquals("AndroidKeyStore", AndroidDeepSeekVault.KEYSTORE);
        assertEquals("listen2.deepseek.api-key.v1", AndroidDeepSeekVault.KEY_ALIAS);
        assertEquals(128, AndroidDeepSeekVault.GCM_TAG_BITS);
        assertEquals(12, AndroidDeepSeekVault.IV_BYTES);

        boolean foundStatus = false;
        boolean foundConfigure = false;
        boolean foundDelete = false;
        for (Method method : AndroidDeepSeekVault.class.getMethods()) {
            if ("status".equals(method.getName())) foundStatus = true;
            if ("configure".equals(method.getName())) foundConfigure = true;
            if ("delete".equals(method.getName())) foundDelete = true;
            assertFalse("the public vault surface must not expose a key getter",
                    method.getName().toLowerCase().contains("apikey"));
        }
        assertTrue(foundStatus);
        assertTrue(foundConfigure);
        assertTrue(foundDelete);

        for (Method method : AndroidDeepSeekVault.class.getDeclaredMethods()) {
            if ("withApiKey".equals(method.getName())) {
                assertFalse(Modifier.isPublic(method.getModifiers()));
            }
        }
        assertNotNull(AndroidDeepSeekVault.CredentialStatus.class);
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index += 1) result.append(value);
        return result.toString();
    }
}
