---
phase: 05-five-source-listen-journey
reviewed: 2026-09-15T04:37:44Z
depth: deep
files_reviewed: 36
files_reviewed_list:
  - mobile/src/api/client.ts
  - mobile/src/api/errors.ts
  - mobile/src/components/BilibiliLyricPicker.tsx
  - mobile/src/components/TrackRow.tsx
  - mobile/src/lyrics/__tests__/cache.test.ts
  - mobile/src/lyrics/__tests__/selectionStore.test.ts
  - mobile/src/lyrics/__tests__/session.test.ts
  - mobile/src/lyrics/__tests__/timeline.test.ts
  - mobile/src/lyrics/selectionStore.ts
  - mobile/src/lyrics/session.ts
  - mobile/src/lyrics/timeline.ts
  - mobile/src/player/__tests__/playbackService.test.ts
  - mobile/src/player/__tests__/playerController.bilibiliRetry.test.ts
  - mobile/src/player/__tests__/playerController.lifecycle.test.ts
  - mobile/src/player/__tests__/playerController.rollback.test.ts
  - mobile/src/player/__tests__/playerController.test.ts
  - mobile/src/player/playbackService.ts
  - mobile/src/player/playerController.ts
  - mobile/src/screens/BilibiliDetailScreen.tsx
  - mobile/src/screens/PlayerScreen.tsx
  - mobile/src/screens/PlaylistDetailScreen.tsx
  - mobile/src/screens/SearchScreen.tsx
  - mobile/src/screens/SettingsScreen.tsx
  - mobile/src/screens/__tests__/bilibiliFlow.test.tsx
  - mobile/src/screens/__tests__/bilibiliLyricsFlow.test.tsx
  - mobile/src/screens/__tests__/lyricAccessibility.test.tsx
  - mobile/src/screens/__tests__/playerJourney.test.tsx
  - mobile/src/screens/__tests__/playerTranslationBehavior.test.tsx
  - mobile/src/screens/__tests__/searchJourney.test.tsx
  - mobile/src/search/searchJourneyState.ts
  - mobile/src/store/__tests__/playerPersistence.test.ts
  - mobile/src/store/__tests__/playerSlice.test.ts
  - mobile/src/store/index.ts
  - mobile/src/store/playerPersistence.ts
  - mobile/src/store/playerSlice.ts
  - mobile/src/types/provider.ts
findings:
  critical: 2
  warning: 0
  info: 0
  total: 2
status: issues_found
---

# Phase 05: Code Review Final Re-review

**Reviewed:** 2026-09-15T04:37:44Z
**Depth:** deep
**Files Reviewed:** 36
**Status:** issues_found

## Summary

This fourth deep re-review covers `66f8e4d` and `5455585` against the complete Phase 05 mobile scope. Third-round CR-01 is closed: Bilibili detail now passes the exact part array to the real player thunk, and the expanded rendered integration test reaches bootstrap/RNTP. CR-02 is closed: overwrite snapshots the existing native item, restores it after post-reset failures, and marks reload-required if recovery also fails. CR-03 is closed: a successful FIFO reorder invalidates the deferred transition and the transition requires the same occurrence to remain queue head. CR-04's unsafe fabricated-current identity is removed.

However, the CR-04 replacement drops every identifier-less native state/error event, including the current track's real failure; playback UI/error recovery can remain stale indefinitely. The existing QQ/Kuwo authorized-playback gap (third-round CR-05) is unchanged. `npx tsc --noEmit` and four focused current suites passed (58 tests), but the new tests expressly assert that identifier-less terminal callbacks are ignored rather than proving user-visible native-error recovery.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-05: QQ and Kuwo still cannot complete the phase's required authorized playback journey

**Classification:** BLOCKER

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/api/client.ts:125-133,241-245`

**Issue:** The capability matrix exposes QQ and Kuwo search (and QQ lyrics), but neither has available playback/bootstrap. `bootstrapTrack` deliberately rejects both with `PLAYBACK_UNAVAILABLE`. Thus users can search those visible sources but cannot reach authorized playback, which fails the Phase 05 five-source search-to-detail-to-listen requirement.

**Fix:** Implement bounded, source-specific authorized QQ and Kuwo media/bootstrap contracts with route/schema tests and only then enable their playback capabilities; alternatively obtain an explicit approved requirement change that narrows the five-source playback promise.

### CR-06: The stale-event fix permanently suppresses real native error and state handling

**Classification:** BLOCKER

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/player/playbackService.ts:66-70`; `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/player/playerController.ts:1360-1369,1403-1414`

**Issue:** RNTP `PlaybackState` and `PlaybackError` events have no track identity. The service now unconditionally forwards `undefined`, and `isNativeCallbackCurrent()` unconditionally rejects an absent identity. These are the only production callers of `onPlaybackState`/`onPlaybackError`, so a current track's real native pause, stop, or playback error never sets `isPlaying: false`, `native-playback-error`, or `restoredNeedsLoad`. For example, after `loadAndPlay()` sets `isPlaying` true, an asynchronous RNTP media failure leaves the screen claiming it is playing and offers no recovery.

**Fix:** Retain stale-event safety while restoring a trusted current-event path: introduce a controller-owned native epoch/settlement protocol that accepts identifier-less events only when no ownership transition is pending and their native state is corroborated, while quarantining them across reset/load transitions. Add an integration test that emits a current-track native failure after its active-track hand-off and asserts safe error/reload state, alongside the existing late-A-after-B test.

---

_Reviewed: 2026-09-15T04:37:44Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
