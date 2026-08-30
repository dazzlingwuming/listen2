---
phase: 02-native-media3-playback-background-control
plan: "08"
subsystem: android-native-playback-lifecycle
tags: [android, media3, mediasession, api35, instrumentation, recovery]
dependency_graph:
  requires: [02-07]
  provides: [api35-native-playback-lifecycle-evidence]
  affects: [PlaybackService, process-recovery, system-controls]
tech_stack:
  added: []
  patterns: [deterministic-SilenceMediaSource-fixture, semantic-Room-checkpoint, main-looper-Media3-ownership]
key_files:
  created:
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackInstrumentationFixture.java
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackServiceInstrumentationTest.java
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackRecoveryInstrumentationTest.java
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackSystemControlsInstrumentationTest.java
    - android/scripts/phase02-process-death-smoke.sh
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java
    - android/app/src/main/AndroidManifest.xml
decisions:
  - Media3 mutations run only on PlaybackService's main-looper handler; async checkpoint work remains off-main.
  - Recovery persists and restores bounded semantic playback state only, deliberately paused and without transport material.
  - API-35 tests use Media3 SilenceMediaSource rather than live provider media.
metrics:
  duration: 00:00:00
  completed: 2026-08-31
status: complete
actuals:
  tokens: 18000
  tasks: 3
  commits: 3
---

# Phase 02 Plan 08: Native playback lifecycle evidence Summary

Installed API-35 tests now prove a single native Media3 service/session, safe semantic process restoration, and truthful system-control lifecycle behavior using deterministic silence media.

## Completed Tasks

1. Proved page/session controller parity through one service-owned player and MediaSession, including play, pause, seek, volume, mute, previous, and idempotent next.
2. Added host-driven Stage A/B recovery proof: seed a duplicate-safe semantic Room checkpoint, force-stop until the PID is empty, relaunch the explicit debug Activity component, then assert paused/actionable semantic restoration without queue drift or transport fields.
3. Proved notification presence/removal, screen-off behavior, real competing audio-focus loss, controller recovery while screen-off, and idle teardown on the API-35 emulator.

## Verification

- `PlaybackServiceInstrumentationTest` passed on the API-35 emulator: one player/session identity and controller/snapshot control parity.
- `bash android/scripts/phase02-process-death-smoke.sh --verify` passed: Stage A checkpoint, `am force-stop`, empty `pidof`, relaunch, and Stage B semantic restoration.
- `PlaybackSystemControlsInstrumentationTest` passed on the API-35 emulator: notification and next-command behavior, screen-off continuation or truthful pause/recovery, real competing AudioFocus loss to paused state, and notification removal after clearing the media context.
- Full local CI passed on exact Task 3 content from `2026-08-31T05:27:27+0800` to `2026-08-31T05:27:33+0800`: Android JVM tests/debug APK/apksigner, six desktop suites, and the extension contract suite.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 1 - Bug] Confined Media3 command execution to the service main looper.
   - **Found during:** Task 3
   - **Issue:** The asynchronous coordinator could invoke `ExoPlayer` from its transition executor, violating Media3's application-thread invariant during clear/teardown.
   - **Fix:** Route all player mutation and projection through `PlaybackService`'s main-looper handler, while retaining Room I/O on the background executor.
   - **Files modified:** `PlaybackService.java`
   - **Commit:** `edb6534`

2. [Rule 2 - Critical lifecycle] Retained active playback independently of a disposable page binding and exposed a truthful monotonic sanitized snapshot.
   - **Found during:** Tasks 1 and 3
   - **Issue:** A renderer detach or late player callback could leave lifecycle state stale or permit playback ownership to disappear with the page.
   - **Fix:** Keep the started service while meaningful playback exists, project player callbacks into revisioned safe snapshots, and release foreground/service cost only after an explicit clear/idle state.
   - **Files modified:** `PlaybackService.java`, `AndroidManifest.xml`
   - **Commits:** `797f3ab`, `edb6534`

## Coverage Limitations

- `ACTION_AUDIO_BECOMING_NOISY` is protected on the API-35 emulator. Direct shell, target-context, and adopted-shell-identity injection were denied, so it is not reported as an injected-broadcast pass. Production retains `player.setHandleAudioBecomingNoisy(true)`; device route-change evidence remains required.
- Emulator screen-off can itself cause a noisy/route event. The test treats this as a truthful alternate outcome: if paused, it resumes through `MediaController` while the screen is still off and requires position advancement. Hardware-specific route behavior remains device evidence.
- Bluetooth/AVRCP is unavailable on the emulator and was not treated as passing evidence.
- All playback fixtures are deterministic native silence sources. This plan does not prove live provider, credential, or signed-transport playback.

## Self-Check: PASSED

All seven implementation/test artifacts exist and commits `797f3ab`, `a7f1a38`, and `edb6534` are present on `agent/android-mobile-rebuild` and pushed to origin.
