---
phase: 04-official-mobile-shell-unified-provider-registry
fixed_at: 2026-09-10T18:33:32+08:00
review_path: .planning/phases/04-official-mobile-shell-unified-provider-registry/04-REVIEW.md
iteration: 3
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
verification_location: isolated worktree (/tmp/sv-04-reviewfix-dQazqN), then main checkout for final focused recheck and push
publication_status: passed
---

# Phase 04: Code Review Fix Report

**Fixed at:** 2026-09-10T18:33:32+08:00
**Source review:** `.planning/phases/04-official-mobile-shell-unified-provider-registry/04-REVIEW.md`
**Iteration:** 3

## Summary

- Findings in scope: 3
- Fixed: 3
- Skipped: 0
- Source commit: `7ca8138` (`fix(04): isolate mobile search and shell`), pushed to `origin/agent/android-mobile-rebuild`.

## Fixed Issues

### CR-01: Android and desktop search surfaces rendered together

**Files modified:** `app/listen1_chrome_extension/listen1.html`, `app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js`, `app/listen1_chrome_extension/test/mobile_ui_contract.test.js`
**Commit:** `7ca8138`

The Android provider surface now requires `isAndroidTyped()`, while the legacy search page requires its inverse. The old `allmusic` guard no longer calls the undefined `isAndroidSurface()` from `InstantSearchController`; Android cannot render the legacy all-music or playlist search controls.

### CR-02: Mobile CSS was incomplete and relied on `@scope`

**Files modified:** `app/listen1_chrome_extension/css/redesign.css`, `app/listen1_chrome_extension/test/mobile_ui_contract.test.js`
**Commit:** `7ca8138`

Every Phase 04 shell selector and the earlier 946–1156 Android narrow-search selector now has an explicit `html[data-listen2-platform='android']` prefix. The critical shell no longer uses `@scope`, retaining a parseable platform boundary for supported minSdk 26 WebViews while leaving unmarked narrow Electron geometry untouched.

### WR-01: Contract tests missed cross-platform render and full-file CSS regressions

**Files modified:** `app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js`, `app/listen1_chrome_extension/test/mobile_ui_contract.test.js`
**Commit:** `7ca8138`

Added test-first Android/Electron surface-gating assertions and complete-file CSS platform-root assertions. They failed before the implementation and pass against the committed source.

## Verification

The source gates ran in the **isolated worktree**. The initial root-cache attempt there could not resolve the pre-existing nested `app` dependency `music-metadata`; it was rerun against the same worktree source with the main checkout's existing dependency directories on `NODE_PATH`, without installing, changing, or committing dependencies. The final focused recheck and push ran from the **main checkout** after the fast-forward.

- `node test/mobile_provider_registry.test.js && node test/android_mobile_shell_registry.test.js && node test/mobile_ui_contract.test.js` — PASS (focused; 2026-09-10T18:31:35+08:00 to 18:31:36+08:00 for the included full frontend rerun).
- `npm run test:bilibili && npm run test:desktop-cache && npm run test:loudness && npm run test:desktop-lyric && npm run test:machine-translation && npm run test:listening-history` — PASS (2026-09-10T18:31:01+08:00 to 18:31:03+08:00; source worktree, with pre-existing main checkout dependencies supplied via `NODE_PATH`).
- `npm test` in `app/listen1_chrome_extension` — PASS (2026-09-10T18:31:35+08:00 to 18:31:36+08:00).
- `env JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug` in `android` — PASS (2026-09-10T18:31:08+08:00 to 18:31:22+08:00).
- `env JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools /opt/homebrew/share/android-commandlinetools/build-tools/35.0.0/apksigner verify --verbose app/build/outputs/apk/debug/app-debug.apk` — PASS (2026-09-10T18:31:27+08:00); v2 signing verified.
- `git diff --check`, the Husky pre-commit hook, and the pre-push hook — PASS. The worktree's hook launcher lacked its nested local executable, so the hook was run—not skipped—through a temporary external command-path shim that delegated to the main checkout's installed `husky-run` and performed the repository's configured `lint-staged` checks.

Coverage limit: API 35 emulator end-to-end acceptance was not run by these local unit/build gates.

---

_Fixed: 2026-09-10T18:33:32+08:00_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 3_
