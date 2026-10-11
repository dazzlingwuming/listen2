package com.listen2mobile.acceptance;

import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import com.doublesymmetry.trackplayer.service.MusicService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Test-only read of RNTP's public binder and actual ExoPlayer position. */
final class NativePlaybackObservation {
    private NativePlaybackObservation() { }

    static Sample read(Instrumentation instrumentation) {
        Context context = instrumentation.getTargetContext();
        Handler main = new Handler(Looper.getMainLooper());
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean closed = new AtomicBoolean(false);
        AtomicReference<Sample> result = new AtomicReference<>(Sample.unavailable());
        final class Probe implements ServiceConnection {
            private boolean bound;

            void release() {
                if (bound) {
                    bound = false;
                    try { context.unbindService(this); } catch (RuntimeException ignored) { }
                }
            }

            void finish(Sample sample) {
                if (closed.compareAndSet(false, true)) result.set(sample);
                release();
                done.countDown();
            }

            void bind() {
                if (closed.get()) return;
                try {
                    // flags=0: observe an existing service; never create or start one.
                    bound = context.bindService(new Intent(context, MusicService.class), this, 0);
                    if (!bound) finish(Sample.unavailable());
                } catch (RuntimeException error) { finish(Sample.unavailable()); }
            }

            @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                if (closed.get()) { release(); return; }
                try {
                    if (!(binder instanceof MusicService.MusicBinder)) { finish(Sample.unavailable()); return; }
                    MusicService service = ((MusicService.MusicBinder) binder).getService();
                    // Callback runs on the main thread, as required by RNTP/ExoPlayer.
                    double seconds = service.getPositionInSeconds();
                    if (!Double.isFinite(seconds) || seconds < 0 || seconds > 604800) {
                        finish(Sample.unavailable()); return;
                    }
                    finish(new Sample("PASS", "OBSERVED", Math.round(seconds * 1000), SystemClock.elapsedRealtime()));
                } catch (RuntimeException | LinkageError error) {
                    // A sealed minified product may have removed this public API.
                    // Report unavailable without crashing or rebuilding the product.
                    finish(Sample.unavailable());
                }
            }

            @Override public void onServiceDisconnected(ComponentName name) { finish(Sample.unavailable()); }
            @Override public void onBindingDied(ComponentName name) { finish(Sample.unavailable()); }
            @Override public void onNullBinding(ComponentName name) { finish(Sample.unavailable()); }
        }
        Probe probe = new Probe();
        main.post(probe::bind);
        try {
            if (!done.await(2, TimeUnit.SECONDS)) return Sample.unavailable();
            return result.get();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return Sample.unavailable();
        } finally {
            closed.set(true);
            main.post(probe::release);
        }
    }

    static final class Sample {
        final String status;
        final String state;
        final long positionMs;
        final long elapsedMs;

        Sample(String status, String state, long positionMs, long elapsedMs) {
            this.status = status; this.state = state; this.positionMs = positionMs; this.elapsedMs = elapsedMs;
        }

        static Sample unavailable() { return new Sample("NOT_VERIFIED", "UNAVAILABLE", 0, SystemClock.elapsedRealtime()); }
        boolean observed() { return "PASS".equals(status) && "OBSERVED".equals(state); }
        String safeLine() { return status + "|" + state + "|" + positionMs + "|" + elapsedMs; }
    }
}
