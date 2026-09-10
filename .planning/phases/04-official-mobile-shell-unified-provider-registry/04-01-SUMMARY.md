---
phase: 04-official-mobile-shell-unified-provider-registry
plan: "01"
subsystem: mobile-provider-registry
tags: [android, webview, classic-script, provider-registry, capability-projection, contracts]
requires:
  - phase: 03
    provides: typed Android provider and lyric boundary foundations
provides:
  - immutable Android source registry, opaque identity validator, and route-free semantic lifecycle
  - tested registry script manifest and exact Android asset allow-list inclusion
  - closed native capability-envelope regression coverage in the normal test chain
affects: [04-02, 04-03, Android provider selection, mobile search]
actuals:
  tokens: 9334
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [pure classic-script registry global, frozen capability projections, exact-shape lifecycle terminals]
key-files:
  created:
    - app/listen1_chrome_extension/js/mobile_provider_registry.js
    - app/listen1_chrome_extension/test/mobile_provider_registry.test.js
    - app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js
  modified:
    - app/listen1_chrome_extension/js/app.js
    - app/listen1_chrome_extension/js/loweb.js
    - app/listen1_chrome_extension/listen1.html
    - android/app/build.gradle
    - app/listen1_chrome_extension/package.json
    - android/app/src/test/java/com/dazzlingwuming/listen2/ProviderAdvancedCapabilityFacadeTest.java
key-decisions:
  - "Android primary order is netease, kugou, kuwo, qq, bilibili; Migu and Taihe remain registry-only unavailable."
  - "Provider work without an installed semantic route terminates synchronously as typed unavailable and never falls back to transport."
requirements-completed: [UI-003, NET-001, NET-002, SEC-001, SEC-002, SEC-003, TEST-001]
coverage:
  - id: D1
    description: Immutable five-source Android registry, opaque identity invariant, safe capability projection, and bounded semantic lifecycle.
    requirement: UI-003
    verification:
      - kind: unit
        ref: app/listen1_chrome_extension/test/mobile_provider_registry.test.js
        status: pass
    human_judgment: false
  - id: D2
    description: Registry loads before consumers and is copied only by the Android allow-list.
    requirement: SEC-001
    verification:
      - kind: unit
        ref: app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js
        status: pass
    human_judgment: false
  - id: D3
    description: Native capability handshake remains credential-free and unavailable providers stay closed.
    requirement: SEC-002
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/ProviderAdvancedCapabilityFacadeTest.java
        status: pass
    human_judgment: false
duration: 13min
completed: 2026-09-10
status: complete
---

# Phase 04 Plan 01: Official Mobile Provider Registry Summary

**A frozen five-source Android registry now owns official source order, opaque track identity, safe capability truth, and a provider-route-free exactly-once lifecycle.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-09-10T08:47:00Z
- **Completed:** 2026-09-10T08:58:49Z
- **Tasks:** 3/3
- **Files modified:** 9

## Accomplishments

- Added `MobileProviderRegistry` with Android order `netease, kugou, kuwo, qq, bilibili`; Migu/Taihe remain non-primary unavailable descriptors, while the desktop source order and provider instances remain compatible.
- Added bounded, injected-executor `search`, `directory`, `media`, `lyric`, and `login` semantic lifecycle coverage for unavailable, timeout, cancellation, destroy, stale, duplicate, and late replies.
- Loaded the registry before all consumers, copied it through the precise Android asset allow-list, and made both Wave-0 contracts part of `npm test`.
- Extended JVM-only assertions that unknown/registry-only providers and transport-shaped capability requests remain closed without changing native production code.

## Task Commits

1. **Task 1: Establish the unified mobile provider registry and route-free semantic lifecycle** — `48d55e5` (`feat`)
2. **Task 2: Load the registry before every consumer and copy it through the explicit Android asset allow-list** — `ae051f8` (`feat`)
3. **Task 3: Put both Wave-0 contracts in the normal test chain and lock native capability truth closed** — `9cb0059` (`test`)

## Verification

- `node app/listen1_chrome_extension/test/mobile_provider_registry.test.js` — PASS.
- `node app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js` — PASS.
- `node app/listen1_chrome_extension/test/android_rpc_contract.test.js` — PASS.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools gradle --no-daemon :app:testDebugUnitTest --tests '*ProviderAdvancedCapabilityFacadeTest' --tests '*HttpBridgePolicyTest' --tests '*AndroidRpcContractTest'` — PASS.
- Publication local CI was run before each commit and push on `agent/android-mobile-rebuild`; latest run began `2026-09-10T16:58:09+0800` at `9cb0059` and passed `(cd app/listen1_chrome_extension && npm test)` plus `(cd android && gradle --no-daemon :app:testDebugUnitTest)`.

No APK was assembled and no emulator acceptance was performed, as Phase 04 confines its inner loop to Node/JVM contracts. The local Android toolchain reported SDK XML version and Gradle 9 deprecation warnings; all required tests passed.

## Decisions Made

- Use one registry for Android source order and capability defaults; desktop provider instances and source order remain in the legacy compatibility view.
- Treat absent capability/executor input as a synchronous `OPERATION_UNAVAILABLE` terminal, with no provider, bridge, MediaService, or transport fallback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved existing standalone Node contract loading for loweb.js**
- **Found during:** Task 1 publication CI.
- **Issue:** Existing tests load `loweb.js` without the HTML script manifest, so direct registry-global access raised `ReferenceError`.
- **Fix:** Added a registry-presence guard; packaged HTML uses the registry, while standalone legacy tests retain their prior provider-prefix behavior.
- **Files modified:** `app/listen1_chrome_extension/js/loweb.js`.
- **Verification:** Full frontend suite and registry contract passed.
- **Committed in:** `48d55e5`.

**2. [Rule 1 - Bug] Used Android's JSONObject iterator API in the new JVM assertion**
- **Found during:** Task 3 focused JVM build.
- **Issue:** Android's JSONObject stub has no `keySet()` method.
- **Fix:** Collected bounded top-level keys through `keys()` before exact-set comparison.
- **Files modified:** `android/app/src/test/java/com/dazzlingwuming/listen2/ProviderAdvancedCapabilityFacadeTest.java`.
- **Verification:** Focused boundary JVM tests passed.
- **Committed in:** `9cb0059`.

**Total deviations:** 2 auto-fixed Rule 1 issues. No scope expansion or new network/native surface.

## Known Stubs

None introduced by this plan.

## Issues Encountered

The legacy HTML formatter rewrote unrelated large markup when invoked by the staged hook. The generated formatting was discarded for that specific task-owned file, the one intended script line was reapplied, and the manifest task was committed with only its three planned files after the repository-defined local CI passed.

## User Setup Required

None.

## Next Phase Readiness

Plan 04-02 can consume `MobileProviderRegistry` for the mobile shell and search integration. No live provider route, credential, or wider bridge capability has been added.

## Self-Check: PASSED

- All three created registry/contract files exist.
- All three task commits exist locally and were pushed to `origin/agent/android-mobile-rebuild`.
