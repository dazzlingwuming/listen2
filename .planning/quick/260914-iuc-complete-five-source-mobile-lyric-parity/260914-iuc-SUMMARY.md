---
phase: quick-260914-iuc-five-source-mobile-lyric-parity
plan: "01"
subsystem: mobile lyrics and consented translation
tags: [react-native, lyrics, bilibili, deepseek, provider-policy]
status: complete
dependency_graph:
  requires: [existing fixed NetEase and QQ lyric adapters]
  provides: [exact-part Bilibili lyrics, dormant Kugou/Kuwo lyric parsers, Bilibili DeepSeek eligibility]
  affects: [PlayerScreen, native DeepSeek contract]
tech_stack:
  added: []
  patterns: [exact semantic IDs, bounded fixed routes, cache-first consent flow, stale guards]
key_files:
  created:
    - mobile/src/bilibili/lyrics.ts
    - mobile/src/lyrics/cache.ts
    - mobile/src/components/BilibiliLyricPicker.tsx
  modified:
    - mobile/src/api/client.ts
    - mobile/src/screens/PlayerScreen.tsx
    - mobile/src/deepseek/client.ts
    - mobile/android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekPolicy.kt
decisions:
  - Kugou and Kuwo lyric parsers are fixture-tested but production capabilities remain unavailable pending device evidence.
  - Bilibili resolves candidates only through existing NetEase and QQ search-plus-lyric contracts.
  - Bilibili DeepSeek requests require exact BVID/CID plus matched source provenance and remain cache-first/consent-gated.
actuals:
  tokens: 22656
  tasks: 3
  commits: 5
---

# Quick Task 260914-iuc: Five-Source Mobile Lyric Parity Summary

Implemented bounded five-source lyric plumbing with exact Bilibili part identity, manual lyric recovery, and explicitly consented native DeepSeek translation eligibility.

## Completed Tasks

1. Added fixture-safe dormant Kugou JSONP and Kuwo JSON lyric adapters, a single safe-integer Bilibili ID parser, NetEase/QQ-only Bilibili candidate scoring, and a versioned exact-CID AsyncStorage cache.
2. Added cache-first Bilibili lyric loading, manual candidate selection, restore-auto controls, cancellation/stale tokens, and source/platform translation separation in the player.
3. Extended JS/native DeepSeek validation to Bilibili only when an exact BVID/CID and NetEase/QQ matched provenance are present; provider, CID, and lyric revision remain track-hash isolated.

## Verification

- `npm --prefix mobile test -- --runInBand` — PASS: 22 suites, 128 tests.
- `npm run mobile:typecheck` — PASS.
- `npm --prefix mobile run lint` — PASS with 0 errors; 7 pre-existing warnings remain outside this task.
- `npx --no-install prettier --check ...` for all plan JS/TS files — PASS.
- Android production Metro bundle — PASS; emitted one bundle and 19 assets to a temporary directory.
- `java -version` — NOT VERIFIED: no Java Runtime/JDK is installed, so no Kotlin/JVM contract was run.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 1 - Bug] Made Kuwo accept its elapsed-decimal-seconds timestamp format and made Bilibili candidate lyric fetches settle per candidate so one failed lyric cannot discard sibling matches.
2. [Rule 2 - Correctness] Hardened cache corruption handling/serialized repair and allowed first optimistic write with `expectedRevision=0`.
3. [Rule 2 - Native trust boundary] Added the minimal native `DeepSeekClient.kt` and `DeepSeekModule.kt` plumbing required for `DeepSeekPolicy` to independently receive and validate exact Bilibili identity/provenance. Endpoint, headers, key vault, cache ownership, and cancellation stayed unchanged.
4. [Rule 1/2 - Verification gap closure] Candidate resolution now scores/deduplicates before its six-fetch cap and returns bounded provider-stage partial metadata; cache reads select and repair the newest valid slot; PlayerScreen invalidates all lyric/selection work on lifecycle boundaries and retries a manual stale revision exactly once after guarded reread.

## Verification Gap Closure

Commit `3040c26` closes the candidate/cache/Player lifecycle verifier gaps with provider/lyric partial-state tests, corrupt/stale-head cache recovery tests, and actual PlayerScreen race tests for part changes and newer candidate queries. Follow-up commit `10663d0` closes the remaining LyricsSheet-close translation gap: closing invalidates the translation epoch, clears the active operation before exactly-once cancellation, settles consent/pending UI, and prevents late cache/network success, error, or finally paths from changing a reopened sheet. Mounted tests cover cache lookup close, network close, late outcomes, and clean reopen state. The final mobile JS/static/Metro gate passes on the final source tree.

## Human-Needed Evidence

- Validate the fixed Kugou and Kuwo lyric routes on an Android device before enabling their production lyric capabilities.
- Validate a user-owned DeepSeek key only through the explicit six-disclosure consent path.
- Run the focused Kotlin/JVM DeepSeek contract when a preinstalled JDK 17 is available, then complete integrated emulator/device acceptance separately.

## Self-Check: PASSED

Verified all five product commits exist and every created product file is present. No planning artifact was staged or committed.
