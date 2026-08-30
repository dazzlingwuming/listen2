---
phase: 02-native-media3-playback-background-control
plan: "06"
subsystem: android-playback-cutover
tags: [android, webview, playback, snapshot, howler]
requires:
  - phase: 02-native-media3-playback-background-control
    plan: "05"
    provides: typed native playback command and snapshot bridge
provides:
  - epoch-safe renderer playback client with native-minted selection identities
  - Android facade cutover that leaves Howler and browser MediaSession inactive
  - regression contracts for transport-free selection and sole audio ownership
affects: [02-07, 02-08, android-native-playback]
tech-stack:
  added: []
  patterns: [monotonic-snapshot-settlement, native-minted-selection, platform-owner-guard]
key-files:
  created:
    - app/listen1_chrome_extension/test/android_native_playback_bridge.test.js
    - app/listen1_chrome_extension/test/android_native_playback_cutover.test.js
  modified:
    - app/listen1_chrome_extension/js/lowebutil.js
    - app/listen1_chrome_extension/js/l1_player.js
    - app/listen1_chrome_extension/js/player_thread.js
key-decisions:
  - "Android selection always sends a bounded Bilibili identity, then accepts native-minted handles only from a newer snapshot before selectPrepared."
  - "Native availability disables page-owned Howler and browser MediaSession setup without changing desktop or extension behavior."
  - "Facade status is rendered from sanitized native snapshots; command acknowledgement alone is never final UI truth."
actuals:
  tokens: 12004
  tasks: 2
  commits: 2
status: complete
---

# Phase 2 Plan 06: Android Native Playback Cutover Summary

**The Android page is now a typed controller and snapshot renderer; native Media3 remains its single audio owner.**

## Accomplishments

- Added a versioned playback client on the existing WebMessage adapter. It validates epoch, revision, bounded command payloads, safe snapshots, native-issued selection handles, duplicate pending commands, teardown, and rejects all candidate/URL/header/cookie/provider-object fields.
- Routed Android facade controls—including transport, seek, volume, mute, mode, queue mutation and retry-capable command shapes—to the native client. Selection uses prepareSelection then selectPrepared, and page status changes only after a newer native snapshot.
- Guarded the page player before Howl allocation, refresh ownership, and browser MediaSession handler registration whenever the trusted Android capability exists. Desktop/browser player behavior continues through the legacy path.
- Added isolated bridge and cutover contract tests. The latter proves no Android Howl construction, no browser MediaSession registration, no local queue mutation, and no transport-field selection payload.

## Verification

- TDD RED: `node app/listen1_chrome_extension/test/android_native_playback_bridge.test.js` initially failed because `connect` was absent.
- Focused: `node app/listen1_chrome_extension/test/android_native_playback_bridge.test.js && node app/listen1_chrome_extension/test/android_native_playback_cutover.test.js` — PASS.
- Full extension regression: `npm --prefix app/listen1_chrome_extension test` — PASS.
- Complete local CI — PASS on the exact Task 1 content at `2026-08-31T04:39:07+0800`–`04:39:13+0800` and the exact Task 2 content at `2026-08-31T04:43:55+0800`–`04:44:01+0800`: Android JVM/debug APK/signature verification, six desktop suites, and the extension suite.

## Task Commits

1. **Subscribe to monotonic native snapshots and send idempotent commands** — `e8512ba` (`feat`)
2. **Route every Android player facade method to native and block dual ownership** — `94e0ae3` (`feat`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Static contract] Reworked the facade helpers for the existing extension lint boundary.**

- **Found during:** Task 2 commit hook.
- **Issue:** helper declarations inside the legacy script block violated the extension's no-inner-declarations policy.
- **Fix:** converted them to block-scoped arrow helpers and declared the facade binding before snapshot callbacks.
- **Files modified:** `app/listen1_chrome_extension/js/l1_player.js`
- **Commit:** `94e0ae3`

## Known Stubs

None introduced. `bundled-placeholder` appears only as a fixture's valid sanitized artwork state.

## Threat Flags

None. The cutover uses the existing origin-bound typed bridge and adds no network, credential, media URL, header, cookie, or arbitrary JavaScript surface.

## Residual Risks

- API-35 installed-device notification, audio-focus, background and renderer-loss proof remains owned by Plans 02-07/02-08.
- The preserved Phase-1 public-provider evidence is still blocked and was not altered by this plan.

## Self-Check: PASSED

- All five listed product/test artifacts exist.
- Task commits `e8512ba` and `94e0ae3` exist and are pushed to `origin/agent/android-mobile-rebuild`.
