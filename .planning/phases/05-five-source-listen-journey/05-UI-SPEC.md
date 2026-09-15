---
phase: 5
slug: five-source-listen-journey
status: corrected-canonical-baseline
created: 2026-09-15
---

# Phase 5 — Five-Source Listen Journey: Mobile UI Contract

This contract applies only to `mobile/` (React Native 0.87, Kotlin native boundaries and RNTP). It is not an AngularJS, WebView, Electron, or desktop UI specification. `android/` and `app/listen1_chrome_extension/` may be inspected as historical behavior references only; no Phase-5 UI implementation is written there.

## UI principles

- One coherent mobile product, with source labels and capability truth rather than provider-branded shell changes.
- Every actionable target has a clear accessible name and a practical touch target; icon-only controls expose a label.
- Preserve user context on a partial failure. Do not replace a valid list, current player state, or lyric view with a generic blank screen.
- Disabled-looking controls alone are insufficient. Show why an action is unavailable and, where possible, a safe action such as retry, sign in, choose a supported source, or return.
- The native player snapshot is authoritative; screens render it and dispatch semantic commands, never reconstruct media URLs or run a second player.

## Information architecture

The existing mobile navigation remains the parent. Phase 5 adds search/detail and player child surfaces rather than a second router.

| Surface | Required mobile behavior |
| --- | --- |
| Search | Exact source order: 网易云音乐, 酷狗音乐, 酷我音乐, QQ音乐, 哔哩哔哩. Query, selected source, cursor and request generation are scoped together. |
| Results | Rows display source, title, artist/author, artwork fallback, duration/kind and truthful action state. Loading-more stays inline; cancellation/failure preserves earlier rows. |
| Detail / Bilibili parts | Back restores search context. Show only source-supported actions. Bilibili part selection is explicit before play. |
| Discover | Reuse the bounded `jlv` collections only for sources whose discover capability is true. A source selector must not imply a fabricated directory. |
| Mini player | Renders the current native snapshot and opens the full player; exposes source/title/state and play/pause. |
| Full player | Renders play/pause, previous/next, seek, volume, mute, playback mode, queue and lyrics from the one controller/RNTP route. |
| Queue | Displays occurrence identity, not just track identity; duplicate entries are distinguishable and can be safely moved, removed or cleared. |
| Lyrics | Renders only current occurrence/revision-matched content, original/translation state, provenance, manual/offset controls where available, and non-blocking errors. |

## Interaction states

### Search and detail

1. Starting search shows source-labelled pending state and an explicit cancellation action.
2. First-page cancellation reports that cancellation; later-page cancellation keeps prior rows and says that only the additional page was cancelled.
3. Empty, unsupported, login-required, authorization, malformed response, offline and timeout each use distinct safe copy. A retry must retain the source/query/detail scope.
4. A row may expose `Play`, `View detail`, `Choose part`, or an unavailable-state recovery action only when the corresponding capability is true.
5. Restoration must not duplicate rows after back, rotation/re-entry, response retry or a stale late reply.

### Player and queue

- Seek controls give current/target position feedback and remain synchronized with the authoritative native snapshot.
- Volume/mute, playback mode, previous/next and play/pause report the result of the player transaction rather than optimistic fictional state.
- “Play next” is FIFO and occurrence-based. Duplicate tracks remain separate entries; a failed transition does not consume, reorder or erase an occurrence.
- Reorder, remove and clear provide confirmation/undo as appropriate and return focus predictably to the changed entry or queue heading.

### Lyrics and accessibility

- Current-line semantics contain active state, original/translation availability and any user-selected offset/provenance. Announce state transitions, not every clock tick.
- Manual choice and offset controls explain scope (“this source/track/part revision”) and whether the edit was saved, conflicted or unavailable.
- Fallback lyrics visibly identify their source. Missing, text-only, mismatched, unsupported or failed lyrics never stop audio playback.

## Visual direction

Use the design system already established in `mobile/`; do not import desktop CSS, Angular templates, a WebView shell or an unreviewed component framework. Keep source identity in text and accessible labels, not color alone. Under narrow widths, larger text, and screen-reader navigation, controls may wrap/reflow but remain discoverable and non-overlapping.

## Deferred runtime proof

This UI contract is implementation guidance, not APK/device evidence. API 35 layout, IME, TalkBack runtime, notification/lock-screen controls, background/restart behavior and live provider behavior remain Phase 8 acceptance work.
