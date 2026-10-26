package com.dazzlingwuming.listen2.platform;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Gist credentials never enter localStorage, playlist backups or bridge replies. */
final class AndroidGitHubTokenVault {
    private static final String ALIAS = "listen2.github.token.v1";
    private final SharedPreferences preferences;

    AndroidGitHubTokenVault(Context context) {
        this(context.getSharedPreferences("listen2.github.secure.v1", Context.MODE_PRIVATE));
    }
    AndroidGitHubTokenVault(SharedPreferences preferences) { this.preferences = preferences; }
    boolean configured() { return preferences.contains("token"); }
    void save(String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!preferences.edit().putString("token", value).commit()) throw new Exception("STORAGE_ERROR");
    }
    String read() throws Exception {
        String value = preferences.getString("token", "");
        String[] parts = value.split(":", -1);
        if (parts.length != 2) throw new Exception("TOKEN_REQUIRED");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    void clear() throws Exception {
        if (!preferences.edit().remove("token").commit()) throw new Exception("STORAGE_ERROR");
    }
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
}
