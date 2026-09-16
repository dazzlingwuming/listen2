package com.listen2mobile.acceptance;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

/** Self-contained, platform-only runner for the sealed releaseLike acceptance artifact. */
public final class Phase08Instrumentation extends Instrumentation {
    private static final long SCENARIO_TIMEOUT_MILLIS = 90_000L;
    private static final int MAX_FAILURE_MESSAGE_LENGTH = 240;
    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern SECRET_PATTERN = Pattern.compile("(?i)(api[_-]?key|authorization|cookie|password|secret|token)\\s*[:=]\\s*[^\\s,;]+|bearer\\s+[^\\s,;]+");
    private String requestedClass;
    private Bundle requestedArguments;

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        requestedClass = arguments.getString("class");
        requestedArguments = new Bundle(arguments);
        start();
    }

    @Override
    public void onStart() {
        Bundle status = new Bundle();
        status.putString("class", requestedClass == null ? "<missing>" : requestedClass);
        status.putString("stream", "Phase08Instrumentation started");
        sendStatus(1, status);

        AtomicReference<Throwable> failure = new AtomicReference<>();
        ScenarioProgress progress = new ScenarioProgress();
        CountDownLatch completed = new CountDownLatch(1);
        Thread worker = new Thread(() -> {
            try {
                dispatchScenario(requestedClass, progress);
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
        String step = progress.currentStep();
        result.putString("stage", step);
        result.putString("failureType", terminalFailure.getClass().getSimpleName());
        result.putString("failureDetail", sanitizeFailureMessage(terminalFailure.getMessage()));
        result.putString("acceptanceStack", formatAcceptanceStack(terminalFailure));
        try {
            new AccessibilityDriver(this).captureFailureEvidence();
        } catch (Throwable ignored) {
            result.putString("failureEvidence", "capture-unavailable");
        }
        // AssertionError and every other scenario failure remain terminal;
        // no catch path can promote a failed scenario to success.
        result.putString("shortMsg", "Phase 8 scenario failed: " + terminalFailure.getClass().getSimpleName() + " at " + step);
        sendStatus(-1, result);
        finish(Activity.RESULT_CANCELED, result);
    }

    private void dispatchScenario(String scenarioClass, ScenarioProgress progress) {
        if ("com.listen2mobile.acceptance.UpgradeSeedTest".equals(scenarioClass)) {
            UpgradeSeedTest.run(this, progress);
            return;
        }
        if ("com.listen2mobile.acceptance.IntegratedJourneyTest".equals(scenarioClass)) {
            IntegratedJourneyTest.run(this, progress);
            return;
        }
        if ("com.listen2mobile.acceptance.LiveProviderSmokeTest".equals(scenarioClass)) {
            LiveProviderSmokeTest.run(this, progress);
            return;
        }
        if ("com.listen2mobile.acceptance.LiveBilibiliSmokeTest".equals(scenarioClass)) {
            LiveBilibiliSmokeTest.run(this, progress);
            return;
        }
        if ("com.listen2mobile.acceptance.PerformanceRecoveryTest#api35Full".equals(scenarioClass)) {
            PerformanceRecoveryTest.api35Full(this, progress, requestedArguments);
            return;
        }
        if ("com.listen2mobile.acceptance.PerformanceRecoveryTest#compatibilityColdStart".equals(scenarioClass)) {
            PerformanceRecoveryTest.compatibilityColdStart(this, progress, requestedArguments);
            return;
        }
        if ("com.listen2mobile.acceptance.PerformanceRecoveryTest#startupProbe".equals(scenarioClass)) {
            PerformanceRecoveryTest.startupProbe(this, progress, requestedArguments);
            return;
        }
        throw new IllegalArgumentException("unapproved Phase 8 instrumentation class");
    }

    static String sanitizeFailureMessage(String message) {
        if (message == null || message.isEmpty()) {
            return "no-message";
        }
        String sanitized = URL_PATTERN.matcher(message).replaceAll("<redacted-url>");
        sanitized = SECRET_PATTERN.matcher(sanitized).replaceAll("<redacted>");
        sanitized = sanitized.replaceAll("[\\r\\n\\t]+", " ").trim();
        return sanitized.length() > MAX_FAILURE_MESSAGE_LENGTH ? sanitized.substring(0, MAX_FAILURE_MESSAGE_LENGTH) : sanitized;
    }

    static String formatAcceptanceStack(Throwable error) {
        StringBuilder result = new StringBuilder();
        int count = 0;
        for (StackTraceElement frame : error.getStackTrace()) {
            if (!frame.getClassName().startsWith("com.listen2mobile.acceptance.")) {
                continue;
            }
            if (count++ > 0) {
                result.append(';');
            }
            result.append(frame.getClassName()).append('#').append(frame.getMethodName());
            if (count == 8) {
                break;
            }
        }
        return result.length() == 0 ? "no-acceptance-frame" : result.toString();
    }
}
