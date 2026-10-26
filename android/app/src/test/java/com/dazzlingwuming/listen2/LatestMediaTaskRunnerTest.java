package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public final class LatestMediaTaskRunnerTest {
    @Test public void nextSelectionDoesNotWaitForPreviousSocketToReturn() throws Exception {
        CountDownLatch oldStarted = new CountDownLatch(1), releaseOld = new CountDownLatch(1);
        CountDownLatch newestRan = new CountDownLatch(1);
        try (LatestMediaTaskRunner runner = new LatestMediaTaskRunner()) {
            runner.submit(() -> { oldStarted.countDown(); awaitSocket(releaseOld); });
            assertTrue(oldStarted.await(2, TimeUnit.SECONDS));
            runner.submit(newestRan::countDown);
            assertTrue(newestRan.await(2, TimeUnit.SECONDS));
        } finally { releaseOld.countDown(); }
    }

    @Test public void rapidSelectionDiscardsIntermediatePendingRequests() throws Exception {
        CountDownLatch firstStarted = new CountDownLatch(1), secondStarted = new CountDownLatch(1);
        CountDownLatch releaseSockets = new CountDownLatch(1), newestRan = new CountDownLatch(1);
        AtomicInteger pendingRuns = new AtomicInteger();
        try (LatestMediaTaskRunner runner = new LatestMediaTaskRunner()) {
            runner.submit(() -> { firstStarted.countDown(); awaitSocket(releaseSockets); });
            assertTrue(firstStarted.await(2, TimeUnit.SECONDS));
            runner.submit(() -> { secondStarted.countDown(); awaitSocket(releaseSockets); });
            assertTrue(secondStarted.await(2, TimeUnit.SECONDS));
            for (int i = 0; i < 100; i++) runner.submit(pendingRuns::incrementAndGet);
            runner.submit(() -> { pendingRuns.incrementAndGet(); newestRan.countDown(); });
            releaseSockets.countDown();
            assertTrue(newestRan.await(2, TimeUnit.SECONDS));
            assertEquals(1, pendingRuns.get());
        } finally { releaseSockets.countDown(); }
    }

    private static void awaitSocket(CountDownLatch latch) {
        boolean interrupted = false;
        while (latch.getCount() > 0) {
            try { latch.await(); } catch (InterruptedException ignored) { interrupted = true; }
        }
        if (interrupted) Thread.currentThread().interrupt();
    }
}
