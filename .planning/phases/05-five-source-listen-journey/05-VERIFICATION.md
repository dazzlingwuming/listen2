---
phase: 05-five-source-listen-journey
verified: 2026-09-15T06:19:12Z
head: c495c55a41785451620ca4fb092bc1f37cad8308
status: complete
verdict: deterministic_complete_phase8_external_acceptance_unverified
score: 5/5 deterministic must-haves verified
behavior_unverified: 8
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "QQ and Kuwo now expose a fail-closed native bootstrap path and registered Android packages."
  gaps_remaining: []
  regressions: []
gaps: []
external_unverified:
  - APK build and installation on Android API 35
  - live provider route, CDN, codec, account, entitlement, and audible-media behavior
  - MediaSession notification, lock screen, focus/noisy, headset, Bluetooth, background, and process-recovery behavior
  - physical-device TalkBack, IME, rotation, and visual interaction acceptance
---

# Phase 5: Five-Source Listen Journey Verification Report

**Goal:** Within a user's actual authorization, each official mobile source and Bilibili supports a coherent phone journey from search to details, playback, and lyrics.

**Verdict:** **COMPLETE for deterministic Phase-5 contracts (5/5).** This is not an APK, live-provider, or device-runtime acceptance claim. Those external checks are explicitly owned by Phase 8.

## Goal-backward result

| # | Roadmap truth | Deterministic evidence | Result |
| --- | --- | --- | --- |
| 1 | Five-source search is source-labelled, paginated/cancellable, restores context, and a failed source does not destroy retained results. | `SearchScreen.tsx:102-229,356-367` uses an abort epoch plus bounded restoration DTO; `searchJourneyState.ts:138-188,223-287` rejects stale/out-of-scope replies and preserves retained pages. Rendered search tests passed. | VERIFIED |
| 2 | A supported result reaches its source-appropriate detail context and back/restoration preserves the search journey. | Normal tracks use direct play when the source has no verified directory route; `PlaylistDetailScreen.tsx:78-123` keeps its detail failure in place. Bilibili search opens `BilibiliDetail`, and `BilibiliDetailScreen.tsx:54-66` constructs only the selected exact `bvid/cid` track. Focused Bilibili and restoration tests passed. | VERIFIED |
| 3 | Every listed source has a safe deterministic route from a selected authorized track to the sole RNTP player; a failed replacement leaves current semantic/audio context intact. | NetEase/Kugou use fixed existing bootstrap adapters; Bilibili resolves the exact part; QQ/Kuwo select `bootstrapNativeTrack` only after exact native readiness (`client.ts:192-249`). `MainApplication.kt:22-26` registers both native packages. `playerController.ts:521-619,889-979` resolves before commit, serializes RNTP mutation, and restores the old snapshot after a load failure. | VERIFIED |
| 4 | Play-next and normal playlist actions retain occurrence identity, serialize rapid replacements, and restore safely. | `playerSlice.ts:493-518` routes UI thunks to the controller; `playerController.ts:655-739,1094-1217` serializes native/queue mutations, aborts a superseded resolution before it can mutate RNTP, and consumes only the accepted queue occurrence. Persistence strips transport and forces paused rehydrate (`playerPersistence.ts:177-256`). Player/rollback/lifecycle/slice/persistence tests passed. | VERIFIED |
| 5 | Active lyrics are occurrence/revision-safe; available lyric routes synchronize and unsupported routes remain explicit without stale content or fabricated timing. | `session.ts:48-100` keys source/track/part/occurrence/revision; `timeline.ts:74-92` applies only a bounded signed local offset; `selectionStore.ts:190-285` is revision-CAS. `client.ts:251-271` exposes NetEase/QQ/Bilibili lyric paths and typed unavailable results for routes not proven (Kugou/Kuwo), which is the required recovery behavior. Lyric, accessibility, and Bilibili flow tests passed. | VERIFIED |

## Five-source journey matrix

| Source | Search and context | Playback/bootstrap route | Lyrics/recovery | Deterministic status |
| --- | --- | --- | --- | --- |
| NetEase | Provider search plus verified playlist/detail routes. | Existing fixed NetEase bootstrap → `PlayerController` → RNTP. | Fixed NetEase lyric path; timeline/offset guards. | VERIFIED |
| Kugou | Provider search; unsupported directory/playlist fields remain explicit rather than inferred. | Existing fixed Kugou bootstrap → common controller/RNTP transaction. | Deliberately typed `LYRIC_UNAVAILABLE`; UI does not fabricate a lyric. | VERIFIED (capability-accurate degradation) |
| Kuwo | Provider search emits `kwtrack_<positive decimal>` semantic IDs. | `Listen2KuwoPlayback` is registered; semantic-only JS call, exact readiness/host contract, fixed native homepage/play/probe flow, and vetted descriptor reach the common controller. | Deliberately typed `LYRIC_UNAVAILABLE`; playback is not blocked by lyric failure. | VERIFIED (live route still Phase 8) |
| QQ | Provider search emits `qqtrack_<mid>` semantic IDs. | `Listen2QqPlayback` is registered; fixed cookie-free musicu POST/probe returns only a vetted short lease to the common controller. | Fixed QQ lyric adapter; typed errors preserve playback context. | VERIFIED (live route still Phase 8) |
| Bilibili | Search opens exact video detail; selected part preserves BVID/CID and restoration scope. | Exact selected CID → Bilibili native media resolution → common controller/RNTP. Fast second-part selection aborts the first. | Exact-part lyric session, candidates/manual choice where supported, offset and typed recovery. | VERIFIED (live authorization/CDN still Phase 8) |

“Verified” above means the repository's deterministic implementation and fixture contracts are complete. It does not claim that every provider will return playable media for a real account; entitlement, region, DRM, codec, and provider changes still surface as typed failures.

## Critical link and security verification

| Link | Evidence | Result |
| --- | --- | --- |
| Bilibili selected part → player | `BilibiliDetailScreen.tsx:54-66` emits `playTracks([exactPart])`; `playerController.test.ts` and `bilibiliFlow.test.tsx` cover exact CID, fast replacement, and no Player navigation on failed bootstrap. | VERIFIED |
| QQ/Kuwo capability → native resolver | `nativePlayback.ts:36-61,137-198` requires exact provider/version/policy-ready/one-host constants, only accepts semantic IDs, validates an eight-field descriptor, lease, MIME, size, HTTPS host, and cancellation. `client.test.ts` covers activation, cancellation, and extra/duplicate/swapped-host rejection. | VERIFIED |
| QQ resolver boundary | `QqPlaybackModule.kt:41-118` accepts only version/requestId/trackId; `QqPlaybackGateway.kt:24-64` fixes POST/probe shape and checks cancellation between steps. `QqPlaybackPolicy.kt:99-157` limits the media host, MIME, size, redirects and provider error mapping. No caller URL/header/cookie/session parameter crosses JS. | VERIFIED — offline JVM suite passed |
| Kuwo resolver boundary | `KuwoPlaybackModule.kt:41-106` is semantic-only and invalidates active leases on teardown; `KuwoPlaybackGateway.kt:31-86` keeps Cookie/Secret in process memory, uses fixed homepage/play/probe routes, retries session once, and checks cancellation. `KuwoPlaybackPolicy.kt:45-128` bounds nonce, URL, MIME, size and hosts. | VERIFIED — offline JVM suite passed |
| Sole RNTP owner and stale callbacks | `index.js:9-12` registers one service; `store/index.ts:56-67` configures one controller/paused restore. `playbackService.ts:9-129` delegates remotes to that controller, verifies the active native identity before terminal state/error changes, and `playerController.ts:1397-1452` rejects identifier-less or stale callbacks. | VERIFIED by focused JS tests |
| Failed transition preserves existing playback | `transition()` resolves before mutation and restores a captured RNTP snapshot after failed replacement (`playerController.ts:521-619`); `playTracksInternal()` has equivalent rollback (`:903-979`). Rollback suites verify current track, queue, history and playing state survive a resolver/add failure. | VERIFIED |

## Requirement coverage

| Requirement | Deterministic verdict | Evidence / remaining boundary |
| --- | --- | --- |
| NET-003 | SATISFIED | Exact Bilibili search → detail/part → vetted bootstrap → lyric entry/error contract is wired and tested. Live login, entitlement, CDN and codec remain Phase 8. |
| NET-004 | SATISFIED | NetEase closed route plus independent QQ/Kugou/Kuwo capability fields; QQ/Kuwo now have native bootstrap. Unsupported directory/lyric fields are explicitly closed, as required by the capability matrix. |
| SRCH-001 | SATISFIED | Epoch/AbortSignal, paging, cancellation, retry, source-labelled rendering and terminal states are covered by `searchJourney.test.tsx`. |
| SRCH-002 | SATISFIED | Bounded search restoration and source-specific detail behavior are wired; exact Bilibili part is covered end-to-end in the JS harness. |
| SRCH-003 | SATISFIED | Each row keeps source metadata and exposes play/detail/unavailable action from capability state; failure preserves existing result context. |
| PLAY-001 | SATISFIED (deterministic) | One JS controller/RNTP command path, native resolver bounds, and rollback/rapid-replacement tests pass. Device media runtime is Phase 8. |
| PLAY-003 | SATISFIED (deterministic) | Confirmed controller transactions cover play/pause/seek/volume/mute/retry and screen state. Notification/lock-screen/focus/hardware behavior is Phase 8. |
| PLAY-004 | SATISFIED | Stable duplicate occurrence IDs, FIFO, reorder/remove/clear, exact consumption, and sanitized rehydrate are in reducer/controller tests. |
| PLAY-005 | SATISFIED | Shuffle/repeat/history and exactly-once rapid/natural-next control logic are covered in controller/slice tests. |
| PLAY-006 | IMPLEMENTED; runtime acceptance unverified | Service registration, remote delegation, active identity quarantine and paused rehydrate are present/tested. Screen-off, background/renderer loss, process recovery, notification/lock-screen, focus/noisy/headset/Bluetooth require Phase-8 device evidence. |
| LYR-001 | SATISFIED | Exact occurrence/revision timeline guard, Bilibili/NetEase paths, bounded offset and stale-safe clock projection are tested. |
| LYR-002 | SATISFIED | Manual Bilibili selection and offset persist through bounded revision-CAS; unavailable providers retain clear degradation. |
| LYR-003 | SATISFIED (deterministic) | Stale callbacks, typed terminal recovery and accessibility labels/active-line semantics are covered. Physical TalkBack acceptance is Phase 8. |

## Focused verification run

| Check | Command | Result |
| --- | --- | --- |
| Type consistency | `cd mobile && npx tsc --noEmit` | PASS (exit 0) |
| Search, provider/bootstrap, Bilibili part, player/RNTP ownership, persistence, lyric and accessibility contracts | `cd mobile && npx jest --runInBand src/api/__tests__/client.test.ts src/player/__tests__/playerController.test.ts src/player/__tests__/playerController.rollback.test.ts src/player/__tests__/playerController.lifecycle.test.ts src/player/__tests__/playerController.bilibiliRetry.test.ts src/player/__tests__/playbackService.test.ts src/store/__tests__/playerSlice.test.ts src/store/__tests__/playerPersistence.test.ts src/screens/__tests__/searchJourney.test.tsx src/screens/__tests__/bilibiliFlow.test.tsx src/screens/__tests__/playerJourney.test.tsx src/screens/__tests__/bilibiliLyricsFlow.test.tsx src/screens/__tests__/lyricAccessibility.test.tsx src/lyrics/__tests__/session.test.ts src/lyrics/__tests__/timeline.test.ts src/lyrics/__tests__/selectionStore.test.ts` | PASS — 16 suites, 150 tests |
| Offline JVM contracts, including QQ/Kuwo resolver tests | `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH ./mobile/android/gradlew --offline --no-daemon -p mobile/android :app:testDebugUnitTest` | PASS — `BUILD SUCCESSFUL in 9s`; 151 actionable tasks (the full debug unit-test task includes QQ/Kuwo contracts). |
| Diff integrity | `git diff --check 868a594..HEAD -- mobile` | PASS |

No APK, emulator, live provider, account, CDN, audible-media, or system-control command was run.

## Phase 8 acceptance boundary

The following are intentionally **not** credited by this report: API-35 build/install; real provider response schemas; actual account/login/paid/DRM/region status; CDN reachability/redirect behavior; codec/audible playback; notification/lock-screen/audio-focus/noisy/headset/Bluetooth callbacks; background/renderer/process recovery; and physical-device TalkBack/IME/rotation interaction. Per `ROADMAP.md:112-115`, these are Phase-8 acceptance gates. Their absence does not reopen the now-closed deterministic QQ/Kuwo implementation gap, but it does prevent a `parity-ready` product claim.

_Verified: 2026-09-15T06:19:12Z_
_Verifier: the agent (gsd-verifier)_
