---
phase: 06-personal-library-continuity
plan: "05"
subsystem: android-local-media
tags: [android, saf, content-provider, rntp, privacy]
dependency_graph:
  requires: [06-04]
  provides: [opaque-local-playback, repairable-local-records]
  affects: [mobile-player, personal-library]
tech_stack:
  added: [Android ContentProvider, bounded in-memory playback tokens]
  patterns: [native-private SAF ownership, transient RNTP handoff, post-commit grant release]
key_files:
  created:
    - mobile/android/app/src/main/java/com/listen2mobile/local/LocalMediaPolicy.kt
    - mobile/android/app/src/main/java/com/listen2mobile/local/LocalMediaProvider.kt
  modified:
    - mobile/android/app/src/main/java/com/listen2mobile/local/LocalAudioModule.kt
    - mobile/src/player/playerController.ts
    - mobile/src/screens/MyMusicScreen.tsx
decisions:
  - Provider tokens are short-lived, single-use, and resolve to native-private SAF associations only.
  - RNTP remains the sole player; its temporary provider URI is never persisted in JS or Room.
  - Local removal deletes Listen2 relationships and releases access after Room commit without deleting the source document.
metrics:
  completed: 2026-09-15
status: complete
actuals:
  tokens: 12654
  tasks: 3
  commits: 1
---

# Phase 06 Plan 05: Private Local Playback Lifecycle Summary

Opaque local records now enter the existing RNTP player through a one-use, app-private read-only provider, with repair and removal preserving user data boundaries.

## Delivered

- Added a non-exported `${applicationId}.local-media` provider with exact `play/<token>` validation, read-only descriptors, bounded token lifetime/count/use, and no generic provider operations.
- Kept SAF document identities and persisted grants native-private; JavaScript receives a private URI only at the matching RNTP handoff and never stores it in the semantic player state.
- Added truthful local availability states and seekability projection. Non-seekable records can remain sequentially playable while seeks are rejected.
- Added controlled repair and removal methods. Repair retains the opaque record identity and library relationships; removal clears semantic local references and releases access only after the database transaction, without calling a source-delete API.
- Added My Music repair/reselect and destructive removal confirmation: `从本地音乐移除？只会移除 Listen2 记录，不会删除设备上的原文件。`

## Verification

- `npm run mobile:test` — passed: 40 suites, 236 tests.
- `npm run mobile:typecheck` — passed.
- `npm --prefix mobile run lint -- --quiet` — passed.
- `git diff --check` — passed.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH ./mobile/android/gradlew --offline --no-daemon -p mobile/android :app:clean :app:testDebugUnitTest :app:compileDebugAndroidTestKotlin` — passed.

The instrumentation target was source-compiled but not executed: the plan explicitly reserves controlled provider fixture execution for after 06-07, and this execution was constrained not to launch an emulator, install an APK, or run live instrumentation.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 3 - Blocking build cache] Regenerated Room's stale KAPT output with the scoped Gradle `:app:clean` task before the required offline unit/instrumentation compilation.
- **Found during:** Final JVM/instrumentation compile.
- **Issue:** Cached generated `LibraryDao_Impl` did not include the newly added DAO method.
- **Fix:** Cleared only generated app build output through Gradle and reran the required verification.
- **Commit:** 47efd74

## Known Stubs

None. The instrumentation fixture is intentionally compile-only until its explicitly scheduled controlled execution phase.

## Self-Check: PASSED

- Confirmed provider, policy, native bridge, RNTP controller, and UI files exist in commit `47efd74`.
- Confirmed `47efd74` exists on `agent/android-mobile-rebuild` and was pushed to `origin/agent/android-mobile-rebuild`.
