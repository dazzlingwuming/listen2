package com.listen2mobile.acceptance;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Self-contained, platform-only runner for the sealed releaseLike acceptance artifact. */
public final class Phase08Instrumentation extends Instrumentation {
    private static final long SCENARIO_TIMEOUT_MILLIS = 90_000L;
    private String requestedClass;

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        requestedClass = arguments.getString("class");
        start();
    }

    @Override
    public void onStart() {
        Bundle status = new Bundle();
        status.putString("class", requestedClass == null ? "<missing>" : requestedClass);
        status.putString("stream", "Phase08Instrumentation started");
        sendStatus(1, status);

        AtomicReference<Throwable> failure = new AtomicReference<>();
        CountDownLatch completed = new CountDownLatch(1);
        Thread worker = new Thread(() -> {
            try {
                dispatchScenario(requestedClass);
            } catch (Throwable error) {
                failure.set(error);
            } finally {
                completed.countDown();
            }
        }, "phase08-acceptance");
        worker.setDaemon(true);
        worker.start();

        try {
            if (!completed.await(SCENARIO_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)) {
                worker.interrupt();
                failure.compareAndSet(null, new AssertionError("Phase 8 scenario exceeded its 90-second bound"));
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            failure.compareAndSet(null, error);
        }

        Throwable terminalFailure = failure.get();
        Bundle result = new Bundle();
        result.putString("class", requestedClass == null ? "<missing>" : requestedClass);
        if (terminalFailure == null) {
            result.putString("stream", "Phase08Instrumentation completed");
            sendStatus(0, result);
            finish(Activity.RESULT_OK, result);
            return;
        }
        // AssertionError and every other scenario failure remain terminal;
        // no catch path can promote a failed scenario to success.
        result.putString("shortMsg", "Phase 8 scenario failed: " + terminalFailure.getClass().getSimpleName());
        sendStatus(-1, result);
        finish(Activity.RESULT_CANCELED, result);
    }

    private void dispatchScenario(String scenarioClass) {
        if ("com.listen2mobile.acceptance.UpgradeSeedTest".equals(scenarioClass)) {
            UpgradeSeedTest.run(this);
            return;
        }
        if ("com.listen2mobile.acceptance.IntegratedJourneyTest".equals(scenarioClass)) {
            IntegratedJourneyTest.run(this);
            return;
        }
        throw new IllegalArgumentException("unapproved Phase 8 instrumentation class");
    }
}
