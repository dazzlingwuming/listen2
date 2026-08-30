---
phase: 01-verified-bilibili-startup-slice
plan: "01"
subsystem: android-native-bridge
tags: [android, webview, bilibili, rpc, api-35, instrumentation]
requires: []
provides:
  - "Protocol-2 typed Bilibili search envelope with native-owned route construction"
  - "Deterministic JavaScript/JVM boundary fixtures and API-35 host tracer"
affects: [01-02, 01-03, 01-05, 01-07]
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
tech-stack:
  added: [androidx.test.runner]
  patterns: [versioned typed bridge, page-epoch settlement, fail-closed ADB identity]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/AndroidRpcContractTest.java
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/Phase01WebViewInstrumentationTest.java
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java
    - app/listen1_chrome_extension/js/lowebutil.js
    - app/listen1_chrome_extension/js/provider/bilibili.js
key-decisions:
  - "Keep v1 GET isolated while all Android Bilibili search calls use v2 operation envelopes."
  - "Wave-0 runtime evidence proves the API-35 host only; live provider/audio remains unverified."
requirements-completed: [NET-001, SRCH-001, SEC-001, SEC-003]
coverage:
  - id: D1
    description: Typed Bilibili search envelope rejects page-supplied transport fields and stale epoch replies.
    requirement: NET-001
    verification:
      - kind: unit
        ref: app/listen1_chrome_extension/test/android_rpc_contract.test.js
        status: pass
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/AndroidRpcContractTest.java
        status: pass
    human_judgment: false
  - id: D2
    description: Packaged Android Activity launches on API-35 using the configured instrumentation runner.
    requirement: SEC-001
    verification:
      - kind: automated_ui
        ref: ":app:connectedDebugAndroidTest on listen2_api35 API-35 emulator"
        status: pass
    human_judgment: false
  - id: D3
    description: Live Bilibili search, selected-part audio progress, pause/resume, and lyrics remain a later manual live-provider gate.
    verification: []
    human_judgment: true
    rationale: External provider, CDN and codec behavior cannot be established by Wave-0 deterministic tracer evidence.
duration: 34min
completed: 2026-08-31
status: complete
---

# Phase 01 Plan 01: Typed Bilibili Search Tracer Summary

**A versioned Bilibili search operation now crosses the Android bridge without exposing page-controlled URLs, headers, cookies, or raw provider bodies.**

## Accomplishments

- Added protocol-2 request/reply correlation with bounded request IDs, page epochs, strict payload validation, and native-owned search route construction.
- Preserved legacy protocol-1 GET behavior for existing NetEase/browser consumers while routing Android Bilibili search through the typed operation.
- Added deterministic JS/JVM tests, compiled Android instrumentation, and ran the packaged Activity tracer on an API-35 arm64 emulator.
- Added a fail-closed ADB evidence script that records only approved identity fields and labels live provider/audio proof as unverified.

## Task Commits

1. Task 1 — `c17a772` `feat(01-01): add typed Bilibili search bridge`
2. Task 2 — `b6b491d` `test(01-01): freeze typed search contract`
3. Task 3 — `d57b6c1` `test(01-01): add API-35 runtime tracer`

## Verification

- Full repository local CI passed on `d57b6c1` at 2026-08-31T00:01:40+08:00: Android JVM tests/build, APK signature verification, all root Node suites, and extension suite.
- `:app:assembleDebugAndroidTest` passed.
- `:app:connectedDebugAndroidTest` passed on `listen2_api35` (API 35, arm64-v8a).
- `android/scripts/phase01-api35-smoke.sh --wave0-verify` passed with the approved temporary Gradle binary and wrote only generated, redacted identity metadata.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 1 - Test compatibility] Updated the pre-existing Android Bilibili fixture from its old v1 URL assertion to the new v2 descriptor contract.
2. [Rule 3 - Runtime dependency] Added the official AndroidX instrumentation runner because API-35 no longer exposes the removed `android.test` API used by the first tracer draft.
3. [Rule 3 - Shell portability] Replaced Bash-4-only `mapfile` with a POSIX-compatible device count so the ADB harness runs on the repository's macOS Bash.

## Known Limits

The API-35 tracer does not prove live Bilibili availability, media manifest resolution, audible progress, pause/resume, selected part, or lyrics. These are explicitly not verified and remain mandatory later gates.

## Self-Check: PASSED

- All three task commits exist on `origin/agent/android-mobile-rebuild`.
- All planned source, test, instrumentation, harness, and evidence-document files exist.
- No provider response body, cookie, header, signed media URL, credential, or personal path is tracked in the evidence template.
