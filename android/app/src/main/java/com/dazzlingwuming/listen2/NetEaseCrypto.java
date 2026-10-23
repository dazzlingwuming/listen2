package com.dazzlingwuming.listen2;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The small, provider-owned crypto surface required by NetEase's legacy
 * WeAPI/EAPI routes.  The page never sees any of these values.  The overloads
 * accepting a secret key are intentionally deterministic so the route contract
 * can be checked with JVM fixtures; production callers use the random overload.
 */
final class NetEaseCrypto {
    static final String WEAPI_NONCE = "0CoJUm6Qyw8W8jud";
    static final String WEAPI_PUBLIC_EXPONENT = "010001";
    static final String WEAPI_MODULUS =
            "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b72"
                    + "5152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbd"
                    + "a92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe48"
                    + "75d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
    static final String EAPI_KEY = "e82ckenh8dichen8";
    private static final String SECRET_ALPHABET = "012345679abcdef";
    private static final byte[] WEAPI_IV = "0102030405060708".getBytes(StandardCharsets.UTF_8);
    private static final byte[] EMPTY_IV = new byte[16];

    private NetEaseCrypto() {}

    static WeapiPayload encryptWeapi(String json, String secretKey) {
        if (json == null || secretKey == null || secretKey.length() != 16) {
            throw new IllegalArgumentException("weapi input");
        }
        byte[] first = aes("AES/CBC/PKCS5Padding", json.getBytes(StandardCharsets.UTF_8),
                WEAPI_NONCE.getBytes(StandardCharsets.UTF_8), WEAPI_IV);
        String firstBase64 = Base64.getEncoder().encodeToString(first);
        byte[] second = aes("AES/CBC/PKCS5Padding", firstBase64.getBytes(StandardCharsets.UTF_8),
                secretKey.getBytes(StandardCharsets.UTF_8), WEAPI_IV);
        String params = Base64.getEncoder().encodeToString(second);
        String encSecKey = rsaEncrypt(secretKey);
        return new WeapiPayload(params, encSecKey);
    }

    static WeapiPayload encryptWeapi(org.json.JSONObject object, String secretKey) {
        if (object == null) throw new IllegalArgumentException("weapi object");
        return encryptWeapi(object.toString(), secretKey);
    }

    static WeapiPayload encryptWeapi(org.json.JSONObject object) {
        return encryptWeapi(object, createSecretKey(new SecureRandom()));
    }

    static String encryptEapi(String urlPath, String json) {
        if (urlPath == null || json == null || urlPath.isEmpty()) {
            throw new IllegalArgumentException("eapi input");
        }
        String message = "nobody" + urlPath + "use" + json + "md5forencrypt";
        String digest = md5Hex(message);
        String plain = urlPath + "-36cd479b6b5-" + json + "-36cd479b6b5-" + digest;
        byte[] encrypted = aes("AES/ECB/PKCS5Padding", plain.getBytes(StandardCharsets.UTF_8),
                EAPI_KEY.getBytes(StandardCharsets.UTF_8), EMPTY_IV);
        return hex(encrypted).toUpperCase(java.util.Locale.ROOT);
    }

    static String encryptEapi(String urlPath, org.json.JSONObject object) {
        if (object == null) throw new IllegalArgumentException("eapi object");
        return encryptEapi(urlPath, object.toString());
    }

    static String createSecretKey(SecureRandom random) {
        if (random == null) throw new IllegalArgumentException("random required");
        StringBuilder result = new StringBuilder(16);
        for (int index = 0; index < 16; index += 1) {
            result.append(SECRET_ALPHABET.charAt(random.nextInt(SECRET_ALPHABET.length())));
        }
        return result.toString();
    }

    private static byte[] aes(String transformation, byte[] plain, byte[] key, byte[] iv) {
        try {
            Cipher cipher = Cipher.getInstance(transformation);
            SecretKeySpec keySpec = new SecretKeySpec(key, "AES");
            if (transformation.contains("ECB")) {
                cipher.init(Cipher.ENCRYPT_MODE, keySpec);
            } else {
                cipher.init(Cipher.ENCRYPT_MODE, keySpec, new IvParameterSpec(iv));
            }
            return cipher.doFinal(plain);
        } catch (Exception error) {
            throw new IllegalStateException("NetEase AES unavailable", error);
        }
    }

    private static String rsaEncrypt(String secretKey) {
        byte[] reversed = new StringBuilder(secretKey).reverse().toString()
                .getBytes(StandardCharsets.UTF_8);
        BigInteger value = new BigInteger(1, reversed);
        BigInteger exponent = new BigInteger(WEAPI_PUBLIC_EXPONENT, 16);
        BigInteger modulus = new BigInteger(WEAPI_MODULUS, 16);
        String hex = value.modPow(exponent, modulus).toString(16);
        StringBuilder padded = new StringBuilder(256);
        for (int index = hex.length(); index < 256; index += 1) padded.append('0');
        padded.append(hex);
        return padded.toString();
    }

    private static String md5Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("MD5");
            return hex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("MD5 unavailable", impossible);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }

    static final class WeapiPayload {
        final String params;
        final String encSecKey;

        WeapiPayload(String params, String encSecKey) {
            this.params = params;
            this.encSecKey = encSecKey;
        }
    }
}
