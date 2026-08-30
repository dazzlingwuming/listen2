---
phase: 01-verified-bilibili-startup-slice
plan: "05"
subsystem: android-webview-security
tags: [android, webview, navigation, lifecycle, api-35, instrumentation]
requires:
  - phase: 01-verified-bilibili-startup-slice
    provides: typed Bilibili bridge cancellation and descriptor contracts
provides:
  - normalized packaged/external/blocked navigation decisions
  - reload-safe bridge request cancellation and ordered WebView teardown
  - API-35 runtime evidence for WebView settings, bridge, navigation, and lifecycle
affects: [01-07-live-proof, android-security, release-like-parity]
actuals:
  tokens: 11275
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns: [fail-closed navigation decision, native page-generation cancellation, API-35 runtime assertions]
key-files:
  created: []
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/NavigationPolicy.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/Phase01WebViewInstrumentationTest.java
key-decisions:
  - "Packaged appassets navigation is exact and normalized; only separately sanitized HTTP(S) targets may reach a browsable system intent."
  - "A page transition cancels and clears old bridge work without closing the single native listener needed by the replacement packaged page."
requirements-completed: [NET-001, NET-002, SEC-001, SEC-002, SEC-003]
coverage:
  - id: D1
    description: Normalized packaged and external navigation rejects traversal, unsafe schemes, userinfo, non-normal ports, and secret-bearing URI fields.
    requirement: SEC-001
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/NavigationPolicyTest.java
        status: pass
    human_judgment: false
  - id: D2
    description: Reload and destroy cancel obsolete bridge work, preserve typed error correlation, and tear down the listener before WebView destruction.
    requirement: NET-002
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/BridgeRequestRegistryTest.java
        status: pass
      - kind: automated_ui
        ref: :app:connectedDebugAndroidTest on API-35 emulator
        status: pass
    human_judgment: false
  - id: D3
    description: The installed API-35 app reads actual hardened WebSettings, exposes one packaged bridge, handles a bounded local typed error, and delegates sanitized external navigation through a browsable intent.
    requirement: SEC-002
    verification:
      - kind: automated_ui
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/Phase01WebViewInstrumentationTest.java
        status: pass
    human_judgment: false
duration: 49min
completed: 2026-08-31
status: complete
---

# Phase 01 Plan 05: WebView Boundary Runtime Summary

**The Android host now fail-closes navigation and stale bridge work, with installed API-35 evidence for the hardened WebView, local bridge handshake, external handoff, reload, and teardown paths.**

## Accomplishments

- Replaced prefix-only URL checks with normalized packaged, external-sanitized, and blocked decisions; external intents carry no WebView headers, cookies, referrer extras, userinfo, secret-bearing query names, or fragments.
- Cancels and forgets old bridge handles when a packaged page starts, then tears down loading, bridge, clients, view hierarchy, and renderer in a safe order on destruction.
- Added Android 11+ browsable HTTP(S) package visibility so a legitimate browser resolver is visible without admitting custom schemes or additional permissions.
- Added API-35 instrumentation for actual WebSettings, third-party-cookie isolation, geolocation-denial behavior, exact origin bridge presence, bounded typed error correlation, external browser handoff, unsafe navigation, reload, and destroy.

## Task Commits

1. Task 1 — `f3f3bba` `feat(01-05): harden WebView navigation lifecycle`
2. Task 2 — `95128bb` `test(01-05): verify API35 WebView boundary`

## Verification

- Full repository local CI passed on the Task 1 worktree at 2026-08-31T00:41:37+08:00 through 2026-08-31T00:41:43+08:00.
- Release-like `:app:assembleRelease` passed after declaring the generated Listen1 asset dependency for Android lint tasks.
- `:app:connectedDebugAndroidTest` passed on `emulator-5554`, API 35, arm64-v8a, WebView `com.google.android.webview` `124.0.6367.219`; report: `android/app/build/reports/androidTests/connected/debug/index.html`.
- Full repository local CI passed on the Task 2 worktree at 2026-08-31T00:57:06+08:00 through 2026-08-31T00:57:12+08:00: Android JVM/build/signature verification, all root Node suites, and extension suite.
- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk` (SHA-256 `06954f38f7f6c1881a15aaf73733059850eb2ba300416870db1c772de2ee9377`). Release-like APK: `android/app/build/outputs/apk/release/app-release-unsigned.apk`.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 3 - Build correctness] Declared generated asset dependencies for Android lint tasks.**
   - **Found during:** Task 1 release-like assembly.
   - **Issue:** `assembleRelease` failed because lint consumed generated Listen1 assets without a declared dependency.
   - **Fix:** Made lint tasks depend on `syncListen1Assets`.
   - **Committed in:** `f3f3bba`

2. **[Rule 1 - RPC correlation] Preserved bounded request identity for typed parse errors.**
   - **Found during:** Task 2 API-35 bridge handshake.
   - **Issue:** A malformed typed operation lost its valid request ID and page epoch in the terminal reply.
   - **Fix:** Retained validated correlation fields in `ParseResult` and used them for safe error replies.
   - **Committed in:** `95128bb`

3. **[Rule 2 - Android package visibility] Declared only browsable HTTP(S) handler queries.**
   - **Found during:** Task 2 external handoff runtime test.
   - **Issue:** Android 11+ package visibility hid the installed browser resolver, preventing an approved safe URL from leaving WebView.
   - **Fix:** Added constrained HTTP/HTTPS browsable `<queries>` entries without adding permissions or custom scheme visibility.
   - **Committed in:** `95128bb`

## Known Limits

No live Bilibili/provider, CDN, codec, audible-progress, pause/resume, layout, or lyric-content claim is made here; those remain Plan 01-07’s API-35 live-provider gate.

## Self-Check: PASSED

- Confirmed commits `f3f3bba` and `95128bb` exist on `origin/agent/android-mobile-rebuild`.
- Confirmed the recorded APKs and connected-test report exist locally.
- Scanned modified source and tests for unresolved placeholder/TODO/FIXME markers; none were introduced.
