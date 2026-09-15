---
phase: 05-five-source-listen-journey
verified: 2026-09-15T02:33:51Z
status: gaps_found
score: 0/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Five-source search preserves successful rows and offers an actionable recovery after cancellation or a later-page failure."
    status: failed
    reason: "SearchScreen replaces retained result rows with a terminal cancelled/error card and renders no retry action."
    artifacts:
      - path: "mobile/src/screens/SearchScreen.tsx"
        issue: "The reducer's cancelled-more state is discarded by screen status; errorCopy.action is not wired to a control."
    missing:
      - "Render retained rows with inline cancellation/error and a scoped retry/load-more action."
      - "Add rendered SearchScreen tests for later-page cancellation and error."
  - truth: "Supported detail navigation restores selected identity and scroll context across Back, re-entry, and rotation."
    status: failed
    reason: "selectedIdentity and scrollAnchor are reducer-only values: no production code writes them, and navigation passes only journey.scope."
    artifacts:
      - path: "mobile/src/screens/SearchScreen.tsx"
        issue: "No selection/scroll capture or restore path is present."
    missing:
      - "Persist and restore bounded rows, cursor, selected identity, and scroll anchor through the semantic route/state boundary."
  - truth: "A user can add a track to a FIFO play-next queue from the normal listening journey."
    status: failed
    reason: "addNextTrack/enqueueNext has no product UI call site; only tests and backup/settings code enqueue occurrences."
    artifacts:
      - path: "mobile/src/store/playerSlice.ts"
        issue: "The thunk exists but is orphaned from search/detail/player track actions."
      - path: "mobile/src/screens/PlayerScreen.tsx"
        issue: "The queue sheet can edit pre-existing rows but cannot add one."
    missing:
      - "Expose a capability-gated Add to play-next action from a normal track surface and cover the end-to-end occurrence flow."
  - truth: "Lyrics support a user-editable, revision-safe signed offset and distinct actionable terminal states."
    status: failed
    reason: "All provider offset capabilities are closed; PlayerScreen only displays an unavailable message and catch{} maps timeout/mismatch/unsupported/cancelled to one generic unavailable state."
    artifacts:
      - path: "mobile/src/api/client.ts"
        issue: "No source declares operations.offset available."
      - path: "mobile/src/screens/PlayerScreen.tsx"
        issue: "No offset mutation UI exists; lyric error identity/action is discarded."
    missing:
      - "Enable only an evidence-backed offset capability, wire bounded offset mutation/CAS persistence, and render distinct safe lyric error/recovery actions."
  - truth: "Every one of the five visible sources supports the roadmap's search-to-detail-to-authorized-playback journey."
    status: failed
    reason: "QQ and Kuwo expose search but their playback/bootstrap capabilities remain unverified/unavailable; the roadmap success criterion requires an authorized supported track from each source."
    artifacts:
      - path: "mobile/src/api/client.ts"
        issue: "QQ and Kuwo have no available playback/bootstrap operation."
    missing:
      - "Either add source-specific approved playback contracts and tests, or obtain an accepted roadmap/requirement override that narrows the five-source outcome."
---

# Phase 5: Five-Source Listen Journey Verification Report

**Phase Goal:** Within a user's actual authorization, each official mobile source and Bilibili supports a coherent phone journey from search to details, playback, and lyrics.

**Verified:** 2026-09-15T02:33:51Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

This report treats the three SUMMARY files as non-evidence. It inspected the canonical `mobile/` changes from `868a594..HEAD`, not the archived WebView route. The phase has substantive, tested reducer/controller foundations, but the roadmap's observable end-to-end truths do not hold in the rendered product.

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Search each of the five sources; cancel/paginate; keep another source's successful result and show truthful, actionable status. | ✗ FAILED | `SearchScreen.tsx:148-163` updates its reducer on cancellation but always sets screen status to `cancelled`/`error`; `:434-454` then returns a card instead of the retained rows, and has no recovery button. `TrackRowAction` is declared but has no call site. |
| 2 | Open supported detail/part routes and preserve source, query, kind, cursor, rows, selected identity, and scroll context across Back/rotation. | ✗ FAILED | `searchJourneyState.ts` supports `selectedIdentity`/`scrollAnchor`, but production references only carry them forward; `rg` finds no code that captures either value. `SearchScreen.tsx:232,360` passes only `journey.scope`, which contains neither rows nor those restoration fields. |
| 3 | Play an authorized device-supported track from every listed source through one native RNTP owner and shared state. | ✗ FAILED | The RNTP/controller wiring is real (`mobile/index.js:9-12`, `playerController.ts`, `playbackService.ts`), but `api/client.ts:125-133` makes Kuwo and QQ search-only/lyric-only and `bootstrapTrack` rejects their media. This is an observable roadmap mismatch, independent of a live-provider run. |
| 4 | Use play-next, duplicate entries, reorder/removal, shuffle/repeat/history, then recover without double-consuming the queue. | ✗ FAILED | The occurrence-safe reducer/controller tests pass, but no normal surface enqueues a track: `addNextTrack` is defined at `playerSlice.ts:419-421`; non-test callers are only Settings backup import/restore. `PlayerScreen` edits an already-populated queue only. |
| 5 | View synchronized active-track lyrics/translations, change offset or manual source where available, and receive distinct missing/mismatch/timeout/unsupported states. | ✗ FAILED | `PlayerScreen.tsx:153-154` derives offset from capability, while no `PROVIDER_CAPABILITIES` source enables it. `:1203-1207` only prints its unavailable reason. `openLyrics` catches every provider error at `:283-292`, losing terminal identity and action. |

**Score:** 0/5 roadmap truths verified (the failed truths contain proven code-level gaps, not merely untested device behavior).

## Required Artifacts

All listed artifacts exist and are substantive; the defects are in their visible behavior/data-flow wiring rather than placeholder files.

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `mobile/src/types/provider.ts` | Operation-level capability contract | ✓ VERIFIED | Closed source/operation union is used by client/screens. |
| `mobile/src/search/searchJourneyState.ts` | Scoped pagination/restoration reducer | ⚠️ HOLLOW | Reducer tests pass, but selected identity and scroll anchor are never populated/restored by production UI. |
| `mobile/src/screens/SearchScreen.tsx` | Cancellable, retained, actionable results | ✗ WIRED-BUT-FAILED | Fetch/reducer wiring exists; terminal rendering hides retained rows and omits recovery controls. |
| `mobile/src/screens/PlaylistDetailScreen.tsx` | Capability-gated remote detail | ✓ VERIFIED | Calls `providerClient.getPlaylist`, rejects mismatched source/id, and renders retry/error state. |
| `mobile/src/screens/BilibiliDetailScreen.tsx` | Exact BVID/CID selection | ✓ VERIFIED | Semantic BVID/CID flow is used and focused Bilibili tests pass. |
| `mobile/src/player/playerController.ts` | Serialized RNTP transactions | ✓ VERIFIED | Loads before committing current occurrence and consumes FIFO after success; focused controller tests pass. |
| `mobile/src/store/playerSlice.ts` | Occurrence-aware queue/state | ⚠️ ORPHANED ENTRY | Correct occurrence reducers, but the enqueue thunk has no normal user-flow caller. |
| `mobile/src/store/playerPersistence.ts` | Safe rehydrate normalization | ✓ VERIFIED | Migration rejects transport-shaped data and restores paused; persistence tests pass. |
| `mobile/src/screens/PlayerScreen.tsx` | Player/queue/lyric controls | ✗ WIRED-BUT-FAILED | It renders controller-state controls and queue edits, but lacks Add to play-next and editable offset/error-action paths. |
| `mobile/src/player/playbackService.ts` | Shared remote RNTP delegation | ✓ VERIFIED | Registered in `mobile/index.js`; events delegate to the same controller. |
| `mobile/src/lyrics/session.ts` | Occurrence/revision stale guard | ✓ VERIFIED | Session tests exercise part/revision stale rejection. |
| `mobile/src/lyrics/timeline.ts` | Bounded RNTP-clock timeline | ✓ VERIFIED | Parser/active-line unit tests pass; UI cannot apply a user offset. |
| `mobile/src/lyrics/selectionStore.ts` | Revision-CAS correction persistence | ⚠️ ORPHANED CAPABILITY | Store tests pass, but the UI cannot initiate an offset mutation and only Bilibili selection invokes it indirectly. |
| `mobile/src/components/BilibiliLyricPicker.tsx` | Exact-part manual picker | ✓ VERIFIED | Parent callbacks carry selection to the cache/store and Bilibili flow tests pass. |

## Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `SearchScreen` | provider client | scoped search + `AbortSignal` | ✓ WIRED | Helper `searchProvider` calls `providerClient.search` with source/query/page/signal/kind. The plan-tool pattern missed the helper but manual trace confirms it. |
| `SearchScreen` | search journey reducer | generation/cancellation | ✗ PARTIAL | Reducer receives events, but the screen ignores `cancelled-more` when choosing what to render. |
| `TrackRow` | operation capability presentation | play/detail/login/retry/unavailable | ✗ NOT WIRED | `TrackRowAction` exists but no `action=` caller exists. |
| `SearchScreen` | playlist/Bilibili detail | semantic navigation | ✗ PARTIAL | Detail navigation is semantic, but its restoration payload is only scope and does not preserve selection/scroll/rows. |
| `PlayerScreen` | player slice/controller | controller thunks + snapshot | ✓ WIRED | Visible controls dispatch slice thunks; controller owns RNTP. |
| playback service | player controller | remote/progress/error/end | ✓ WIRED | Every registered RNTP callback delegates to `playerController`. |
| store | persistence migration | redux-persist migration | ✓ WIRED | `store/index.ts` imports/configures `migratePlayerState`. |
| `PlayerScreen` | lyric session/timeline/store | active occurrence/revision | ✗ PARTIAL | Session/timeline are wired; offset selection persistence has no user mutation entry point. |
| lyric picker | selection store | manual selection/revision | ✓ INDIRECTLY WIRED | Picker callback is handled by `PlayerScreen`, which writes the exact Bilibili key. |
| `PlayerScreen` | DeepSeek client | consented translation | ✓ WIRED | Existing consent/hash guards remain in the screen; focused translation behavior tests pass. |

## Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| Search screen | `journey.rows` | `providerClient.search` → bounded adapters | Fixture-normalized dynamic DTOs; live provider not run | ⚠️ STATIC ONLY |
| Player screen | Redux `player` snapshot | RNTP controller/service | Controller test mocks exercise it; installed RNTP not run | ⚠️ STATIC ONLY |
| Lyrics sheet | `lyrics`, position, selection | provider client/cache + Redux position | Dynamic identity guards work in tests; offset write path is disconnected | ✗ HOLLOW FOR OFFSET |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase 5 deterministic contracts | `cd mobile && npm test -- --runInBand` with 15 Phase-5-focused suites | 15 suites, 96 tests passed | ✓ PASS |
| Type consistency | `cd mobile && npx tsc --noEmit` | exit 0 | ✓ PASS |
| Search cancellation renders retained rows | Source/test trace | Only reducer test exists; screen explicitly selects full cancelled card | ✗ FAIL |
| Add current/search track to play-next | Call-site trace | No production caller for `addNextTrack`/`enqueueNext` outside Settings backup paths | ✗ FAIL |
| User offset editing | Capability + screen trace | no available offset capability and no setter UI | ✗ FAIL |

## Probe Execution

Step 7c: SKIPPED — Phase plans/summaries declare no probe and `scripts/**/tests/probe-*.sh` yielded none.

## Requirements Coverage

| Requirement | Source plan | Verdict | Evidence |
| --- | --- | --- | --- |
| NET-003 | 05-01 | NEEDS HUMAN | Static Bilibili search/detail/part/lyric seams are wired and tested; an authorized manifest/media/live-provider journey is not Phase-5 evidence and remains Phase 8. |
| NET-004 | 05-01 | NEEDS HUMAN | Static source matrix is explicit (NetEase/Kugou/Bilibili playable; QQ/Kuwo closed where no route exists); live matrix/API proof is absent. This does not cure the broader roadmap five-source-playback failure. |
| SRCH-001 | 05-01 | BLOCKED | Request identity/reducer is tested, but screen cancellation/error rendering loses retained results and retry. |
| SRCH-002 | 05-01 | BLOCKED | Exact Bilibili part selection is tested, but production never captures/restores selected identity or scroll anchor across the required lifecycle. |
| SRCH-003 | 05-01 | BLOCKED | Row metadata is rendered, but operation action descriptors are unused and error recovery is presentation-only. |
| PLAY-001 | 05-02 | NEEDS HUMAN | Single RNTP/controller/service direction is wired; native Media3/RNTP sole-owner behavior needs installed API-35/system evidence. |
| PLAY-003 | 05-02 | NEEDS HUMAN | Static transport handlers exist; real seek/volume/mute/error behavior against RNTP/device is unexercised. |
| PLAY-004 | 05-02 | BLOCKED | Duplicate-safe FIFO mechanics are tested but ordinary users cannot add a play-next occurrence. |
| PLAY-005 | 05-02 | NEEDS HUMAN | Shuffle/history/rapid-next mechanics have partial fixture coverage; no focused natural-end/repeat lifecycle proof against RNTP. |
| PLAY-006 | 05-02 | NEEDS HUMAN | Service is registered and delegates events, but notification, lock screen, audio focus/noisy route, headset/Bluetooth, background and process recovery are unrun Phase-8 acceptance gates. |
| LYR-001 | 05-03 | BLOCKED | Active occurrence/timeline logic is tested; the required user offset is never enabled or editable. |
| LYR-002 | 05-03 | BLOCKED | Bilibili manual selection persistence works, but signed offset persistence is not reachable by a user and other advertised terminal recovery is absent. |
| LYR-003 | 05-03 | BLOCKED | Labels/stale-result tests pass, but all lyric request errors collapse in `catch {}` to an undifferentiated unavailable state. Real TalkBack remains a Phase-8 gate. |

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| `mobile/src/screens/SearchScreen.tsx` | 148-163, 434-454 | Reducer state retained but rendered UI discards it | 🛑 Blocker | Violates non-destructive pagination/cancellation requirement. |
| `mobile/src/components/TrackRow.tsx` | 23-26 | Closed action type has no product caller | 🛑 Blocker | Capability truth is not made visible/actionable per row. |
| `mobile/src/store/playerSlice.ts` | 419-421 | Play-next thunk has no listening-flow caller | 🛑 Blocker | FIFO can be tested but not started by a normal user. |
| `mobile/src/screens/PlayerScreen.tsx` | 283-292 | Bare lyric catch discards typed terminal outcome | 🛑 Blocker | Missing/mismatch/timeout/unsupported are indistinguishable. |

No `TBD`, `FIXME`, or `XXX` debt markers were found in Phase-5-modified production files. Artwork and input placeholders are normal UI fallbacks, not stubs.

## Phase 8 Acceptance Boundary

Phase 8 explicitly owns APK/API-35 install, live-provider/account behavior, device codecs, notification/lock screen, audio focus/noisy route, headset/Bluetooth, background/process recovery, real TalkBack/IME/rotation, and performance evidence. None of those gates were run here, and none is reported as passed. They are **not** used to defer the five code-level gaps above: Phase 8 is an acceptance phase, not an implementation plan for retained search UI, restoration, play-next entry, lyric offset controls, or source capability completion.

## Gaps Summary

Five grouped blockers prevent the phase goal from being achieved: the search UI contradicts its otherwise-correct reducer contract; restoration data is never acquired/restored; the queue cannot be entered by a user; lyric correction/error contracts are not surfaced; and the literal five-source playback roadmap criterion has no approved QQ/Kuwo path. Focused tests and type checking are green, but they do not cover these broken screen-level links.

_Verified: 2026-09-15T02:33:51Z_
_Verifier: the agent (gsd-verifier)_
