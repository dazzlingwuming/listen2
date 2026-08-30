---
phase: 03-netease-lyrics-provider-contract
plan: "02"
subsystem: android-frontend-provider-adapter
tags: [android, netease, lyrics, rpc, capabilities, cancellation]
dependency_graph:
  requires: [03-01-closed-netease-lyric-rpc-contract]
  provides: [typed-netease-page-adapter, closed-provider-capability-matrix]
  affects: [03-03-media3-rendition-clock, 03-04-lyric-persistence, 03-05-lyric-ui]
tech_stack:
  added: []
  patterns: [named-v2-operations, cancellable-facades, safe-dto-projection, unavailable-by-default]
key_files:
  created:
    - app/listen1_chrome_extension/test/android_netease_typed_provider.test.js
    - app/listen1_chrome_extension/test/android_provider_capability_matrix.test.js
  modified:
    - app/listen1_chrome_extension/js/lowebutil.js
    - app/listen1_chrome_extension/js/loweb.js
    - app/listen1_chrome_extension/js/provider/netease.js
    - app/listen1_chrome_extension/test/android_http_netease_search.test.js
decisions:
  - Android NetEase search uses only the closed netease.search RPC and retains terminal provider state instead of converting failure to an empty success.
  - Directory, default rendition, primary/manual lyric, selection, clear and offset requests carry only logical IDs and native selection identity; rendition transport never crosses into page code.
  - Android provider capabilities are closed by default; only Phase-1 Bilibili fields and explicit native NetEase handshake fields are invokable.
metrics:
  duration: 00:16:00
  completed: 2026-08-31
status: complete
actuals:
  tokens: 22800
  tasks: 3
  commits: 3
requirements-completed: []
---

# Phase 3 Plan 02: Typed NetEase Frontend Adapter Summary

The Android page now sends cancellable, closed NetEase and lyric intents to native code while preserving desktop and extension transport behavior.

## Accomplishments

- Replaced Android's legacy URL-based NetEase search with the typed `netease.search` request handle, safe DTO mapping, native-first cancellation, and actionable terminal errors.
- Added exact page-side validation and normalized payloads for directory/detail, one default rendition, primary/manual lyrics, selection read/write/clear, and bounded offset changes.
- Preserved the desktop callback and Axios/cookie branches; Android callbacks receive no URL, headers, cookies, signatures, candidates, or provider bodies.
- Added a capability matrix that blocks QQ, Kugou, Kuwo, Migu, and Taihe before they can issue an Android operation. Bilibili retains only previously verified fields; NetEase is enabled solely by an explicit native handshake.

## Task Commits

1. Task 1 — `8095e6c`: typed Android NetEase search.
2. Task 2 — `79f1846`: typed directory, rendition, lyric and persistence intents.
3. Task 3 — `4624502`: closed Android provider capability matrix.

## Verification

- Focused Node fixtures passed: `android_rpc_contract`, `android_http_netease_search`, `android_netease_typed_provider`, `android_provider_capability_matrix`, `android_bilibili_typed_provider`, and `bilibili_lyric_translation`.
- Full local CI passed on final code commit `4624502` from 2026-08-31T07:45:42+0800 to 2026-08-31T07:45:48+0800: Android JVM tests, debug APK assembly, APK signature verification, six desktop suites, and the extension suite.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 1 - Bug] Made `NETEASE_ROUTE_UNAVAILABLE` terminal and non-retryable at the page boundary.
   - Native route absence is actionable provider state, not a transient empty search result.
   - Files modified: `app/listen1_chrome_extension/js/lowebutil.js`.
   - Commit: `79f1846`.

2. [Rule 2 - Missing critical functionality] Added service-entry capability gates for search, directory, media, lyric and login operations.
   - Capability display alone did not prevent a legacy provider call from issuing work.
   - Files modified: `app/listen1_chrome_extension/js/loweb.js`.
   - Commit: `4624502`.

## Evidence Limits

- No approved entitlement-compliant NetEase live route or authorized item is available. Native returns explicit `NETEASE_ROUTE_UNAVAILABLE`; this plan makes no live playback claim.
- The preserved Phase 1 Bilibili API-35 evidence remains independently blocked and unmodified.

## Self-Check: PASSED

- The six modified/created source and fixture artifacts exist.
- Task commits `8095e6c`, `79f1846`, and `4624502` are present on the pushed branch.
- No tracked files were deleted.
