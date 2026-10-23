package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import java.util.UUID;

/** Exercises the real Android Keystore without touching the user's saved credential. */
public final class DeepSeekVaultInstrumentationTest {
    @Test public void githubTokenIsEncryptedAndReopens() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "listen2.github.test." + UUID.randomUUID();
        SharedPreferences preferences = context.getSharedPreferences(name, Context.MODE_PRIVATE);
        String fixture = "github_pat_fixture_token_only";
        try {
            AndroidGitHubTokenVault vault = new AndroidGitHubTokenVault(preferences);
            vault.save(fixture);
            assertTrue(vault.configured());
            String encrypted = preferences.getString("token", "");
            assertFalse(encrypted.contains(fixture));
            assertEquals(fixture, new AndroidGitHubTokenVault(preferences).read());
            vault.save(fixture);
            assertNotEquals(encrypted, preferences.getString("token", ""));
            vault.clear(); assertFalse(vault.configured());
        } finally { context.deleteSharedPreferences(name); }
    }
    @Test public void accountCredentialUsesKeystoreGeneratedIv() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "listen2.account.test." + UUID.randomUUID();
        try {
            AndroidKeystoreCredentialVault vault = new AndroidKeystoreCredentialVault(
                    context.getSharedPreferences(name, Context.MODE_PRIVATE));
            vault.save("fixture-refresh-material");
            assertTrue(vault.hasStoredCredential());
            vault.clear();
            assertFalse(vault.hasStoredCredential());
        } finally { context.deleteSharedPreferences(name); }
    }

    @Test public void encryptsWithKeystoreGeneratedIvAndReopensSavedKey() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = AndroidDeepSeekVault.PREFERENCES + ".test." + UUID.randomUUID();
        SharedPreferences preferences = context.getSharedPreferences(name, Context.MODE_PRIVATE);
        String fixture = "sk-storage-test-only-not-a-real-api-key";
        try {
            AndroidDeepSeekVault vault = new AndroidDeepSeekVault(preferences);
            assertTrue(vault.status().secureStorageAvailable);
            assertFalse(vault.status().hasApiKey);
            AndroidDeepSeekVault.CredentialStatus saved = vault.configure(fixture);
            assertTrue("saving with Android Keystore must succeed", saved.secureStorageAvailable);
            assertTrue(saved.hasApiKey);
            assertNull(saved.errorCode);
            String firstCiphertext = preferences.getString(AndroidDeepSeekVault.VALUE_KEY, "");
            assertFalse(firstCiphertext.contains(fixture));

            AndroidDeepSeekVault reopened = new AndroidDeepSeekVault(preferences);
            assertTrue(reopened.status().hasApiKey);
            assertTrue(reopened.withApiKey(fixture::equals));
            assertTrue(reopened.configure(fixture).hasApiKey);
            assertNotEquals("each save must use a fresh IV", firstCiphertext,
                    preferences.getString(AndroidDeepSeekVault.VALUE_KEY, ""));
            assertTrue(reopened.withApiKey(fixture::equals));
            assertFalse(reopened.delete().hasApiKey);
            assertFalse(new AndroidDeepSeekVault(preferences).status().hasApiKey);
        } finally {
            context.deleteSharedPreferences(name);
        }
    }
}
