---
phase: 06-personal-library-continuity
plan: "02"
subsystem: mobile-library-cutover
tags: [react-native, redux, room, migration, bridge]
requires: [06-01]
provides: [room-projection-hydration, reversible-legacy-handoff]
affects: [06-03, 06-04, 06-05, 06-07]
tech-stack:
  added: []
  patterns: [allow-listed-native-client, monotonic-revision-projection, retained-source-migration]
key-files:
  created: [mobile/src/library/libraryClient.ts, mobile/src/library/LibraryBootGate.tsx, mobile/src/library/legacyMigration.ts]
  modified: [mobile/src/store/index.ts, mobile/src/store/librarySlice.ts, mobile/src/store/playerPersistence.ts, mobile/android/app/src/main/java/com/listen2mobile/library/LibraryBridge.kt]
decisions:
  - Redux library state is a Room-derived projection and is no longer persisted by redux-persist.
  - Migration uses one named AsyncStorage key, a fixed safe DTO, and retained-source status instead of generic storage access.
  - Local document grants never survive player persistence; restart always restores paused.
metrics:
  duration: 94m
  completed: 2026-09-15
actuals:
  tokens: 11968
  tasks: 3
  commits: 3
status: complete
---

# Phase 06 Plan 02: Redux cutover and reversible legacy handoff Summary

Room now owns durable library data, while the React Native store hydrates a bounded confirmed projection and legacy persisted state can be copied without exposing playback URLs or document grants.

## Completed Work

- Added strict snapshot, receipt, migration-status and mutation DTO parsing with request/revision correlation, stale-reload coalescing and monotonic projection updates.
- Removed the library reducer from Redux Persist and added a retryable Room hydration gate before navigation renders library controls.
- Added a named-key legacy exporter, a paused URL-free player boundary, and a narrow native `beginLegacyMigration` contract with attempt/checksum correlation and retained-source status.

## Verification

- `npm run mobile:test` — 36 suites, 229 tests passed.
- `npm run mobile:typecheck` — passed.
- `npm --prefix mobile run lint -- --quiet` — passed.
- `git diff --check` — passed.
- JDK 17 / SDK offline `:app:testDebugUnitTest :app:compileDebugAndroidTestKotlin` — passed; instrumentation was compiled only, not installed or run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Contract drift] Adapted the TypeScript client to the existing 06-01 native mutation envelope and receipt statuses.**
- **Found during:** Task 3.
- **Issue:** The initial client sent its internal mutation shape while `LibraryBridge` requires the fixed `schemaVersion/requestId/expectedRevision/operation/payload` envelope and returns `applied`/`stale` statuses.
- **Fix:** Translate only the allow-listed create-playlist mutation at the client boundary and normalize native statuses before they reach Redux.
- **Files modified:** `mobile/src/library/libraryClient.ts`, `mobile/src/library/__tests__/libraryRepositoryClient.test.ts`.
- **Commit:** `0afac26`.

**2. [Rule 2 - Missing critical functionality] Added the authorized fixed-schema native migration entry point.**
- **Found during:** Task 3.
- **Issue:** 06-01 exposed only migration status, so the actual known legacy payload could not start a copy or correlate an attempt/checksum.
- **Fix:** Added `beginLegacyMigration` for only `{schemaVersion, attemptId, checksum, playlists, localEntries}`; it recursively rejects unsafe fields, validates FNV-1a correlation, preserves the legacy source, and returns status without raw payloads or native handles.
- **Files modified:** `mobile/android/app/src/main/java/com/listen2mobile/library/LibraryBridge.kt`, `mobile/android/app/src/main/java/com/listen2mobile/library/LegacyLibraryMigration.kt`, `mobile/android/app/src/test/java/com/listen2mobile/library/LibraryBridgeContractTest.kt`.
- **Commit:** `0afac26`.

## Known Stubs

- `mobile/src/store/librarySlice.ts`: legacy screen action creators remain intentional no-op compatibility actions while Phase 06-03 rewires those screens to receipt-backed `libraryClient` commands. They cannot write a competing persisted library backend.

## Remaining Boundary

No APK, emulator, live-provider, or instrumentation execution was performed. Phase 06-03 owns receipt-backed screen commands and backup UI; Phase 06-07 is the controlled instrumentation phase, and Phase 08 owns final APK/API 35/live verification.

## Self-Check: PASSED

- Confirmed commits `7b67b7a`, `b24dc8d`, and `0afac26` exist.
- Confirmed all listed library client, gate, migration, projection, Redux, and native bridge files exist.
