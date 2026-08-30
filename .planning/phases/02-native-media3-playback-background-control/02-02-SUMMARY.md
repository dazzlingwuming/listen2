---
phase: 02-native-media3-playback-background-control
plan: "02"
subsystem: android-playback-semantics
tags: [android, java, playback, queue, shuffle, history]
requires:
  - phase: 02-native-media3-playback-background-control
    plan: "01"
    provides: revisioned native playback command and occurrence identity contract
provides:
  - immutable duplicate-preserving semantic FIFO queue above Media3
  - deterministic shuffle, repeat, accepted-history, retry, and checkpoint transitions
affects: [02-03, 02-04, 02-05, 02-06, android-playback-service]
actuals:
  tokens: 8627
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns: [pure-java-immutable-state, token-idempotent-transition, injected-clock-random-and-id-sources]
key-files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackQueueEngine.java
    - android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackQueueEngineTest.java
  modified: []
key-decisions:
  - "Play-next entries are unique opaque occurrences outside both provider identity and the Media3 timeline."
  - "All next surfaces share a bounded transition token map so duplicate callbacks retain the accepted revision."
  - "Queue-only history is durable semantic data but never changes the base playlist."
patterns-established:
  - "Use injected identity, clock, and random sources for replayable Java playback tests."
  - "Model retry and terminal failure as revisions on the same current occurrence, never as implicit next."
requirements-completed: [PLAY-004, PLAY-005]
status: complete
---

# Phase 2 Plan 02: Semantic Queue, History, and Mode Core Summary

**A pure Java, checkpoint-ready playback state machine now enforces Listen2 FIFO, shuffle, repeat, history, and retry semantics independently of Media3's timeline.**

## Performance

- **Tasks:** 2/2
- **Files created:** 2
- **Task commits:** `ace27e9`, `28bc60e`

## Accomplishments

- Added unique bounded occurrence IDs so identical track handles remain separate FIFO queue rows; queue mutation uses only occurrence identity and current revision.
- Routed natural-end, page, notification, and headset next through one token-idempotent transition so duplicate events cannot consume another queued occurrence.
- Restored the saved base playlist/context and playback mode after queue drain without inserting queue-only tracks into the base list.
- Added deterministic Fisher-Yates shuffle rounds, disabled-track filtering, real accepted playback history, repeat-one behavior, bounded token retention, retry/terminal-failure retention, and checkpoint/restore support.

## Verification

- TDD RED: `PlaybackQueueEngineTest` initially failed because the engine API did not exist; implementation then made the focused JVM suite pass.
- Focused: `cd android && gradle --no-daemon :app:testDebugUnitTest --tests com.dazzlingwuming.listen2.PlaybackQueueEngineTest` — PASS.
- Behavioral parity: `node test/player_play_next_queue.test.js`, `node test/player_shuffle.test.js`, `node test/player_recovery.test.js` — PASS.
- Full local CI at `2026-08-31T03:52:18+0800` and `2026-08-31T03:55:09+0800` — PASS: Android JVM tests/debug APK/signature verification, six root desktop suites, and the extension test suite.

## Task Commits

1. **Task 1: Model duplicate-preserving FIFO occurrences and return context** — `ace27e9` (`feat`)
2. **Task 2: Add Fisher-Yates, repeat, real-history previous, and restart state** — `28bc60e` (`feat`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Completed full shuffle rounds after the initial current-excluding round.**

- **Found during:** Task 2 TDD
- **Issue:** Reusing the initial exclusion on every round omitted the prior boundary occurrence from later rounds.
- **Fix:** Initial shuffle excludes the current item; subsequent rounds permute every playable base occurrence and swap a boundary duplicate when alternatives exist.
- **Files modified:** `PlaybackQueueEngine.java`, `PlaybackQueueEngineTest.java`
- **Commit:** `28bc60e`

## Known Stubs

None. The engine intentionally has no Media3, network, Room, or provider dependency; those integration layers belong to subsequent Phase 2 plans.

## Threat Flags

None. This plan creates no network, authentication, file, or schema boundary; bounded IDs, queue size, revisions, and token retention reduce the plan's queue tampering/DoS surface.

## Self-Check: PASSED

- Both engine artifacts exist in the Android package and both task commits are present and pushed on `agent/android-mobile-rebuild`.
- The focused JVM suite, desktop behavior references, and final complete local CI gate passed against the committed task snapshots.

## Residual Risks

- Native MediaSessionService dispatch and Room persistence must consume this engine atomically in later plans; this plan does not claim device-level background playback evidence.
- The preserved Phase 1 API-35 live-provider evidence remains externally blocked and is not altered by this plan.
