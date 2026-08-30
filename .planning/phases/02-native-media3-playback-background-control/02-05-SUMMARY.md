---
phase: 02-native-media3-playback-background-control
plan: "05"
subsystem: android-playback-bridge
tags: [android, webmessage, playback, lifecycle, mediasession]
requires:
  - phase: 02-native-media3-playback-background-control
    plan: "04"
    provides: sole Media3 service owner and serialized transition lane
provides:
  - one origin-bound typed playback operation family on Listen2AndroidHttp
  - disposable page epoch controller with monotonic sanitized snapshots
  - Activity-to-service local control connection that never owns the player
affects: [02-06, 02-07, 02-08, android-native-playback]
tech-stack:
  added: []
  patterns: [closed-rpc-schema, first-terminal-then-snapshot, renderer-only-teardown]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackBridgeController.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgeControllerTest.java
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/AndroidRpcContractTest.java
key-decisions:
  - "Playback commands reuse the exact trusted Listen2AndroidHttp listener and version-2 envelope; no JavaScript interface or URL-capable bridge was added."
  - "Only the page controller is detached on reload, Back navigation, or Activity destruction; the local service port never gives the Activity a player/session handle."
  - "Command acknowledgements precede strictly newer sanitized snapshot events; stale page authority and stale/replayed selection identities fail closed."
actuals:
  tokens: 9473
  tasks: 2
  commits: 2
status: complete
---

# Phase 2 Plan 05: Trusted Playback Bridge Summary

**The existing origin-restricted WebMessage object now carries a closed playback command family to a short-lived page controller while Media3 ownership stays in the native service.**

## Accomplishments

- Added `playback.command` to the existing v2 contract with closed JSON-to-map conversion. It preserves all Phase-1 provider operations and rejects arrays, unknown fields, caller-selected transport controls, and malformed payloads before a playback port sees them.
- Added `PlaybackBridgeController`, which enforces current page epoch/revision, native-minted prepare/select identities, one-time selection consumption, first terminal acknowledgement followed by a newer sanitized snapshot, and inert detached-page replies.
- Connected the controller to `PlaybackService` through an explicit same-app binder which exposes only the bounded service port, never `ExoPlayer` or `MediaSession`; service transition work remains on its single lane.
- Updated `MainActivity` to bind/unbind only that controller port, invalidate page authority before WebView teardown, and delegate player-overlay Back handling to the packaged page without pausing or releasing service audio.

## Verification

- TDD RED: `PlaybackBridgeControllerTest` initially failed to compile because the controller did not exist.
- Focused JVM: `:app:testDebugUnitTest --tests com.dazzlingwuming.listen2.AndroidRpcContractTest --tests com.dazzlingwuming.listen2.PlaybackBridgeControllerTest` — PASS (11 tests).
- Android JVM/debug APK: `:app:testDebugUnitTest :app:assembleDebug` — PASS.
- Complete local CI — PASS on the exact Task 1 content at `2026-08-31T04:29:38+0800`–`04:29:46+0800` and exact Task 2 content at `2026-08-31T04:30:46+0800`–`04:30:52+0800`: Android JVM/debug APK/signature verification, six desktop suites, and the extension suite.

## Task Commits

1. **Dispatch playback commands and monotonic snapshots on the existing bridge** — `7c8c786` (`feat`)
2. **Make Activity and renderer lifecycle controller-only** — `1deac0e` (`feat`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical service boundary] Added a narrow local service binder.**

- **Found during:** Task 1
- **Issue:** `PlaybackService` exposed no controller-only port, so `MainActivity` could not reconnect the packaged page without incorrectly acquiring/releasing the player.
- **Fix:** added an explicit same-app binder that returns only `PlaybackBridgeController.ServicePort`; the port accepts immutable logical commands and sanitized snapshots, while player/session fields remain private to the service.
- **Files modified:** `PlaybackService.java`
- **Commit:** `7c8c786`

## Known Stubs

None introduced by this plan. Native candidate resolution remains the pre-existing occurrence-scoped service seam from Plan 02-04 and is intentionally not serialized through this page bridge.

## Threat Flags

None. The new service binding is explicit and same-app, retains the existing trusted origin/main-frame listener, and adds no route, raw media, credential, header, cookie, or file-access surface.

## Residual Risks

- Device-level Media3/notification/focus/recovery proof remains owned by Plan 02-08; this plan does not claim installed-device evidence.
- Packaged player overlay handling is a source hook for Plan 02-07; absent UI overlays fall through to normal history/Activity Back behavior without altering audio.
- The preserved Phase-1 API-35 public-provider evidence remains blocked and was not changed.

## Self-Check: PASSED

- All seven product/test artifacts listed above exist.
- Task commits `7c8c786` and `1deac0e` exist and are pushed to `origin/agent/android-mobile-rebuild`.
