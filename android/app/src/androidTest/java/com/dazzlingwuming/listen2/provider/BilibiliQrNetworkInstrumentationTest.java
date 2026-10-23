package com.dazzlingwuming.listen2.provider;

import android.webkit.CookieManager;
import androidx.test.platform.app.InstrumentationRegistry;
import com.dazzlingwuming.listen2.provider.BilibiliAccountSession;
import com.dazzlingwuming.listen2.platform.BilibiliQrGateway;
import org.junit.Assume;
import org.junit.Test;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/** Opt-in read-only QR handshake; never logs the one-time code or user credentials. */
public final class BilibiliQrNetworkInstrumentationTest {
    @Test public void providerChallengeCanBeDisplayedAndPolled() throws Exception {
        Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("bilibiliQrNetworkTest")));
        BilibiliQrGateway gateway = new BilibiliQrGateway(CookieManager.getInstance());
        BilibiliAccountSession.QrChallenge challenge = gateway.begin();
        URI uri = new URI(challenge.qrUrl);
        StringBuilder shape = new StringBuilder(uri.getHost()).append(uri.getPath());
        for (String pair : uri.getRawQuery().split("&")) {
            int split = pair.indexOf('=');
            String name = split < 0 ? pair : pair.substring(0, split);
            String value = split < 0 ? "" : pair.substring(split + 1);
            shape.append(' ').append(name).append(':').append(value.isEmpty() ? "empty" : "present");
            if ("callback".equals(name) && !value.isEmpty()) {
                URI callback = new URI(URLDecoder.decode(value, StandardCharsets.UTF_8.name()));
                shape.append('(').append(callback.getScheme()).append("://").append(callback.getHost())
                        .append(callback.getPath()).append(')');
            }
        }
        BilibiliAccountSession session = new BilibiliAccountSession(new BilibiliAccountSession.QrGateway() {
            public BilibiliAccountSession.QrChallenge begin() { return challenge; }
            public BilibiliAccountSession.PollResult poll(String key) throws Exception { return gateway.poll(key); }
            public boolean hasAuthenticatedSession() { return false; }
            public void logout() { }
        }, new BilibiliAccountSession.CredentialVault() {
            public boolean isAvailable() { return true; }
            public boolean hasStoredCredential() { return false; }
            public void save(String unused) { }
            public void clear() { }
        });
        BilibiliAccountSession.PublicState state = session.begin(System.currentTimeMillis());
        assertEquals(shape.toString(), BilibiliAccountSession.Status.WAITING, state.getStatus());
        assertEquals(BilibiliAccountSession.Status.WAITING,
                session.poll(state.getSessionId(), System.currentTimeMillis()).getStatus());
    }
}
