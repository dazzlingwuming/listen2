---
phase: 05-five-source-listen-journey
plan: 05
subsystem: android-native-provider-playback
tags: [android, kotlin, react-native, kuwo, qq, playback, cancellation]
requires:
  - phase: 05-04
    provides: cookie-free QQ resolver and semantic native boundary
provides:
  - Kuwo native-only session, exact Secret, bounded playUrl resolver, and cancellation contract
  - Registered, readiness-gated QQ and Kuwo semantic playback modules
  - PlayerController AbortSignal propagation that prevents stale resolutions from reaching RNTP
affects: [phase-05-verification, phase-06, phase-08-android-acceptance]
actuals:
  tokens: 14278
  tasks: 4
  commits: 5
tech-stack:
  added: []
  patterns:
    - Fixed native session and provider-route owner with deterministic injected transport fixtures
    - Versioned NativeModules constants gate and correlated semantic bootstrap descriptor
    - One AbortSignal per player transition, raced through provider resolution before RNTP mutation
key-files:
  created:
    - mobile/android/app/src/main/java/com/listen2mobile/kuwo/KuwoPlaybackPolicy.kt
    - mobile/android/app/src/main/java/com/listen2mobile/kuwo/KuwoPlaybackGateway.kt
    - mobile/android/app/src/main/java/com/listen2mobile/kuwo/KuwoPlaybackModule.kt
    - mobile/android/app/src/main/java/com/listen2mobile/kuwo/KuwoPlaybackPackage.kt
    - mobile/android/app/src/test/java/com/listen2mobile/kuwo/KuwoPlaybackContractTest.kt
    - mobile/src/api/nativePlayback.ts
  modified:
    - mobile/android/app/src/main/java/com/listen2mobile/MainApplication.kt
    - mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackModule.kt
    - mobile/src/api/client.ts
    - mobile/src/player/playerController.ts
key-decisions:
  - "Kuwo derives the original-author Secret only in native process memory from its fixed cookie and numeric nonce; neither value crosses the RN bridge."
  - "QQ and Kuwo activate only after exact provider/version/readiness/host constants validate; native module absence stays unavailable."
  - "A new selection aborts the prior resolution before it can occupy the serialized RNTP mutation lane."
requirements-completed: [NET-004, PLAY-001, SRCH-003, SEC-004]
duration: 1h 12m
completed: 2026-09-15
status: complete
---

# Phase 05 Plan 05: Native QQ/Kuwo Playback Closure Summary

**Kuwo's fixed native session resolver and QQ/Kuwo playback registration now feed the sole mobile player through correlated, cancellable semantic bootstrap descriptors.**

## Accomplishments

- Ported the exact original-author Kuwo Secret behavior, including the corrected decimal nonce golden vector `452fda90010b117cb165a7af6d0012d687`, fixed homepage/playUrl routes, in-memory cookie ownership, exactly one session refresh, fixed fixture host, no redirects, one-byte probe, bounds, expiry, and safe failures.
- Added the versioned Kuwo React Native module/package, immutable readiness constants, duplicate-ID rejection, cancellation, invalidation, and session clearing; registered both the existing QQ package and Kuwo package once in `MainApplication`.
- Added `nativePlayback.ts` as the only JS consumer of QQ/Kuwo modules. It accepts semantic IDs only, checks exact readiness/host constants, validates correlated bounded descriptors, maps safe failures, and calls native cancel once for an aborted request.
- Propagated an operation AbortSignal from `PlayerController` into all provider resolution paths. A replacement selection now invalidates/aborts the prior operation before RNTP reset/add/play, and deterministic QQ-to-Kuwo tests prove the stale result cannot mutate RNTP.

## Task Commits

1. **Task 1: Kuwo numeric-nonce Secret and session tracer** — `ef637fb`
2. **Task 2: Kuwo module, safe errors, and cancellation** — `311eddf`
3. **Task 3: QQ/Kuwo registration and canonical bootstrap** — `c61c663`
4. **Task 4: Player operation cancellation before RNTP mutation** — `a42b944`
5. **Critical contract coverage: SecureRandom nonce bounds** — `0ec8ecc`

## Verification

Final full local verification passed on `agent/android-mobile-rebuild`:

- `npm run mobile:test` — 34 suites / 219 tests passed.
- `npm run mobile:typecheck` — passed.
- `npm --prefix mobile run lint -- --quiet` — passed.
- `git diff --check` — passed.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH ./mobile/android/gradlew --offline --no-daemon -p mobile/android :app:testDebugUnitTest` — 151 Gradle tasks, passed.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 2 - Critical contract] Added immutable QQ readiness constants.**
   The pre-existing QQ module had no JS-visible immutable provider/version/readiness/host constants, so it could not satisfy the shared fail-closed adapter contract. `QqPlaybackModule.kt` now exposes the same non-sensitive constants as Kuwo; no QQ cookie/session behavior was introduced.

2. **[Rule 1 - Test compatibility] Updated Bilibili flow expectations for the existing provider signal.**
   The global player cancellation contract correctly passes an AbortSignal to Bilibili as well. Two UI-flow assertions now verify that second argument instead of falsely treating it as a regression.

## Known Stubs

None.

## Phase 8 Evidence Still Required

- No APK assembly, installation, API 35 emulator, account login, live provider/CDN request, or audible RNTP playback was executed.
- The exact QQ/Kuwo fixture hosts are deterministic fail-closed assumptions only. Production redirects, post-probe RNTP behavior, account/entitlement outcomes, and final CDN host coverage remain unverified until Phase 8.

## Self-Check: PASSED

All six Kuwo/native adapter files, five plan commits, and the final regression commands exist and passed. The summary is the only Phase 05 planning file staged by this executor.
