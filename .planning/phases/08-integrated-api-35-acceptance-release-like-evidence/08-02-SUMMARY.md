---
phase: 08-integrated-api-35-acceptance-release-like-evidence
plan: 02
subsystem: api35-acceptance
tags: [android, api35, accessibility, cjk, upgrade, evidence]
requires:
  - phase: 08-01
    provides: development-signed debug and releaseLike candidate evidence
provides:
  - one sealed API 35 debug-to-releaseLike upgrade and visible CJK search journey record
  - confined canonical evidence copy with binaries retained locally and uncommitted
affects: [08-03 performance-and-recovery, 08-04 requirement-evidence-map]
key-files:
  modified:
    - mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/AccessibilityDriver.java
    - mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/IntegratedJourneyTest.java
    - mobile/scripts/acceptance/evidence.mjs
    - mobile/scripts/acceptance/run-api35-journey.sh
  created:
    - .planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence/phase08-20260915T212857Z-b68a0b2396a5/08-journey.json
decisions:
  - CJK search acceptance enters text through the visible editable accessibility node and asserts the re-acquired exact value; Android shell input is not used.
  - The releaseLike candidate remains the sealed 54bc100 product APK; the separately built AndroidTest payload is evidence-only and does not substitute the product candidate.
metrics:
  api35_journey_runs: 1
  release_like_sha256: b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b
  android_test_sha256: 27076883db2c66e621d043ed0e07780d7efc3f7561686b18f3dc888bdf481954
  outcome: NOT_VERIFIED
completed: 2026-09-16
status: partial
---

# Phase 08 Plan 02: API 35 Journey Evidence Summary

**One API 35 debug-to-releaseLike upgrade and visible CJK search journey completed against the sealed candidate; the retained record is valid, but it is partial evidence and does not establish full Phase 4–7 device parity.**

## Evidence Run

- Canonical run: `.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence/phase08-20260915T212857Z-b68a0b2396a5/`
- Product candidate: development-signed, minified `releaseLike.apk`, SHA-256 `b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b`.
- Debug upgrade seed: SHA-256 `3dbfd6d0048fb436442f13e3b826ca25d485fa69873a6c8d31c8307b0f5c1652`.
- AndroidTest-only payload: SHA-256 `27076883db2c66e621d043ed0e07780d7efc3f7561686b18f3dc888bdf481954`; its manifest uses `Phase08Instrumentation` and targets `com.dazzlingwuming.listen2`.
- The one reset, debug seed, in-place releaseLike install, shell smoke, and class-filtered `IntegratedJourneyTest` all reached terminal success. The run-created API 35 AVD was shut down and deleted after the sealed record was validated.

## Verified in This Run

- The fixed query `青花瓷` was entered through `AccessibilityNodeInfo.ACTION_SET_TEXT`, then re-acquired and matched exactly before submit; no shell CJK input path was used.
- The visible source sequence includes NetEase and the real label `哔哩哔哩`; both reached the bounded terminal search assertion.
- Phone shell launch, debug-to-releaseLike migration seed/upgrade, library/settings navigation, screenshot/window capture, one package-data clear, and device-state rollback completed.
- `08-journey.json` validates; releaseLike `zipalign`, signature, manifest/R8 checks, and the Phase 7 security scanner passed.

## Not Claimed

- The evidence outcome is `NOT_VERIFIED`: no user-owned Bilibili authentication or DeepSeek credential was entered, and no credential material was passed to automation.
- This class-filtered journey does not by itself prove live playback, lyrics, duplicate queue identity, background/notification controls, SAF, backup, cache/offline, MV/PiP, effects/loudness, network/process recovery, accessibility variants, or the complete D-07 domain list. These remain non-passing evidence gaps for Plan 08-03 and the Plan 08-04 requirements map.
- APKs, screenshots, generated WAV and other binary run artifacts remain local/untracked by design. Only sanitized text/JSON/XML evidence is committed.

## Local CI

At `2026-09-16T05:28:01+08:00` through `2026-09-16T05:28:15+08:00`, the exact source snapshot passed:

- `npm run mobile:test` — 53 suites / 268 tests.
- `npm run mobile:typecheck` and `npm --prefix mobile run lint -- --quiet`.
- `:app:testReleaseLikeUnitTest :app:assembleReleaseLikeAndroidTest` with the pinned local Android toolchain.
- Fixture, evidence-containment, and acceptance-runner self-tests plus `git diff --check`.

The repository's older `:app:testDebugUnitTest` command no longer exists because AndroidTest is explicitly bound to `releaseLike`; the available and executed `:app:testReleaseLikeUnitTest` gate covers the configured variant.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] API 35 shell text injection did not enter CJK.**
   - Replaced it with visible editable-node `ACTION_SET_TEXT`, exact post-entry reacquisition, and self-tests for Unicode/action failure/reacquisition and the real Bilibili label.
   - Commits: `76b13b7`, `b68a0b2`.

2. **[Rule 3 - Blocking] Background emulator process did not remain attached after startup.**
   - Started the same run-created API 35 AVD in a persistent PTY before the sole journey command. This happened before any successful instrumentation run and did not create a second candidate journey.

## Self-Check: PASSED

- The canonical `08-build.json` and `08-journey.json` exist in the stated run directory and the journey schema validates.
- Commits `76b13b7` and `b68a0b2` are reachable on `agent/android-mobile-rebuild`.
