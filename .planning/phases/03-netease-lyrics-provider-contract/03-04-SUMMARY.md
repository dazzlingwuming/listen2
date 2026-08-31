---
phase: 03-netease-lyrics-provider-contract
plan: "04"
subsystem: database
tags: [android, room, lyrics, migration, api35]
requires:
  - phase: 03-01
    provides: closed lyric persistence operations and semantic identity fields
  - phase: 02-03
    provides: Room migration and expected-revision transaction pattern
provides:
  - exact-identity Room lyric selection and offset authority
  - schema 1-to-2 migration with exported Room schema
  - bounded, privacy-scanned lyric persistence tests on API 35
affects: [03-05-lyric-ui, 03-08-live-evidence]
actuals:
  tokens: 17081
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [semantic-only-port, exact-identity-room-transaction, key-local-corruption-recovery]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/data/LyricRecord.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/data/LyricRepository.java
    - android/schemas/com.dazzlingwuming.listen2.data.Listen2Database/2.json
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/data/Listen2Database.java
key-decisions:
  - "The bridge converts closed NetEase lyric RPCs to semantic value objects before Room sees them."
  - "Exact source/track/part/lyric-revision keys and expected semantic revisions scope every mutation."
requirements-completed: [LYR-001, LYR-002, LYR-003]
coverage:
  - id: D1
    description: Native Room stores and restores exact-identity manual lyric choice and bounded offset.
    requirement: LYR-002
    verification:
      - kind: e2e
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/LyricPersistenceInstrumentationTest.java#manualSelectionAndOffsetRoundTripWithoutCrossIdentityMutation
        status: pass
    human_judgment: false
  - id: D2
    description: Schema 1 migrates non-destructively to schema 2 and excludes transport, credentials, provider bodies, and personal paths.
    requirement: LYR-002
    verification:
      - kind: e2e
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/LyricMigrationInstrumentationTest
        status: pass
    human_judgment: false
  - id: D3
    description: Invalid, stale, and corrupt lyric state cannot partially mutate or resurrect a current lyric view.
    requirement: LYR-003
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/LyricRepositoryValidationTest
        status: pass
      - kind: e2e
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/LyricPersistenceInstrumentationTest#invalidAndCorruptRecordsCannotResurrect
        status: pass
    human_judgment: false
duration: 18min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 04: Room lyric persistence summary

**Android now keeps manual lyric selections, offsets, revision conflicts, and corruption recovery in a migration-tested semantic Room record rather than WebView storage.**

## Performance

- **Duration:** 18 min
- **Completed:** 2026-08-31
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Replaced the unavailable persistence seam with an injected, semantic-only Room repository.
- Added schema 2 with a non-destructive migration from the checked schema-1 asset and retained `lyric_metadata`.
- Proved API-35 manual/automatic precedence, exact-key clear, revision conflicts, offset bounds, privacy scanning, and one-key corruption removal.

## Task commits

1. Task 1 — `6269bbf`: native lyric selection persistence and bridge injection.
2. Task 2 — `66e0911`: schema 1-to-2 migration and privacy instrumentation proof.
3. Task 3 — `37402ab`: validation, exact-key clear, and corruption recovery tests.

## Decisions made

- The durable port uses narrow value objects; it cannot accept URLs, headers, cookies, provider bodies, or arbitrary JSON.
- A malformed stored record is deleted only for its exact identity and returns a recoverable typed error rather than a raw Room/SQLite failure.

## Deviations from plan

### Auto-fixed issues

1. [Rule 2 - correctness] Replaced the original package-private bridge-only persistence interface with semantic public value objects.
   - **Found during:** Task 1.
   - **Issue:** A repository in the `data` package cannot safely implement a port whose request/reply types are package-private bridge internals.
   - **Fix:** Kept the port narrow and converted the already closed RPC payload at the bridge boundary.
   - **Verification:** API-35 persistence instrumentation and full local CI passed.
   - **Committed in:** `6269bbf`.

2. [Rule 1 - bug] Qualified Room annotations in the nested lyric entity.
   - **Found during:** Task 1 compilation.
   - **Issue:** Nested `Entity` and `Dao` names shadowed Room annotations.
   - **Fix:** Used explicit Room annotation names.
   - **Verification:** Android compilation, API-35 instrumentation, and full local CI passed.
   - **Committed in:** `6269bbf`.

**TDD note:** The repository-level red test was not separately committed because the project publication rule requires a fully passing local CI before every commit. The focused test was created and verified with the implementation in the same publishable commit.

## Verification

- API 35 emulator `emulator-5554`: both lyric persistence and migration instrumentation suites passed after installing the exact debug and androidTest APKs.
- Full local CI passed before each of `6269bbf`, `66e0911`, and `37402ab`: Android unit tests/build/signature plus every repository Node/frontend suite.
- No live provider request, merge, deployment, release signing, or Phase 1 evidence mutation occurred.

## Known stubs

None.

## Next phase readiness

Phase 03 lyric UI can read the injected persistence result and render manual/automatic state without using Android WebView localStorage as its durable source. Live provider lyrics remain a separate Phase 03 evidence gate.

## Self-check: PASSED

- Required entity, repository, schema export, instrumentation tests, and commits `6269bbf`, `66e0911`, and `37402ab` exist on the pushed branch.
