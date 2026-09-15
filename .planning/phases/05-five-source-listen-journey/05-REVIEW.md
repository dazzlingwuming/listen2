---
phase: 05-five-source-listen-journey
reviewed: 2026-09-15T02:39:29Z
depth: deep
files_reviewed: 31
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
  - mobile/src/player/__tests__/playerController.test.ts
  - mobile/src/player/playbackService.ts
  - mobile/src/player/playerController.ts
  - mobile/src/screens/BilibiliDetailScreen.tsx
  - mobile/src/screens/PlayerScreen.tsx
  - mobile/src/screens/PlaylistDetailScreen.tsx
  - mobile/src/screens/SearchScreen.tsx
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
  critical: 5
  warning: 4
  info: 0
  total: 9
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-15T02:39:29Z
**Depth:** deep
**Files Reviewed:** 31
**Status:** issues_found

## Summary

The Phase 05 mobile changes were reviewed at the search/detail, player/RNTP, persistence, lyric/session, and screen boundaries. The implementation has five ship-blocking correctness/security defects: retained search pages are hidden after cancellation/failure, queued transition failure destroys active native audio, rehydration loses an active play-next occurrence, a successful Bilibili lyric cache read can stay permanently loading, and native/bridge exception text is rendered to the user. Detail retry, restoration, accessibility, and persistence-conflict paths also fall short of the stated contracts.

## Critical Issues

### CR-01: Later-page cancellation or failure erases the visible successful result set

**Classification:** BLOCKER

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/screens/SearchScreen.tsx:148-164,205-209,434-453`

**Issue:** A later-page request starts with the prior rows retained, but `cancel()` increments `requestEpoch` before the aborted request's catch can reduce it, so the catch is ignored. It then forces `status` to `cancelled`; any non-abort rejection forces `status` to `error`. `SearchSurface` renders either terminal card exclusively for both states, hiding all prior rows and providing no retry control. This directly violates the non-destructive pagination/cancellation contract.

**Fix:** Keep a page-scoped pending/error state in `SearchJourneyState`. Abort/reduce the outgoing request before invalidating its epoch, and for `nextPage > 1` leave `status` renderable as ready, show an inline `cancelled-more`/error notice plus a retry action that reuses the same source/query/kind/page scope.

### CR-02: Failed play-next transition resets the native player and does not restore current audio

**Classification:** BLOCKER

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/player/playerController.ts:344-408,412-454,635-656`

**Issue:** Queue transitions call `transition()`, which calls `loadAndPlay()`. `loadAndPlay()` invokes `TrackPlayer.reset()` before adding the next item. On `add`, seek, or play failure it only updates Redux to not-playing and returns false; it never uses the defined rollback helpers. The Redux current occurrence/queue can remain unchanged while the native player has been emptied and the prior audio has stopped. The controller tests assert the Redux queue but do not exercise this native rollback path.

**Fix:** Capture the active native snapshot before a queued transition and, on any destructive native-load failure, restore its track, position, repeat mode, volume/mute, and play/pause state before returning false. Commit `activateTrack`/`consumeQueuedNext` only after that transaction succeeds. Add a native-mocked regression asserting the old track is re-added and resumes after queued `add()`/`play()` rejection.

### CR-03: A current play-next occurrence is discarded by persistence rehydration

**Classification:** BLOCKER

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/store/playerPersistence.ts:197-208,219-229`

**Issue:** Successful queue transitions activate the occurrence and then remove it from `playNextQueue`. On restore, `sanitizePlayerState()` accepts a play-next current track only if it can find the occurrence still in that FIFO. Since accepted occurrences are deliberately consumed, `currentFromOccurrence` is null and the persisted `currentTrack`, position, and current occurrence are replaced by null/-1. Restarting after playing a queued item loses the current track despite the persisted-player contract.

**Fix:** Persist and validate a dedicated current-occurrence semantic record, or accept the sanitized `currentTrack` when its source is `play-next` and its persisted occurrence is syntactically valid but no longer queued. Preserve it independently of the one-shot FIFO and add a rehydration test for an accepted, already-consumed queue occurrence.

### CR-04: Bilibili lyric cache success can leave the lyric sheet permanently loading

**Classification:** BLOCKER

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/screens/PlayerScreen.tsx:251-260,272-280,293-295`

**Issue:** `requestSession` is created with `bilibiliCacheRevision` (initially 0). Both cache-hit and cache-write paths set a new revision before returning. That changes `lyricSession`, so the `finally` condition no longer recognizes the request session and never clears `lyricsLoading`. `LyricsSheet` prioritizes `loading` over parsed lines, so a successfully loaded/cached Bilibili lyric remains hidden behind “正在加载歌词…”.

**Fix:** Separate the request identity/revision from cache metadata, or settle `lyricsLoading` using the immutable request epoch/current occurrence identity rather than a session key that the operation itself mutates. Add rendered cache-hit and cache-write tests that assert loading clears and the lyric text is visible.

### CR-05: Raw native/bridge exception messages are exposed in the lyric UI

**Classification:** BLOCKER

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/screens/PlayerScreen.tsx:531-535,1214-1217`

**Issue:** The translation catch copies `caught.message` into `translationError`, and the sheet renders that value verbatim. Promise rejections at the JS/native boundary are not guaranteed to be the closed `DeepSeekErrorCode` DTO; this can disclose provider response text, request identifiers, lyrics, URLs, or implementation details. It contradicts the safe-error boundary used elsewhere in the phase.

**Fix:** Map only an allow-list of typed `DeepSeekClientError`/result error codes to fixed product copy; map every unknown rejection to a generic safe code such as `PROVIDER_ERROR`. Never render `Error.message`, and add a test rejecting with a URL/token-shaped message that verifies it is absent from the rendered tree and persisted state.

## Warnings

### WR-01: Detail retry responses race and an older retry can overwrite newer detail

**Classification:** WARNING

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/screens/PlaylistDetailScreen.tsx:72-102`

**Issue:** The initial effect owns an abort controller, but `retryRemotePlaylist()` creates an untracked controller. Repeated retries run concurrently; there is no generation check, and an old success/error can overwrite the newest response/status or set state after navigation.

**Fix:** Keep the active controller and a monotonically increasing detail generation in refs. Abort/invalidate the prior request on every retry and only commit a response/error if its generation and semantic playlist/source identity are current.

### WR-02: Search restoration state is implemented but never restored or updated by the screen

**Classification:** WARNING

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/screens/SearchScreen.tsx:53-60,170-189,225-233,354-361`

**Issue:** `SearchJourneyState` has rows, cursor, selected identity, and scroll anchor, but the screen only initializes a blank state or reissues a route query. It never writes selected identity/scroll anchor, and passes only `journey.scope` (not the state) to detail routes. Thus recreation/re-entry cannot restore rows, cursor, selected selection, or scroll location as specified; the reducer-only restoration test does not exercise the screen integration.

**Fix:** Define a bounded navigation restoration DTO containing the sanitized journey state, update selection/scroll events into it, and hydrate it before issuing a request. Add an integration test that unmounts/recreates SearchScreen from the DTO and verifies no second request and restored row/scroll selection.

### WR-03: Restore-automatic deletes the lyric cache before resolving the selection CAS conflict

**Classification:** WARNING

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/screens/PlayerScreen.tsx:416-444`

**Issue:** `restoreBilibiliAutomatic()` clears the exact-part cache at line 428, then performs `clearManual()` with a potentially stale selection revision. If the CAS rejects, it still has destroyed the manual cache and reloads automatic lyrics, so a revision conflict is not non-destructive.

**Fix:** First clear the selection record using its expected revision; on `stale`, preserve both cache and UI and report conflict. Only clear the cache and reload automatic lyrics after that CAS succeeds.

### WR-04: The advertised player seek surface is not an accessible seek control

**Classification:** WARNING

**File:** `/Users/fluenteng/个人相关/listen1/listen1_desktop/mobile/src/screens/PlayerScreen.tsx:922-950`

**Issue:** `Progress` is a non-interactive `View` with an accessibility label. It has no slider role, value, increment/decrement actions, or handler. The adjacent ±15-second buttons offer only coarse steps and do not meet the phase's promised accessible seek/target feedback contract.

**Fix:** Replace it with a controlled accessible slider (role, min/max/current value, value text and adjustable actions) that dispatches the controller seek thunk and reflects only the confirmed snapshot; retain the step buttons as optional shortcuts.

---

_Reviewed: 2026-09-15T02:39:29Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
