---
phase: 5
slug: five-source-listen-journey
status: draft
shadcn_initialized: false
preset: none
created: 2026-09-10
---

# Phase 5 — Five-Source Listen Journey: UI Design Contract

> This contract turns the Phase-4 phone shell into the complete source-labelled journey: search → directory/detail or Bilibili part → authorized playback → lyrics. It uses the original `listen1/listen1_mobile@v0.8.2` phone hierarchy and uniform provider interaction as a product reference, while current Android typed-bridge, Media3, and desktop contracts remain the implementation authority. It does not claim a live API 35 device result; Phase 8 owns that integrated acceptance.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — retain the existing AngularJS/classic-script and scoped CSS system |
| Preset | not applicable |
| Component library | none; use semantic HTML, AngularJS templates, existing inline SVG sprites, and scoped Android mobile classes |
| Icon library | existing inline SVG sprite and existing icon CSS only |
| Font | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` |
| Theme | retain the Midnight Editorial dark theme: Android phone surfaces at `max-width: 760px` |

No shadcn gate applies: this is AngularJS 1.x rather than React, Next.js, or Vite. No third-party UI blocks or registry are permitted.

### Existing implementation anchors

| Contract area | Existing anchor | Phase-5 implementation direction |
|---|---|---|
| Search lifecycle and Bilibili part detail | `js/controller/instant_search.js`, mobile search markup in `listen1.html` | Generalize the semantic source/query/page/epoch state; do not retain the Bilibili-only row branch. |
| Source identity and capability projection | `js/mobile_provider_registry.js`, `js/loweb.js` | Every row, detail, queue occurrence, playback selection, and lyric request carries the registry source ID; labels come from its display name. |
| Mobile search/detail styling | `css/redesign.css` Android mobile provider/search rules | Reuse the existing one-column, 48dp, safe-area scoped styles; no desktop selector/sidebar branch. |
| Native playback projection | `js/l1_player.js`, `js/controller/play.js`, Android player markup in `listen1.html` | Keep `PlaybackService`/Media3 as sole owner. The page renders snapshots and sends semantic commands only. |
| Queue | existing `android-queue-sheet` markup and `PlayController` queue handlers | Retain occurrence-aware queue entries, explicit mutation confirmation, focus return, and source-labelled copy. |
| Lyrics | `PlayController`, `LyricClockProjection`, existing primary lyric/manual picker flows | Project only identity-matched, attributed lyric snapshots on the current Media3 clock. |

Do not introduce a second router, player, provider-specific screen framework, Howler fallback, arbitrary web request surface, or external UI package.

---

## Spacing Scale

All values are inherited from the approved Phase-4 shell and remain multiples of four.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| xs | 4px | source/status metadata gaps; artwork placeholder detail |
| sm | 8px | row internals, compact actions, lyric line pairing |
| md | 16px | page gutters, result/detail card padding, player sections |
| lg | 24px | separation between search/result/pagination and player groups |
| xl | 32px | major detail and lyric section breaks |
| 2xl | 48px | every actionable hit target; result/detail row minimum interior |
| 3xl | 64px | only large empty-state breathing room; fixed mini-player height |

Exceptions: the mini-player is exactly 64px high; bottom navigation is `64px + env(safe-area-inset-bottom, 0px)`; a static status pill may be 32px high. Every button, source tab, result row, part row, pagination action, queue mutation, lyric action, and visible slider thumb has a 48dp by 48dp touch target. Controls may be visually compact but their hit area may not be smaller.

---

## Typography

Use exactly these four sizes and two weights. Selection, availability, and current-track state must also have text or semantic state; they are never communicated by weight or colour alone.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata, status, tab, lyric translation | 12px | 400 | 1.4 |
| Body, input, result/queue title, control label, lyric original | 14px | 400 | 1.5 |
| Section heading, detail title, current lyric line | 20px | 600 | 1.2 |
| Full-player title / page display title | 28px | 600 | 1.2 |

Result title, artist, directory title, queue title, and player title receive at most two lines where the row reserves vertical space; otherwise use a one-line ellipsis. Provider display names are never abbreviated. At 320px width or 200% text scale, metadata may wrap under a title, action groups become one column or horizontally scroll, and no fixed player/navigation surface may be obscured or overlapped.

---

## Color

Retain the approved Phase-4 palette so every source appears in one product rather than five provider-branded products.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#090B12` | page and full-player backgrounds; primary scroll surface |
| Secondary (30%) | `#10131D` | search field, result/detail cards, mini-player, queue/lyric sheets, bottom navigation |
| Accent (10%) | `#8B7CF6` | selected source/tab, primary `播放`/`搜索音乐` action, current progress value, focus outline, current lyric line |
| Positive semantic | `#5DD6C7` | text/icon for a verified playable state only; never an unsupported or generic button colour |
| Warning semantic | `#D9A441` | attributed degraded/login/unsupported status only; paired with copy |
| Destructive | `#D45B5B` | confirmed queue removal and clear actions only |
| Primary text | `#F5F7FB` | normal readable text |
| Secondary text | `#8F97AA` | artist, duration, source metadata, explanatory copy |

Accent is reserved for the selected provider, selected bottom destination, primary play/search/retry action, focus outline, actual playback progress, and current lyric line. It is not applied to all buttons, headings, provider names, or errors. Text contrast remains at least 4.5:1 and focus/interactive indicators at least 3:1 against their adjacent surface.

---

## Information Architecture and Interaction Contract

### Journey hierarchy

The Phase-4 four-tab shell remains unchanged: `首页`, `发现`, `音乐库`, `设置`. Phase 5 adds child layers only; neither directory, full player, queue, nor lyrics becomes a fifth tab.

| Level | Surface | Required behaviour |
|-------|---------|--------------------|
| 1 | Discover | Query input, five-source selector, a single source-labelled result surface, then page control. It remains the parent of all provider detail routes. |
| 2 | Source directory/detail | Header with Back, source label, artwork/title/artist, route-specific content, and only capability-valid actions. It restores the Discover query, selected source, page/cursor, and scroll position on return. |
| 2 | Bilibili video detail | A source-labelled directory detail that shows the base video identity internally and a visible selectable part list. The selected part is visually and semantically explicit before playback. |
| Persistent | Mini-player | Visible only with a current Media3 snapshot. Shows safe artwork/fallback, title, artist, source label, state, and play/pause. Tapping artwork/title opens the full player. |
| 2 | Full player | Focused snapshot view of the selected Media3 occurrence. Contains progress, previous/play-next, mode, volume/mute, queue, and lyrics entrances. |
| 3 | Queue sheet | Child of full player; retains the focused player below it. Contains occurrence-aware FIFO entries and bounded mutations. |
| 3 | Lyrics / lyric-source sheet | Child of full player; renders current identity-matched lyrics, offset/manual selection where supported, and truthful degradation without changing playback. |

### Five-source search and pagination

The source selector remains a horizontal single-row `tablist`, in this exact order: `网易云音乐` (`netease`), `酷狗音乐` (`kugou`), `酷我音乐` (`kuwo`), `QQ音乐` (`qq`), `哔哩哔哩` (`bilibili`). Migu and Taihe must not appear as primary tabs or fake empty sources.

1. The selected source, query, page cursor, capability epoch, request epoch, and result cache key are one immutable semantic scope. A row never changes its source because another selector tab is tapped.
2. A search submission starts at page 1. It shows four source-labelled skeleton rows and `正在搜索{来源}…`; the shell, selector, and explicit `取消搜索` control remain usable.
3. A successful first page replaces only the selected scope. A successful later page appends once after the previous rows and presents `加载更多` only when a valid next cursor exists. It shows `正在加载更多…` inline at the list end, not a blank full-page spinner.
4. Cancelling first-page search shows `已取消本次搜索`; cancelling a later page restores the already-loaded rows and shows `已取消加载更多`. Timeout, malformed data, offline, authorization, and unsupported routes preserve valid visible rows and the source/query context. They never erase another source/query cache or append a duplicate page.
5. Search-result rows use one normalized layout: 48px artwork or neutral note placeholder; two-line title; artist/author; source display name; duration or `时长未知`; result kind; and an explicit state. Valid kinds are `歌曲`, `专辑`, `歌单`, and `视频`; do not expose raw provider type codes.
6. Row actions are semantic and capability-gated: `播放`, `查看详情`, or `选择分P`. A disabled-looking `播放` is not enough: if it cannot run, replace it with the truthful state/recovery action. No action opens a desktop browser, sends an arbitrary URL, or assumes an unverified provider route.
7. The visible page count may be omitted when the provider returns only a cursor. It must never display a guessed total. `上一页` and `下一页` are 48dp controls, unavailable at their true boundary, and announce the page transition.

### Result, directory, and detail states

Each result/detail model contains only the normalized presentation fields `sourceId`, source display name, semantic identity, title, artist/author, artwork state, duration, result kind, capability state, and safe reason. Transport URLs, provider payload fragments, cookies, headers, signed media, request IDs, and native exception text never reach the UI.

| State | Search / detail presentation | Valid recovery |
|-------|-------------------------------|----------------|
| Empty | `还没有搜索结果` with `换个关键词，或选择其他音乐来源后再试。` | edit query or choose a source |
| Partial | Valid rows stay visible; each unavailable continuation is marked, for example `可查看，播放待支持` | use remaining supported action or change source |
| Login required / expired | `需要登录后才能继续。` or `登录已过期，请重新登录。` only if that provider route supports account handling | `前往账户`; Phase 6 owns account/session completion |
| Unsupported | `{来源}暂不支持{能力}。` with a readable capability name | `返回搜索结果` or `返回其他来源` |
| Offline | `网络不可用。检查连接后重试。` | `重试` |
| Timeout | `{来源}响应超时。请重试。` / `读取详情超时。请重试。` | `重试` |
| Malformed response | `{来源}返回的数据暂时无法识别。` | `重试` or return without losing context |
| Authorization / entitlement | `此内容当前账号无法播放。` | `前往账户` only when supported, otherwise `返回搜索结果` |
| Artwork failure | Neutral 48px music-note placeholder; title, artist, source, duration, and all valid actions stay visible | no blocking retry or empty result state |

Directory and detail loading shows the retained title/source header plus compact skeleton content and `正在读取详情…`; it does not replace the preceding search context. A failure retains the header and the last valid child list, if any. Rotation/recreation restores one page/cursor and selected detail item once; it may refetch a stale page but must not append it a second time.

For Bilibili specifically, the detail header uses the user-facing source label `哔哩哔哩`, title, author, and video kind. The parts list uses `第 {n} P · {part title} · {duration}` with `已选择`, `可播放`, `需要登录`, or `暂不可播放`. The first valid part may be preselected, but `播放此分P` names the selected part in its accessible name. An invalid or stale CID shows `所选分P不可用` and cannot prepare a different part by fallback. Base video and CID remain semantic data, never visible URL syntax.

### Media3 player, queue, and system-state projection

`PlaybackService` is the only queue, ExoPlayer, MediaSession, clock, and recovery owner. The WebView may send source-prefixed track/part/queue intentions and must render returned native snapshots. It must not create an Android Howler/audio fallback.

| Surface | Required content and interaction |
|---------|----------------------------------|
| Mini-player | Artwork/fallback, title, artist, source label, concise state (`正在播放`, `已暂停`, `正在准备`), and one play/pause button. With no snapshot it is hidden rather than showing stale metadata. |
| Full player | Source label above title/artist, artwork/fallback, elapsed/duration, accessible seek slider, previous, play/pause, next, playback mode, volume, mute, `播放队列（n）`, and `歌词`. Every displayed value derives from the same snapshot revision. |
| Preparing / interrupted | Retain current title/artwork/queue; show `正在准备播放…` or `播放已暂停。连接耳机或回到应用后可继续播放。` without a fake progress value. |
| Media error | Retain the current occurrence and queue. Show `当前歌曲暂时无法播放。请重试，或选择其他歌曲。` and `重试播放` only if native marks it retryable. It never auto-consumes the next entry merely because resolution failed. |
| System controls | Notification, lock-screen, audio focus, noisy route, headset, and Bluetooth/AVRCP changes update the same snapshot as mini/full player. Their actual API35/device behaviour is accepted in Phase 8, not asserted visually here. |

Queue rows show visible ordinal, title, artist, source label, and current/next status; they never expose occurrence IDs. Duplicate tracks remain separate visible entries, each with its own reorder/remove target. `下一首播放` is FIFO and is shown in source order. `移到最前`, `上移`, `下移`, and `移到最后` are disabled only at their real boundary or while that native command is pending. After a successful snapshot revision, focus stays on the corresponding row; on failure, the old order remains and an inline `队列操作未完成，请重试。` is announced.

Removing one entry and clearing the queue require the existing explicit confirmation layers:

| Action | Confirmation title | Consequence copy | Cancel / confirm |
|--------|--------------------|------------------|------------------|
| Remove occurrence | `删除此条队列项？` | `这不会删除原歌单中的歌曲。` | `保留此队列项` / `删除此条队列项` |
| Clear queue | `清空播放队列？` | `将移除 {n} 首待播歌曲，原歌单不会改变。` | `保留播放队列` / `清空播放队列` |

The confirmation is an `alertdialog`, focus moves to its confirm control, and Back/Escape closes it without mutation. `播放队列为空` is followed by `添加“下一首播放”的歌曲会显示在这里。`; mutation controls are then absent.

### Lyrics, manual choice, offset, and translation projection

The lyrics entry is active only for the current Media3 occurrence. The lyric model is keyed to source, track, part, occurrence, revision, duration/match policy, and playback/selection epoch. A response that does not match all current identity conditions is ignored without changing visible lyric state.

| State | Presentation and action |
|-------|-------------------------|
| Loading | Keep title/source and show `正在加载歌词…`; playback controls remain available. |
| Timed lyric | Scrollable original line list follows the Media3 clock. Current line has accent plus `当前歌词` text/accessible state; translations appear under the matching original only when attributed and available. |
| Plain text / insufficient timestamps | `歌词没有可同步的时间信息。` Show readable static text when safe; do not fabricate a highlighted current line. |
| Missing | `暂未找到歌词。` Show `选择歌词来源` only where the provider/manual capability exists. |
| Mismatch | `找到的歌词与当前歌曲不匹配。` Preserve the active track and offer `重新选择歌词来源` only where supported. |
| Timeout / unsupported / login required | `{来源}暂时无法提供歌词。` / `{来源}暂不支持歌词。` / `需要登录后才能查看歌词。` with the same truthful recovery policy as detail. None blocks first playback. |
| Manual choice | `选择歌词来源` sheet lists title, artist, source attribution, and duration/match hint. Selecting one shows `使用此歌词`; only a current identity/revision may persist it. |
| Offset | `歌词偏移` control speaks the signed value, for example `歌词提前 0.5 秒` or `歌词延后 0.5 秒`; `重置偏移` restores zero. Pending/error never changes a different track. |
| Translation | `显示译文` / `隐藏译文` is available only for an existing, attributed translation. Phase 5 does not expose machine-translation configuration or consent flows that belong to Phase 7. |

TalkBack text for a lyric line includes original line text, `当前歌词` when active, translation when visible, and the offset value once when it changes. The lyric list is not an `aria-live` flood: only current-line transition and explicit status/error are politely announced. Long lyric lines wrap inside the content column; no text is clipped behind player controls.

### Nearest-layer Back and cancellation

System Back, Escape, visible Back buttons, and in-app navigation follow this exact order. Each closure cancels only the operation owned by that layer and advances its epoch so a late reply cannot reopen it.

1. Dismiss the IME, retain the query and visible result/detail context.
2. Close a queue remove/clear confirmation or lyric-manual selection confirmation without mutation.
3. Close queue sheet or lyrics/lyric-source sheet, return focus to its full-player trigger, and retain player state.
4. Close full player, return focus to mini-player, retain the current snapshot and selected bottom destination.
5. Close Bilibili part detail or another source directory/detail, cancel its request, and restore Discover source/query/page/cursor/scroll context.
6. Close any remaining bounded product sheet or pop a real child route, preserving valid source identity/context.
7. At a top-level destination with no transient layer, allow normal Activity Back. Never change source/tab, open a desktop page, or display an exit confirmation.

---

## Responsive, Touch, and Accessibility Contract

- The Android mobile shell remains one column at widths through 760px. At **320px** and at **200% text scale**, result cards, detail actions, player controls, queue rows, and lyric controls reflow rather than forcing horizontal page scroll. The source selector is the sole intentional horizontal scroller.
- Use `env(safe-area-inset-*)`. The content region reserves `calc(64px + 64px + env(safe-area-inset-bottom, 0px) + 24px)` below fixed mini-player/tab navigation. Sheets have their own scroll region and never extend behind gesture/navigation areas in portrait or landscape.
- Result rows, parts, queue rows, and player controls use real `<button>`/`<input>` semantics. Use `header`, `main`, `nav`, `tablist`/`tab`, list/ordered-list semantics, `dialog`/`alertdialog`, and associated labels. Icon-only controls name their action in Simplified Chinese.
- Source selector tabs expose `aria-selected`; the active bottom destination exposes `aria-current="page"`; current queue entry and current lyric line include a textual accessible state. Selected provider/capability/action state is never colour-only.
- Search and detail loads/cancellations use one polite live region; an error is `role="alert"` once when it occurs. Source labels in accessible names always come from the registry display name, not internal IDs or untrusted payload strings.
- Artwork has empty alt/`aria-hidden` when decorative; the adjacent row supplies title, artist, source, duration, kind, and availability. Placeholder artwork conveys no false success/failure state.
- Respect `prefers-reduced-motion: reduce`: no transform/slide animation; otherwise transitions are opacity/transform only and at most 160ms. No gesture, hover, or drag-only outcome is required: queue reorder has labelled button alternatives.
- Do not render raw provider error text, request ID, URL, cookie/header, signed media data, local path, CID/BVID syntax, or bridge status in visible text, accessibility labels, notifications, or copied state.

---

## Copywriting Contract

All strings are Simplified Chinese. `{来源}` is inserted only from the trusted registry display name; `{能力}` is a product term such as `搜索`, `详情`, `播放`, or `歌词`.

| Element | Copy |
|---------|------|
| Search field placeholder | `搜索歌曲、歌手或歌单` |
| Primary first-page action | `搜索音乐` |
| Load next page | `加载更多` / `正在加载更多…` |
| Cancel | `取消搜索` / `已取消本次搜索` / `已取消加载更多` |
| Search loading | `正在搜索{来源}…` |
| Empty heading/body | `还没有搜索结果` / `换个关键词，或选择其他音乐来源后再试。` |
| Result detail action | `查看详情` |
| Bilibili action | `选择分P` / `播放此分P` |
| Detail loading/failure | `正在读取详情…` / `读取详情超时。请重试。` |
| Generic source error | `{来源}暂时无法完成此操作。请检查网络后重试，或选择其他来源。` |
| Malformed result | `{来源}返回的数据暂时无法识别。` |
| Offline | `网络不可用。检查连接后重试。` |
| Unsupported | `{来源}暂不支持{能力}。` |
| Login required | `需要登录后才能继续。` / `前往账户` |
| Mini-player empty | `还没有正在播放的内容` |
| Media preparing/error | `正在准备播放…` / `当前歌曲暂时无法播放。请重试，或选择其他歌曲。` / `重试播放` |
| Queue empty | `播放队列为空` / `添加“下一首播放”的歌曲会显示在这里。` |
| Lyrics loading/missing | `正在加载歌词…` / `暂未找到歌词。` |
| Lyrics mismatch/plain text | `找到的歌词与当前歌曲不匹配。` / `歌词没有可同步的时间信息。` |
| Lyrics actions | `选择歌词来源` / `重新选择歌词来源` / `歌词偏移` / `重置偏移` / `显示译文` / `隐藏译文` |
| Search recovery | `重试搜索` / `返回搜索结果` / `返回其他来源` |
| Detail recovery | `重试读取详情` / `返回搜索结果` |
| Playback recovery | `重试播放` / `选择其他歌曲` |

---

## UI Considerations

Applicable state considerations resolved: 26 covered, 8 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | `SearchStateSurface`, `DirectoryDetail`, `QueueSheet`, lyric surface | ✅ covered | Search, directory, queue, and lyric zero states use the fixed copy above; empty queue removes unavailable mutations and empty lyric never blocks playback. |
| loading | search submit/pagination, directory/detail, media snapshot, lyrics/manual picker | ✅ covered | Lists use source-labelled skeleton/inline loading while preserving valid prior context; full-shell blocking spinners are prohibited. |
| error | search, page append, artwork, directory/detail, media, queue command, lyrics | ✅ covered | Each error has a safe source/product-level message and valid recovery; raw transport/bridge data never renders. |
| populated | search rows, parts, detail tracks, mini/full player, queue, lyrics | ✅ covered | Normal rows always include source, title, artist, artwork state, duration/kind/capability as applicable; player reads one Media3 snapshot. |
| partial | paginated result list, route capability, translations | ✅ covered | Existing valid rows stay visible; missing follow-up actions become labelled unavailable and an attributed translation is optional. |
| overflow | selector, result/detail/queue rows, long lyric lists, player sheets | ✅ covered | Selector scrolls horizontally once; all other lists/sheets scroll vertically; text wraps/ellipsizes per Typography without falling behind fixed shell surfaces. |
| zero-one-many | result pages, parts, queue occurrences, lyric candidates | ✅ covered | One item uses the same full-width row; many use ordered/list semantics and no duplicate page/occurrence collapse; zero receives fixed copy. |
| long-text | title, artist, source reason, Bilibili part title, lyric line, accessible label | ✅ covered | Two-line/ellipsis rules and safe registry display names prevent controls from overlap and prohibit raw/internal text leakage. |
| loading | five-source capability and search lifecycle | 🧪 backstop | Fixture/DOM contract proves only an active source/query/page/epoch can settle; cancel, timeout, source switch, navigation-away, and late reply settle exactly once. |
| partial | independent five-source capability fields | 🧪 backstop | Matrix fixtures prove search does not imply directory/media/lyric/login and unavailable actions render the exact capability state rather than a dead button. |
| populated | normalized result/directory rows | 🧪 backstop | Five-source fixture contract proves required source/title/artist/artwork-state/duration/kind/status fields and rejects malformed/cross-source rows before presentation. |
| zero-one-many | pagination and restoration | 🧪 backstop | Held-out contract proves a later page appends once, cancel/failure preserves prior rows, and rotation/Back restores one cursor/scroll scope without duplicate append. |
| populated | Bilibili parts and cross-provider details | 🧪 backstop | Contract proves a Bilibili base video only selects a validated current CID; other providers never reuse the Bilibili detail/media resolver. |
| error | Media3 failure and native snapshot projection | 🧪 backstop | Snapshot/fixture test proves a media failure retains current occurrence/queue and never invokes Howler or consumes next; mini/full player show the same revision. |
| zero-one-many | duplicate FIFO queue entries | 🧪 backstop | Queue engine/UI contract proves duplicates retain separate occurrence identities, reorder/remove target the chosen occurrence, and confirmation Back causes no mutation. |
| loading | lyric race, manual choice, and offset | 🧪 backstop | Held-out lyric test proves source/track/part/occurrence/revision mismatch, stale replies, errors, and offset persistence cannot replace the active lyric or leave loading stuck. |
| long-text | 320px / 200% text accessibility shell | 🧪 backstop | DOM/CSS contract proves 48dp targets, one-column reflow, selector scrolling, and focus targets remain outside mini-player/tab-bar occlusion. API35 rendered layout/TalkBack perception remains Phase 8. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not required — project is not React/Next.js/Vite |
| third-party | none | not applicable — no third-party UI registry/block is allowed |
| application-owned provider capability registry | existing `mobile_provider_registry.js` projection only | reviewed 2026-09-10 — typed, bounded, source allow-listed projection; contains no transport URL, cookie, header, token, local path, or raw exception payload |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS — recovery actions are surface-specific
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved by the Phase 5 UI checker on 2026-09-10
