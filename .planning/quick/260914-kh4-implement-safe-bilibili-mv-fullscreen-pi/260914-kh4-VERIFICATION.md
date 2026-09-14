---
phase: quick-260914-kh4-implement-safe-bilibili-mv-fullscreen-pi
verified: 2026-09-14T19:28:38+08:00
status: human_needed
score: 4/6 must-haves verified
behavior_unverified: 2
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 4/6
  gaps_closed:
    - "All nine review findings are represented in the current source: exact MV identity sync, validated deterministic candidate/backup routing, stable opaque randomness, stale release, lifecycle gating, typed retries, and dependency/compile alignment."
    - "BilibiliRandom replaces API-sensitive encoding with bounded SecureRandom hexadecimal output for native opaque/session identifiers."
    - "React Native 0.87 native dependency versions are aligned for gesture handling and safe area, and the latest offline Android unit-test gate is BUILD SUCCESSFUL."
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "RNTP is the only actual Android audio/MediaSession/notification/audio-focus owner while MV is muted video-only and MV failure leaves audio playing."
    test: "Run the API-35 RNTP-plus-MV ownership matrix through play, error, backup-source fallback, quality switch, close, and background/foreground."
    expected: "Exactly one audio owner, no audible MV audio, and video-only failure/release without RNTP interruption."
    why_human: "Media3/RNTP focus and notification ownership require a live Android runtime."
  - truth: "Fullscreen, PiP, rotation, detach, backgrounding, process recreation, and real Bilibili responses preserve one owner and semantic-only recovery."
    test: "On API 35, exercise PiP/fullscreen/rotation/background/process recreation and an authorized or fake-manifest Bilibili resolve."
    expected: "PiP waits for a usable surface, late sync cannot resume background video, restoration creates fresh transport, and provider errors remain typed."
    why_human: "Activity/PiP/surface and live provider timing are outside JVM and JS tests."
human_verification:
  - test: "Run API-35 device acceptance for RNTP + muted MV: source fallback/error, stale close, quality, fullscreen/PiP, rotation, background/foreground, process recreation."
    expected: "One audio/session/focus/notification owner; no leaked native handle/view; semantic-only restore and correctly gated visibility."
    why_human: "End-to-end Android media behavior is not statically or JVM-test verifiable."
  - test: "Run an authorized Bilibili BVID/CID or a local fake-manifest acceptance case."
    expected: "Exact part resolves through native policy; entitlement/network/region/member conditions are typed and do not expose signed transport."
    why_human: "Provider and entitlement state are external."
---

# Quick 260914-kh4: Safe Bilibili MV / Fullscreen / PiP Final Verification

**Phase Goal:** Implement a safe native-only Bilibili MV slice in the canonical React Native app while retaining RNTP as the single Android audio owner.

**Verified:** 2026-09-14T19:28:38+08:00

**Status:** human_needed

**Re-verification:** Yes — after final review fixes, BilibiliRandom, RN 0.87 dependency alignment, and Kotlin compile fixes.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | RNTP 4.1.2 remains sole audio player, MediaSession, notification, and audio-focus owner; MV is video-only/muted and error fallback preserves audio. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `BilibiliMvView.kt:117-126` disables `TRACK_TYPE_AUDIO`, sets zero volume, and has no audio-attributes/focus/session/foreground-service path. Live ownership remains device-only. |
| 2 | Every MV operation starts with exact BVID/CID and allow-listed quality/codec; selected part/transport remain native behind opaque handles. | ✓ VERIFIED | Current `mvSync` additionally binds handle to BVID/CID; policy/controller/JVM tests validate requests, part matching, opaque public projection, and stale generations. |
| 3 | Signed video URL/cookie/caller header/deadline/raw reply/native exception never enters JS DTOs, persistence, logs, or recovery snapshots. | ✓ VERIFIED | `SurfaceBinding.urls` is internal only; public maps/strict JS DTOs contain opaque handle + safe metadata; Activity snapshot is semantic only. Fixed Referer is native constant in `BilibiliMvView.prepare`, not JS input/output. |
| 4 | Manifest/candidate validation rejects unsafe scheme/host/deadline/codec/MIME/dimension/count/mismatched BVID-CID before surface preparation. | ✓ VERIFIED | `BilibiliMvPolicy` validates every primary and backup URL before `SurfaceBinding`; latest JVM suite includes policy/controller/lifecycle coverage. |
| 5 | State/error/retry/handle transitions are bounded, typed, stale-safe, and do not retain stale signed transport. | ✓ VERIFIED | Controller resolves outside lock with generation check; stale screen operations close their returned handle; error listener is binding-generation guarded; fixed native backup route is bounded; `REQUEST_TIMEOUT` remains terminal. |
| 6 | Fullscreen, PiP, rotation, detach, background, and recreation preserve ownership and re-resolve semantic state only. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Semantic Bundle → one-shot native bridge → RootNavigator → fresh resolve/sync is wired; PiP requires active valid attached surface and `hostPaused` blocks late sync replay. Device behavior is pending. |

**Score:** 4/6 truths verified (2 present, behavior-unverified)

## Final Source and Wiring Review

| Concern | Verdict | Evidence |
| --- | --- | --- |
| Single audio owner | ✓ SOURCE SAFE | View explicitly disables audio track and makes no MediaSession/focus/audio-attribute/service call. RNTP is untouched. |
| Signed transport confinement | ✓ WIRED | Candidate URLs exist only in private controller/binding/view; JS uses strict allow-listed public DTOs; recovery Bundle has semantic fields only. |
| Exact identity and quality | ✓ WIRED | Module/client pass BVID/CID with opaque handle for sync; controller rejects mismatch, chooses exact validated quality, and projects deduplicated safe variants. |
| Bounded native candidate fallback | ✓ WIRED | Policy validates primary plus at most three backups; view uses the next native-only validated source on player error, then releases/fails. |
| Stale/cancellation/cleanup | ✓ WIRED | Controller generation guards I/O commit; `releaseStale` covers open/restore/sync/quality responses; lifecycle invalidation cancels/releases; old listener generations cannot tear down new binding. |
| PiP/background/restore | ✓ WIRED | Valid attached surface gate, host pause gate, semantic-only restore handoff, fresh native resolve. |
| Entropy/compatibility | ✓ WIRED | `BilibiliRandom` uses bounded `SecureRandom` hexadecimal encoding without Android/JDK Base64 differences. |
| RN 0.87 native integration | ✓ WIRED | `react-native-gesture-handler@2.33.0` and `react-native-safe-area-context@5.8.0` align with the current React Native dependencies; latest native JVM gate passes. |

## Data-Flow Trace

| Flow | Source → sink | Status |
| --- | --- | --- |
| Resolve / surface | semantic BVID/CID/quality → controller-private validated candidate list → `SurfaceBinding.urls` → native `ProgressiveMediaSource` | ✓ CONFINED |
| Fallback | Media3 player error → next already-validated native URL (max 3 backups) → otherwise controller `VIDEO_UNAVAILABLE` and view release | ✓ BOUNDED |
| Sync | semantic handle+BVID+CID+position+intent → controller → view manager → muted view with hard-seek/rate/host-pause gate | ✓ FLOWING |
| Recovery | semantic Activity snapshot → `mvConsumePendingRestore` → RootNavigator → screen open/fresh transport → semantic sync | ✓ FLOWING, no signed transport |

## Verification Evidence

| Gate | Result |
| --- | --- |
| Offline Android JVM gate | ✓ `./gradlew --offline --no-daemon :app:testDebugUnitTest` **BUILD SUCCESSFUL**; latest evidence reports 44 passing tests after Kotlin/RN 0.87 compile fixes. |
| Full mobile JavaScript | ✓ Re-run: 26 suites / 145 tests passed. |
| TypeScript | ✓ Re-run: `npm run mobile:typecheck` exit 0. |
| Quiet lint / Prettier | ✓ Latest supplied full quiet lint and source Prettier gate passed. |
| Diff integrity | ✓ Re-run: `git diff --check` exit 0. |

The integrated gate ran at 2026-09-14 19:27:32–19:27:49 CST (Asia/Shanghai).

## Anti-Pattern Scan

No source-level MV safety blocker, signed-transport projection, TODO/FIXME/XXX debt marker, or audio-owner regression was found in the final MV/native bridge paths. `BilibiliRandom` is bounded, uses `SecureRandom`, and does not introduce transport/persistence/log exposure.

## Human Verification Required

### 1. API-35 media ownership and lifecycle

**Test:** Exercise RNTP audio plus MV through error/fallback, stale close, quality, fullscreen/PiP, rotation, background/foreground, and process recreation.

**Expected:** RNTP alone owns audio focus/session/notification; MV remains muted; no stale renderer/handle survives; restore is semantic-only and fresh.

**Why human:** Real Media3, RNTP, Activity, surface and PiP behavior requires a device/emulator.

### 2. Authorized provider acceptance

**Test:** Resolve an authorized Bilibili BVID/CID, plus login/member/region/network failure cases (or an approved fake manifest).

**Expected:** Exact content follows native policy; failures are typed and contain no signed URL/header/cookie/deadline in UI or state.

**Why human:** Provider availability and entitlement are external state.

## Final Assessment

`gaps_remaining` is empty. All source-level and JVM-testable contracts are implemented and wired, including the final review remediation, secure native random encoding, and RN 0.87 dependency/compile alignment. `human_needed` remains correct because only API-35 runtime media/PiP behavior and live provider acceptance are unverified.

---

_Verified: 2026-09-14T19:28:38+08:00_

_Verifier: gsd-verifier_
