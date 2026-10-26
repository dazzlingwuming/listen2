package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.concurrent.atomic.AtomicInteger;

public final class AndroidNetEaseRpcLifecycleTest {
    @Test
    public void cancellationSettlesOnceAndInterruptsTheProviderWork() {
        BridgeRequestRegistry registry = new BridgeRequestRegistry();
        BridgeRequestRegistry.RequestKey key = new BridgeRequestRegistry.RequestKey(3, "request");
        AtomicInteger terminalCount = new AtomicInteger();
        assertTrue(registry.register(key) != null);
        assertTrue(registry.attachTerminalListener(key, ignored -> terminalCount.incrementAndGet()));

        assertEquals(BridgeRequestRegistry.SettleResult.CANCELLED, registry.cancel(key));
        assertEquals(BridgeRequestRegistry.SettleResult.ALREADY_SETTLED,
                registry.settle(key, AndroidRpcContract.Terminal.OK));
        assertEquals(1, terminalCount.get());
        assertFalse(registry.hasActive(key));
    }

    @Test
    public void interruptedNativeProviderWorkIsCancelledRatherThanAnEmptySuccess() {
        AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.neteaseSearch(
                "request", 3, "title", 1);
        NetEaseProviderClient client = new NetEaseProviderClient(uri -> {
            throw new InterruptedException("do not serialize this");
        });

        AndroidRpcContract.TypedReply reply = client.executeSearch(request);

        assertEquals(AndroidRpcContract.Terminal.CANCELLED, reply.terminal);
        assertEquals("CANCELLED", reply.errorCode);
        assertFalse(reply.toJson().contains("do not serialize this"));
    }

    @Test
    public void deadlineAndTeardownSuppressLateTransportSettlement() {
        BridgeRequestRegistry registry = new BridgeRequestRegistry();
        BridgeRequestRegistry.RequestKey timedOut = new BridgeRequestRegistry.RequestKey(3, "timeout");
        AtomicInteger terminalCount = new AtomicInteger();
        assertTrue(registry.register(timedOut) != null);
        assertTrue(registry.attachTerminalListener(timedOut, ignored -> terminalCount.incrementAndGet()));
        assertEquals(BridgeRequestRegistry.SettleResult.TIMEOUT, registry.timeout(timedOut));
        assertEquals(BridgeRequestRegistry.SettleResult.ALREADY_SETTLED,
                registry.settle(timedOut, AndroidRpcContract.Terminal.OK));
        assertEquals(1, terminalCount.get());

        BridgeRequestRegistry.RequestKey stale = new BridgeRequestRegistry.RequestKey(2, "stale");
        assertTrue(registry.register(stale) != null);
        assertEquals(1, registry.cancelForPageTransition());
        assertEquals(BridgeRequestRegistry.SettleResult.NOT_FOUND,
                registry.settle(stale, AndroidRpcContract.Terminal.OK));
    }
}
