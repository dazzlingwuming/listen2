package com.listen2mobile.acceptance;

/** Pure post-action position pairing; never estimates actual playback position. */
final class SyntheticAudioObservation {
    enum Result { WAIT, PASS, ROLLBACK, INVALID_ANCHOR, INVALID_CLOCK }
    final boolean fresh;
    final Long resumeAnchorMs;
    Long firstUiSeconds;
    Long firstNativeMs;
    private Long previousUiSeconds;
    private Long previousNativeMs;
    private String identity;
    private long previousElapsed = -1L;

    SyntheticAudioObservation(boolean fresh, Long resumeAnchorMs) {
        this.fresh = fresh;
        this.resumeAnchorMs = resumeAnchorMs;
    }

    boolean sameIdentity(String metadata) { return identity != null && identity.equals(metadata); }

    static Long parseAnchor(String value) {
        if (value == null || !value.matches("[0-9]{1,9}")) return null;
        long anchor = Long.parseLong(value);
        return anchor > 0L && anchor <= 604_800_000L ? anchor : null;
    }

    Result observe(long elapsed, Long uiSeconds, Long nativeMs, long uiAt, long nativeAt,
            boolean fullPlayer, boolean playingTitle, String metadata) {
        if (!fresh && resumeAnchorMs == null) return Result.INVALID_ANCHOR;
        if (elapsed < 0L || elapsed < previousElapsed || uiAt < 0L || nativeAt < uiAt) return Result.INVALID_CLOCK;
        previousElapsed = elapsed;
        if (elapsed > 6_000L || nativeAt - uiAt > 500L || !fullPlayer || !playingTitle || metadata == null ||
                uiSeconds == null || nativeMs == null || uiSeconds < 0L || uiSeconds > 604_800L || nativeMs < 0L || nativeMs > 604_800_000L) return Result.WAIT;
        // UI reports each 1s; floor adds <1s, paired sample span adds <=500ms.
        // Scheduling is not guaranteed: values outside this bound stay unverified.
        if (Math.abs(uiSeconds * 1000L - nativeMs) > 2_500L) return Result.WAIT;
        if (fresh && nativeMs > elapsed + 1_000L) return Result.WAIT;
        if (previousNativeMs != null && (nativeMs < previousNativeMs || uiSeconds < previousUiSeconds)) {
            if (!fresh) return Result.ROLLBACK;
            firstUiSeconds = null; firstNativeMs = null; identity = null;
            previousUiSeconds = null; previousNativeMs = null;
        }
        if (firstNativeMs == null) {
            if (!fresh && Math.abs(nativeMs - resumeAnchorMs) > 3_000L) return Result.WAIT;
            firstUiSeconds = uiSeconds; firstNativeMs = nativeMs; identity = metadata;
        }
        previousUiSeconds = uiSeconds; previousNativeMs = nativeMs;
        return identity.equals(metadata) && uiSeconds > firstUiSeconds && nativeMs > firstNativeMs ? Result.PASS : Result.WAIT;
    }
}
