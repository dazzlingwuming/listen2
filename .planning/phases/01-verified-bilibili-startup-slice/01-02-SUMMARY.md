---
phase: 01-verified-bilibili-startup-slice
plan: "02"
subsystem: android-native-bridge
tags: [android, webview, bilibili, cancellation, rpc, security]
requires:
  - phase: 01-verified-bilibili-startup-slice
    provides: typed Bilibili search bridge from plan 01-01
provides:
  - exactly-once typed native request lifecycle with cancellation and teardown guards
  - bounded Bilibili detail/page and audio-manifest DTO mapping
affects: [android provider adapter, playback, emulator verification]
actuals:
  tokens: 15192
  tasks: 2
  commits: 2
tech-stack:
  added: [org.json JVM test implementation]
  patterns: [atomic terminal registry, native-owned typed Bilibili routes, bounded DTO mapper]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/BridgeRequestRegistry.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/BridgeRetryPolicy.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/BilibiliResponseMapper.java
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java
key-decisions:
  - "Terminal ownership is keyed by page epoch plus request ID, with cancellation and destroy suppressing later transport replies."
  - "Explicit Bilibili CID selection fails closed; only default-first selection may use API page zero."
requirements-completed: [NET-001, NET-002, NET-003, SEC-001, SEC-003]
coverage:
  - id: D1
    description: Cancellable typed bridge lifecycle with bounded retry and teardown suppression.
    requirement: NET-002
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/BridgeRequestRegistryTest.java
        status: pass
    human_judgment: false
  - id: D2
    description: Strict Bilibili detail and audio-manifest mapping with exact CID selection.
    requirement: NET-003
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/BilibiliResponseMapperTest.java
        status: pass
    human_judgment: false
duration: 42min
completed: 2026-08-30
status: complete
---

# Phase 1 Plan 2: Native request lifecycle and Bilibili descriptor mapping Summary

**Typed Android bridge requests now settle once across cancellation, timeout, and teardown, while Bilibili detail and audio descriptors are reduced to validated selected-part playback data.**

## Accomplishments

- Added a thread-safe request registry that cancels queued/running futures and active HTTPS connections, rejects duplicate identities, and blocks late replies after teardown.
- Added finite retry classification with a two-attempt limit, deadline-aware backoff, and no retry after cancellation.
- Added closed `bilibili.video.detail`, `bilibili.audio.manifest`, and `rpc.cancel` contracts; all Bilibili routes and request headers remain native-owned.
- Added strict page/CID, MIME/codec, candidate URL, expiry, duration, and response-size validation before a minimized descriptor enters WebView memory.

## Task Commits

1. **Task 1: Make cancellation, deadline, retry, teardown, and settlement one native lifecycle** — `9240491`
2. **Task 2: Resolve exact Bilibili video parts and public audio descriptors natively** — `f3973b7`

## Verification

- `:app:testDebugUnitTest` targeted lifecycle, contract, and mapper suites: passed.
- Full local CI passed: Android JVM tests and debug APK assembly, APK v2 signature verification, all root desktop tests, and all extension contract tests.
- Timestamped API-35 live provider playback remains intentionally unverified and is owned by Plan 01-07; no fixture is presented as proof of live playback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Test infrastructure] Added a JVM-only JSON implementation for mapper fixtures**

- **Found during:** Task 2
- **Issue:** Android's framework `org.json` is a mockable stub in local JVM tests, preventing deterministic nested provider-schema fixtures.
- **Fix:** Added `org.json:json:20240303` only to `testImplementation`; APK runtime continues using the Android framework API.
- **Verification:** Mapper fixtures pass in `:app:testDebugUnitTest`.
- **Committed in:** `f3973b7`

## Known Stubs

None. Live Bilibili/CDN/device codec behavior is deliberately not stubbed and remains pending API-35 evidence.

## Next Phase Readiness

The shared provider/UI can consume closed detail, exact-part, manifest, cancellation, and safe error contracts. Live API-35 verification is still required before any claim of real provider playback.

## Self-Check: PASSED

- Confirmed all three native helpers and both JUnit fixture classes exist at the paths recorded above.
- Confirmed task commits `9240491` and `f3973b7` exist on `agent/android-mobile-rebuild`.
