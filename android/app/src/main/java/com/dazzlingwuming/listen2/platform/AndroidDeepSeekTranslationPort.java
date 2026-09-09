package com.dazzlingwuming.listen2.platform;

import android.content.Context;

import com.dazzlingwuming.listen2.provider.AndroidDeepSeekPolicy;

/**
 * Small native-facing port for the future named RPC operations. It exposes
 * safe status/result DTOs only; the API key is accepted once by configure and
 * is never returned by any method.
 */
public final class AndroidDeepSeekTranslationPort {
    public static final String OPERATION_STATUS = "deepseek.translation.status";
    public static final String OPERATION_CONFIGURE = "deepseek.translation.configure";
    public static final String OPERATION_TEST = "deepseek.translation.test";
    public static final String OPERATION_DELETE = "deepseek.translation.delete";
    public static final String OPERATION_TRANSLATE = "deepseek.translation.translate";

    private final AndroidDeepSeekCredentialStore vault;
    private final AndroidDeepSeekTranslationClient client;

    public AndroidDeepSeekTranslationPort(Context context) {
        this(new AndroidDeepSeekVault(context));
    }

    public AndroidDeepSeekTranslationPort(AndroidDeepSeekVault vault) {
        this(vault, new AndroidDeepSeekTranslationClient(vault));
    }

    AndroidDeepSeekTranslationPort(AndroidDeepSeekVault vault,
            AndroidDeepSeekTranslationClient client) {
        this.vault = vault;
        this.client = client;
    }

    AndroidDeepSeekTranslationPort(AndroidDeepSeekCredentialStore vault,
            AndroidDeepSeekTranslationClient client) {
        this.vault = vault;
        this.client = client;
    }

    public AndroidDeepSeekVault.CredentialStatus status() {
        return vault.status();
    }

    public AndroidDeepSeekVault.CredentialStatus configure(String apiKey) {
        return vault.configure(apiKey);
    }

    public AndroidDeepSeekTranslationClient.TestOutcome test(
            AndroidDeepSeekTranslationClient.CancellationToken cancellation) {
        return client.test(cancellation);
    }

    public AndroidDeepSeekVault.CredentialStatus delete() {
        return vault.delete();
    }

    public AndroidDeepSeekTranslationClient.TranslationOutcome translate(
            AndroidDeepSeekPolicy.Input input,
            AndroidDeepSeekTranslationClient.CancellationToken cancellation) {
        return client.translate(input, cancellation);
    }
}
