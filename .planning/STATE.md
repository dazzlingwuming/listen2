---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: android-official-mobile-product-pivot
current_phase: 5
current_phase_name: Five-Source Listen Journey
status: executing
stopped_at: Completed 05-03-PLAN.md
last_updated: "2026-09-15T02:26:04.241Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
  percent: 40
last_activity: 2026-09-14
last_activity_desc: Closed quick 260914-kh4 MV source and native JVM gates; 26 mobile suites/145 tests plus Android JVM tests passed
---

# Project State

## Project Reference

See: `.planning/PROJECT.md`

**Core value:** Android users reliably complete an authorized end-to-end music journey from search through playback, lyrics, and later control.

**Current focus:** Standalone React Native mobile parity; offline, Discover, native Bilibili account/audio, consented DeepSeek, and Bilibili exact-part lyric selection implemented; QQ/Kuwo playback, advanced media surfaces, and integrated runtime acceptance pending

## Current Position

Phase: 5 — Five-Source Listen Journey

Plan: 3 of 3

Status: Ready to execute

Progress: [██████████] 100%

## Performance Metrics

**Velocity:** Reset at the approved product pivot; prior per-plan counts belong to the superseded infrastructure-first roadmap and are not comparable.

| Phase                        | Plans | Status      |
| ---------------------------- | ----- | ----------- |
| 4. Official Mobile Shell & Unified Provider Registry | TBD   | Not started |
| 5. Five-Source Listen Journey | TBD   | Not started |
| 6. Personal Library & Continuity | TBD   | Not started |
| 7. Offline & Advanced Desktop-Equivalent Playback | TBD   | Not started |
| 8. Integrated API 35 Acceptance & Release-Like Evidence | TBD   | Not started |

**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04 P01 | 13m | 3 tasks | 9 files |
| Phase 04 P02 | 10min | 2 tasks | 3 files |
| Phase 04-official-mobile-shell-unified-provider-registry P03 | 16min | 2 tasks | 3 files |
| Phase 05 P01 | 45m | 3 tasks | 12 files |
| Phase 05 P02 | 65m | 3 tasks | 10 files |
| Phase 05 P03 | 8min | 3 tasks | 12 files |

## Accumulated Context

### Decisions

- Product reference is the original author's `listen1/listen1_mobile` v0.8.2: use its phone-first shell, navigation, focused player flow, and uniform four-provider contract as behavior/design reference. Add Bilibili as the fifth Android source.
- Technology does not revert to the old React Native 0.59 / SDK 28 implementation. Keep the SDK 35 WebView hardening, typed bridge, Media3 sole owner, Room, SAF, Keystore, and native cache ownership.
- Do not translate the original app's legacy direct HTTP, cleartext, caller-cookie/header, or unbounded Promise behavior. The shared provider contract is consolidated first; native logic is reserved for privileged lifecycle, secure storage, local file, download/cache, and media ownership responsibilities.
- The latest desktop `main` capability set remains the v1 promise. A desktop-only form is rendered as Android-equivalent UX or reported as unavailable with a real reason; it is not silently dropped.
- Current bridge, Media3, Room, SAF, cache, Bilibili/NetEase and lyric code are foundation facts. They are neither a five-source product claim nor final E2E acceptance.
- Fast iteration uses scoped JavaScript/JVM/contract tests after coherent work. Do not assemble an APK merely to inspect each small change. Phase 8 performs the integrated API 35 emulator, performance, and release-like validation.
- [Phase ?]: Android primary provider order is netease, kugou, kuwo, qq, bilibili; Migu and Taihe remain registry-only unavailable.
- [Phase ?]: Missing semantic routes terminate OPERATION_UNAVAILABLE without provider, bridge, MediaService, or transport fallback.
- [Phase ?]: Android search selects NetEase first and projects all five primary sources from MobileProviderRegistry.
- [Phase ?]: The shared semantic lifecycle owns deadline, cancellation, stale-reply, and exactly-once terminal settlement; only the existing search seam is dispatched.
- [Phase ?]: System Back blurs active phone search, closes confirmation and child layers nearest-first, then falls through to the existing Activity policy.
- [Phase ?]: The terminal 760px rule owns 64px dock/tab geometry, safe-area clearance, single-row source selection, and motion/accessibility backstops.
- [Quick 260914-kh4]: RNTP remains the sole audio/MediaSession/audio-focus owner; MV transport is native-only, muted/video-only, opaque-handle based, and semantic-only across recovery boundaries.
- [Phase ?]: Phase 05 search actions read operation-level capability truth; legacy booleans are compatibility-only.
- [Phase ?]: Play-next requests are stable occurrence IDs with nested semantic tracks, preserving duplicate queue edits.
- [Phase ?]: Player rehydrate normalizes persisted semantic state and always waits for explicit user play before native loading.
- [Phase ?]: Lyrics bind source/track/part/occurrence/revision before settlement.
- [Phase ?]: Manual lyric correction remains capability-gated; unverified offset operations do not dispatch.

### Pending Todos

- Plan and execute Phase 4 around source registry and official-style mobile navigation.
- Implement Phase 5 as one coherent NetEase/QQ/Kugou/Kuwo/Bilibili source journey, rather than adding per-endpoint native patches.
- Obtain user-owned credentials only for final Bilibili QR and DeepSeek checks; keep them outside the repository.
- Complete the approved semantic QQ/Kuwo playback fallbacks without restoring legacy arbitrary URL/cookie/header authority, then validate MV/PiP runtime behavior on an API 35 emulator/device.
- Continue with the next coherent mobile-parity slice; keep APK generation and API 35 runtime acceptance for the integrated acceptance stage.
- Use user-owned SAF media only in the final integrated acceptance and record absence as `not verified`.

### Blockers/Concerns

- The official reference app is a useful product/contract reference, not a safe code drop-in: it is React Native 0.59-era software and includes legacy provider behavior incompatible with the API 35 security constraints.
- Music-provider availability, membership, region, DRM, endpoint drift, WebView codec support, and device PiP/effect support remain external variables. They must produce a visible, actionable state rather than a claimed success.
- Existing historical Android evidence and `android/evidence/phase01/` are preserved but cannot prove the newly specified five-source journey. Do not delete or overwrite the untracked Phase 1 evidence while executing this roadmap.
- Release signing, merge, and deploy remain out of scope. Local toolchain drift from repository-pinned Gradle/JDK must be recorded during Phase 8 rather than hidden.
- OpenJDK 17, Android SDK, Build Tools 36.0.0, and NDK 27.1.12297006 are available locally. The exact offline `:app:testDebugUnitTest` gate now passes; AndroidKeyStore/content-provider/TrackPlayer runtime remains `not verified` until API 35 acceptance. JavaScript behavior, typecheck, lint, formatting, and native JVM tests passed.
- Quick 260914-kh4 source and native JVM closure is committed and pushed as `4f02a7c`. No APK, emulator/device, live provider/account, signing, merge, or deploy run was performed.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 260913-g8n | NetEase/Kugou verified offline downloads, cache-first playback, and download management | 2026-09-13 | 5ae3984 | Needs Review | [260913-g8n-implement-the-first-production-offline-d](./quick/260913-g8n-implement-the-first-production-offline-d/) |
| 260913-jlv | Real NetEase/Kugou Discover collections, truthful detail, and rollback-safe play-all | 2026-09-13 | 770a116 | Needs Review | [260913-jlv-replace-the-placeholder-react-native-dis](./quick/260913-jlv-replace-the-placeholder-react-native-dis/) |
| 260914-f3q | Native Bilibili QR session, exact multipart selection, and authenticated semantic audio resolution | 2026-09-14 | 8ce07d1 | Needs Review | [260914-f3q-implement-bilibili-account-session-exact](./quick/260914-f3q-implement-bilibili-account-session-exact/) |
| 260914-h1s | Consented native DeepSeek lyric translation, strict alignment, and private track-bound cache | 2026-09-14 | 0c0f42d | Needs Review | [260914-h1s-implement-consented-deepseek-lyric-trans](./quick/260914-h1s-implement-consented-deepseek-lyric-trans/) |
| 260914-iuc | Bilibili exact-part automatic/manual lyrics, bounded dormant Kugou/Kuwo adapters, and Bilibili DeepSeek handoff | 2026-09-14 | 10663d0 | Needs Review | [260914-iuc-complete-five-source-mobile-lyric-parity](./quick/260914-iuc-complete-five-source-mobile-lyric-parity/) |
| 260914-kh4 | Safe native Bilibili MV, fullscreen/PiP, and semantic recovery source slice | 2026-09-14 | 4f02a7c (+ a9a44ee, 60598aa, eef2a56, a3c0121) | Human needed; source/native gaps empty; API 35 runtime pending | [260914-kh4-implement-safe-bilibili-mv-fullscreen-pi](./quick/260914-kh4-implement-safe-bilibili-mv-fullscreen-pi/) |
| 3 | Refresh Android mobile progress documentation after offline and Discover implementation | 2026-09-13 | 0ad8ef4 | — | — |

## Deferred Items

| Category | Item | Status | Deferred At |
| --- | --- | --- | --- |
| *(none)* | All 58 requirements remain in Android v1.0 | Not deferred | - |

## Session Continuity

**Resume file:** None

Last session: 2026-09-15T02:26:04.233Z

Stopped at: Completed 05-03-PLAN.md

Resume with: implement the next coherent mobile-parity slice without per-feature APK generation; preserve API 35 emulator/device, live-provider, and release-like checks for integrated acceptance
