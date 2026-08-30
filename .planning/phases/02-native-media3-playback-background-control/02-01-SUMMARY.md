---
phase: 02-native-media3-playback-background-control
plan: "01"
subsystem: android-playback-protocol
tags: [android, media3, room, java, webmessage, security]
requires:
  - phase: 01-verified-bilibili-startup-slice
    provides: bounded provider descriptors and an origin-restricted WebMessage boundary
provides:
  - API-35-compatible Media3 1.9.4 and Room 2.8.4 dependency graph
  - Immutable closed command and sanitized snapshot contracts for native playback
  - Native-minted prepared selection and occurrence identities with revision checks
affects: [02-02, 02-03, 02-04, 02-05, android-playback-service, webview-playback-adapter]
actuals:
  tokens: 11053
  tasks: 2
  commits: 2
tech-stack:
  added: [androidx.media3:media3-exoplayer:1.9.4, androidx.media3:media3-session:1.9.4, androidx.room:room-runtime:2.8.4, androidx.room:room-testing:2.8.4]
  patterns: [pure-Java closed-schema bridge policy, revisioned allow-listed snapshot projection]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackCommand.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackBridgePolicy.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgePolicyTest.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackDependencyProbeTest.java
  modified:
    - android/app/build.gradle
key-decisions:
  - "All Media3 modules use the API-35-compatible 1.9.4 line; no compileSdk upgrade or DataStore dependency was introduced."
  - "The page can prepare only a Bilibili audio selection; native mints opaque track and occurrence identities before selection."
  - "Snapshots use an explicit safe projection and never serialize transport, credential, provider-body, or MediaItem-shaped fields."
patterns-established:
  - "Validate complete page envelopes before coordinator dispatch and reject unknown fields with stable codes."
  - "Use occurrence identity rather than provider identity for queue mutations and replay protection."
requirements-completed: [PLAY-001, PLAY-003, DATA-001]
coverage:
  - id: D1
    description: API-35-compatible Media3 and Room graph compiles through the public service, player, database, and migration-test types.
    requirement: PLAY-001
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackDependencyProbeTest.java#resolvesThePinnedNativePlaybackAndPersistenceApis
        status: pass
      - kind: other
        ref: "Gradle dependencyInsight and compileDebugJavaWithJavac on API 35"
        status: pass
    human_judgment: false
  - id: D2
    description: Native playback bridge accepts only revision-aware, exact command schemas and mints the prepared selection identities consumed by selectPrepared.
    requirement: PLAY-003
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgePolicyTest.java#mintsOpaqueSelectionIdentityAndRequiresItForSelection
        status: pass
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgePolicyTest.java#rejectsStaleRevisionEpochReplayedPairsAndCallerChosenIds
        status: pass
    human_judgment: false
  - id: D3
    description: Safe snapshots expose only allow-listed playback metadata, queue identities, controls, and recovery state.
    requirement: DATA-001
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgePolicyTest.java#serializesOnlyBoundedSafeSnapshotFields
        status: pass
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgePolicyTest.java#acceptsExactPrepareBoundariesAndRejectsAllTransportLikePayloadFields
        status: pass
    human_judgment: false
duration: 46min
completed: 2026-08-30
status: complete
---

# Phase 2 Plan 01: Native Playback Contract Summary

**API-35-native Media3/Room foundation with a closed, revisioned WebView-to-playback command boundary and sanitized snapshot projection.**

## Performance

- **Duration:** 46 min
- **Started:** 2026-08-30T18:59:00Z
- **Completed:** 2026-08-30T19:45:27Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- Pinned one compatible Media3 1.9.4 graph and Room 2.8.4 Java annotation-processing/migration-test graph under compile SDK 35.
- Added an immutable, Android-free command contract and policy that validates exact envelopes, page epochs, revisions, bounds, and native-issued occurrence identities.
- Added a snapshot DTO with an explicit page-safe projection plus JVM tests for stale/replayed selections and every transport-shaped forbidden field.

## Task Commits

1. **Task 1: Resolve the API-35 Media3 and Room graph before implementation** — `c3e9187` (`chore`)
2. **Task 2: Freeze the allow-listed command and revisioned snapshot protocol** — `6cfebfb` (`feat`)

## Files Created/Modified

- `android/app/build.gradle` — Media3/Room versions, Room compiler, migration testing, and schema location.
- `android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackCommand.java` — immutable validated coordinator command DTO.
- `android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java` — versioned safe playback projection DTO.
- `android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackBridgePolicy.java` — closed schema, identity minting, revision, and safe-error policy.
- `android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackDependencyProbeTest.java` — compile-level dependency tracer.
- `android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgePolicyTest.java` — contract boundaries, stale-state, and sensitive-field tests.

## Decisions Made

- Kept all Media3 artifacts at 1.9.4 because it resolves on the project’s Java 17/compile SDK 35 baseline; no API 36 toolchain change was made.
- Made `prepareSelection` the only command that can receive source track data. It produces opaque native `trackHandle`/`occurrenceId` values, and `selectPrepared` can only consume the exact minted pair.
- Kept the bridge Android-free and map-based so JVM tests can prove the trust boundary before it is connected to the existing WebMessage listener.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Retried transient Maven TLS retrieval during the first compile verification.**

- **Found during:** Task 1
- **Issue:** Gradle temporarily could not retrieve Guava while resolving the new Media3 graph because Maven Central terminated the TLS handshake.
- **Fix:** Retried the identical repository-authoritative Gradle compile command; dependency retrieval then succeeded without changing dependency sources or versions.
- **Verification:** Dependency insight reported Media3 1.9.4 and Room 2.8.4; Java compilation passed.
- **Committed in:** `c3e9187`

---

**Total deviations:** 1 auto-fixed (1 transient blocking environment issue)
**Impact on plan:** No product scope, dependency, security, or toolchain change.

## Issues Encountered

- The expected TDD red phase first failed compilation because the new public APIs were absent, then passed after implementation.

## Known Stubs

None. The protocol is intentionally a pure validation/projection seam; service dispatch, Room persistence, and WebMessage integration are assigned to later Phase 2 plans.

## User Setup Required

None — no account, signing secret, provider credential, or external service configuration was introduced.

## Next Phase Readiness

- Later Phase 2 plans can build the MediaSessionService, Room coordinator, and WebView adapter on one stable command/snapshot contract.
- This plan does not claim live background playback or provider audio verification; those remain explicit downstream emulator gates.

## Self-Check: PASSED

- All six production/test artifacts exist and both task commits are present on `agent/android-mobile-rebuild`.
- The final full local CI gate passed at the committed source snapshot before this documentation commit.

---

*Phase: 02-native-media3-playback-background-control*
*Completed: 2026-08-30*
