package com.listen2mobile.acceptance;

/** Bounded, UI-only progress marker used to make an acceptance failure diagnosable. */
final class ScenarioProgress {
    private static final int MAX_STEP_LENGTH = 80;
    private volatile String currentStep = "runner-start";

    void step(String value) {
        if (value == null || !value.matches("[a-z0-9-]+")) {
            throw new IllegalArgumentException("invalid acceptance step");
        }
        currentStep = value.length() > MAX_STEP_LENGTH ? value.substring(0, MAX_STEP_LENGTH) : value;
    }

    String currentStep() {
        return currentStep;
    }
}
