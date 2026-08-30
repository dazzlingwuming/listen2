# Phase 02 Validation Strategy

**Phase:** Native Media3 Playback & Background Control
**Requirements:** PLAY-001, PLAY-003, PLAY-004, PLAY-005, PLAY-006, DATA-001
**Rule:** JVM/build/fixture evidence supports implementation but cannot complete the API-35 live-provider gate.

## Validation layers

| Layer | Purpose | Command / artifact | Completion authority |
|---|---|---|---|
| Pure Java | Closed bridge schemas; occurrence FIFO; shuffle/repeat/history; serialized coordinator/retry | `cd android && gradle --no-daemon :app:testDebugUnitTest` | Deterministic behavior only |
| Room/API 35 | Schema 1, transaction rollback, restore, migration, settings isolation | Focused `PlaybackPersistenceInstrumentationTest,PlaybackMigrationInstrumentationTest` | DATA-001 device evidence |
| Shared frontend | Native command/snapshot cutover, no Android Howl, desktop/browser regression, mobile UI/queue contracts | `npm --prefix app/listen1_chrome_extension test` | JS/UI source contract |
| Installed Media3/API 35 | Sole owner, controls, queue, session/notification, focus/noisy, and two-stage process-death recovery | Focused `Playback*InstrumentationTest` plus `phase02-process-death-smoke.sh --verify` | Deterministic installed-runtime gate |
| Deterministic evidence | Exact APK/git/device identity, screenshots, phone geometry, redaction, non-substitution | `phase02-api35-smoke.sh --run-deterministic` then `--verify-evidence --allow-live-blocked` | Allows Phase-2 implementation review, not completion |
| Live provider evidence | Existing typed descriptor → Media3 → background/recovery on authorized public item | `phase02-api35-smoke.sh --run-live` then strict `--verify-evidence` | Final Phase-2 gate; currently BLOCKED by Phase-1 HTTP 412 |
| Publication | Repository-authoritative full local CI for exact worktree and HEAD | User-level `$run-local-ci` before every commit/push | Required before publication; no merge/deploy |

## Nyquist requirement map

| Requirement | Observable behavior | First test/evidence file | Owning plan |
|---|---|---|---|
| PLAY-001 | One service/player/session; page, mini-player and system controls share snapshot | `PlaybackBridgePolicyTest.java`, `PlaybackServiceInstrumentationTest.java`, `android_native_playback_cutover.test.js` | 02-01, 02-04–02-08 |
| PLAY-003 | Play/pause/seek/progress/duration/volume/mute/prev/next; failure retains current occurrence | `PlaybackCoordinatorTest.java`, `PlaybackMediaResolverTest.java`, `PlaybackServiceInstrumentationTest.java` | 02-04, 02-07–02-10 |
| PLAY-004 | Duplicate occurrence FIFO, reorder/remove/clear/restart/base return | `PlaybackQueueEngineTest.java`, `android_native_queue_ui.test.js`, `PlaybackRecoveryInstrumentationTest.java` | 02-02, 02-03, 02-07–02-09 |
| PLAY-005 | Fisher-Yates/repeat/real-history restart and no double consumption | `PlaybackQueueEngineTest.java`, `PlaybackCoordinatorTest.java`, `PlaybackRecoveryInstrumentationTest.java` | 02-02–02-04, 02-08–02-09 |
| PLAY-006 | Legal service, notification/lock screen, focus/noisy, screen-off, renderer/activity/process recovery, idle exit | `PlaybackSystemControlsInstrumentationTest.java`, `PlaybackRecoveryInstrumentationTest.java`, API-35 evidence | 02-04, 02-05, 02-08–02-10 |
| DATA-001 | Migration-safe records for all named categories; transactional checkpoint; small settings only | `PlaybackPersistenceInstrumentationTest.java`, `PlaybackMigrationInstrumentationTest.java`, schema 1 export | 02-03, 02-04, 02-08–02-09 |

## Wave gates

| After wave | Required green gate |
|---|---|
| 1 | Exact Media3 1.9.4/Room 2.8.4 dependency insight, compile probe, bridge-policy JVM tests |
| 2 | Queue-engine JVM tests; Room schema/transaction/migration device tests |
| 3 | Coordinator/resolver JVM tests; debug and release-like service/manifest build |
| 4 | Native RPC/controller tests plus Phase-1 bridge/navigation regressions |
| 5 | Native playback adapter/no-Howl tests plus full frontend suite |
| 6 | UI/queue contract tests plus full frontend suite |
| 7 | Three focused connected classes plus Stage A → force-stop/empty-pid → relaunch → Stage B process-death script |
| 8 | Deterministic harness self-tests, installed evidence, allow-live-blocked verifier |
| 9 | Phase-1 live PASS precondition, live Media3 proof, strict verifier |

## Fail-closed evidence rules

- Record timestamp/timezone, git SHA, APK SHA-256, build variant/package, API/ABI/AVD/WebView, exact commands, device state, step result, screenshots, uncovered behavior, and recovery path.
- Reject mismatched/stale identity, missing or nonterminal steps, substituted fixture/build/JVM evidence, absent screenshots, and forbidden data.
- Require checkpoint revision continuity, exact occurrence/queue/mode/history restore, paused/actionable state, position within five seconds, verified process absence before relaunch, and no signed candidate after restore.
- Never retain media URLs/candidates, cookies, headers, credentials, provider bodies, raw exceptions, database rows, or personal paths.
- Phase-1 live status remains `BLOCKED` after the 03:13 HTTP-412 retry. Plans 02-01 through 02-09 may execute; Plan 02-10 must not run past its precondition until Phase-1 live evidence is PASS.
- `BLOCKED` is honest evidence but not requirement completion. Strict verification must return nonzero while any required live marker is blocked, missing, or failed.

## Sign-off checklist

- [ ] Every task verifier passes on the exact changed worktree.
- [ ] `$run-local-ci` passes before each commit/push; command, time/timezone, SHA, worktree state, result, and uncovered items are recorded.
- [ ] Debug and release-like compilation resolve Media3 1.9.4 under SDK 35.
- [ ] API-35 connected tests pass for service, Room, queue, controls, lifecycle, and idle release.
- [ ] Deterministic evidence passes without being labeled final Phase-2 completion.
- [ ] Phase-1 live prerequisite and Phase-2 live strict evidence pass before any Phase-2 completion claim.
- [ ] No merge, deploy, release publication, or signing-secret operation occurred.
