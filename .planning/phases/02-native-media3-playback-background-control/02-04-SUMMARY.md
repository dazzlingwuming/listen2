---
phase: 02-native-media3-playback-background-control
plan: "04"
subsystem: android-native-playback-owner
tags: [android, media3, mediasession, exoplayer, room, retry]
requires:
  - phase: 02-native-media3-playback-background-control
    plan: "02"
    provides: semantic queue/history state engine
  - phase: 02-native-media3-playback-background-control
    plan: "03"
    provides: atomic Room checkpoint repository
provides:
  - serialized transaction-before-projection coordinator
  - native-only Bilibili occurrence resolver with transient candidate recovery
  - one non-exported MediaSessionService owner for the Android ExoPlayer/session
affects: [02-05, 02-06, 02-07, 02-08, android-playback-bridge]
actuals:
  tokens: 9498
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [single-transition-lane, transaction-before-projection, occurrence-scoped-candidates]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackCoordinator.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackMediaResolver.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackCoordinatorTest.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackMediaResolverTest.java
  modified:
    - android/app/src/main/AndroidManifest.xml
key-decisions:
  - "Coordinator persistence completes before the sole player is projected; projection failure retains the selected occurrence and publishes an actionable recovery state."
  - "Bilibili candidate URLs are deduplicated, bounded, expiry-checked, occurrence-scoped memory only and absent from page snapshots/checkpoints."
  - "PlaybackService owns exactly one ExoPlayer and one MediaSession and is the only manifest-declared mediaPlayback service."
status: complete
---

# Phase 2 Plan 04: Native Media3 Owner Summary

**The Android runtime now has a single Media3 service owner, a serialized semantic transition lane, and native-only current-occurrence media recovery.**

## Accomplishments

- Added `PlaybackCoordinator`, which serializes page/session/natural-end/retry callbacks, persists accepted semantic transitions before a single player projection, deduplicates event tokens, and checkpoints seek completion plus bounded position intervals.
- Added `PlaybackMediaResolver`, which mints opaque native track/occurrence handles from a strict Bilibili audio descriptor, rejects replay/stale/unregistered selections, and keeps finite candidate attempts transient and current-occurrence-bound.
- Added final `PlaybackService` with one `ExoPlayer`, one `MediaSession`, a single-thread transition executor, Room checkpoint adapter, bounded settings adapter, and idempotent high-cost-state release.
- Declared only the required foreground-service permissions and a non-exported `mediaPlayback` MediaSessionService; no boot receiver, caller-controlled URL/header/cookie channel, or persisted transport material was added.

## Verification

- TDD RED: both focused suites initially failed at compile because the coordinator and resolver did not exist.
- Focused JVM: `:app:testDebugUnitTest --tests com.dazzlingwuming.listen2.PlaybackCoordinatorTest` — PASS (3 tests).
- Focused JVM: `:app:testDebugUnitTest --tests com.dazzlingwuming.listen2.PlaybackMediaResolverTest` — PASS (4 tests).
- Android assembly: `:app:testDebugUnitTest :app:assembleDebug :app:assembleRelease` — PASS; merged debug manifest includes the two foreground-service permissions and the non-exported `PlaybackService` with `mediaPlayback` type.
- Complete local CI — PASS on the exact pre-commit snapshots at `2026-08-31T04:13:41+0800`–`04:13:48+0800`, `04:15:54+0800`–`04:16:01+0800`, and `04:18:55+0800`–`04:19:01+0800`: Android JVM/debug APK/signature verification, six desktop suites, and the extension suite.

## Task Commits

1. **Serialize every semantic transition before Media3 projection** — `220cd25` (`feat`)
2. **Re-resolve and retry only the current occurrence** — `0a34db3` (`feat`)
3. **Own ExoPlayer and MediaSession in one legal playback service** — `1365c27` (`feat`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept a projection failure on the selected occurrence.**

- **Found during:** Task 1 focused TDD
- **Issue:** the failure assertion initially expected a next occurrence even though D-10 requires the current selection to remain actionable.
- **Fix:** asserted and retained the existing current occurrence while publishing `projection-failed`.
- **Files modified:** `PlaybackCoordinatorTest.java`

## Known Stubs

None. The service intentionally does not fabricate a media URL; later typed-playback bridge work supplies an authorized, fresh resolver descriptor before player preparation.

## Threat Flags

None. The new service introduces a foreground media service boundary, but it uses the plan's two required permissions, remains non-exported, and keeps resolution transport material process-local.

## Residual Risks

- Device-level notification, Bluetooth/noisy/focus, renderer-loss, and foreground-release evidence belongs to the later Phase 2 device plans; this plan does not claim it.
- The preserved Phase 1 API-35 live-provider evidence remains blocked and was not altered.

## Self-Check: PASSED

- All five implementation/test artifacts and the manifest declaration exist.
- Task commits `220cd25`, `0a34db3`, and `1365c27` are present and pushed on `agent/android-mobile-rebuild`.
