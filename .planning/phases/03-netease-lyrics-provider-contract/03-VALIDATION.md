---
phase: 03-netease-lyrics-provider-contract
status: draft
requirements: [NET-004, LYR-001, LYR-002, LYR-003]
nyquist_compliant: false
wave_0_complete: false
deterministic_gate: pending
live_gate: blocked-until-authorized
---

# Phase 03 Validation Strategy

**Phase:** NetEase Lyrics & Provider Contract  
**Rule:** Deterministic JVM/Node/Room/API-35 evidence may prove implementation and installed architecture, but only same-build entitlement-compliant live NetEase evidence can complete NET-004. A missing live route/test item/device/TalkBack remains `BLOCKED`/not verified and does not invalidate safe deterministic, UI, or persistence work.

## Validation layers

| Layer | Purpose | Command / artifact | Completion authority |
|---|---|---|---|
| Pure Java | Closed operation schemas, route policy, typed provider projection/errors, cancellation, sole-player resolver, clock identity | `cd android && gradle --no-daemon :app:testDebugUnitTest` plus focused `--tests` commands in Plans 03-01/03-03 | Deterministic contracts only |
| Room/API 35 | Schema 1→2, exact-key manual precedence, offset/revision transaction, reopen/corruption/privacy | `LyricMigrationInstrumentationTest`, `LyricPersistenceInstrumentationTest`, exported schema 2 | LYR-002 persistence evidence |
| Shared frontend | Typed adapter, desktop preservation, capability matrix, native-clock lyrics, stale arbitration, manual picker, accessibility/source geometry | Focused Node tests, then `npm --prefix app/listen1_chrome_extension test` | JavaScript/UI source contract |
| Installed deterministic API 35 | Packaged WebMessage → synthetic NetEase DTO → default resolver → sole Media3 progression → Room/lyrics/UI/lifecycle | `bash android/scripts/phase03-api35-smoke.sh --run-deterministic` | Architecture/device evidence, never live provider completion |
| Authorized live API 35 | Real search/detail/default rendition/progress/primary-manual lyrics/recovery/TalkBack on the same exact build | `android/scripts/phase03-live-smoke.sh --run-live` and `--verify-live-evidence` | Final NET-004 and device-side LYR gate; may remain BLOCKED |
| Publication | Repository-authoritative full local gate for the exact worktree | User-level `$run-local-ci` before every commit/push | Required publication gate; no merge/deploy authority |

## Requirement coverage map

| Requirement | Observable behavior | First deterministic evidence | Installed/live evidence | Owning plans | Status rule |
|---|---|---|---|---|---|
| NET-004 | NetEase search → directory/detail → one authorized default rendition → sole Media3 playback → primary lyric; five other providers unavailable | `AndroidRpcContractTest`, `NetEaseResponseMapperTest`, `android_netease_typed_provider.test.js`, resolver tests | 03-07 deterministic installed path plus mandatory 03-08 authorized live path | 03-01, 03-02, 03-03, 03-06, 03-07, 03-08 | Pending until 03-08 strict live PASS |
| LYR-001 | Bilibili/NetEase provider-neutral matching, authorized translation, current line/scroll/offset from Media3 across pause/seek/transition/restore | `LyricClockProjectionTest`, `android_native_lyric_state.test.js`, Bilibili lyric regression | 03-07 lifecycle evidence; 03-08 both-provider live transition | 03-02, 03-03, 03-05, 03-06, 03-07, 03-08 | PASS only after deterministic + required live markers |
| LYR-002 | Manual search/select/clear and offset persist by exact provider/track/part/revision; degradations never block audio | Room migration/persistence tests, adapter/controller/UI tests | 03-07 reopen/rotation evidence; 03-08 live manual journey | 03-01, 03-02, 03-04, 03-05, 03-06, 03-07, 03-08 | Persistence may pass independently; requirement stays pending until device journey passes |
| LYR-003 | TalkBack semantics, stale/error/cancel safety, terminal loading, no invented timestamp/old track overwrite | JVM clock/redaction, Node stale/accessibility tests | 03-07 accessibility-tree/lifecycle proof and 03-08 TalkBack-enabled live proof | 03-01, 03-03, 03-05, 03-06, 03-07, 03-08 | Pending while TalkBack/live gate is blocked |

## Plan and wave gates

| After wave | Required green gate |
|---|---|
| Wave 1 — 03-01 | Exact named RPC/policy/mapper/lifecycle tests; no generic transport fields; stable errors and first-terminal settlement |
| Wave 2 — 03-02/03-03/03-04 | Frontend typed provider/matrix fixtures; resolver/clock/snapshot JVM suites; schema-1→2 and Room repository tests whose focused commands fail unless exactly one `adb -s` target is online, reports API 35, and receives the exact debug/androidTest APKs; no same-wave file overlap |
| Wave 3 — 03-05 | Provider-neutral native-clock lyric, degradation, manual transaction, Bilibili and playback-cutover Node tests |
| Wave 4 — 03-06 | NetEase phone UI, lyric/picker accessibility, source/geometry/motion contracts, and aggregate frontend suite |
| Wave 5 — 03-07 | Exact API-35 deterministic installed run and strict deterministic evidence verifier; evidence labels live status not verified |
| Wave 6 — 03-08 | Prerequisite/substitution self-test always available; strict live run passes only when authorized external prerequisites exist, otherwise explicit BLOCKED |

## Exclusive file ownership

| Plan | Sole ownership boundary | Shared inputs consumed read-only |
|---|---|---|
| 03-01 | Native RPC/policy/transport/client/mapper/persistence-port and their JVM fixtures | Phase 1 registry/retry/origin patterns |
| 03-02 | `lowebutil.js`, `loweb.js`, `provider/netease.js`, page-adapter/matrix fixtures | 03-01 operation/result contract |
| 03-03 | Playback policy/resolver/service/snapshot/clock and JVM fixtures | 03-01 native client; Phase 2 service/queue contracts |
| 03-04 | `MainActivity` lyric port wiring, lyric Room record/repository/database schema and migration/persistence tests | 03-01 persistence port |
| 03-05 | `l1_player.js`, `controller/play.js`, native lyric state and Bilibili/cutover regression tests | 03-02 facade, 03-03 snapshot, 03-04 repository results |
| 03-06 | Search/playlist controllers, HTML/CSS, frontend package test registration, NetEase/lyric/playback UI tests | 03-02 capability/provider data; 03-05 controller state |
| 03-07 | Deterministic instrumentation/harness and deterministic evidence/screenshots only | All production plans plus Phase 1/2 evidence conventions |
| 03-08 | Live harness, live evidence/screenshots, and final coverage ledger only | 03-07 deterministic PASS and external authorized prerequisites |

No path appears in two plan frontmatter `files_modified` lists. Plans in Wave 2 have zero file overlap and may execute in parallel after 03-01.

### Intra-plan task ownership and atomicity

The plan-level `files_modified` list is a worktree boundary, not a single commit batch. Plans 03-01 and 03-03 intentionally revisit a few core files in later sequential tasks, so their task-local ownership is explicit and independently verified:

| Plan / task | Task files | Exclusive task-owned region | Atomic boundary |
|---|---:|---|---|
| 03-01 / Task 1 | 5 | Version-2 common envelope and `netease.search` parser/dispatcher/client/mapper tracer only | Focused tracer tests + task-scoped `git diff --check`, then one commit before Task 2 |
| 03-01 / Task 2 | 5 | Non-search operation schemas, dispatch, persistence port, and v1 non-expansion guard only | Focused contract/policy tests + task-scoped `git diff --check`, then one commit before Task 3 |
| 03-01 / Task 3 | 5 | Cancellation/deadline/teardown, cross-operation projection/redaction, and lifecycle matrices only | Exhaustive lifecycle/mapper tests + task-scoped `git diff --check`, then one final plan commit |
| 03-03 / Task 1 | 5 | NetEase identity/resolver/MediaItem preparation path only, including only resolver injection regions in `PlaybackService` | Focused resolver/policy tests + task-scoped `git diff --check`, then one commit before Task 2 |
| 03-03 / Task 2 | 5 | Snapshot DTO, clock projection, listener/cadence publication, and cadence teardown only | Focused clock/service tests + task-scoped `git diff --check`, then one commit before Task 3 |
| 03-03 / Task 3 | 5 | Failure-only stale/recovery/privacy guards and matrices; resolver construction and cadence definition remain read-only | Full resolver/clock/service matrix + task-scoped `git diff --check`, then one final plan commit |

For both plans, `$run-local-ci` remains mandatory after the focused task verifier and before that task's commit/push. A shared path never authorizes staging another task's region, and the executor must finish each task commit before opening the next task's diff.

If any 03-01 or 03-03 task cannot be completed within its listed five files and exclusive region, stop before editing or staging a sixth file. Re-slice the remaining work into a new sequential task or plan, re-run ownership/wave and plan validation, and preserve the existing task's five-file cap and atomic commit boundary; never widen the cap or batch adjacent task regions to make execution fit.

## Multi-source coverage audit

| SOURCE | ID | Feature / constraint | Plan | Status | Notes |
|---|---|---|---|---|---|
| GOAL | — | Complete NetEase listening journey plus synchronized accessible lyrics following active Media3 state | 03-01..03-08 | COVERED | Deterministic work precedes separate live completion gate |
| REQ | NET-004 | NetEase search/detail/default rendition/play/primary lyric; other five providers unavailable | 03-01,02,03,06,07,08 | COVERED | 03-08 remains BLOCKED until authorized prerequisites exist |
| REQ | LYR-001 | Both-provider match/timeline/translation/current line/offset/scroll from Media3 | 03-02,03,05,06,07,08 | COVERED | Native clock is Plan 03-03 |
| REQ | LYR-002 | Manual search/select/persist/clear/offset and explicit nonblocking degradation | 03-01,02,04,05,06,07,08 | COVERED | Room migration/repository is Plan 03-04 |
| REQ | LYR-003 | TalkBack plus stale/error/cancel/no-fake-time safety | 03-01,03,05,06,07,08 | COVERED | Device proof split deterministic/live |
| RESEARCH | R-01 | Named provider operations; no generic URL/header/cookie bridge | 03-01 | COVERED | D-01/D-02 |
| RESEARCH | R-02 | No new dependency/package; reuse Media3 1.9.4, Room 2.8.4, Angular classic scripts | 03-01..03-08 | COVERED | No install task; package-legitimacy gate not triggered |
| RESEARCH | R-03 | Search-only compatibility route cannot prove detail/rendition/lyrics; errors cannot become empty results | 03-01,03-02 | COVERED | Closed adapter replaces Android branch only |
| RESEARCH | R-04 | Empty native resolver must become a one-default NetEase resolver behind sole Media3 | 03-03 | COVERED | Live route absence remains explicit |
| RESEARCH | R-05 | Native-issued lyric identity and bounded Media3 clock cadence | 03-03,03-05 | COVERED | Immediate semantic events + 500 ms attached cadence |
| RESEARCH | R-06 | Provider-neutral Room state with migration, expected revision, bounds, corruption recovery | 03-04 | COVERED | New lyric record table retains metadata table |
| RESEARCH | R-07 | Provider-neutral parsing/manual picker and accessible phone UI | 03-05,03-06 | COVERED | UI-SPEC exact copy/state/geometry included |
| RESEARCH | R-08 | Five unverified providers unavailable-by-default | 03-02,03-06,03-07 | COVERED | No legacy mobile routes copied |
| RESEARCH | R-09 | Deterministic installed proof cannot substitute for live authorization | 03-07,03-08 | COVERED | Separate scripts and evidence files |
| RESEARCH | R-10 | No transport/secret/provider-body/path data in page, Room, snapshots, logs, evidence | 03-01,03-03,03-04,03-06,03-07,03-08 | COVERED | Layer-specific recursive scans |
| CONTEXT | D-01 | Separate named version-2 NetEase/lyric operations; no generic fetch or compatibility expansion | 03-01,03-02 | COVERED | Exact names locked in 03-01 |
| CONTEXT | D-02 | Native route/method/schema/deadline/cancel/terminal ownership | 03-01 | COVERED | Policy/client/mapper/lifecycle fixtures |
| CONTEXT | D-03 | One authorized default rendition in Phase 3; advanced rendition/MV scope remains Phase 9 | 03-01,03-02,03-03,03-08 | COVERED | No selector/alternate/advanced failover surface |
| CONTEXT | D-04 | Distinct actionable provider failures; no empty success | 03-01,03-02,03-06 | COVERED | Node/JVM/UI matrices |
| CONTEXT | D-05 | Five providers unavailable; no absent mobile runtime/routes copied | 03-02,03-06,03-07 | COVERED | Matrix and non-actionable UI/device assertions |
| CONTEXT | D-06 | PlaybackService/Media3 sole audio and clock owner | 03-03,03-07 | COVERED | No page Howler or second player |
| CONTEXT | D-07 | Bounded lyric-safe native snapshot identity | 03-03,03-05,03-07 | COVERED | Explicit allow-list and privacy scan |
| CONTEXT | D-08 | Full current identity/token acceptance and exactly-once stale/cancel/error settlement | 03-01,03-05,03-07 | COVERED | JVM/Node/device race matrices |
| CONTEXT | D-09 | Media3 clock, immediate semantic events, bounded progress, no persistent/announced ticks | 03-03,03-05,03-07 | COVERED | 500 ms attached cadence plus live-region suppression |
| CONTEXT | D-10 | One provider-neutral nonblocking lyric model with explicit degradation | 03-02,03-05,03-06,03-07 | COVERED | Bilibili regression retained |
| CONTEXT | D-11 | Capability-driven manual select/clear and bounded offset for exact identity | 03-02,03-04,03-05,03-06 | COVERED | Native revision confirmation |
| CONTEXT | D-12 | Room durable authority with migration/expected revision/bounded validated content | 03-04 | COVERED | Schema 2 and device tests |
| CONTEXT | D-13 | Authorized provider translation only; DeepSeek remains Phase 9 | 03-02,03-05,03-06 | COVERED | Existing explicit AI path regression-tested, never invoked |
| CONTEXT | D-14 | Player detail states/manual actions/48dp; lyric work never disables audio | 03-06,03-07 | COVERED | Exact UI-SPEC surface |
| CONTEXT | D-15 | Concise polite TalkBack semantic announcements, not every clock tick | 03-06,03-07,03-08 | COVERED | Source/tree/live device layers |
| CONTEXT | D-16 | Back/panel order and recreation restore without duplicates | 03-04,03-05,03-06,03-07 | COVERED | Controller + persistence + device checks |
| CONTEXT | D-17 | JVM/frontend coverage across every contract/persistence/UI matrix | 03-01..03-07 | COVERED | Focused tests then aggregate suites |
| CONTEXT | D-18 | Exact API-35 installed NetEase/default/Media3/lyric/recovery/TalkBack evidence | 03-07,03-08 | COVERED | Deterministic and live authorities remain distinct |
| CONTEXT | D-19 | Missing live route stays BLOCKED while safe work proceeds | 03-01,03-03,03-07,03-08 | COVERED | Final plan only carries external precondition |
| CONTEXT | D-20 | Page/Room/snapshot/log/backup/evidence prohibited-data scans | 03-01,03-03,03-04,03-06,03-07,03-08 | COVERED | Backups are not modified; new surfaces are scanned |

Deferred exclusions are not gaps: quality selection, alternate renditions, advanced CDN policy, part switching, MV/effects/loudness/visualization/DeepSeek, sessions/login, downloads/cache/offline, and QQ/Kugou/Kuwo/Migu/Taihe expansion remain in their assigned later phases.

## Wave 0 / first-failing-test ledger

- [ ] 03-01 adds failing JVM request/policy/mapper/lifecycle fixtures before each implementation slice.
- [ ] 03-02 adds failing VM adapter/matrix fixtures for exact operation and terminal semantics.
- [ ] 03-03 adds failing resolver/clock/snapshot/privacy tests for default selection and Media3 transitions.
- [ ] 03-04 adds failing Room persistence/migration/revision/corruption tests using schema-1 asset.
- [ ] 03-05 adds failing provider-neutral native-clock/degradation/manual race tests.
- [ ] 03-06 adds failing NetEase/lyric/accessibility/source-layout tests and registers them in the aggregate suite.
- [ ] 03-07 adds failing installed deterministic markers, CDP self-tests, and evidence non-substitution/redaction checks.
- [ ] 03-08 adds failing live prerequisite/substitution self-tests; strict live verification remains nonzero while BLOCKED.

Set `wave_0_complete: true` only after every referenced test file exists and its focused command passes. Set `nyquist_compliant: true` only after Waves 1-5 deterministic gates pass and the live gate status is accurately represented; a BLOCKED live result is valid evidence state but not phase completion.

## Live-only final verification

| Behavior | Why live | Required result |
|---|---|---|
| Authorized NetEase search/detail/default rendition and audible/advancing sole Media3 playback | Fixtures cannot prove provider contract, entitlement, CDN/codec, or real installed transport | 03-08 exact-build live PASS, else BLOCKED/not verified |
| Primary/manual lyrics, offset persistence, pause/seek/track-change/recovery on live track | Real provider identity/duration/content must align with native clock and Room key | Same-build live markers and redacted screenshots/result |
| TalkBack-enabled readable current line/source/mode/offset/terminal state without cadence speech flood | Static ARIA/tree contracts do not fully prove installed screen-reader behavior | TalkBack available/enabled and bounded accessibility event/state evidence, else BLOCKED |

## Publication and completion gate

- Before every commit or push in every plan, invoke user-level `$run-local-ci` against the exact current worktree. Record repo/branch, HEAD and worktree before/after, authoritative commands, start/end timezone timestamps, exit codes, uncovered checks, and recovery.
- A missing, stale, partial, failing, timed-out, or inapplicable local result is `BLOCKED`/`NOT VERIFIED` and prevents that commit/push. Do not substitute optional remote CI.
- No plan authorizes merge, deployment, release publication, signing credentials, admin bypass, issue closure, or production access.
- Phase 3 completion requires strict 03-08 live PASS. If external prerequisites remain absent, report Waves 1-5 as implemented/deterministically verified and Phase 3 as `BLOCKED`/not verified.

## Validation sign-off

- [ ] Every task has a runnable `<automated>` verifier and first-failing behavior expectations where production code changes.
- [ ] Same-wave plan files are disjoint and all cross-plan interfaces are dependency-ordered.
- [ ] Focused JVM/Node/Room/API-35 deterministic gates pass on exact changed snapshots.
- [ ] Aggregate frontend and repository-authoritative local CI pass before each publication action.
- [ ] Deterministic evidence is exact-build-bound, redacted, and explicitly non-live.
- [ ] Live gate is either exact-build PASS or explicit BLOCKED with recovery; fixtures never satisfy it.
- [ ] No forbidden data is present in page state, Room, snapshots, diagnostics, backups, logs, or evidence.
- [ ] `nyquist_compliant: true` is set only when this checklist and evidence status are truthful.

**Approval:** pending execution
