---
phase: 02-native-media3-playback-background-control
plan: "07"
subsystem: android-native-playback-ui
tags: [android, webview, angularjs, playback, queue, accessibility]
requires:
  - phase: 02-native-media3-playback-background-control
    plan: "06"
    provides: revisioned native playback snapshots and a typed page command client
provides:
  - Android-only mini-player and player detail rendered from the native snapshot
  - occurrence-keyed FIFO queue sheet with reorder, remove, clear, and focus-safe confirmations
  - phone safe-area, target-size, motion, high-contrast, and Back-order source contract
affects: [02-08, 02-09, android-native-playback]
actuals:
  tokens: 15512
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [snapshot-only-rendering, occurrence-keyed-queue-ui, revision-settled-commands]
key-files:
  created:
    - app/listen1_chrome_extension/test/android_native_playback_ui.test.js
    - app/listen1_chrome_extension/test/android_native_queue_ui.test.js
  modified:
    - app/listen1_chrome_extension/js/controller/play.js
    - app/listen1_chrome_extension/listen1.html
    - app/listen1_chrome_extension/css/redesign.css
key-decisions:
  - "The Android surface reads only sanitized native snapshots; button acceptance never becomes a final visual state."
  - "FIFO rows are keyed by occurrenceId and preserve duplicate title/artist entries with visible ordinals."
  - "The Android-only player layer leaves the legacy desktop/browser dock and lyrics route untouched."
requirements-completed: [PLAY-001, PLAY-003, PLAY-004, PLAY-005]
coverage:
  - id: D1
    description: Android mini-player and detail expose snapshot state, bounded controls, safe recovery copy, and primary lyric entry.
    requirement: PLAY-001
    verification:
      - kind: automated_ui
        ref: app/listen1_chrome_extension/test/android_native_playback_ui.test.js
        status: pass
      - kind: integration
        ref: npm --prefix app/listen1_chrome_extension test
        status: pass
    human_judgment: true
    rationale: API-35 visual geometry, native service agreement, and external-control behavior require the Phase 02-09 device gate.
  - id: D2
    description: Android FIFO queue sheet preserves duplicate occurrences and confirms reorder/remove/clear only after a native revision.
    requirement: PLAY-003
    verification:
      - kind: automated_ui
        ref: app/listen1_chrome_extension/test/android_native_queue_ui.test.js
        status: pass
      - kind: integration
        ref: npm --prefix app/listen1_chrome_extension test
        status: pass
    human_judgment: true
    rationale: Touch drag, focus order, and post-command device rendering require the Phase 02-09 device gate.
  - id: D3
    description: Phone-safe 48dp player geometry, Back ordering, high contrast, and reduced motion remain isolated from desktop/browser UI.
    requirement: PLAY-006
    verification:
      - kind: automated_ui
        ref: app/listen1_chrome_extension/test/android_native_playback_ui.test.js
        status: pass
      - kind: automated_ui
        ref: app/listen1_chrome_extension/test/android_native_queue_ui.test.js
        status: pass
    human_judgment: true
    rationale: 320px, landscape, keyboard, gesture navigation, and 200% text must be inspected on the API-35 emulator.
duration: 12min
completed: 2026-08-31
status: complete
---

# Phase 2 Plan 07: Android Native Player UI Summary

**A phone-first Android mini-player, detail layer, and occurrence-preserving FIFO queue sheet now render one revisioned native playback snapshot.**

## Accomplishments

- Replaced the Android dock with a snapshot-only mini-player and detail surface: explicit connecting, resolving, buffering, paused, interrupted, retry, restored, and terminal-error copy; actions stay disabled until native state advances.
- Added a mobile queue sheet that renders each `occurrenceId` separately, including duplicate tracks, visible `队列第 N 首` labels, drag affordance, move-first/up/down/last alternatives, and confirmed remove/clear actions.
- Added 48dp controls, safe-area/`100svh` layout, bounded scroll regions, focus containment/return, reduced-motion and forced-color rules, plus Back ordering that never pauses audio.

## Verification

- TDD RED: both new UI contracts failed before implementation because the snapshot/detail and occurrence-sheet controller paths were absent.
- Focused PASS: `node app/listen1_chrome_extension/test/android_native_playback_ui.test.js` and `node app/listen1_chrome_extension/test/android_native_queue_ui.test.js`.
- Complete local CI PASS on exact task commits: Android JVM/debug APK/signature verification, six desktop suites, and the full extension suite. Latest pass: `2026-08-31T04:59:45+0800`–`2026-08-31T04:59:51+0800` at `c5e81c3`.

## Task Commits

1. **Render mini-player/detail controls from one snapshot** — `442b283` (`feat`)
2. **Add occurrence-preserving queue sheet and confirmations** — `f8c2de1` (`feat`)
3. **Enforce phone geometry, Back order, accessibility, themes, and reduced motion** — `c5e81c3` (`style`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Command binding] Made slider values use Angular models so only a completed seek/volume gesture sends one typed command.**

- **Found during:** Task 3
- **Issue:** static range values cannot provide a reliable changed value to `ng-change`.
- **Fix:** reconciled seek and volume drafts from the next native snapshot and sent bounded values only at the change boundary.
- **Files modified:** `app/listen1_chrome_extension/js/controller/play.js`, `app/listen1_chrome_extension/listen1.html`
- **Verification:** focused UI contracts and complete local CI passed.
- **Committed in:** `c5e81c3`

## Known Stubs

None. Device-only geometry and system-surface evidence is deliberately owned by Plan 02-09 rather than represented as a product stub.

## Threat Flags

None. This plan consumes the existing origin-bound typed bridge and exposes no network, media URL, header, cookie, credential, or arbitrary JavaScript capability.

## Next Phase Readiness

- Plan 02-08 can exercise the same snapshot surface through notification, lock-screen, audio-focus, and lifecycle behavior.
- Plan 02-09 must install the exact APK on API 35 and collect the required visual/control evidence; source and build results do not replace that gate.

## Self-Check: PASSED

- Confirmed all five planned source/test artifacts exist.
- Confirmed task commits `442b283`, `f8c2de1`, and `c5e81c3` exist and are pushed to `origin/agent/android-mobile-rebuild`.
