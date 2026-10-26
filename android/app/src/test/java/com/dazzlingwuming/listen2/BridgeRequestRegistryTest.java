package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.Future;

import org.junit.Test;

public final class BridgeRequestRegistryTest {
    @Test
    public void queuedCancellationWinsOnceAndCancelsItsFuture() {
        BridgeRequestRegistry registry = new BridgeRequestRegistry();
        BridgeRequestRegistry.RequestKey key = new BridgeRequestRegistry.RequestKey(3, "queued");
        BridgeRequestRegistry.CallHandle handle = registry.register(key);
        FakeFuture future = new FakeFuture();
        registry.attachFuture(key, future);

        assertEquals(BridgeRequestRegistry.SettleResult.CANCELLED, registry.cancel(key));
        assertTrue(future.cancelled);
        assertEquals(BridgeRequestRegistry.SettleResult.ALREADY_SETTLED,
                registry.settle(key, AndroidRpcContract.Terminal.OK));
        assertFalse(registry.hasActive(key));
    }

    @Test
    public void timeoutCannotBeRelabelledCancellationAndDuplicateIdentityIsRejected() {
        BridgeRequestRegistry registry = new BridgeRequestRegistry();
        BridgeRequestRegistry.RequestKey key = new BridgeRequestRegistry.RequestKey(7, "running");
        registry.register(key);
        assertEquals(BridgeRequestRegistry.SettleResult.TIMEOUT, registry.timeout(key));
        assertEquals(BridgeRequestRegistry.SettleResult.ALREADY_SETTLED, registry.cancel(key));
        assertEquals(BridgeRequestRegistry.SettleResult.ALREADY_SETTLED,
                registry.settle(key, AndroidRpcContract.Terminal.ERROR));
        assertEquals(null, registry.register(key));
    }

    @Test
    public void destroyCancelsEveryCallAndSuppressesLateReplies() {
        BridgeRequestRegistry registry = new BridgeRequestRegistry();
        BridgeRequestRegistry.RequestKey first = new BridgeRequestRegistry.RequestKey(1, "first");
        BridgeRequestRegistry.RequestKey second = new BridgeRequestRegistry.RequestKey(1, "second");
        registry.register(first);
        registry.register(second);

        assertEquals(2, registry.cancelAll());
        assertTrue(registry.isDestroyed());
        assertEquals(BridgeRequestRegistry.SettleResult.DESTROYED,
                registry.settle(first, AndroidRpcContract.Terminal.OK));
        assertFalse(registry.canPostReplies());
    }

    @Test
    public void pageTransitionCancelsAndForgetsOldCallsWithoutClosingNewPageAuthority() {
        BridgeRequestRegistry registry = new BridgeRequestRegistry();
        BridgeRequestRegistry.RequestKey oldKey = new BridgeRequestRegistry.RequestKey(1, "old");
        FakeFuture oldFuture = new FakeFuture();
        registry.register(oldKey);
        registry.attachFuture(oldKey, oldFuture);

        assertEquals(1, registry.cancelForPageTransition());
        assertTrue(oldFuture.cancelled);
        assertEquals(BridgeRequestRegistry.SettleResult.NOT_FOUND,
                registry.settle(oldKey, AndroidRpcContract.Terminal.OK));
        assertFalse(registry.isDestroyed());

        BridgeRequestRegistry.RequestKey newKey = new BridgeRequestRegistry.RequestKey(1, "old");
        assertTrue(registry.register(newKey) != null);
        assertTrue(registry.hasActive(newKey));
    }

    @Test
    public void retryDecisionsAreBoundedAndCancellationAwareWithoutSleeping() {
        assertEquals(BridgeRetryPolicy.Decision.retryAfter(50),
                BridgeRetryPolicy.decide(1, 0, 200, false, 503));
        assertEquals(BridgeRetryPolicy.Decision.noRetry("attempt-limit"),
                BridgeRetryPolicy.decide(2, 0, 200, false, 503));
        assertEquals(BridgeRetryPolicy.Decision.noRetry("cancelled"),
                BridgeRetryPolicy.decide(1, 0, 200, true, 503));
        assertEquals(BridgeRetryPolicy.Decision.noRetry("deadline"),
                BridgeRetryPolicy.decide(1, 170, 200, false, 503));
        assertEquals(BridgeRetryPolicy.Decision.noRetry("non-transient"),
                BridgeRetryPolicy.decide(1, 0, 200, false, 401));
    }

    private static final class FakeFuture implements Future<Object> {
        boolean cancelled;

        @Override public boolean cancel(boolean mayInterruptIfRunning) { cancelled = true; return true; }
        @Override public boolean isCancelled() { return cancelled; }
        @Override public boolean isDone() { return cancelled; }
        @Override public Object get() { return null; }
        @Override public Object get(long timeout, java.util.concurrent.TimeUnit unit) { return null; }
    }
}
