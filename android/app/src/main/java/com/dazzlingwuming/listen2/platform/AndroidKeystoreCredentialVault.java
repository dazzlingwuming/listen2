package com.dazzlingwuming.listen2.platform;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;

import com.dazzlingwuming.listen2.provider.BilibiliAccountSession;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores refresh material only as Android-Keystore-encrypted ciphertext. The
 * vault deliberately has no material read API: bridge and page code cannot
 * retrieve it. The boolean presence check is used only to restore account
 * state after process recreation.
 */
public final class AndroidKeystoreCredentialVault implements BilibiliAccountSession.CredentialVault {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "listen2.bilibili.refresh.v1";
    private static final String PREFERENCES = "listen2.secure.credentials";
    private static final String VALUE_KEY = "bilibili.refresh.v1";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_BYTES = 12;
    private static final int MAX_REFRESH_BYTES = 8 * 1024;

    private final SharedPreferences preferences;
    private final SecureRandom random = new SecureRandom();

    public AndroidKeystoreCredentialVault(@NonNull Context context) {
        Context applicationContext = context.getApplicationContext();
        preferences = applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    @Override
    public boolean isAvailable() {
        try {
            getOrCreateKey();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @Override
    public void save(String refreshMaterial) throws Exception {
        if (refreshMaterial == null || refreshMaterial.isEmpty()
                || refreshMaterial.getBytes(StandardCharsets.UTF_8).length > MAX_REFRESH_BYTES) {
            throw new IllegalArgumentException("Invalid credential material");
        }
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] encrypted = cipher.doFinal(refreshMaterial.getBytes(StandardCharsets.UTF_8));
        String stored = "v1:" + Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!preferences.edit().putString(VALUE_KEY, stored).commit()) {
            throw new IllegalStateException("Credential persistence unavailable");
        }
    }

    @Override
    public void clear() throws Exception {
        if (!preferences.edit().remove(VALUE_KEY).commit()) {
            throw new IllegalStateException("Credential removal unavailable");
        }
    }

    @Override
    public boolean hasStoredCredential() {
        String stored = preferences.getString(VALUE_KEY, null);
        return stored != null && stored.startsWith("v1:") && stored.length() <= 16 * 1024;
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
