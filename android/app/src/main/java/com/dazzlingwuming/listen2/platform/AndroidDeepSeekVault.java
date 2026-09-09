package com.dazzlingwuming.listen2.platform;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Native-only storage for the DeepSeek API key.
 *
 * <p>The encrypted value is kept in private preferences and the key-encryption
 * key lives in Android Keystore. There is intentionally no public getter. The
 * package-private key-use seam is consumed by the translation client in this
 * package and cannot be used by page/backup DTO code without moving into this
 * trusted native package.</p>
 */
public final class AndroidDeepSeekVault extends AndroidDeepSeekApiKeySource
        implements AndroidDeepSeekCredentialStore {
    static final String KEYSTORE = "AndroidKeyStore";
    static final String KEY_ALIAS = "listen2.deepseek.api-key.v1";
    static final String PREFERENCES = "listen2.deepseek.secure.v1";
    static final String VALUE_KEY = "api-key.v1";
    static final int GCM_TAG_BITS = 128;
    static final int IV_BYTES = 12;
    static final int MAX_API_KEY_BYTES = 512;

    private final SharedPreferences preferences;
    private final SecureRandom random = new SecureRandom();

    public AndroidDeepSeekVault(@NonNull Context context) {
        Context applicationContext = context.getApplicationContext();
        preferences = applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    /** A page-safe projection; neither ciphertext nor plaintext is included. */
    public CredentialStatus status() {
        try {
            boolean available = getOrCreateKey() != null;
            boolean configured = available && preferences.contains(VALUE_KEY);
            return new CredentialStatus(available, configured, null);
        } catch (Exception ignored) {
            return new CredentialStatus(false, false, "secure-storage-unavailable");
        }
    }

    /** Stores a normalized key and returns only safe availability metadata. */
    public CredentialStatus configure(String apiKey) {
        String normalized = normalizeApiKey(apiKey);
        if (normalized == null) {
            CredentialStatus current = status();
            return new CredentialStatus(current.secureStorageAvailable, current.hasApiKey,
                    "invalid-api-key");
        }
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] encrypted = cipher.doFinal(normalized.getBytes(StandardCharsets.UTF_8));
            String stored = "v1:" + Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                    + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            if (!preferences.edit().putString(VALUE_KEY, stored).commit()) {
                return new CredentialStatus(true, false, "secure-storage-unavailable");
            }
            return new CredentialStatus(true, true, null);
        } catch (Exception ignored) {
            return new CredentialStatus(false, false, "secure-storage-unavailable");
        } finally {
            // Do not retain a mutable key buffer beyond the encryption call.
            normalized = null;
        }
    }

    /** Removes ciphertext; the page receives no key material or storage detail. */
    public CredentialStatus delete() {
        try {
            if (!preferences.edit().remove(VALUE_KEY).commit()) {
                return new CredentialStatus(true, true, "secure-storage-unavailable");
            }
            return new CredentialStatus(true, false, null);
        } catch (Exception ignored) {
            return new CredentialStatus(false, false, "secure-storage-unavailable");
        }
    }

    boolean isStorageAvailable() {
        try {
            return getOrCreateKey() != null;
        } catch (Exception ignored) {
            return false;
        }
    }

    /**
     * The only read path. It is package-private so only the native translation
     * implementation can consume plaintext, and the callback result must not
     * be serialized into any page-safe DTO.
     */
    @Override
    <T> T withApiKey(AndroidDeepSeekKeyAction<T> action) throws Exception {
        if (action == null) throw new IllegalArgumentException("Missing key action");
        String stored = preferences.getString(VALUE_KEY, null);
        if (stored == null || stored.isEmpty()) throw new AndroidDeepSeekVaultException("missing-api-key");
        String apiKey = decrypt(stored);
        try {
            return action.run(apiKey);
        } finally {
            apiKey = null;
        }
    }

    private String decrypt(String stored) throws Exception {
        String[] parts = stored.split(":", -1);
        if (parts.length != 3 || !"v1".equals(parts[0])) {
            throw new AndroidDeepSeekVaultException("secure-storage-corrupt");
        }
        byte[] iv;
        byte[] encrypted;
        try {
            iv = Base64.decode(parts[1], Base64.DEFAULT);
            encrypted = Base64.decode(parts[2], Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new AndroidDeepSeekVaultException("secure-storage-corrupt");
        }
        if (iv.length != IV_BYTES || encrypted.length < 16
                || encrypted.length > MAX_API_KEY_BYTES + 16) {
            throw new AndroidDeepSeekVaultException("secure-storage-corrupt");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        String apiKey = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        if (normalizeApiKey(apiKey) == null) throw new AndroidDeepSeekVaultException("secure-storage-corrupt");
        return apiKey.trim();
    }

    static String normalizeApiKey(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        if (normalized.isEmpty() || normalized.getBytes(StandardCharsets.UTF_8).length > MAX_API_KEY_BYTES) {
            return null;
        }
        for (int index = 0; index < normalized.length(); index += 1) {
            char character = normalized.charAt(index);
            if (character < 0x20 || character == 0x7f) return null;
        }
        return normalized;
    }

    private static synchronized SecretKey getOrCreateKey() throws Exception {
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

    public static final class CredentialStatus {
        public final boolean secureStorageAvailable;
        public final boolean hasApiKey;
        public final String errorCode;

        CredentialStatus(boolean secureStorageAvailable, boolean hasApiKey, String errorCode) {
            this.secureStorageAvailable = secureStorageAvailable;
            this.hasApiKey = hasApiKey;
            this.errorCode = errorCode;
        }
    }

    public static final class AndroidDeepSeekVaultException extends Exception {
        public final String code;

        AndroidDeepSeekVaultException(String code) {
            super(code);
            this.code = code;
        }
    }
}

/** Package-private by design: only trusted native classes may consume plaintext. */
abstract class AndroidDeepSeekApiKeySource {
    abstract <T> T withApiKey(AndroidDeepSeekKeyAction<T> action) throws Exception;
}

interface AndroidDeepSeekKeyAction<T> {
    T run(String apiKey) throws Exception;
}

/** Package-private safe credential projection used by the internal operation port. */
interface AndroidDeepSeekCredentialStore {
    AndroidDeepSeekVault.CredentialStatus status();

    AndroidDeepSeekVault.CredentialStatus configure(String apiKey);

    AndroidDeepSeekVault.CredentialStatus delete();
}
