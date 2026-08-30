---
phase: 02-native-media3-playback-background-control
plan: "03"
subsystem: android-playback-persistence
tags: [android, room, java, migration, playback, persistence]
requires:
  - phase: 02-native-media3-playback-background-control
    plan: "01"
    provides: Room 2.8.4 dependency graph and native-issued occurrence identities
  - phase: 02-native-media3-playback-background-control
    plan: "02"
    provides: duplicate-preserving queue, history, shuffle, and revision semantics
provides:
  - Room schema 1 for playback checkpoints and every DATA-001 record family
  - atomic revision/token checkpoint writes with ordered duplicate occurrences
  - API-35 migration, rollback, restore, and small-settings evidence
affects: [02-04, 02-05, 02-06, android-playback-service, durable-library]
actuals:
  tokens: 19333
  tasks: 2
  commits: 3
tech-stack:
  added: [androidx.room:room-testing:2.8.4]
  patterns: [Room transaction checkpoint, bounded logical identifiers, exported-schema migration test]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/data/Listen2Database.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackCheckpointRepository.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSettingsStore.java
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackPersistenceInstrumentationTest.java
    - android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackMigrationInstrumentationTest.java
    - android/schemas/com.dazzlingwuming.listen2.data.Listen2Database/1.json
  modified:
    - android/app/build.gradle
key-decisions:
  - "Room schema 1 stores logical Bilibili identity, occurrence order, context, history, modes, and bounded position only; transport and credential material have no schema field."
  - "A transition checks expected revision and replay token, then replaces checkpoint rows inside one Room transaction so stale or invalid state cannot partially persist."
  - "One application-scoped SharedPreferences wrapper owns only volumePercent and muted, leaving relational state to Room."
patterns-established:
  - "Persist queue entries by opaque occurrence identity, never provider ID, so duplicates retain independent ordering and history."
  - "Ship each Room schema export as an androidTest asset and open it with MigrationTestHelper before later migrations exist."
requirements-completed: [DATA-001, PLAY-004, PLAY-005, PLAY-006]
coverage:
  - id: D1
    description: "Schema 1 owns typed playlist, favorite, checkpoint, queue, lyric metadata, listening-history, cache-catalog, and SAF-reference tables with foreign keys and indices."
    requirement: DATA-001
    verification:
      - kind: integration
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackMigrationInstrumentationTest.java#schemaOneCreatesAllDurableTablesWithoutDestructiveFallback
        status: pass
      - kind: integration
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackMigrationInstrumentationTest.java#schemaHasNoTransportOrCredentialColumns
        status: pass
    human_judgment: false
  - id: D2
    description: "Revisioned checkpoint transitions atomically preserve duplicate occurrence order, modes, history, base context, shuffle state, and bounded position across restore."
    requirement: PLAY-004
    verification:
      - kind: integration
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackPersistenceInstrumentationTest.java#transitionIsAtomicIdempotentAndRestoresDuplicateOccurrences
        status: pass
      - kind: integration
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackPersistenceInstrumentationTest.java#failedTransitionRollsBackCheckpointQueueAndHistory
        status: pass
    human_judgment: false
  - id: D3
    description: "Volume and mute use one bounded non-sensitive settings store without accepting queue, metadata, transport, or secret-shaped keys."
    requirement: DATA-001
    verification:
      - kind: integration
        ref: android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackPersistenceInstrumentationTest.java#settingsAreSmallAndApplicationScoped
        status: pass
    human_judgment: false
duration: 11min
completed: 2026-08-30
status: complete
---

# Phase 2 Plan 03: Durable Playback Data Boundary Summary

**Room schema 1 now atomically preserves semantic playback checkpoints, occurrence-based queue/history state, and all DATA-001 record families without retaining media transport or credentials.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-30T19:58:49Z
- **Completed:** 2026-08-30T20:08:07Z
- **Tasks:** 2/2
- **Files modified:** 11

## Accomplishments

- Added migration-safe Room schema 1 with normalized queue occurrences, history, shuffle order, replay tokens, playlists/favorites, lyric metadata, listening history, cache catalog, and SAF references.
- Added `PlaybackCheckpointRepository`, which rejects stale revisions, makes transition tokens idempotent, bounds replay retention, and rolls invalid writes back as one transaction.
- Added API-35 instrumentation coverage for schema export/opening, transaction rollback, duplicate restore, secret-field scanning, and the isolated volume/mute settings wrapper.

## Task Commits

1. **Task 1: Persist playback semantics in one Room transaction** — `2efdeaf` (`feat`)
2. **Task 2: Prove schema 1, transaction rollback, restore, and small-settings isolation** — `ccb3b28` (`test`)
3. **Correctness completion for both tasks** — `1c597ec` (`fix`)

## Verification

- TDD RED: `:app:compileDebugAndroidTestJavaWithJavac` failed as expected before Room persistence types and the Android Room-test artifact existed.
- API-35 focused device gate: `:app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.dazzlingwuming.listen2.PlaybackPersistenceInstrumentationTest,com.dazzlingwuming.listen2.PlaybackMigrationInstrumentationTest` — PASS, 5 tests.
- Full local CI: PASS at `2026-08-31T04:08:01+0800` through `2026-08-31T04:08:07+0800`: Android JVM/debug APK/signature verification, six desktop suites, and the extension suite.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Routed Room's exported schema to the planned checked baseline and test assets.**

- **Found during:** Task 2
- **Issue:** the existing annotation-processor path emitted schemas under `android/app/schemas`, while the plan's migration baseline is `android/schemas`; Android tests also lacked the Room migration helper artifact.
- **Fix:** emitted schemas into `android/schemas`, packaged that directory as androidTest assets, and added the existing pinned Room test artifact to androidTest.
- **Files modified:** `android/app/build.gradle`
- **Verification:** MigrationTestHelper created and reopened schema 1 on API 35.
- **Committed in:** `ccb3b28`

**2. [Rule 1 - Bug] Completed durable restore state and relational integrity before publication.**

- **Found during:** Task 2 review
- **Issue:** the initial checkpoint projection omitted shuffle/base-context restoration and logical provider references, while checkpoint pointers were not foreign-key constrained.
- **Fix:** added shuffle rows/index, bounded provider/domain references, current/base occurrence foreign keys, and complete restoration assertions.
- **Files modified:** `PlaybackEntities.java`, `Listen2Dao.java`, `Listen2Database.java`, `PlaybackCheckpointRepository.java`, persistence test, schema export.
- **Verification:** focused API-35 persistence/migration suite passed after the correction.
- **Committed in:** `1c597ec`

**Total deviations:** 2 auto-fixed (1 blocking build/test seam, 1 correctness defect).

## Known Stubs

None. Candidate URLs, headers, cookies, raw provider bodies, secrets, and arbitrary paths have no entity or repository field.

## Next Phase Readiness

- The MediaSession coordinator can now atomically checkpoint accepted queue-engine transitions and restore a paused/actionable logical state before it requests fresh provider descriptors.
- This plan does not itself supply MediaSessionService, notification, Bluetooth/focus, or live provider proof; those remain downstream Phase 2 work and the preserved Phase 1 provider evidence remains blocked.

## Self-Check: PASSED

- All eleven planned source/test/schema artifacts exist and commits `2efdeaf`, `ccb3b28`, and `1c597ec` are pushed on `agent/android-mobile-rebuild`.
- Focused API-35 device tests and the final complete local CI gate passed at the final source snapshot.

---

*Phase: 02-native-media3-playback-background-control*
*Completed: 2026-08-30*
