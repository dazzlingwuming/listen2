package com.dazzlingwuming.listen2;

/** Pure retry classifier: callers sleep only after a retry decision is returned. */
final class BridgeRetryPolicy {
    static final int MAX_ATTEMPTS = 2;
    private static final long FIRST_BACKOFF_MILLIS = 50L;

    private BridgeRetryPolicy() {}

    static Decision decide(int completedAttempts, long elapsedMillis, long deadlineMillis,
            boolean cancelled, int httpStatus) {
        if (cancelled) return Decision.noRetry("cancelled");
        if (completedAttempts >= MAX_ATTEMPTS) return Decision.noRetry("attempt-limit");
        if (!isTransient(httpStatus)) return Decision.noRetry("non-transient");
        long delay = FIRST_BACKOFF_MILLIS;
        if (elapsedMillis < 0 || deadlineMillis <= elapsedMillis || delay > deadlineMillis - elapsedMillis) {
            return Decision.noRetry("deadline");
        }
        return Decision.retryAfter(delay);
    }

    static boolean isTransient(int httpStatus) {
        return httpStatus == 0 || httpStatus == 429 || httpStatus == 502
                || httpStatus == 503 || httpStatus == 504;
    }

    static final class Decision {
        final boolean retry;
        final long delayMillis;
        final String reason;

        private Decision(boolean retry, long delayMillis, String reason) {
            this.retry = retry;
            this.delayMillis = delayMillis;
            this.reason = reason;
        }

        static Decision retryAfter(long delayMillis) { return new Decision(true, delayMillis, "retry"); }
        static Decision noRetry(String reason) { return new Decision(false, 0L, reason); }

        @Override public boolean equals(Object other) {
            if (!(other instanceof Decision)) return false;
            Decision decision = (Decision) other;
            return retry == decision.retry && delayMillis == decision.delayMillis
                    && reason.equals(decision.reason);
        }

        @Override public int hashCode() {
            return (retry ? 1 : 0) * 31 * 31 + (int) delayMillis * 31 + reason.hashCode();
        }
    }
}
