---
phase: 01
slug: verified-bilibili-startup-slice
status: draft
shadcn_initialized: false
preset: none
created: 2026-08-30
---

# Phase 1 — UI Design Contract

> Phone-first visual and interaction contract for the verified Bilibili startup slice. This extends the existing AngularJS/mobile shell; it does not introduce a new UI framework or make a scaled-down desktop layout.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — existing classic AngularJS HTML/CSS |
| Preset | not applicable; this is not a React/Next.js/Vite project, so the shadcn gate is not applicable |
| Component library | none; reuse semantic HTML, existing Angular bindings, and CSS custom properties |
| Icon library | existing inline SVG sprite (`<use href="#…">`) |
| Font | platform sans stack already supplied by the app/theme; do not load remote fonts |
| Existing visual language | retain `redesign.css` tokens and the dark, elevated-surface look: `--ui-bg`, `--ui-surface`, `--ui-surface-soft`, `--ui-text`, `--ui-muted`, `--ui-accent` |

No third-party registry or block is used in this phase.

## Phone Layout Contract

### Responsive shell

- Treat widths `<= 760px` as phone UI, continuing the existing `@media screen and (max-width: 760px)` contract. The desktop sidebar, window controls, desktop back/forward buttons, and desktop-only hover affordances remain absent on phone.
- The local shell must paint before any provider request. It contains the existing `.mobile-page-heading`, `.navigation .search`, `.browser`, `.footer.player-dock`, and `.mobile-tabbar`; remote work may update only the content region after first paint.
- Use one vertical scroll container: `.modern-body .main .content .browser`. It must reserve space for the fixed mini-player and fixed tab bar with `env(safe-area-inset-bottom, 0px)`. Do not create a horizontally scrollable page.
- Keep the app's Android host system-bar padding and additionally use `100svh`/safe-area-aware CSS for fixed web UI. The top search/header has at least 16px content inset; bottom fixed UI must sit above the Android gesture/navigation area. No essential control may be under a cutout, system bar, keyboard, mini-player, or tab bar.
- New phone-shell rules use a 64px header, a 64px mini-player, and a 64px tab-bar base plus the bottom safe-area inset. Existing non-scale shell heights are normalized to these values as part of this phase; no shell-height exception remains.
- At 320–760 CSS px, primary content is one column. Search song rows use the existing 48px cover / flexible copy / trailing action pattern; playlist-card grids may remain two fluid columns. No fixed desktop column minimum is allowed.
- On rotation, preserve the active query, current source, result/detail identity, selected CID, and current playback snapshot. Reflow only; do not issue a duplicate request or append duplicate rows.
- At Android 200% font scaling, text may wrap in detail and state cards; controls grow vertically and the page remains scrollable. Never clip actionable copy or reduce a target below 48dp.

### Navigation and system-back behavior

| Situation | Required phone behavior |
|-----------|-------------------------|
| Root home / no active overlay | Android Back follows existing platform behavior (leaves the activity only after the WebView has no safe in-app history). |
| Search results | Back dismisses the keyboard first when it is visible; otherwise returns to local home without changing a still-playing track. |
| Bilibili detail / part picker | Back returns to the current search results and preserves their scroll position and query. |
| Lyrics / full now-playing surface | Back returns to the mini-player/content page; it does not stop audio. |
| Loading search or detail | Back/cancel immediately clears the visible busy state, sends the request cancellation, and ignores its late result. |
| Approved external HTTP(S) link | Open outside the WebView through Android's system handler. The app page remains unchanged and no URL, cookie, header, token, or signed media value is displayed or passed in UI state. |
| `javascript:`, `file:`, `content:`, `intent:`, non-HTTPS provider, untrusted appassets URL | Block silently in navigation; if the action originated from a visible user control, show the safe generic failure copy once. |

### Component and selector inventory

| Surface | Reuse / implementation selector | Required phase-1 role |
|---------|---------------------------------|-----------------------|
| Header/search | `.mobile-page-heading`, `.navigation .search`, `#search-input` | Home identity plus one Bilibili-scoped query input. The input has an accessible label and a visible clear/cancel affordance while a request is active. |
| Search source strip | `.page .searchbox .source-list`, `.source-button` | Bilibili is visibly selected and labelled `哔哩哔哩`; do not imply unverified providers work. |
| Search results | `ul.detail-songlist.isSearchOne > li.isSearchType` | Source-labelled rows with cover, title, author, duration/type, capability chip, and a 48dp open/play affordance. |
| Detail / parts | `.page .playlist-detail`, `.detail-head`, `ul.detail-songlist.playlist-songlist` | Video title/author plus an explicit part list. A selected part is visually and semantically selected. |
| Mobile player | `.footer.player-dock`, `.detail.mobile-current-track`, `.main-info` | Fixed foreground mini-player showing current track, source, playback state, and a minimum 48dp play/pause target. Tapping track information opens primary lyrics/now-playing. |
| Full player / primary lyrics | existing `.playsong-detail .detail-songinfo .lyric` | Entry surface for the selected current Bilibili track. It must show loading, content, unavailable, or error without blocking audio. |
| Bottom navigation | `.mobile-tabbar`, `.mobile-tab` | Fixed four tabs (`首页`, `发现`, `音乐库`, `设置`), each with 48dp minimum tap region and visible selected state. Keep current behavior; Phase 1 does not add desktop navigation. |
| Account/library drawer | `.mobile-library-hub` | Preserve existing local library drawer. Account entry says that sign-in is unavailable in this slice rather than initiating a startup login probe. |

### Primary visual focal point by state

| State | Primary focal point | Required emphasis |
|-------|---------------------|-------------------|
| Idle home | Search field (`#search-input`) | It is the only prominent action, receives initial focus on explicit user request only, and has the visible Bilibili source context nearby. |
| Current search | Current-request status | Place `正在搜索哔哩哔哩…` and `取消本次搜索` directly below/adjacent to the search field; retain older valid rows as subdued context, never as the current query result. |
| Detail / parts | Selected part and `播放此分P` | Keep the selected part in the first visible action region when possible; pair its non-color selection indicator with the enabled primary play CTA. |
| Playback / mini-player | Current track and play/pause | The fixed mini-player title and its 48dp play/pause control have the strongest persistent emphasis; progress and source are secondary. |

## Spacing Scale

Declared values (all multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Status-icon gap, dense inline metadata |
| sm | 8px | Chips, row sub-elements, adjacent controls |
| md | 16px | Default page inset, card padding, result-row copy gap |
| lg | 24px | Section separation and error/empty state inset |
| xl | 32px | Major content-group separation |
| 2xl | 48px | Minimum square touch target and primary-control height |
| 3xl | 64px | Header, mini-player, tab-bar base, and major page break |

Exceptions: none. Icon glyphs may be 16–24px only inside a 48dp target; all surrounding shell bands and interactive controls use declared scale values.

## Typography

Use exactly these four CSS-pixel base sizes. Browser text scaling is respected; do not use transform scaling or fixed-height text clipping.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata / chip | 12px | 400 | 1.5 |
| Body / result title | 14px | 400 | 1.5 |
| Section / action label | 16px | 600 | 1.35 |
| Detail title / lyrics heading | 22px | 600 | 1.25 |

Only weights 400 and 600 are permitted in new Phase-1 rules. Existing `font-weight: 760` on the noninteractive app mark is grandfathered; do not extend it to new content.

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#090b12` (`--ui-bg`) | Page background and app shell |
| Secondary (30%) | `#10131d` / `#151925` (`--ui-surface` / `--ui-surface-raised`) | Search field, result/detail surfaces, mini-player, tabs, state cards |
| Accent (10%) | `#8b7cf6` (`--ui-accent`) | Current tab/source, focused input outline, selected part, primary `播放`/`重试`, playback progress, active lyric state |
| Destructive | `#d94b5c` | Reserved for a future destructive confirmation only; no destructive user operation is in Phase 1 |

Accent is reserved for the selected Bilibili source, selected part, primary user action, focused keyboard control, current playback/progress, and active navigation/lyric indication. It must not be used as the sole signal for status, selection, or error.

## Copywriting Contract

All user-visible Phase-1 provider and bridge failures map from safe stable codes. Never show a raw exception, URL, header, cookie, token, BVID/CID, signed media URL, or provider response body.

| Element | Copy |
|---------|------|
| Primary CTA | `播放此分P` (available only for a validated, publicly playable selected part) |
| Search idle / empty heading | `搜索哔哩哔哩音乐` |
| Search idle / empty body | `输入歌名、歌手或视频标题开始搜索。` |
| No-result heading | `没有找到结果` |
| No-result body | `换个关键词，或稍后再试。` |
| Search loading / cancel | `正在搜索哔哩哔哩…` — labelled progress plus `取消本次搜索` |
| Search cancelled / recover | `已取消本次搜索` — preserve valid rows; error recovery action is `重新搜索哔哩哔哩` |
| Detail loading / cancel | `正在读取分P…` — labelled progress plus `取消读取分P` |
| Detail cancelled / recover | `已取消读取分P` — preserve current valid result context; error recovery action is `重新读取分P` |
| Search offline/TLS/timeout/malformed | `网络连接不可用` / `无法建立安全连接` / `搜索超时` / `搜索结果暂时无法识别` — `重新搜索哔哩哔哩` |
| Detail offline/TLS/timeout/malformed | `网络连接不可用` / `无法建立安全连接` / `读取分P超时` / `分P信息暂时无法识别` — `重新读取分P` |
| Permission/login state | `此内容需要登录或没有播放权限` — `查看其他结果`; do not show a nonfunctional login CTA in Phase 1. |
| Unsupported/unavailable stream | `当前设备无法播放此音频` / `此分P暂时没有可用音频` — `返回选择其他分P` |
| Invalid selected part | `所选分P不可用` — `返回重新选择` |
| Lyrics loading / cancel | `正在获取歌词…` — `取消获取歌词` |
| Lyrics unavailable | `暂无可用歌词` — `音频仍可继续播放。` |
| Lyrics error | `歌词暂时无法加载` — `重新获取歌词` |
| Account entry | `登录功能将在后续版本提供` — no automatic probe and no disabled control presented as usable. |
| Destructive confirmation | 本阶段无删除、清空或覆盖操作，因此不展示破坏性确认框。 |

## Interaction and State Contract

### Home/startup

1. Cold launch displays the local header, search field, bottom navigation, and either locally available content or a stable local empty state before remote catalog/account work begins.
2. A remote home/catalog failure finalizes its own loading indicator and leaves the shell, local items, and any previously successful content usable. `Gathering`/indeterminate loading must never persist after a terminal result.
3. The search input opens the Android keyboard, keeps the query visible, and uses `type="search"` plus a labelled submit action. Empty submit stays in the local idle state; it does not create a network request.

### Bilibili search and cancellation

1. Submitting a nonempty query sets Bilibili as the visible source and produces one current request identity. Search results are tagged with a visible `哔哩哔哩` source chip and a programmatic source name.
2. Revising a query, switching page, navigating away, or pressing `取消本次搜索` cancels the prior search. The old busy UI disappears immediately; its terminal reply cannot overwrite the later query/page/detail or announce a stale result.
3. During loading, preserve prior valid rows but mark them as results for the prior query only until the new current response arrives. Do not mix results from two query/page epochs.
4. A successful current response renders title, author/artist, duration when known, type, cover or a neutral cover placeholder, and capability state. Cover failure never hides text, selected-part flow, or playback availability.
5. Render exactly one source-specific retry action on terminal error: `重新搜索哔哩哔哩` for search. It reuses the current visible query only, never a stale request object.

### Result, detail, and selected part

1. Opening a supported Bilibili video navigates to its detail with a deterministic busy state and `取消读取分P`. On success, show its title/author and a vertically scrollable part list. Each part row shows its ordinal/title, duration when known, current availability, and a 48dp entire-row tap target.
2. The part selected by the user has both a non-color selected indicator and `aria-selected="true"`/equivalent accessible state. The play CTA names that exact part (`播放此分P`).
3. An unqualified BVID may choose the API-declared first part only after the visible part list has loaded. Once the user chose a part, an absent/mismatched CID is `所选分P不可用`; it must not silently select the first part or play another part.
4. Capability is explicit: `可播放`, `需要登录`, `暂不可播放`, or `设备不支持`. CTA availability follows that state; a disabled/hidden CTA must not look actionable.
5. Detail back, rotation, and re-entry preserve the selected part and cursor once loaded; no part or search row is duplicated. Any detail terminal error exposes only `重新读取分P` for the current result.

### Foreground playback and lyric entry

1. On a valid user gesture, the mini-player enters a visible resolving state, then playing/paused state only after the permitted foreground player has begun and position advances beyond `0:00`. A URL/object alone is never surfaced as successful playback.
2. The mini-player stays above the tab bar, exposes track title, source, play/pause label, and a 48dp play/pause target. Long title/artist strings truncate after one line with ellipsis; the full combined title is available through `aria-label`/accessible name.
3. Failed manifest, unavailable stream, incompatible codec, permission, timeout, and malformed descriptor states stop the resolving affordance and route back to the relevant safe error state. Recovery is finite and bound to the current track/request epoch.
4. Tapping `.detail.mobile-current-track` opens the existing primary now-playing/lyrics surface for the current track. Lyrics have four mutually exclusive visible states: loading (`取消获取歌词`), content, unavailable, error (`重新获取歌词`). They do not delay or stop otherwise valid foreground audio.
5. Phase 1 does not claim background play, lock-screen controls, synchronized lyrics, translations, manual lyric persistence, or native Media3 playback. Do not put controls for those future capabilities on this screen.

## Accessibility and Motion

- Use semantic `<button>` for every tap action; icon-only buttons require an explicit Chinese `aria-label`. Result rows and part rows must announce title, author, source, part/duration where known, and capability before their action.
- Announce current loading/terminal state once through a scoped polite live region. Cancellation and stale replies must not announce after the user moved to a newer screen.
- Loading indicators expose `aria-busy="true"` and descriptive text; skeletons/spinners alone are insufficient. Retry/failure status uses text plus icon/color, never color alone.
- Maintain visible keyboard focus using the existing accent outline. Keyboard Enter submits search; Escape/Android Back resolves the most local dismissible state first. No hover-only action is required on mobile.
- Every primary, trailing, source, retry, part, mini-player control, and bottom-tab target is at least 48dp by 48dp. The 34–36px legacy icon glyph/button styles must be expanded with hit-area padding or replaced within the phone media query.
- Ensure normal text contrast is at least 4.5:1 against its surface; icon/control contrast is at least 3:1. Use `--ui-text`/`--ui-muted` only where the required contrast remains met in both theme modes.
- Respect reduced motion: state changes/focus may fade in ≤150ms, but no autoplayed parallax, looping decorative animation, or motion-only status signal. Never delay the terminal state behind animation.

## Emulator-Verifiable Acceptance Criteria

The Phase 1 UI is not accepted from markup, unit tests, or APK assembly alone. On the exact API-35 emulator/APK evidence record required by `01-VALIDATION.md`, a reviewer must be able to verify:

1. Cold launch reaches an interactive local phone shell with no desktop sidebar/window controls and no permanently visible loading state; search, mini-player, and bottom navigation are unobscured by system bars.
2. A public Bilibili query can be submitted, cancelled, revised, and resubmitted. Only the current source-labelled result list remains visible; a delayed old result cannot replace it.
3. A result opens a detail/part list; selecting a part visibly marks that exact part. An invalid selected part produces `所选分P不可用` rather than playing a different part.
4. A permitted selected part can be started by a user gesture. The mini-player reports a playing state only when audible progress advances past `0:00`; pause/resume remains usable.
5. The mini-player opens primary lyrics, which visibly reaches one truthful loading/content/unavailable/error state without blocking audio.
6. Search, detail, manifest, stream, and lyric failures each end their spinner and show the contract's safe Chinese recovery copy. No screenshot/log/UI contains cookie, header, raw URL, signed URL, token, or raw exception text.
7. Back moves from lyrics to player/content, detail to current results, and current loading to cancelled without stopping valid audio or letting late state mutate the next page. Approved external HTTP(S) links open outside the WebView; unsafe schemes remain blocked.
8. At 320px width, rotation, 200% font scale, keyboard open, and gesture navigation, essential controls remain visible, vertically reachable, labelled, and at least 48dp.

## UI Considerations

Probe-confirmed surfaces: `idle-home-search-form`, `search-source-strip`, `active-search-results`, `detail-part-selector`, `error-empty-states`, `mini-player`, `lyric-entry`, `bottom-navigation`, `account-library-drawer`, and `safe-area-shell`. The auto resolution floor proposed 69 backstops; all 69 were upgraded to explicit covered truths because the Interaction and State Contract and Emulator-Verifiable Acceptance Criteria provide defensible acceptance criteria. No surface was unclassified.

Applicable state considerations resolved: 69 covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | `idle-home-search-form`, `search-source-strip`, `active-search-results`, `detail-part-selector`, `error-empty-states`, `mini-player`, `lyric-entry`, `bottom-navigation`, `account-library-drawer` | ✅ covered | Empty forms, collections, and media follow the empty-state behavior in the Copywriting Contract while preserving the local shell or valid audio required by the Interaction and State Contract. |
| loading | All ten probe-confirmed surfaces | ✅ covered | Search, detail, playback, lyric, navigation, and control loading expose labelled busy state and scoped cancellation; every terminal or cancelled state clears busy UI. |
| error | All ten probe-confirmed surfaces | ✅ covered | Search, detail, manifest/stream, selected-part, lyric, navigation, and control failures end spinners and use safe stable-code recovery paths defined by the Copywriting Contract; raw provider data is never shown. |
| populated | `search-source-strip`, `active-search-results`, `detail-part-selector`, `error-empty-states`, `mini-player`, `lyric-entry`, `bottom-navigation`, `account-library-drawer` | ✅ covered | Happy-path collections and media identify current Bilibili content, selected part, capability, and 48dp actions without duplicate rows. |
| partial | `idle-home-search-form`, `search-source-strip`, `active-search-results`, `detail-part-selector`, `error-empty-states`, `bottom-navigation`, `account-library-drawer` | ✅ covered | Partial fields, rows, covers, and local-library data preserve safe identity and capability, using neutral placeholders or omitted optional metadata; prior valid rows remain scoped context only. |
| overflow | `search-source-strip`, `active-search-results`, `detail-part-selector`, `error-empty-states`, `mini-player`, `lyric-entry`, `bottom-navigation`, `account-library-drawer`, `safe-area-shell` | ✅ covered | The browser remains the single vertical scroll region with fixed-player/tab-bar and safe-area clearance; source strips scroll only within themselves, and titles/state content wrap or ellipsize without clipping. |
| zero-one-many | `search-source-strip`, `active-search-results`, `detail-part-selector`, `error-empty-states`, `bottom-navigation`, `account-library-drawer` | ✅ covered | Zero, one, and many result/detail/library rows retain explicit empty-state, full-width identity, and scrollable-collection behavior without duplicate append. |
| long-text | All ten probe-confirmed surfaces | ✅ covered | Query text scrolls internally; row and fixed-player metadata ellipsize with accessible full names; detail/state copy and navigation labels reflow at 200% text scale, leaving action labels visible. |

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — no shadcn setup and no React/Next.js/Vite stack |
| third-party | none | not applicable |

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
