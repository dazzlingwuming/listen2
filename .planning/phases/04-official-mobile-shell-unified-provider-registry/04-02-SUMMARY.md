---
phase: 04-official-mobile-shell-unified-provider-registry
plan: "02"
subsystem: mobile-ui
tags: [android, angularjs, provider-registry, semantic-lifecycle, accessibility]
requires:
  - phase: 04-01
    provides: ordered provider registry and bounded semantic operation lifecycle
provides:
  - Android registry-driven five-source search lifecycle
  - Official phone search hierarchy with one safe state surface
  - VM and DOM contracts for capability and stale-reply safety
affects: [04-03, phase-05-search, android-mobile-shell]
actuals:
  tokens: 9814
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - registry-projected Angular search state
    - route-free semantic lifecycle adapter
key-files:
  created: []
  modified:
    - app/listen1_chrome_extension/js/controller/instant_search.js
    - app/listen1_chrome_extension/listen1.html
    - app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js
key-decisions:
  - "Android search selects NetEase first and projects all five primary sources from MobileProviderRegistry."
  - "The shared semantic lifecycle owns deadline, cancellation, stale-reply, and exactly-once terminal settlement; only the existing search seam is dispatched."
requirements-completed: [UI-001, UI-003, NET-002, SEC-003, TEST-001]
coverage:
  - id: D1
    description: Registry-driven Android source selection and bounded search lifecycle.
    requirement: NET-002
    verification:
      - kind: unit
        ref: app/listen1_chrome_extension/test/mobile_provider_registry.test.js
        status: pass
      - kind: integration
        ref: app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js
        status: pass
    human_judgment: false
  - id: D2
    description: Official phone search selector and safe state surface.
    requirement: UI-001
    verification:
      - kind: automated_ui
        ref: app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js
        status: pass
    human_judgment: true
    rationale: Final phone layout, IME, safe-area, TalkBack, and touch verification require Phase 8 API 35 acceptance.
duration: 10min
completed: 2026-09-10
status: complete
---

# Phase 04 Plan 02: Unified Search Lifecycle and Phone State Surface Summary

**Android now projects the official NetEase/Kugou/Kuwo/QQ/Bilibili selector through one bounded semantic search lifecycle and one accessible, source-labelled result surface.**

## Performance

- **Duration:** 10 min
- **Tasks:** 2/2
- **Files modified:** 3
- **Publication CI:** frontend suite, Android JVM tests, and debug assemble passed before both task publications.

## Accomplishments

- Replaced the Android-only two-source filter and Bilibili primary state with registry-derived five-source selection and a generic `providerSearch` record.
- Delegated request identity, deadline, cancellation, destroy, stale reply, and exact terminal handling to `createSemanticOperationLifecycle`; absent capabilities never dispatch `MediaService.search`.
- Replaced the Bilibili-only phone search block with a labelled query field, horizontal tablist, four-row loading state, one safe result/recovery region, and retained Bilibili parts as a nested child layer.
- Added VM and DOM coverage for default pending NetEase selection, unavailable no-dispatch, cancellation, source order, safe copy, and primary-tab exclusion of Migu/Taihe.

## Task Commits

1. **Task 1: Bind Android search to the route-free five-operation semantic lifecycle** — `ba26695` (`feat`)
2. **Task 2: Render the official phone hierarchy, five-source selector, and one safe result-state surface** — `f28e49d` (`feat`)

## Decisions Made

- Android only uses the registry's five primary sources in the phone selector, with NetEase visibly selected while capabilities settle.
- Search preserves the legacy desktop callback route; Bilibili details remain a bounded result child and no Phase 5 route, native RPC, credential flow, or playback ownership was introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Lint] Replaced nested expressions and a dynamic test import rejected by the frontend hook.**
- **Found during:** Task 1 commit
- **Fix:** Used explicit capability-state branches and a top-level VM import.
- **Verification:** ESLint, the focused contracts, the frontend suite, Android JVM tests, and debug assembly passed.

### Execution Adjustment

The TDD RED test was run and failed as expected, but was not committed separately: the repository's mandatory local-CI gate forbids publishing an intentionally failing commit. The succeeding implementation and test contract were committed atomically.

## Verification

- `node app/listen1_chrome_extension/test/mobile_provider_registry.test.js` — passed
- `node app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js` — passed
- `npm --prefix app/listen1_chrome_extension test` — passed
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug` — passed

## Known Stubs

None. The Phase 4 selector intentionally exposes unavailable capabilities as explicit registry-derived states; it does not fabricate route results.

## Next Phase Readiness

Plan 04-03 can refine navigation and visual contracts against the stable `providerSearch` state. Final device/visual acceptance remains unverified and is owned by Phase 8.

## Self-Check: PASSED

- All three plan-owned source/test files exist.
- Both task commits are present in Git history.
