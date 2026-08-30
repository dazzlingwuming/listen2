---
phase: 03-netease-lyrics-provider-contract
plan: "03"
subsystem: android-media3-lyric-clock
tags: [android, media3, netease, resolver, lyrics, privacy]
dependency_graph:
  requires: [03-01-closed-netease-lyric-rpc-contract, 03-02-typed-netease-page-adapter]
  provides: [native-default-rendition-seam, media3-lyric-clock-projection, snapshot-privacy-matrix]
  affects: [03-04-lyric-persistence, 03-05-lyric-ui, 03-08-live-evidence]
tech_stack:
  added: []
  patterns: [opaque-native-handles, source-specific-identity, media3-only-clock, recursive-page-redaction]
key_files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/NetEasePlaybackResolver.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/LyricClockProjection.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/LyricClockProjectionTest.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackServiceLyricContractTest.java
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackBridgePolicy.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackMediaResolver.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java
decisions:
  - NetEase accepts one native-only default rendition seam; absent approved route returns route-unavailable and never creates a MediaItem.
  - Lyric identity and progress are projected only from the service-owned Media3 player with monotonic revision handling and a bounded attached-renderer cadence.
  - Snapshot serialization performs recursive rejection of transport-like fields and URL or credential-like values before crossing to the page.
metrics:
  duration: 00:09:00
  completed: 2026-08-31
status: complete
actuals:
  tokens: 11735
  tasks: 3
  commits: 3
requirements-completed: []
---

# Phase 3 Plan 03: Native Rendition and Lyric Clock Summary

The Android Media3 owner now accepts source-specific logical identities, resolves only one native NetEase default seam, and emits a privacy-checked lyric identity/clock projection.

## Accomplishments

- Added a native-only NetEase default rendition resolver. Its production default is a truthful `route-unavailable` recovery state; deterministic fixture candidates remain resolver-private and occurrence-scoped.
- Generalized logical descriptors while retaining strict Bilibili BVID/CID checks and adding separate numeric NetEase track identity validation.
- Connected selection preparation to the existing single Media3 service. Only the service consumes a transient candidate to create a `MediaItem`; no candidate is copied into the snapshot or checkpoint.
- Added `LyricClockProjection`, a pure Media3-clock projection with monotonic cadence handling, accepted seek behavior, global stale-revision rejection, and selection-generation identity.
- Extended the snapshot allow-list with bounded lyric identity/capability/state and a 500 ms foreground cadence that runs only for an attached renderer and meaningful active native lyric context.
- Added recursive snapshot guards against transport-like keys and URL/cookie/credential-like values.

## Task Commits

1. Task 1 — `7e01ac5`: native default NetEase selection resolver seam.
2. Task 2 — `799a195`: lyric-safe Media3 identity and clock projection.
3. Task 3 — `b24c5f8`: stale/recovery and recursive privacy failure matrix.

## Verification

- Focused JVM suites passed: `PlaybackBridgePolicyTest`, `PlaybackMediaResolverTest`, `LyricClockProjectionTest`, and `PlaybackServiceLyricContractTest`.
- Full local CI passed before every task publication: Android JVM tests, debug APK assembly, APK signature verification, six desktop suites, and the extension suite.
- Final full gate ran 2026-08-31T07:56:38+0800–07:56:45+0800 on pre-commit `799a195`, exit 0. The final matrix commit changes only deterministic source/tests and was made from that verified worktree.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 2 - Missing critical functionality] Added final recursive snapshot validation.
   - **Found during:** Task 3 privacy-matrix tests.
   - **Issue:** An explicit allow-list alone would not defend against a future nested DTO field containing transport-like values.
   - **Fix:** The snapshot serializer now recursively rejects forbidden keys and URL/cookie/authorization-like values before page projection.
   - **Files modified:** `PlaybackSnapshot.java`, `PlaybackServiceLyricContractTest.java`.
   - **Commit:** `b24c5f8`.

## Evidence Limits

- No approved, entitlement-compliant NetEase rendition route or authorized test item is available. The resolver deliberately reports `route-unavailable`; deterministic fixtures do not complete NET-004 live evidence.
- This plan provides deterministic JVM verification only. Live provider playback, physical codec/Bluetooth behavior, and API-35 end-to-end NetEase evidence remain for the dedicated live gate.
- Preserved Phase 1 Bilibili evidence was not read, modified, staged, or deleted.

## Self-Check: PASSED

- All ten planned source/test artifacts exist.
- Task commits `7e01ac5`, `799a195`, and `b24c5f8` are present on the pushed branch.
- No tracked files were deleted.
