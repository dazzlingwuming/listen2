---
phase: 04-official-mobile-shell-unified-provider-registry
plan: "03"
subsystem: mobile-ui
tags: [android, angularjs, navigation, accessibility, css]
requires:
  - phase: 04-01
    provides: ordered provider registry and bounded semantic operation lifecycle
  - phase: 04-02
    provides: registry-driven phone search surface and child-detail ownership
provides:
  - nearest-layer Android Back coordination without a second router
  - mobile shell geometry and accessibility contracts for compact viewports
  - deterministic Back and CSS regression coverage
affects: [phase-05-search, phase-08-api35-acceptance, android-mobile-shell]
actuals:
  tokens: 4557
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - mutable handled-event Back delegation
    - terminal max-width mobile CSS contract
    - VM-loaded AngularJS controller contract
key-files:
  created: []
  modified:
    - app/listen1_chrome_extension/js/controller/navigation.js
    - app/listen1_chrome_extension/css/redesign.css
    - app/listen1_chrome_extension/test/mobile_ui_contract.test.js
key-decisions:
  - "System Back blurs the active phone search, closes confirmation and child layers nearest-first, then falls through to the existing Activity policy."
  - "The terminal 760px rule owns 64px dock/tab geometry, safe-area clearance, single-row source selection, and motion/accessibility backstops."
requirements-completed: [UI-001, UI-002, UI-003, NET-002, SEC-001, TEST-001]
coverage:
  - id: D1
    description: Nearest-layer Android Back preserves query, player, and top-level context while cancelling a closed owner.
    requirement: UI-001
    verification:
      - kind: unit
        ref: app/listen1_chrome_extension/test/mobile_ui_contract.test.js#testNearestLayerBack
        status: pass
    human_judgment: false
  - id: D2
    description: Fixed phone shell geometry, compact text, selector, focus, safe-area, landscape, and reduced-motion contracts.
    requirement: UI-002
    verification:
      - kind: automated_ui
        ref: app/listen1_chrome_extension/test/mobile_ui_contract.test.js
        status: pass
    human_judgment: true
    rationale: Real-device WebView perception, IME geometry, TalkBack, rotation, and touch target use remain Phase 8 acceptance work.
duration: 16min
completed: 2026-09-10
status: complete
---

# Phase 04 Plan 03: Mobile Back and Accessibility Shell Summary

**Android’s shared phone shell now closes the nearest active layer safely and keeps compact, large-text layouts reachable above fixed playback and navigation surfaces.**

## Performance

- **Duration:** 16 min
- **Tasks:** 2/2
- **Files modified:** 3
- **Publication CI:** frontend suite, Android JVM tests, debug APK assembly, and v2 APK-signature verification passed before both task publications.

## Accomplishments

- Refactored the existing Android Back callback into an ordered coordinator: focused search/IME, confirmation, playback child, full player, search detail, product layer, real child route, then Activity fallthrough.
- Invalidated product-layer local replies and broadcast a cancel-capable owner event before hiding the layer; no native route, transport, or playback owner was added.
- Applied a terminal `max-width: 760px` phone contract for 64px fixed surfaces, all safe-area edges, one-column sheet actions, 48px controls, non-wrapping source selection, landscape overflow, focus visibility, 320px truncation, and reduced motion.
- Added VM and source-level regressions that prove Back ordering, handled fallthrough, compact geometry, selector behavior, focus, and motion rules.

## Task Commits

1. **Task 1: Delegate system Back through the nearest phone layer and cancel its owned work** — `9c10641` (`feat`)
2. **Task 2: Enforce the phone shell geometry, touch, typography, focus, and motion contract** — `0ef1bfc` (`style`)

## Decisions Made

- Preserve Media3 as the sole playback owner; the shared callback only asks layer owners to consume Back and never changes playback state directly.
- Keep a clean top-level Back unhandled so the existing Android Activity remains the only exit/lifecycle policy.
- Limit responsive changes to the final mobile media-query block, leaving desktop rules above 760px unchanged.

## Verification

- `node app/listen1_chrome_extension/test/mobile_ui_contract.test.js` — passed during both focused loops.
- `npm --prefix app/listen1_chrome_extension test` — passed before both task commits and pushes.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug -p android` — passed before both task commits and pushes.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools /opt/homebrew/share/android-commandlinetools/build-tools/35.0.0/apksigner verify --verbose android/app/build/outputs/apk/debug/app-debug.apk` — passed (v2 signature).

Real-device WebView perception, IME geometry, TalkBack, rotation, and touch behavior remain **not verified** and are owned by Phase 8.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Lint] Avoided direct mutation of the Back-event callback parameter in the VM contract.**
- **Found during:** Task 1 commit hook.
- **Fix:** Used an equivalent object update accepted by the repository ESLint rule.
- **Files modified:** `app/listen1_chrome_extension/test/mobile_ui_contract.test.js`.
- **Verification:** Focused contract and full frontend/JVM/APK publication gates passed.
- **Committed in:** `9c10641`.

**Total deviations:** 1 auto-fixed Rule 1 issue. No security boundary, provider route, or native architecture expansion occurred.

## Issues Encountered

The first APK signature invocation did not inherit the required JDK 17 runtime. Re-running the complete gate with `JAVA_HOME` set for `apksigner` passed; no source change was required.

## Known Stubs

None introduced by this plan.

## Next Phase Readiness

Phase 5 can rely on one Back coordinator and a stable phone shell contract while completing source journeys. Integrated device-only accessibility and perception evidence remains pending Phase 8.

## Self-Check: PASSED

- All three plan-owned source/test files exist.
- Task commits `9c10641` and `0ef1bfc` exist locally and were pushed to `origin/agent/android-mobile-rebuild`.
