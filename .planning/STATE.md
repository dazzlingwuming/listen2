---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: android-official-mobile-product-pivot
current_phase: 5
current_phase_name: Five-Source Listen Journey
status: planning
stopped_at: Completed 04-03-PLAN.md
last_updated: "2026-09-10T10:46:34.748Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 20
last_activity: 2026-09-10
last_activity_desc: Reframed Android roadmap around official Listen1 Mobile product behavior and current desktop parity
---

# Project State

## Project Reference

See: `.planning/PROJECT.md`

**Core value:** Android users reliably complete an authorized end-to-end music journey from search through playback, lyrics, and later control.

**Current focus:** Phase 04 — official-mobile-shell-unified-provider-registry

## Current Position

Phase: 5 — Five-Source Listen Journey

Plan: Not started

Status: Ready to plan

Progress: [██████████] 100%

## Performance Metrics

**Velocity:** Reset at the approved product pivot; prior per-plan counts belong to the superseded infrastructure-first roadmap and are not comparable.

| Phase | Plans | Status |
| --- | --- | --- |
| 4. Official Mobile Shell & Unified Provider Registry | TBD | Not started |
| 5. Five-Source Listen Journey | TBD | Not started |
| 6. Personal Library & Continuity | TBD | Not started |
| 7. Offline & Advanced Desktop-Equivalent Playback | TBD | Not started |
| 8. Integrated API 35 Acceptance & Release-Like Evidence | TBD | Not started |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04 P01 | 13m | 3 tasks | 9 files |
| Phase 04 P02 | 10min | 2 tasks | 3 files |
| Phase 04-official-mobile-shell-unified-provider-registry P03 | 16min | 2 tasks | 3 files |

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

### Pending Todos

- Plan and execute Phase 4 around source registry and official-style mobile navigation.
- Implement Phase 5 as one coherent NetEase/QQ/Kugou/Kuwo/Bilibili source journey, rather than adding per-endpoint native patches.
- Obtain user-owned credentials only for final Bilibili QR and DeepSeek checks; keep them outside the repository.
- Use user-owned SAF media only in the final integrated acceptance and record absence as `not verified`.

### Blockers/Concerns

- The official reference app is a useful product/contract reference, not a safe code drop-in: it is React Native 0.59-era software and includes legacy provider behavior incompatible with the API 35 security constraints.
- Music-provider availability, membership, region, DRM, endpoint drift, WebView codec support, and device PiP/effect support remain external variables. They must produce a visible, actionable state rather than a claimed success.
- Existing historical Android evidence and `android/evidence/phase01/` are preserved but cannot prove the newly specified five-source journey. Do not delete or overwrite the untracked Phase 1 evidence while executing this roadmap.
- Release signing, merge, and deploy remain out of scope. Local toolchain drift from repository-pinned Gradle/JDK must be recorded during Phase 8 rather than hidden.

## Deferred Items

| Category | Item | Status | Deferred At |
| --- | --- | --- | --- |
| *(none)* | All 58 requirements remain in Android v1.0 | Not deferred | - |

## Session Continuity

**Resume file:** None

Last session: 2026-09-10T09:30:44.948Z

Stopped at: Completed 04-03-PLAN.md

Resume with: `$gsd-plan-phase 4`
