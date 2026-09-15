---
phase: 07-offline-advanced-playback
plan: 03
subsystem: android-audio
tags: [react-native-track-player, audiofx, visualizer, loudness, media-codec]
requires:
  - phase: 07-offline-advanced-playback
    provides: durable offline cache catalog and RNTP-only playback ownership
provides:
  - Native-private RNTP audio-session lifecycle bridge and generation-aware effect lifecycle
  - Capability-labelled presets, foreground visualization, and fixed loudness gain seam
  - Content-identity-bound complete-media loudness analysis and unity fallback
affects: [phase-08-device-audio-validation, player, offline-cache]
actuals:
  tokens: 9736
  tasks: 3
  commits: 9
tech-stack:
  added: [Android Equalizer, Visualizer, LoudnessEnhancer, MediaExtractor, MediaCodec]
  patterns: [native-private audio session bridge, ephemeral bounded analyzer frames, hash-bound metric reuse]
key-files:
  created: [mobile/android/app/src/main/java/com/listen2mobile/audiofx/LoudnessAnalyzer.kt, mobile/src/audioFx/client.ts]
  modified: [mobile/patches/react-native-track-player+4.1.2.patch, mobile/android/app/src/main/java/com/listen2mobile/audiofx/AudioEffectsModule.kt, mobile/src/screens/PlayerScreen.tsx]
key-decisions:
  - "RNTP remains the sole session/player owner; the app consumes only its process-local native session bridge."
  - "Malformed, unavailable, denied, or stale analysis never fabricates frames and fails open to original audio/unity gain."
  - "Loudness metrics require matching content hash, sample rate, codec, and analyzer version."
patterns-established:
  - "Audio capability pattern: attach platform effects only to a nonzero current session and release on generation loss."
  - "Visualizer pattern: accept bounded, ephemeral, current-generation frames only."
requirements-completed: [FX-001, FX-002, FX-003]
coverage:
  - id: D1
    description: Native-private RNTP session bridge and capability-safe effects lifecycle
    requirement: FX-001
    verification:
      - kind: unit
        ref: ":app:testDebugUnitTest --tests com.listen2mobile.audiofx.AudioEffectsContractTest"
        status: pass
    human_judgment: true
    rationale: Real-session hardware effects require Phase 8 device-route validation.
  - id: D2
    description: Permission-gated, bounded foreground visualization with labelled fallback
    requirement: FX-002
    verification:
      - kind: unit
        ref: "mobile/src/screens/__tests__/audioEffectsFlow.test.tsx"
        status: pass
    human_judgment: true
    rationale: Permission and foreground lifecycle require device validation.
  - id: D3
    description: Hash-bound loudness analysis and nonblocking unity fallback
    requirement: FX-003
    verification:
      - kind: unit
        ref: ":app:testDebugUnitTest --tests com.listen2mobile.audiofx.LoudnessAnalyzerTest"
        status: pass
      - kind: unit
        ref: "mobile/src/player/__tests__/loudnessPlaybackIntegration.test.ts"
        status: pass
    human_judgment: true
    rationale: Codec and measured LUFS/true-peak behavior require Phase 8 media vectors and device evidence.
duration: 2h 15m
completed: 2026-09-15
status: complete
---

# Phase 07 Plan 03: Actual-session effects and loudness summary

**RNTP-owned native audio-session effects, permission-gated real-frame visualization, and hash-bound asynchronous loudness analysis with unity fail-open behavior.**

## Performance

- **Duration:** 2h 15m
- **Completed:** 2026-09-15T13:22:52Z
- **Tasks:** 3/3
- **Files modified:** 12

## Accomplishments

- Added a reproducible RNTP 4.1.2 patch that observes only the real ExoPlayer audio session in-process and clears it on service destruction.
- Attached Equalizer, Visualizer, and LoudnessEnhancer only to the current nonzero session; all errors release resources and preserve playback.
- Added explicit Android permission UX, bounded generation-fenced spectrum frames, content-identity metric reuse, and nonblocking unity gain fallback.

## Task Commits

1. **Task 1: real TrackPlayer session transition** - `791bab3`, `c700d2e`
2. **Task 2: foreground visualization fallback and UI** - `3932012`, `c433180`, `2b308b8`
3. **Task 3: complete-media loudness core and playback integration** - `1d1e3ec`, `ce62a8e`

Supporting path corrections: `bb1a8c6`, `a20cf6d`.

## Verification

- `:app:testDebugUnitTest --tests com.listen2mobile.audiofx.AudioEffectsContractTest --tests com.listen2mobile.audiofx.LoudnessAnalyzerTest` — passed.
- `npm test -- --runInBand src/screens/__tests__/audioEffectsFlow.test.tsx src/player/__tests__/loudnessPlaybackIntegration.test.ts` — passed (5 assertions).
- Isolated reverse/apply check for `mobile/patches/react-native-track-player+4.1.2.patch` — `PATCH_REPRODUCIBLE`.

No APK, emulator, live provider, or device-audio check was run, by scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Regenerated the dependency patch without Gradle build outputs**
- **Found during:** Task 1
- **Issue:** The first patch-package run captured generated RNTP `android/build` output.
- **Fix:** Isolated that generated directory and regenerated a source-only patch; reverse/apply validation passes.
- **Committed in:** `c700d2e`

## Decisions Made

- Used same-package Java protected access to the pinned KotlinAudio player rather than reflection, a second player, or JS-visible session IDs.
- Retained honest unavailable/static states until a real session and permitted capture are available.

## Next Phase Readiness

Phase 8 should verify actual routes, headset/Bluetooth changes, permission denial, codec corruption, and measured loudness vectors on device.

## Self-Check: PASSED

- Required audiofx source, patch, client, and tests exist.
- All task commits listed above are present on the current branch.
