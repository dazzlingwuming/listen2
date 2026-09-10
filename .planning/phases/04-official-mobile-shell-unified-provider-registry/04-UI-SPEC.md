---
phase: 4
slug: official-mobile-shell-unified-provider-registry
status: approved
shadcn_initialized: false
preset: none
created: 2026-09-10
reviewed_at: 2026-09-10T15:36:00+08:00
---

# Phase 4 — Official Mobile Shell & Unified Provider Registry: UI Design Contract

> The Android product uses the phone-first information hierarchy of Listen1 Mobile v0.8.2 as a behaviour reference, while retaining the existing API 35 WebView, typed bridge, Media3, Room, SAF, Keystore, and native cache boundaries. This contract governs the shell and capability-driven source selection only; Phase 5 owns a verified live search-to-playback journey for every source.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — retain the existing AngularJS/classic-script and CSS system |
| Preset | not applicable |
| Component library | none; reuse semantic HTML, AngularJS templates, and existing scoped mobile classes |
| Icon library | existing inline SVG sprite (`#home`, `#search`, `#music`, `#settings`) and existing icon CSS only |
| Font | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` |
| Theme | retain `.modern-body` Midnight Editorial dark theme; Android is phone-first at `max-width: 760px` |

No shadcn gate applies: this is an AngularJS 1.x classic-script application, not a React, Next.js, or Vite application. No third-party block or registry is permitted for this phase.

### Existing visual analogs and implementation ownership

| Contract area | Existing analog | Files likely changed for this phase |
|---|---|---|
| Phone shell, insets, fixed dock/tab bar, responsive rules | `css/redesign.css` “Mobile shell contract” | `app/listen1_chrome_extension/css/redesign.css` |
| Page hierarchy, four tabs, library hub, mini-player and mobile surfaces | `listen1.html` mobile sections | `app/listen1_chrome_extension/listen1.html` |
| Top-level navigation, mobile overlays, Android Back dispatch | `NavigationController` | `app/listen1_chrome_extension/js/controller/navigation.js` |
| Query entry, search request lifecycle, result/detail state | `InstantSearchController` | `app/listen1_chrome_extension/js/controller/instant_search.js` |
| Source order and source labels | `sourceList` | `app/listen1_chrome_extension/js/app.js` |
| Capability matrix projection and semantic provider dispatch | `PROVIDERS`, Android capability helpers | `app/listen1_chrome_extension/js/loweb.js` |
| Native capability handshake truth | `ProviderCapabilityFacade` and typed bridge | `android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java`; `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java` only if handshake wiring changes |
| Contract verification | existing mobile and provider-matrix suites | `app/listen1_chrome_extension/test/mobile_ui_contract.test.js`; `android_mobile_behavior_contract.test.js`; `android_provider_capability_matrix.test.js`; `android_whole_product_mobile_surface.test.js`; matching JVM capability-facade test |

Use the current files rather than introducing a second navigation framework or a provider-specific screen per source. If a new shared JavaScript/CSS file is genuinely necessary, add it to the deliberate `listen1.html` load order and the explicit Android asset allow-list in `android/app/build.gradle`; otherwise that Gradle file does not change.

---

## Spacing Scale

Declared values (all multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | icon-to-label gap; tightly paired metadata |
| sm | 8px | inline actions, chips, stacked compact rows |
| md | 16px | default page gutter and component padding |
| lg | 24px | section separation and page bottom breathing room |
| xl | 32px | major section break within a scroll page |
| 2xl | 48px | minimum touch target and major shell separation |
| 3xl | 64px | reserved only for large empty-state vertical spacing |

Exceptions: the fixed mini-player is 64px tall and the bottom tab bar is `64px + safe-area inset`; both are 4px-grid-aligned and preserve a 48dp interactive interior. Set `--mobile-dock-height: 64px` and `--mobile-tabbar-height: calc(64px + env(safe-area-inset-bottom, 0px))`. Static source-status pills may be 32px high because they are not controls. Every actionable control, including the selector item, close button, retry, tab, queue action, and sheet action, has a minimum 48dp by 48dp hit target.

---

## Typography

Use exactly these four sizes and two weights. Do not use text size alone to convey provider availability or selected state.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata / tab label | 12px | 400 | 1.4 |
| Body / input / row title | 14px | 400 | 1.5 |
| Section heading / selected-source label | 20px | 600 | 1.2 |
| Page display title | 28px | 600 | 1.2 |

Long track titles, artist names, provider reasons, playlist names, and tab labels use two lines only where the layout grants two lines; otherwise they use one-line ellipsis. A provider name is never abbreviated. At 200% font scale, every card and selector item reflows into a single column or horizontally scrolls; it must not overlap the mini-player or tab bar.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#090B12` | page background, full-player background, the primary scroll surface |
| Secondary (30%) | `#10131D` | raised cards, search field, bottom navigation, mini-player, sheets |
| Accent (10%) | `#8B7CF6` | selected bottom tab, selected provider, primary CTA, focused input outline, active progress only |
| Positive semantic | `#5DD6C7` | verified/available source status only; never a CTA |
| Destructive | `#D45B5B` | destructive confirmation action only; no Phase 4 destructive action is introduced |
| Primary text | `#F5F7FB` | normal readable text on dominant and secondary surfaces |
| Secondary text | `#8F97AA` | supporting metadata and explanatory copy |

Accent is reserved for: the selected provider selector item; the selected bottom-navigation item; the `搜索音乐` primary action; keyboard focus outlines; and an actual playback progress value. Do not use accent for every button, unavailable state, heading, or provider brand. Keep existing contrast behaviour at or above 4.5:1 for text and 3:1 for focus/interactive indicators.

---

## Information Architecture and Interaction Contract

### Mobile hierarchy

The Android shell has one scrollable content region between a fixed header and fixed playback/navigation surfaces. It must never expose the desktop sidebar, window controls, floating-lyrics window, tray, thumbbar, or engineering capability dashboard.

| Level | Surface | Required behaviour |
|-------|---------|--------------------|
| 0 | Bottom navigation | Four stable destinations in this exact order: `首页`, `发现`, `音乐库`, `设置`. The active destination remains selected when a child route belongs to it. Account is reached from `设置`; it is not a fifth bottom tab. |
| 1 | Home | A calm continuation page. Its focal point is the current-track card when playback exists; otherwise its focal point is the accent `搜索音乐` action. `打开音乐库` and concise personal-library shortcuts follow. It contains no provider transport, bridge, or diagnostic text. |
| 1 | Discover / Search | Its focal point is the query field, followed immediately by the selected source and then one search-result state surface. Tapping `输入关键词` focuses the field and opens the IME without changing the active destination. |
| 1 | Library | Existing library hub: local music entry, created playlists, favourites, and short links to account, annual recap, and settings. It opens as a bounded bottom drawer above the mini-player and tab bar. |
| 1 | Settings | Account, preferences, and honest capability-gated routes. Current/unfinished non-primary capabilities appear here only as a short action with a recovery reason, not as a diagnostic panel. |
| Persistent | Mini-player | Sits above the tab bar while a track exists. It shows artwork, title, artist, play/pause, and opens player detail on title/artwork tap. It is the only desktop-dock equivalent in normal phone navigation. |
| Modal | Full player | Full-screen focused player. Queue and lyrics are child layers, not new bottom destinations. System controls/notification are Android equivalents; no desktop floating-player affordance is shown. |

### Source selector and unified capability presentation

Place the source selector immediately below the Discover search field, before any result, state card, or pagination control. It is a horizontally scrollable, single-row tab list with a visible selected state and a 48dp minimum height. Do not wrap provider tabs into two rows.

The only selectable sources, in this exact order, are:

| Order | Stable ID | Visible label | Initial state rule |
|------:|-----------|---------------|--------------------|
| 1 | `netease` | 网易云音乐 | select by default; capability fields decide whether an operation can run |
| 2 | `qq` | QQ音乐 | visible; shows its exact registry-derived unavailability until its route is proven |
| 3 | `kugou` | 酷狗音乐 | visible; shows its exact registry-derived unavailability until its route is proven |
| 4 | `kuwo` | 酷我音乐 | visible; shows its exact registry-derived unavailability until its route is proven |
| 5 | `bilibili` | 哔哩哔哩 | visible; capability fields decide whether an operation can run |

`migu` and `taihe` remain registry-only unavailable entries during Phase 4. They are not hidden “extra” source tabs, do not appear in the primary selector, and cannot produce a dead selector control, fabricated row, or empty-success state.

Each selected source projects the same data shape into the UI: immutable `sourceId`, display name, `search`, `directory`, `detail`, `media`, `lyric`, `accountRequirement`, account state, availability state, and a safe actionable reason. The UI derives labels, enabled actions, status badges, and recovery actions from this one registry projection. It must never infer a provider from a title, artwork URL, track URL, or a provider-specific controller branch.

| Registry state | Selector/result behaviour | User action |
|----------------|---------------------------|-------------|
| Available | show normal selected state; offer the supported action | submit or continue the requested action |
| Degraded | show source label and concise capability label, such as `可搜索，播放待支持`; do not promise the unsupported follow-up action | `继续搜索` if search is supported, otherwise `查看原因` |
| Unavailable | selection remains readable and focusable but no network request starts; replace the result region with the unavailable state | `返回其他来源` scrolls/focuses the selector; `重试` only appears when the registry marks that specific operation retryable |
| Account required / expired | show `需要登录` or `登录已过期` only for a route that actually supports login | `前往账户` opens the Settings account route; do not display a fake sign-in button |

Provider identity is rendered as a text source label on every future result-row, detail header, playlist item, queue item, and mini-player/full-player snapshot. Phase 4 establishes that visual slot and identity rule; Phase 5 fills it with live rows and playback outcomes.

### State, request, and recovery rules

1. A source switch, query edit, search submission, explicit cancel, page change, navigation away, or renderer destruction increments the visible request epoch. Only a reply matching the active source, query, page, and epoch can change the result region.
2. On a new submission, clear old results for a different query/source and show four compact skeleton rows labelled with the active source; never show a former source's rows beneath the new source label.
3. `取消搜索` immediately settles the current request once, removes the spinner, and shows `已取消本次搜索`. A late reply is ignored.
4. A source timeout, malformed response, offline state, entitlement failure, or unavailable route keeps the user on the current source and query. It shows a safe source-specific recovery card rather than raw protocol/bridge/HTTP data.
5. A result list may be partial only when the registry says that the missing follow-up capability is unavailable. Existing valid rows remain visible and each unsupported row action is absent or replaced by its exact capability label; no blank success surface is allowed.
6. Loading uses skeleton rows for lists and a small inline progress indicator for one button. Never block the whole shell with a spinner for a provider request.

### Layers and system Back

Back always closes the nearest visible layer; it never jumps to a desktop layout or silently changes source/tab.

1. If the IME is visible, dismiss the IME and retain the typed query.
2. Close a destructive/translation/queue confirmation without performing its action.
3. Close queue, lyrics picker, or other child sheet and return to the full player.
4. Close full player and return to the current top-level destination with the mini-player preserved.
5. Close Bilibili part detail, a source detail, the library hub, or a mobile product sheet and return to its parent destination; cancel its in-flight request.
6. Pop a real in-app child route, retaining its source/query/scroll context when it is still valid.
7. At a top-level destination with no transient layer, allow normal Activity Back behaviour. Do not switch to another tab or show an exit confirmation.

### Component inventory

| Component | Structure and interaction | Required states |
|-----------|---------------------------|-----------------|
| `MobileAppShell` | fixed header + one scroll region + mini-player + tab bar; consumes safe-area insets | normal, compact width, landscape, 200% font, reduced motion |
| `MobileTabBar` | four icon-and-label buttons; semantic `nav`; selected item exposes `aria-current="page"` | selected, focus-visible, pressed |
| `SearchInput` | visible label/placeholder, clear action, submit action, IME-safe | idle, focused, populated, submitting, cleared |
| `ProviderSelector` | horizontally scrollable five-item `tablist`; selected item is distinct by label, accent, and `aria-selected` | selected, available, degraded, unavailable, long label/200% type |
| `SearchStateSurface` | one region below selector, source-labelled; does not display stale data | guide, four-row skeleton, zero results, populated list, partial list, cancelled, error, unavailable |
| `ProviderStatusCard` | concise capability reason and only valid recovery action | retryable error, unavailable route, login required, entitlement restricted |
| `MobileLibraryHub` | bounded bottom drawer, backdrop, close control, scrollable sections | populated, zero playlists, long playlist name, loading/error summary |
| `MiniPlayer` | artwork/title metadata + play/pause; opens full player | no track hidden, paused, playing, missing artwork, long title |
| `FullPlayer` | focused player, lyrics entry, queue entry, close action | normal, loading artwork/lyrics, error preserved with retry; Phase 5 completes actual media states |
| `QueueSheet` | occurrence-aware list, reorder/remove/clear only when the capability exists | empty, populated, long list scroll, confirmation, command pending/error |
| `MobileSheet` | reusable bounded sheet for account/settings/library child actions | loading, populated, error, close/back |

---

## Responsive, Touch, and Accessibility Contract

- The phone shell applies at `max-width: 760px`; all mobile content is one column. At 359px and at 200% font scaling, no two-column action grid, fixed-width card, or desktop minimum width may cause horizontal scrolling.
- Apply `env(safe-area-inset-top/right/bottom/left)` to the shell. With the fixed 64px mini-player and `64px + safe-area inset` tab bar, the scroll region reserves `calc(64px + 64px + env(safe-area-inset-bottom, 0px) + 24px)` at the bottom; focus targets scroll into this unoccluded region when the IME appears.
- Portrait and landscape retain the same hierarchy. In landscape, sheets use the remaining safe viewport and have an internal scroll region; they never extend behind navigation/gesture areas.
- Every interactive element has a 48dp target, visible focus indication, keyboard activation for WebView hardware keyboard users, and no hover-only outcome. Icon-only controls have an `aria-label` that names the outcome.
- Use semantic landmarks (`header`, `main`, `nav`), semantic buttons, `role="tablist"`/`tab` for sources, and a polite live region for loading/cancelled messages; errors use `role="alert"` only when they first occur. Announce selected source, capability state, current track, and queue count.
- Convey source availability with text plus icon/status treatment, never colour alone. Artwork failures use a neutral placeholder and preserve title, artist, source, duration, and playable/login/unavailable label.
- Respect `prefers-reduced-motion: reduce`: remove scale/slide transitions and use immediate state changes. Normal state transitions use opacity/transform only, no longer than 160ms.
- Do not surface raw exception text, request ID, URL, cookie, header, signed-media data, local path, or bridge status in user-visible copy or accessibility labels.

---

## Copywriting Contract

All copy is Simplified Chinese, short enough for a 320px viewport, and source labels are inserted only from the registry display name.

| Element | Copy |
|---------|------|
| Primary CTA | `搜索音乐` |
| Search field placeholder | `搜索歌曲、歌手或歌单` |
| Discover guide | `输入关键词后选择来源，结果会显示在这里。` |
| Selector accessibility label | `选择音乐来源` |
| Loading search | `正在搜索{来源}…` |
| Cancel action / settled state | `取消搜索` / `已取消本次搜索` |
| Empty state heading | `还没有搜索结果` |
| Empty state body | `换个关键词，或选择其他音乐来源后再试。` |
| Generic source error | `{来源}暂时无法完成此操作。请检查网络后重试，或选择其他来源。` |
| Offline state | `网络不可用。检查连接后重试。` |
| Timeout state | `{来源}响应超时。请重试。` |
| Unavailable capability | `{来源}暂不支持{能力}。` |
| Unavailable recovery | `返回其他来源` |
| Login-required state | `需要登录后才能继续。` |
| Login recovery | `前往账户` |
| Partial capability label | `可搜索，{能力}待支持` |
| Home without playback | `还没有正在播放的歌曲。` |
| Library empty state | `还没有歌单。新建歌单或导入本地音乐。` |
| Sheet close label | `返回` |
| Destructive confirmation | No new destructive action belongs to Phase 4. Existing queue/history/cache destructive confirmations remain outside this phase's scope and must preserve their current explicit confirmation behaviour. |

The source-reason mapping must use safe, product-level capability text (for example `搜索`, `播放`, `歌词`, `登录`) rather than an engineering code. Do not use “当前不可用” as unexplained standalone copy; every unavailable state states the source, affected capability, and a usable next action when one exists.

---

## UI Considerations

Applicable state considerations resolved: 21 covered, 6 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | `SearchStateSurface`, `MobileLibraryHub`, queue sheet | ✅ covered | Search/library copy is fixed in the Copywriting Contract; a queue uses `播放队列为空` and no queue controls requiring an item are rendered. |
| loading | `SearchInput`, `ProviderSelector`, `SearchStateSurface`, mobile sheets | ✅ covered | Current operation only shows an inline progress state or four source-labelled skeleton rows; the shell remains interactive. |
| error | Search/result/detail states, account/capability card, mobile sheets | ✅ covered | All errors use the specified safe, source-specific recovery card. Raw transport and bridge details never render. |
| populated | Search results, library sections, queue | ✅ covered | Rows preserve source label, title, artist, duration/result kind, and capability state; lists scroll inside the shell's safe content area. |
| partial | Search results and provider capabilities | ✅ covered | Valid rows remain; each missing follow-up capability is labelled from the registry and its action is removed/replaced, never silently successful. |
| overflow | Bottom tabs, provider selector, result/list rows, sheet content | ✅ covered | Bottom labels and titles truncate per Typography; source selector horizontally scrolls without wrapping; lists/sheets scroll vertically with fixed controls remaining reachable. |
| zero-one-many | Results, playlists, queue | ✅ covered | Zero uses the documented empty state; one uses the same full-width row; many use uniform virtualisable rows and no layout change beyond vertical scrolling. |
| long-text | Search field, source status/reason, title/artist, playlist name, buttons | 🧪 backstop | Add a held-out visual/DOM contract at 320px and 200% font scale proving ellipsis/wrap rules preserve the 48dp targets and never overlap fixed playback/navigation surfaces. |
| loading | Provider selector handshake | 🧪 backstop | Add a contract proving default selected source is rendered pending handshake, then updates only from a current capability epoch without a false enabled action. |
| error | Cancel/timeout/late-response search lifecycle | 🧪 backstop | Add a contract proving cancel, timeout, navigation away, and late replies each settle only the active query/source/page state once. |
| overflow | Library drawer and full-player/queue child layers | 🧪 backstop | Add a visual/layout contract proving layers fit portrait and landscape safe viewports, retain internal scrolling, and do not sit behind mini-player/tab bar. |
| long-text | Accessibility labels and dynamic source copy | 🧪 backstop | Add a contract proving registry display names/reasons are used in readable accessible names without source ID, URL, or raw error leakage. |
| zero-one-many | Five-source selector | 🧪 backstop | Add a contract proving exactly five selectable primary sources appear in order and Migu/Taihe cannot appear as dead primary tabs. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not required — project is not React/Next.js/Vite |
| third-party | none | not applicable — no third-party UI registry or block is allowed |
| provider capability registry | existing application-owned registry only | capability projection is typed, bounded, origin-restricted, and contains no URL, cookie, header, local path, token, or raw error payload |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved after one bounded revision; no remaining recommendations
