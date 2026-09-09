package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import com.dazzlingwuming.listen2.provider.BilibiliAccountSession;

import org.junit.Test;

/** JVM coverage for account restoration and native logout state. */
public final class BilibiliAccountSessionTest {
    @Test
    public void restoresOnlyWhenGatewayAndVaultBothReportPresence() {
        assertEquals(BilibiliAccountSession.Status.AUTHENTICATED,
                newSession(true, true).snapshot().getStatus());
        assertEquals(BilibiliAccountSession.Status.IDLE,
                newSession(true, false).snapshot().getStatus());
        assertEquals(BilibiliAccountSession.Status.IDLE,
                newSession(false, true).snapshot().getStatus());
        assertEquals(BilibiliAccountSession.Status.IDLE,
                newSession(false, false).snapshot().getStatus());
    }

    @Test
    public void logoutClearsGatewayAndVaultPresenceAndPreventsRestoration() {
        MutableGateway gateway = new MutableGateway(true);
        MutableVault vault = new MutableVault(true);
        BilibiliAccountSession session = new BilibiliAccountSession(gateway, vault);

        assertEquals(BilibiliAccountSession.Status.AUTHENTICATED,
                session.snapshot().getStatus());

        assertEquals(BilibiliAccountSession.Status.IDLE, session.logout().getStatus());
        assertEquals(1, gateway.logoutCalls);
        assertEquals(1, vault.clearCalls);
        assertFalse(gateway.authenticated);
        assertFalse(vault.stored);
        assertEquals(BilibiliAccountSession.Status.IDLE,
                new BilibiliAccountSession(gateway, vault).snapshot().getStatus());
    }

    private static BilibiliAccountSession newSession(boolean gatewayPresent, boolean vaultPresent) {
        return new BilibiliAccountSession(new MutableGateway(gatewayPresent),
                new MutableVault(vaultPresent));
    }

    private static final class MutableGateway implements BilibiliAccountSession.QrGateway {
        boolean authenticated;
        int logoutCalls;

        MutableGateway(boolean authenticated) {
            this.authenticated = authenticated;
        }

        @Override
        public BilibiliAccountSession.QrChallenge begin() {
            return null;
        }

        @Override
        public BilibiliAccountSession.PollResult poll(String ignored) {
            return null;
        }

        @Override
        public void logout() {
            logoutCalls += 1;
            authenticated = false;
        }

        @Override
        public boolean hasAuthenticatedSession() {
            return authenticated;
        }
    }

    private static final class MutableVault implements BilibiliAccountSession.CredentialVault {
        boolean stored;
        int clearCalls;

        MutableVault(boolean stored) {
            this.stored = stored;
        }

        @Override
        public boolean isAvailable() {
            return true;
        }

        @Override
        public void save(String ignored) {
            stored = true;
        }

        @Override
        public void clear() {
            clearCalls += 1;
            stored = false;
        }

        @Override
        public boolean hasStoredCredential() {
            return stored;
        }
    }
}
