---
phase: 05-five-source-listen-journey
plan: 03
subsystem: mobile lyrics and accessibility
tags: [react-native, lyrics, accessibility, async-storage, deepseek]
requires:
  - phase: 05-02
    provides: stable currentOccurrenceId and player position snapshot
provides:
  - occurrence and revision-safe lyric request settlement
  - versioned manual lyric selection and signed offset persistence
  - truthful fallback provenance and TalkBack lyric semantics
affects: [phase-08-acceptance, mobile-player, provider-capabilities]
actuals:
  tokens: 10312
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [closed lyric session keys, dual-slot CAS selection records, meaningful-change accessibility labels]
key-files:
  created: [mobile/src/lyrics/session.ts, mobile/src/lyrics/selectionStore.ts]
  modified: [mobile/src/screens/PlayerScreen.tsx, mobile/src/lyrics/timeline.ts]
key-decisions:
  - "Bilibili lyric identity derives its part only from canonical BVID/CID, never display metadata."
  - "Manual selection is persisted separately from cached lyric text and is capability-gated."
  - "Fallback provenance names the matched provider so Bilibili fallback cannot be misrepresented as native lyrics."
patterns-established:
  - "Async lyric callbacks compare exact source/track/part/occurrence/revision before mutating UI."
  - "Accessibility live state is attached to the active lyric row, not progress polling."
requirements-completed: [LYR-001, LYR-002, LYR-003]
coverage:
  - id: D1
    description: Occurrence/revision-safe lyric session and signed timeline projection
    requirement: LYR-001
    verification:
      - kind: unit
        ref: mobile/src/lyrics/__tests__/session.test.ts and timeline.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: CAS-protected semantic manual selection and offset persistence
    requirement: LYR-002
    verification:
      - kind: unit
        ref: mobile/src/lyrics/__tests__/selectionStore.test.ts and cache.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Truthful lyric provenance and TalkBack labels
    requirement: LYR-003
    verification:
      - kind: unit
        ref: mobile/src/screens/__tests__/lyricAccessibility.test.tsx
        status: pass
    human_judgment: true
    rationale: Real TalkBack announcement cadence requires API 35 runtime acceptance.
duration: 8min
completed: 2026-09-15
status: complete
---

# Phase 05 Plan 03: Lyric Session and Accessibility Summary

**Lyrics now settle only for the active occurrence/revision, retain capability-safe corrections, and identify fallback provenance clearly to TalkBack users.**

## Accomplishments

- Added closed session keys for source, semantic track, Bilibili CID, occurrence, and revision; stale lyric/candidate callbacks are rejected.
- Added bounded signed-offset timeline projection and a dual-slot AsyncStorage selection record with revision CAS.
- Kept Bilibili cached lyric text intact while adapting compatible manual provenance into the new selection view.
- Added provider-labelled fallback/manual source copy and active-row original/translation/offset semantics without changing the DeepSeek consent or cache contract.

## Task Commits

1. Task 1 — `ba6cd50` `feat(05-03): bind lyric work to occurrences`
2. Task 2 — `1664f8c` `feat(05-03): persist lyric corrections safely`
3. Task 3 — `cf622ca` `feat(05-03): announce truthful lyric state`

## Verification

- Full local gate passed on `cf622ca`: 32 Jest suites / 163 tests, TypeScript, ESLint, `git diff --check`, and offline `:app:testDebugUnitTest` (151 Gradle tasks).
- No APK, emulator/device, live provider/account, signing, merge, or deployment was run.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 1 - Test isolation] Deferred AsyncStorage module loading until a semantic selection operation so existing non-lyric PlayerScreen tests do not require a native ESM transform.

## Known Limits

- Current provider capabilities mark local offset correction as unverified, so the UI surfaces that precise status and does not dispatch an offset mutation. The bounded persistence/clock contract is ready when a later approved capability update enables it.
- API-35 device/emulator, real TalkBack cadence, live-provider behavior, background lifecycle and release-like APK evidence remain Phase 8 work.

## Self-Check: PASSED

- Created lyric session, selection store, tests, and all three commits exist on the pushed branch.
