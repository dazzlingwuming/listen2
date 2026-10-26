package com.dazzlingwuming.listen2;

import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Network resolution never occupies the service's command/persistence lane. */
final class LatestMediaTaskRunner implements AutoCloseable {
    // A second worker lets the latest selection start while an old socket winds down.
    // Only the latest pending task is retained; service generations reject stale completions.
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(2, 2, 0L,
            TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>(), runnable -> {
                Thread thread = new Thread(runnable, "listen2-media-resolver");
                thread.setDaemon(true);
                return thread;
            });
    private Future<?> latest;

    synchronized void submit(Runnable task) {
        if (executor.isShutdown()) return;
        if (latest != null) latest.cancel(true);
        executor.purge();
        latest = executor.submit(task);
    }

    @Override public synchronized void close() {
        if (latest != null) latest.cancel(true);
        executor.shutdownNow();
    }
}
