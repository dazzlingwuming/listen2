---
phase: 05-five-source-listen-journey
verified: 2026-09-15T04:35:53Z
status: gaps_found
score: 4/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed: []
  gaps_remaining:
    - "Every one of the five visible sources supports the roadmap's search-to-detail-to-authorized-playback journey."
  regressions: []
gaps:
  - truth: "Every one of the five visible sources supports the roadmap's search-to-detail-to-authorized-playback journey."
    status: failed
    reason: "QQ and Kuwo remain search-only in the capability projection, and bootstrapTrack deliberately rejects both with PLAYBACK_UNAVAILABLE."
    artifacts:
      - path: "mobile/src/api/client.ts"
        issue: "QQ and Kuwo have no available playback/bootstrap capability or approved fixed media-candidate contract."
    missing:
      - "Implement source-specific authorized QQ and Kuwo media/bootstrap contracts with bounded route/schema tests, then expose playback only when that evidence exists."
      - "Or obtain an explicit accepted roadmap/requirements override that narrows the literal five-source authorized-playback contract."
---

# Phase 5: Five-Source Listen Journey Verification Report

**Phase Goal:** Within a user's actual authorization, each official mobile source and Bilibili supports a coherent phone journey from search to details, playback, and lyrics.
**Verified:** 2026-09-15T04:35:53Z
**Status:** gaps_found
**Re-verification:** Yes — after `66f8e4d` and `5455585`

## Goal Achievement

This report verifies current canonical `mobile/` code, not SUMMARY assertions. Search retention/restoration, normal play-next entry, lyric editing/error recovery, and exact Bilibili part playback have executable code and focused tests. One code-level roadmap mismatch remains: QQ and Kuwo cannot enter authorized playback.

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Search each source, paginate/cancel safely, retain a successful page, and give recovery without erasing it. | ✓ VERIFIED | `SearchScreen.tsx` keeps retained rows for later-page cancellation/error, renders scoped retry, and rejects late replies. The rendered search suite passes (14 tests). |
| 2 | Supported detail/part navigation preserves source, query, kind, rows, cursor, selection, and scroll context. | ✓ VERIFIED | `SearchScreen.tsx:356-367` captures a bounded DTO and persists it with `navigation.setParams`; `BilibiliDetailScreen` now sends the exact selected CID via `playTracks([track])` to the sole controller. Stack-recreation and exact-part success/failure tests pass. |
| 3 | A user can add a verified search track to the occurrence-safe FIFO play-next queue through a normal listening surface. | ✓ VERIFIED | `TrackRow` renders `onAddNext`; `SearchScreen` dispatches the existing `addNextTrack(track)` thunk only for available playback. The new head-reorder/ownership tests plus prior UI tests pass. |
| 4 | Lyrics provide a user-editable, revision-safe signed offset and distinct actionable terminal states. | ✓ VERIFIED | Bilibili declares app-local `offset: available` in `api/client.ts:135-146`. `PlayerScreen.tsx:550-595` bounds and CAS-saves an offset, while `:1412-1502` renders ±250 ms and typed retry/choose-source actions. The focused lyric suites pass (12 tests), including exact-part offset persistence and terminal-action mapping. |
| 5 | An authorized, device-supported track can traverse search → detail → playback for every listed source. | ✗ FAILED | `api/client.ts:125-133` exposes QQ/Kuwo search without playback. `bootstrapTrack` explicitly rejects both at `:238-242`. The focused client contract passes because those transports correctly remain closed; truthful unavailable is not authorized playback. |

**Score:** 4/5 truths verified (0 present, behavior-unverified).

## Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `mobile/src/screens/SearchScreen.tsx` | Retained, restorable search journey and play-next entry | ✓ VERIFIED | Dynamic `providerClient.search` data reaches rows; restoration is also persisted on the route before pushing detail. |
| `mobile/src/screens/BilibiliDetailScreen.tsx` | Exact-part playback hand-off | ✓ VERIFIED | Selected CID reaches the real player thunk and controller rather than a test-only action shape. |
| `mobile/src/search/searchJourneyState.ts` | Bounded reducer and semantic restoration DTO | ✓ VERIFIED | Substantive and production-wired; rendered stack-recreation test exercises it. |
| `mobile/src/components/TrackRow.tsx` | User-facing play-next affordance | ✓ VERIFIED | Action is rendered and dispatches from a normal search row. |
| `mobile/src/lyrics/selectionStore.ts` | Revision-CAS signed offset persistence | ✓ VERIFIED | `setOffset` preserves manual selection, handles stale/not-found/invalid safely, and is exercised by focused tests. |
| `mobile/src/screens/PlayerScreen.tsx` | Editable offset and distinct lyric recovery actions | ✓ VERIFIED | Capability-gated controls call `setOffset`; typed failure state reaches visible retry/choose-source controls. |
| `mobile/src/api/client.ts` | Five-source authorized playback matrix | ✗ WIRED-BUT-FAILED | Correctly closed QQ/Kuwo operations contradict the roadmap's all-five playback criterion. |

## Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `SearchScreen` | `providerClient.search` | helper with `AbortSignal` | ✓ WIRED | Response updates visible `journey.rows`; cancellation/retry are rendered-test-backed. |
| `SearchScreen` | semantic restoration DTO | `setParams` before detail navigation | ✓ WIRED | `navigation.setParams({ restorationScope })` persists scroll/selection/rows/cursor across stack recreation. |
| `BilibiliDetailScreen` | player thunk/controller | `playTracks([exactPartTrack])` | ✓ WIRED | Focused integration test observes exact CID bootstrap, native add/play, state commit, and no Player navigation on bootstrap failure. |
| `TrackRow` | `playerSlice.addNextTrack` | capability-gated callback | ✓ WIRED | Normal row action reaches occurrence FIFO. |
| `PlayerScreen` | `lyricSelectionStore.setOffset` | bounded ±250 ms user control with revision | ✓ WIRED | `updateLyricOffset` calls CAS storage and only commits current-session results. |
| `PlayerScreen` | lyric terminal UI | typed `lyricFailurePresentation` → action button | ✓ WIRED | Cancellation, timeout, mismatch, missing, unsupported, and provider failures map to safe retry/choose-source actions. |
| `playerController` | `providerClient.bootstrapTrack` | authorized media resolution | ✗ PARTIAL | NetEase/Kugou/Bilibili have paths; QQ/Kuwo reject before a media request. |

## Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| Search screen | `journey.rows` | provider client → reducer → `SearchSurface` | Yes; retained result rows remain displayed after scoped failure | ✓ FLOWING |
| Search restoration | `restorationScope` | scroll/selection capture → route params → restoration reducer | Yes; bounded semantic DTO, never raw transport | ✓ FLOWING |
| Play-next | selected track | `TrackRow` → thunk → occurrence reducer | Yes; repeated user actions retain separate occurrences | ✓ FLOWING |
| Lyric offset | `lyricOffsetMs` | active exact Bilibili part → CAS store → current-session state → timeline | Yes; bounds, stale response protection, and persisted value are exercised | ✓ FLOWING |
| QQ/Kuwo playback | bootstrap media | provider client | No; capability is unavailable and bootstrap throws before transport | ✗ DISCONNECTED |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Search, restoration, play-next, exact Bilibili part, player ownership, lyric recovery | `cd mobile && npx jest src/screens/__tests__/bilibiliFlow.test.tsx src/screens/__tests__/searchJourney.test.tsx src/screens/__tests__/bilibiliLyricsFlow.test.tsx src/screens/__tests__/lyricAccessibility.test.tsx src/lyrics/__tests__/selectionStore.test.ts src/screens/__tests__/playerJourney.test.tsx src/player/__tests__/playerController.test.ts src/player/__tests__/playerController.lifecycle.test.ts src/player/__tests__/playerController.rollback.test.ts src/player/__tests__/playbackService.test.ts src/store/__tests__/playerSlice.test.ts --runInBand` | 99/99 passed | ✓ PASS |
| Type consistency | `cd mobile && npx tsc --noEmit` | exit 0 | ✓ PASS |
| QQ/Kuwo closed playback contract | `cd mobile && npx jest src/api/__tests__/client.test.ts -t 'keeps unproven playback, playlist, and lyric transports closed' --runInBand` | 1 passed; asserts rejected QQ/Kuwo bootstrap | ✗ FAILS roadmap truth |

## Probe Execution

Step 7c: SKIPPED — no phase-declared probe and no `*/tests/probe-*.sh` exists.

## Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| --- | --- | --- | --- |
| NET-003 | 05-01 | PARTIAL | Bilibili code contracts are wired; authorized live media remains Phase 8 evidence. |
| NET-004 | 05-01 | BLOCKED | QQ and Kuwo lack playback/bootstrap contracts. |
| SRCH-001 | 05-01 | SATISFIED | Rendered retained-page cancellation/error/retry tests pass. |
| SRCH-002 | 05-01 | SATISFIED | Route-persisted bounded restoration and exact Bilibili part thunk hand-off survive focused success/failure tests. |
| SRCH-003 | 05-01 | SATISFIED | Capability-gated actions and non-destructive error states are rendered. |
| PLAY-001 | 05-02 | PARTIAL | Single-controller contracts are tested, but the five-source playback outcome remains blocked. |
| PLAY-003 | 05-02 | PARTIAL | Deterministic controller/UI tests pass; device MediaSession proof remains Phase 8. |
| PLAY-004 | 05-02 | SATISFIED | A normal search row reaches tested occurrence-safe FIFO behavior. |
| PLAY-005 | 05-02 | SATISFIED | Focused transition tests pass. |
| PLAY-006 | 05-02 | PARTIAL | Service wiring is present; system-control/lifecycle evidence is Phase 8 only. |
| LYR-001 | 05-03 | SATISFIED | Exact active-part, bounded signed offset, and timeline paths are wired and tested. |
| LYR-002 | 05-03 | SATISFIED | Manual selection and offset persistence use exact keys plus revision CAS. |
| LYR-003 | 05-03 | SATISFIED | Distinct safe lyric terminals and actions are mapped and rendered by the sheet/picker paths. |

## Anti-Patterns Found

No `TBD`, `FIXME`, or `XXX` marker was found in the relevant Phase-5 files. Normal artwork/input placeholders are UI fallbacks, not stubs.

## Phase 8 Acceptance Boundary

Phase 8 still owns installed APK/API-35, live provider/account/entitlement and codec behavior, notification/lock-screen/audio focus/headset/Bluetooth, background/process recovery, actual TalkBack/IME/rotation, and performance evidence. None was run or credited here. These are external runtime gates; they do not defer the remaining QQ/Kuwo implementation gap.

## Gaps Summary

One blocker remains: QQ and Kuwo cannot bootstrap authorized media. The source matrix honestly marks them unavailable, but the Phase 5 roadmap requires authorized playback for every one of the five visible sources. Implement those bounded contracts or obtain an accepted contract override before this phase can pass.

_Verified: 2026-09-15T04:35:53Z_
_Verifier: the agent (gsd-verifier)_
