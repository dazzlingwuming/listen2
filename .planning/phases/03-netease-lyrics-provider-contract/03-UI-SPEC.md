---
phase: 03
slug: netease-lyrics-provider-contract
status: draft
shadcn_initialized: false
preset: none
created: 2026-08-31
---

# Phase 3 — UI Design Contract

> Phone-first visual and interaction contract for NetEase's closed provider slice and provider-neutral lyrics. It extends Phase 1's search shell and Phase 2's single native Media3 player; it never changes desktop/browser paths or makes the WebView an audio clock.

---

## Scope and source of truth

- Activate these additions only when the trusted Android v2 capability reports the relevant NetEase or lyric capability. Retain the existing AngularJS/classic-script markup, `redesign.css` design language, and desktop rendering unchanged.
- The accepted native `PlaybackSnapshot` is the sole source for active track/occurrence, selection generation, playback revision, position, duration, lyric capability, and playback state. A JavaScript timer may only visually interpolate between current snapshots; it cannot choose a lyric line, declare success, or survive a snapshot mismatch.
- A lyric reply may render only when its page epoch, native occurrence/track identity, selection generation, playback revision, and lyric request token all match the visible player. Track change, seek, renderer recreation, cancel, timeout, or terminal reply clears the prior busy/active-line state exactly once; discarded replies do not alter the screen or announce anything.
- Phase 3 includes one authorized default NetEase rendition and primary/manual lyrics. Quality choice, alternate renditions, advanced CDN recovery, MV, DeepSeek translation consent/configuration/caching, login/session flows, download/offline controls, and provider expansion remain out of scope and must not appear as enabled controls.

## Design System

| Property | Value |
|----------|-------|
| Tool | none — no shadcn gate applies; this is AngularJS/classic scripts, not React/Next.js/Vite |
| Preset | not applicable |
| Component library | none; reuse semantic HTML, Angular bindings, existing inline SVG/icon font, and Android system surfaces |
| Icon library | existing inline SVG/icon font only; icon-only controls have explicit Chinese accessible names |
| Font | existing Android/system UI font stack; honour user font scaling and never transform-scale text |
| Existing visual language | Phase 1/2 `--ui-*` dark/light tokens, violet focus/accent, rounded raised surfaces, fixed mini-player and bottom navigation, state cards |

### Mobile surface inventory

| Surface | Reuse / target | Required Phase-3 role |
|---------|----------------|-----------------------|
| Source strip and search results | `.source-list`, `.source-button`, `ul.detail-songlist.isSearchOne` | NetEase is selected only for a current typed NetEase query. Result rows retain source, title, artist, duration/type, capability, and a 48dp open/play target. |
| NetEase detail / track list | `.page .playlist-detail`, `ul.detail-songlist.playlist-songlist` | Phone list for provider-authorized directory/detail tracks. Each row identifies `网易云音乐`, preserves cursor/scroll state, and exposes one safe default-play action when capable. |
| Mini-player | `.footer.player-dock`, `.detail.mobile-current-track` | Preserve the Phase-2 snapshot-rendered fixed player above the tab bar. Its current track/source opens player detail; it never shows lyric work as a playback failure. |
| Player detail / lyric pane | `.player-dock-surface`, `.playsong-detail`, `.detail-songinfo .lyric` | Full-height Android player detail with source, original/translation mode, active line, lyric state, offset controls, and a lyric source action. |
| Lyric source picker | existing `.lyric-picker`, `.lyric-picker-search`, `.lyric-candidate` adapted as Android modal sheet | Provider-neutral manual search/select/clear layer; it does not call desktop-only Bilibili paths or use WebView localStorage as durable state. |
| Capability-disabled provider rows | existing source selector/provider state rendering | QQ, Kugou, Kuwo, Migu, and Taihe remain visibly unavailable and non-actionable. Their unavailable explanation is readable but no fake search, login, detail, playback, or lyric action is offered. |
| Safe-area shell | `.mobile-tabbar`, `.footer.player-dock`, browser scroll region | Continue Phase-1/2 fixed-surface clearance and add lyric panel/sheet keyboard-safe geometry. |

### Primary visual focal point

| State | Primary focal point | Required emphasis |
|-------|---------------------|-------------------|
| NetEase search idle/current | Current source-labelled query and result-state card | `网易云音乐` appears as text plus source chip; a current request has labelled status and cancel action beside/below the search field. |
| NetEase detail/default playback | Chosen track and default-play action | Capability label and `播放`/play intent communicate one authorized default selection; no quality or alternate-rendition affordance is visible. |
| Player detail with usable lyrics | Active lyric line | Active original line is highest contrast and uses accent plus an explicit non-colour active indicator; optional translation sits immediately below its original line. |
| Lyric loading/degraded/error | Truthful state card and one recovery route | Retain track/playback controls and never replace lyrics with an empty success. |
| Manual picker | Search field, selected source, and result rows | Picker heading identifies the current song context. The selected source has text, check/state, and source chip; a clear action is visually secondary and explicit. |

---

## Spacing Scale

Inherited from Phase 1/2; declared values are multiples of four only.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Active-line marker, inline status/icon gap, original-to-translation separation |
| sm | 8px | Chips, offset labels, lyric-row metadata, adjacent controls |
| md | 16px | Player/picker inset, state-card padding, standard row spacing |
| lg | 24px | Separation between player metadata, lyric controls, and state card |
| xl | 32px | Major player-detail and picker content groups |
| 2xl | 48px | Minimum interactive target and standard primary-control height |
| 3xl | 64px | Major detail break; player/lyric heading rhythm |

Exceptions: lyric glyphs, artwork, progress markers, and icons may be visually smaller, but every actionable wrapper is at least 48dp × 48dp. The fixed mini-player uses a 64dp content band; its play/pause and track-information hit areas are padded to at least 48dp. The tab bar remains `64dp + env(safe-area-inset-bottom)`, and all content reserves `64dp + 64dp + env(safe-area-inset-bottom)` clearance for the mini-player, tab bar, and safe area.

---

## Typography

Use exactly these four CSS-pixel base sizes. Browser/Android font scaling is respected; text reflows before an action moves below it, and no new 650/700/760 weight is introduced.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata, source/capability chip, offset value, translation line | 12px | 400 | 1.5 |
| Body, result row, inactive lyric line, state copy | 14px | 400 | 1.5 |
| Action label, picker heading, original lyric line, section title | 16px | 600 | 1.35 |
| Track/player-detail title | 22px | 600 | 1.25 |

Only weights 400 and 600 are permitted in new Phase-3 rules. Compact mini-player/result metadata uses one visual line with ellipsis and a complete accessible name. Player title, lyric state copy, picker candidate metadata, and errors may wrap; action labels, source state, and 48dp controls remain visible at 200% font scale.

---

## Color

Follow the existing app dark/light theme; do not add a provider-specific theme or a per-lyrics theme switch.

| Role | Dark value | Light value | Usage |
|------|------------|-------------|-------|
| Dominant (60%) | `#090b12` (`--ui-bg`) | `#f7f7fb` | Phone page and player-detail background; sheet backdrop base |
| Secondary (30%) | `#10131d` / `#151925` (`--ui-surface` / `--ui-surface-raised`) | `#ffffff` / `#eef0f6` | Result rows, mini-player, lyric controls, picker, state card, and bottom navigation |
| Accent (10%) | `#8b7cf6` (`--ui-accent`) | `#6557d8` | Exact reserved elements below |
| Primary text | `#f3f4fa` | `#151725` | Track title, active original lyric, primary labels |
| Muted text | `#b7bbca` | `#575b6a` | Translation, artist/source, inactive lyric, explanatory copy |
| Destructive | `#d94b5c` | `#ba2940` | Reserved for future destructive confirmations; unused in this phase |

Accent reserved for: current selected source/tab, keyboard focus outline, accepted NetEase/default-play or retry action, active playback indication/progress inherited from Phase 2, active lyric line marker, selected original/translation mode, selected manual lyric source, and offset adjustment focus. It must never be the only sign of active lyric, selected source, translation mode, capability, error, or unavailable provider. Normal text contrast is at least 4.5:1 and icon/control contrast at least 3:1 in both modes; high-contrast mode preserves these relationships using existing semantic variables rather than fixed low-opacity text.

---

## Copywriting Contract

All runtime messages derive from stable sanitized states. Never display URL/query data, signed rendition, cookie, header, token, provider body, internal track/occurrence key, raw Room/database error, or exception text.

| Element | Copy |
|---------|------|
| NetEase primary CTA | `播放当前歌曲` — available only when the current NetEase track has a validated authorized default rendition; compact icon treatment may use the same accessible label |
| NetEase search idle | `搜索网易云音乐` — `输入歌名、歌手或专辑开始搜索。` |
| NetEase search loading / cancel | `正在搜索网易云音乐…` — labelled progress plus `取消本次搜索` |
| NetEase search no-result | `未找到匹配的网易云音乐歌曲` — `换个关键词，或稍后再试。` |
| NetEase detail loading / cancel | `正在读取歌曲信息…` — labelled progress plus `取消读取歌曲信息` |
| NetEase detail no tracks | `没有可播放的歌曲` — `请返回选择其他结果。` |
| NetEase cancelled / recover | `已取消本次操作` — reuse the relevant current-query action: `重新搜索网易云音乐` or `重新读取歌曲信息` |
| Network/TLS/timeout/schema provider error | `网络连接不可用` / `无法建立安全连接` / `请求超时` / `歌曲信息暂时无法识别` — one relevant retry only |
| Entitlement/login/region/DRM/rate limit | `此内容当前不可播放` — `请查看其他结果，或稍后再试。` No nonfunctional login CTA is shown in this phase. |
| Unsupported/default rendition error | `当前设备无法播放此音频` — `请重试，或选择其他歌曲。` Recovery: `重试播放` |
| Primary lyric loading / cancel | `正在获取歌词…` — `取消获取歌词` |
| Usable timed lyrics | `正在显示同步歌词` — source chip `自动匹配` or `手动选择`; this state is announced only when it changes, not on clock ticks |
| Plain text / insufficient timestamps | `这首歌没有可同步的歌词` — `可查看文本歌词，音频仍可继续播放。` |
| No lyric / provider refusal | `暂无可用歌词` — `音频仍可继续播放。` Recovery: `重新获取歌词` only when retryable |
| Track/duration mismatch | `歌词与当前歌曲不匹配` — `搜索其他歌词` |
| Lyric timeout/error | `歌词暂时无法加载` — `重新获取歌词` |
| Original/translation control | `原文` / `原文和翻译`; when no authorized translation is supplied, show `暂无翻译` as disabled explanatory text, not a working switch |
| Offset control | `歌词偏移` with current value `{+/-N.N}s`; actions `提前 0.5 秒`, `延后 0.5 秒`, `重置偏移` |
| Manual picker heading | `选择歌词来源` — `{歌曲名} · {歌手名}` |
| Manual picker search | Placeholder `搜索歌词来源`; action `搜索歌词来源` |
| Manual picker loading/empty/error | `正在搜索歌词…` / `没有找到可用歌词` — `换个关键词后重试。` / `歌词来源暂时无法搜索` — `重新搜索歌词来源` |
| Manual source selection/clear | `使用此歌词` / `清除手动选择`; after clear: `已恢复自动匹配` |
| Other providers unavailable | `此来源暂未在 Android 上提供` — `等待该来源完成独立验证后再使用。` |
| Destructive confirmation | 本阶段没有删除、清空或覆盖操作；`清除手动选择`恢复自动匹配，不需要确认对话框。 |

---

## Interaction and State Contract

### NetEase search, directory, capability state

1. Submitting a nonempty query after selecting NetEase makes `网易云音乐` the visible source and creates one current request identity. Revising the query, leaving the screen, source switching, Android Back while busy, or `取消本次搜索` immediately clears only that request's busy UI and prevents its late reply from changing rows, detail, player, lyrics, or speech.
2. A current successful result displays text-safe title, artist, cover/neutral placeholder, duration/type when known, source chip, and explicit capability (`可播放`, `需要登录`, `暂不可播放`, or `设备不支持`). Cover or optional field failure never hides core text. Prior valid rows may remain subdued and labelled as the earlier query while a new query loads; they never mix with new rows.
3. Empty result, partial success, provider rejection, timeout, malformed response, and cancellation are terminal states, not an empty success. Preserve already successful current rows when a later page/detail request fails, expose one context-correct retry, and never leave an indeterminate spinner after terminal settlement.
4. NetEase directory/detail opens a labelled busy state and preserves query, scroll cursor, and selected row on Back, rotation, and re-entry. Track rows are vertically scrollable and each entire row has a 48dp target. One authorized default-rendition action is offered only for an explicitly capable track; no quality selector, alternate source, manual URL, or provider transport detail appears.
5. QQ, Kugou, Kuwo, Migu, and Taihe have an unavailable text state in the source selector. The row is either a disabled button with the documented accessible explanation or non-interactive static content; it cannot submit a request, open a picker, or imitate a login/play action. Bilibili remains available only through its existing Phase-1 contract and must migrate onto the same native-clock lyric view without losing its existing safe states.

### Player detail and native-clock lyrics

1. Opening current-track information opens the existing full-height Android player detail with a labelled 48dp Back/close target. It retains Phase-2 artwork, metadata, timeline, and playback controls, then adds a lyric section after the player metadata. Pending, degraded, unavailable, and error lyrics never disable valid audio controls, hide the elapsed time, or convert playback to an error.
2. The lyric heading exposes source (`自动匹配` or `手动选择`), state, original/translation mode, current offset, `选择歌词来源`, and `清除手动选择` only when a manual record exists. Each actionable item is a semantic 48dp button; selected mode/source uses text and non-colour state in addition to accent.
3. The accepted Media3 position selects the active timed original line. On play, pause, seek, transition, playback error, process restore, and renderer reconnection, render the next accepted snapshot immediately. Ordinary bounded foreground progress may update the highlight and scroll; it must not use Howler, a page-local track identity, persisted timer state, or a stale pre-seek position.
4. The lyric list is one vertical scroll region inside the player detail. Keep the active line near the visual reading centre when the user has not manually scrolled; after manual scrolling, retain the user's position until they tap `回到当前歌词` or the track changes. Do not auto-scroll animation under reduced motion. Do not clip lines; long original/translation text wraps within the list.
5. Render each translation directly below its original with 4px separation and muted but contrast-safe text. `原文` hides translations; `原文和翻译` shows only authorized translation supplied with the selected lyric response. A missing translation leaves original lyrics visible and the unavailable explanatory text; it never substitutes machine translation or opens Phase-9 consent.
6. A plain-text lyric is readable but never highlighted as synchronized; insufficient timestamps, duration/track mismatch, missing lyrics, timeout, and provider refusal use their documented degraded/error cards. `暂无可用歌词` and other lyric terminal states leave audio/mini-player/player timeline usable.

### Offset and persistent manual source behavior

1. Offset has a visible current value and three 48dp controls: `提前 0.5 秒`, `延后 0.5 秒`, and `重置偏移`. Each successful intent waits for the current native selection/revision confirmation; a pending action is visibly disabled to avoid duplicate writes. The value is bounded by the native contract and never exposes a database status.
2. Offset changes reset the active-line calculation using the current native clock, retain original/translation mode, and announce the new offset once. `重置偏移` restores `0.0s`; it is reversible and does not clear lyric content or manual choice.
3. Manual selection persists only for the exact provider/track/part/revision identity in Android Room. A matching manual record takes precedence over automatic resolution. `清除手动选择` removes only that preference and restores automatic matching for the same identity; it does not delete a user playlist, external data, or another provider's lyric record.
4. A changed provider track, part, revision, occurrence, or active selection immediately invalidates the picker/search/result/offset pending state from the earlier identity. Old manual or automatic results cannot paint the new track. Rotation/renderer recreation reloads the current native identity and its persisted selection/offset once; it does not reissue duplicate searches or writes.

### Lyric source picker, loading, error, recovery

1. `选择歌词来源` opens a modal bottom sheet on phone layouts over player detail. It has a labelled heading/context, 48dp close button, search input with `type="search"`, 48dp `搜索歌词来源` action, one scrollable result list, scrim, focus containment, and focus return to the trigger on close. Desktop may retain its existing non-phone placement and path.
2. Empty submit retains idle state and makes no request. Starting a nonempty search displays the documented labelled busy state and a 48dp cancel/close route. New query, close, Back, track change, rotation, or renderer loss cancels/invalidates the old search and its late reply is silent.
3. A candidate row exposes source, title/artist when safely available, timestamp/match quality when supplied, selected state, and `使用此歌词` in its accessible name. Entire candidate selection is at least 48dp. Candidate text is rendered as text, never provider HTML.
4. On candidate selection, leave the existing valid lyric view visible until a current acceptance settles. A valid selection changes source to `手动选择`, uses its persisted offset, and announces the state once. Invalid/mismatched/cancelled/failed selection leaves the previous valid lyric or documented degraded state intact and offers one relevant recovery action.
5. Loading, empty, degraded, error, and retry states are mutually exclusive. A terminal state clears `aria-busy`; no spinner persists after cancel/error. Retry uses only the current track identity and current visible query, never a cached request, URL, header, cookie, or signed rendition.

### Back, safe areas, keyboard, rotation, and lifecycle

1. Android Back resolves the nearest layer in order: lyric picker search keyboard (dismiss keyboard), lyric picker, player detail, then existing Phase-1 content navigation. It never pauses or stops valid native playback. Back/cancel during a lyric operation settles its visible busy state before returning and ignores late terminal events.
2. Player detail and picker use `100svh` plus `env(safe-area-inset-top/right/bottom/left)`. The mini-player, tab bar, lyric action bar, sheet close control, state cards, and picker submit/close actions remain unobscured with display cutouts, gesture navigation, and three-button navigation.
3. Opening the lyric picker keyboard scrolls only the local detail/sheet content enough to keep the input, active candidate, close, and submit controls visible. It does not cover or reflow the fixed mini-player/tab bar into an untappable state. On keyboard dismissal, preserve the picker query/results and prior scroll context.
4. Portrait/landscape, Activity recreation, renderer recreation, background/foreground, and native service reattachment retain audio and request a fresh current snapshot. Restore player detail/picker only if their native identity is still current; otherwise close the stale picker and show the standard current player state. Never reset the current lyric to `0:00`, duplicate requests, or resurrect stale errors.

---

## Accessibility and Motion

- Use semantic `<button>` controls and semantic search/range inputs or correct ARIA equivalents. Icon-only controls have a Chinese name that states action and state. Source/result/candidate accessible names include title, artist, source, capability, selection/manual state, and action without exposing private IDs.
- The lyric section has one scoped polite live region. Announce state transitions, source selection/clear, original/translation mode, offset changes, errors, and an active-line transition once. Do not announce every normal progress cadence or scrolling movement. The active line has an explicit accessible current-state label such as `当前歌词：{original}; {translation when visible}; 歌词偏移 {value}`.
- All search, cancel, retry, source, candidate, offset, mode, close, and player controls are at least 48dp × 48dp. State/capability uses text plus icon/shape and color. Loading exposes `aria-busy="true"` plus the documented visible text; a spinner alone is insufficient.
- Picker modal semantics provide initial focus at heading/close, focus trapping while open, scrim isolation from player-detail controls, and focus return to its invoker. Visible violet keyboard focus is retained in both themes. Screen-reader announcements from stale pages, cancelled requests, closed panels, and old tracks are suppressed.
- At 200% text scale, 320px width, portrait/landscape, and high-contrast settings: no horizontal page overflow; lyric lines/state copy wrap; source/capability and action labels remain visible; fixed controls retain 48dp hit regions; no content is clipped behind the safe areas, keyboard, mini-player, or tab bar.
- Respect `prefers-reduced-motion: reduce`: no cover rotation, ambient/looping decoration, parallax, auto-scroll tween, or motion-only status. Focus and state changes may fade for at most 150ms. When reduced motion is enabled, active-line changes occur without smooth scrolling; the contrast/state marker remains visible.

---

## Emulator-Verifiable Acceptance Criteria

On the exact API-35 APK/device evidence record, a reviewer can verify the following without live-provider secrets, URLs, query strings, signed candidates, cookies, headers, raw provider data, raw exception messages, internal IDs, or personal paths:

1. A user can select NetEase, search, cancel/revise/retry, open a directory/detail track list, and see one source-labelled, capability-truthful terminal state. Old responses never replace the current query/detail/player state.
2. A capability-approved NetEase track follows the existing sole Media3 owner from default rendition through visibly advancing playback and player-detail lyric entry. The page never reports playing from a descriptor or bridge acknowledgement alone.
3. Bilibili and NetEase primary lyrics use the same player-detail source/state/offset layout. Pause, resume, seek, track change, rotation, renderer recreation, and recovery change the active lyric only from accepted native snapshots, never an old page timer.
4. Usable timed lyrics visibly highlight one current original line; authorized translations render directly below originals and can be shown/hidden. Plain text, no lyrics, insufficient timestamps, mismatch, provider refusal, cancellation, timeout, and error each end loading, retain audio controls, and show the documented Chinese degradation/recovery copy.
5. A manual source search opens an accessible phone sheet, reaches loading/result/empty/error states, lets a user select and clear a lyric source, persists choice/offset for the exact track revision, and rejects stale/cancelled selection replies without overwriting another song.
6. The other five external providers appear unavailable and cannot launch search/detail/playback/lyrics/login flows. No disabled control appears actionable or reports false success.
7. With TalkBack enabled, current lyric/source/mode/offset and terminal lyric states are readable exactly once per state/line transition, not continuously with playback ticks. At 320px, keyboard open, safe-area insets, gesture and three-button navigation, portrait/landscape, 200% text, high contrast, and reduced motion, all essential controls remain visible, labelled, and at least 48dp.

---

## UI Considerations

Probe-confirmed surfaces: `netease-source-search`, `netease-results`, `netease-detail-track-list`, `capability-disabled-provider-row`, `mini-player`, `player-detail-lyric-pane`, `lyric-active-line-list`, `lyric-offset-controls`, `lyric-source-picker`, and `safe-area-shell`. All applicable shape-rooted states are explicit contract truths; no surface is unclassified.

The compiled UI consideration probe was run with explicit element-kind confirmation for all ten surfaces. Applicable state considerations resolved: 68 covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | `netease-source-search`, `netease-results`, `netease-detail-track-list`, `lyric-source-picker`, `player-detail-lyric-pane` | ✅ covered | Empty query makes no request; no-result/no-track/manual-picker states use the documented copy and keep player context/audio valid. |
| loading | `netease-source-search`, `netease-detail-track-list`, `mini-player`, `player-detail-lyric-pane`, `lyric-source-picker` | ✅ covered | Every request has labelled busy/cancel state and an accepted identity; cancellation or every terminal result clears busy UI once. |
| error | `netease-source-search`, `netease-detail-track-list`, `player-detail-lyric-pane`, `lyric-source-picker`, `capability-disabled-provider-row` | ✅ covered | Stable sanitized errors end loading and expose one current-context recovery; unproven providers are unavailable rather than failed/successful requests. |
| populated | `netease-results`, `netease-detail-track-list`, `mini-player`, `lyric-active-line-list`, `lyric-source-picker` | ✅ covered | Result/track/candidate collections expose safe identity/capability; accepted native snapshot selects exactly one active lyric line and provider-neutral manual state. |
| partial | `netease-results`, `netease-detail-track-list`, `player-detail-lyric-pane`, `lyric-source-picker` | ✅ covered | Missing covers/duration/translation/timestamps or partial provider data use neutral placeholders or explicit degradation without hiding safe identity, audio, or recovery. |
| overflow | `netease-source-search`, `netease-results`, `netease-detail-track-list`, `lyric-active-line-list`, `lyric-source-picker`, `safe-area-shell` | ✅ covered | One local vertical scroll region per collection/panel, compact ellipsis with full accessible text, wrapping lyric/state copy, keyboard and safe-area clearance prevent clipping. |
| zero-one-many | `netease-results`, `netease-detail-track-list`, `lyric-active-line-list`, `lyric-source-picker` | ✅ covered | Zero uses explicit copy, one stays full-width/actionable, and many remain scrollable with no duplicate appends or stale-row mixing. |
| long-text | All ten probe-confirmed surfaces | ✅ covered | Query text scrolls internally; compact metadata ellipsizes with full names; lyrics, candidate metadata, capability/state, and recovery copy reflow at 200% without hiding 48dp controls. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — no shadcn setup and no React/Next.js/Vite stack |
| third-party | none | not applicable — no external block or registry is introduced |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
