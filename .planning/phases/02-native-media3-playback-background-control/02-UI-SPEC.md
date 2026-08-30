---
phase: 02
slug: native-media3-playback-background-control
status: draft
shadcn_initialized: false
preset: none
created: 2026-08-31
---

# Phase 2 — UI Design Contract

> Phone-first visual and interaction contract for the single native Media3 playback owner. This extends, rather than replaces, Phase 1's AngularJS/classic-script mobile shell and its `redesign.css` design language.

## Scope and non-negotiable source of truth

- The service-owned Media3 snapshot is the only playback truth. The page, mini-player, player detail, notification, lock screen, Bluetooth/headset controls, and recovery UI render the same current occurrence, metadata, position, duration, mode, capabilities, and state revision. The page never infers playback success from a URL, a controller command, or local timer progress.
- The WebView is a renderer/controller only. It sends high-level, allow-listed native-occurrence intents and renders revisioned, sanitized snapshots. A stale page or snapshot revision must not change a visible control, position, track, queue entry, or announcement.
- Do not migrate the shared AngularJS/classic-script UI, introduce React/shadcn, or restyle desktop/browser paths. Phase 2 rules activate only for the trusted Android playback capability.
- Phase 2 owns basic playback controls and queue semantics. Synchronized/manual/translated lyrics, account UI, downloads/offline UI, MV, visualizers, effects, loudness, and AI controls remain out of scope and must not appear as enabled phone controls.

## Design System

| Property | Value |
|----------|-------|
| Tool | none — no shadcn initialization; the stack is AngularJS/classic scripts, not React/Next.js/Vite |
| Preset | not applicable |
| Component library | none; reuse semantic HTML, Angular bindings, existing SVG/icon treatment, and Android system notification/lock-screen UI |
| Icon library | existing inline SVG/icon font only; icon-only actions always include a Chinese accessible name |
| Font | existing system UI font stack; respect Android font scaling and never transform-scale text |
| Existing visual language | Phase 1 `--ui-*` dark surfaces, violet accent, rounded raised surfaces, fixed mini-player plus bottom navigation, text-safe state cards |

### Mobile surface inventory

| Surface | Reuse / target | Required Phase-2 role |
|---------|----------------|-----------------------|
| Mini-player | `.footer.player-dock`, `.detail.mobile-current-track`, `.mobile-playback-state` | Persistent 72dp phone control surface above the bottom tab bar; renders the current native snapshot and opens player detail. |
| Player detail | existing full now-playing surface under `.player-dock-surface` / `.playsong-detail` | Phone-first detail layer, not desktop chrome: artwork, metadata, timeline, controls, playback mode, volume/mute, queue entry point, recovery copy. |
| Queue sheet | new Android-only panel owned by the player-detail state | Modal bottom sheet for FIFO play-next occurrences; never overload the desktop playlist or raw Media3 timeline. |
| Existing lyrics entry | `openPrimaryLyrics()` path | Retain as a separate Phase-1-compatible entry. It shows the current native track identity but does not claim Phase-2 lyric synchronization. |
| System surfaces | Media3 notification / lock screen / headset/Bluetooth media controls | OS-owned equivalents of mini-player basic controls; project the same native snapshot and action availability. |

### Primary focal point

| State | Primary focal point | Required emphasis |
|-------|---------------------|-------------------|
| No active track | Local library/content plus an inactive, non-actionable mini-player | Do not fabricate a play action or start a foreground service. |
| Resolving / buffering | Current track title plus labelled state in mini-player/detail | Progress is secondary and visibly indeterminate only while duration/position is unavailable. |
| Playing / paused | Large play/pause control and elapsed/remaining timeline in player detail; compact state in mini-player | Violet accent marks the current playback state and track progress only. |
| Queue open | Next unconsumed FIFO occurrence and its order number | Queue identity and order take priority over duplicate-looking artwork/title. |
| Recovery/error | Safe problem statement plus one finite recovery action | Preserve the selected occurrence/context; never move focus to another track or silently skip. |

## Spacing Scale

Declared values are inherited from Phase 1 and all new values are multiples of 4.

| Token | Value | Phase-2 usage |
|-------|-------|----------------|
| xs | 4px | Status icon gap, progress labels, compact metadata |
| sm | 8px | Inline controls, queue metadata and chip gaps |
| md | 16px | Page/sheet inset, card padding, timeline/control grouping |
| lg | 24px | Detail sections, confirmation-card inset |
| xl | 32px | Separation between artwork, timeline, mode and queue sections |
| 2xl | 48px | Minimum square interactive target and standard primary control height |
| 3xl | 64px | Minimum player-detail primary control group rhythm; persistent mini-player content band excludes safe-area padding |

Exceptions: visual artwork, progress thumb, and glyphs may be smaller, but their actionable wrapper is at least 48dp × 48dp. The mini-player is 72dp content height plus `env(safe-area-inset-bottom)` clearance when it is the lowest fixed surface; its controls retain 48dp targets.

## Typography

Use exactly these four CSS-pixel base sizes. Browser/Android font scaling is respected; headings and controls expand their container rather than clip or reduce text.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata, queue ordinal, elapsed time, capability chip | 12px | 400 | 1.5 |
| Body, track/artist row, state copy | 14px | 400 | 1.5 |
| Action label, sheet heading, player-detail section title | 16px | 600 | 1.35 |
| Current-track/player-detail title | 22px | 600 | 1.25 |

Only weights 400 and 600 are permitted in new Phase-2 rules. Track title/artist in the mini-player and queue row each use one visual line with ellipsis; their full combined name and distinct queue ordinal remain in the accessible name. Detail title may wrap to two lines before its adjacent action row moves below it.

## Color

Phase 2 preserves the Phase-1 palette. Theme follows the app's existing persisted dark/light setting; it does not introduce a per-player theme switch.

| Role | Dark value | Light value | Usage |
|------|------------|-------------|-------|
| Dominant (60%) | `#090b12` (`--ui-bg`) | `#f7f7fb` | Phone page/player-detail background and sheet backdrop base |
| Secondary (30%) | `#10131d` / `#151925` (`--ui-surface` / `--ui-surface-raised`) | `#ffffff` / `#eef0f6` | Mini-player, player-detail cards, queue sheet, confirmation card, controls |
| Accent (10%) | `#8b7cf6` (`--ui-accent`) | `#6557d8` | Exact reserved elements below |
| Primary text | `#f3f4fa` | `#151725` | Track title, primary labels |
| Muted text | `#b7bbca` | `#575b6a` | Artist, duration, explanatory state copy |
| Destructive | `#d94b5c` | `#ba2940` | Confirmed remove/clear actions only |

Accent is reserved for: current playing indicator, current progress/seek thumb, enabled primary play/retry action, selected repeat/shuffle mode, focused control outline, selected queue occurrence, and the active navigation/lyrics indication inherited from Phase 1. It must not be the sole signal for playing/paused, selection, queue order, availability, or error. Normal text maintains at least 4.5:1 contrast and icon/control indicators at least 3:1 in both modes.

## Copywriting Contract

All visible runtime failures map from stable sanitized codes. Never expose a media URL, signed candidate, cookie, token, header, raw provider body, internal occurrence key, database error, or exception message.

| Element | Copy |
|---------|------|
| Primary playback CTA | Visible `播放` / `暂停`; accessible label `播放当前歌曲` / `暂停当前歌曲` — both always match the current native snapshot |
| Mini-player no-track state | `还没有正在播放的内容` |
| Player-detail queue CTA | `播放队列` with count: `播放队列（{N}）` |
| Queue empty heading/body | `播放队列为空` — `添加“下一首播放”的歌曲会显示在这里。` |
| Queue occurrence label | `队列第 {N} 首` — always visible and included in the accessible name; duplicate track titles are never merged |
| Reorder labels | Visible `上移` / `下移` / `移到最前` / `移到最后`; accessible labels add `此队列项` |
| Remove one confirmation | `删除此条队列项？` — `这不会删除原歌单中的歌曲。` Actions: `保留此队列项` / `删除此队列项` |
| Clear confirmation | `清空播放队列？` — `将移除 {N} 首待播歌曲，原歌单不会改变。` Actions: `保留播放队列` / `清空播放队列` |
| Mode labels | `顺序播放` / `单曲循环` / `随机播放`; control announces the resulting mode before confirmation |
| Resolving | `正在准备播放…` |
| Buffering | `正在缓冲…` |
| Paused | `已暂停` |
| Interrupted by route/focus | `播放已暂停` — `连接耳机或回到应用后可继续播放。` |
| Bounded retry | `正在尝试恢复播放（{attempt}/{max}）…` |
| Terminal media failure | `当前歌曲暂时无法播放` — `请重试，或选择其他歌曲。` Primary recovery: `重试播放` |
| Restored but unresolved checkpoint | `已恢复播放队列` — `当前歌曲需要重新准备后才能播放。` Recovery: `继续播放` |
| Renderer reconnecting | `正在连接播放器…` — controls remain disabled until a current snapshot arrives |
| Seek unavailable | `暂时无法跳转进度` |
| Notification/lock-screen unavailable action | Omit the unavailable action from system controls; the page counterpart is disabled with the matching accessible explanation, never shown as a successful tap. |
| Destructive confirmation | Only `删除` one queue occurrence and `清空队列` are destructive in this phase; both require the explicit confirmations above. |

## Interaction and State Contract

### One-snapshot contract and command feedback

1. Every page command is immediately represented as a non-final pending affordance, then settles only from a newer native snapshot revision. A repeated tap while the same command is pending is ignored and remains visibly disabled; it must not create a second seek, queue mutation, playback start, or announcement.
2. The mini-player, player detail, notification, and lock screen must agree on track title/artist/artwork fallback, playing/paused/resolving/buffering/error state, elapsed/duration, mode, and enabled basic actions after the next accepted snapshot. Page-local timers may animate the displayed elapsed time between snapshots but must reconcile forward only and snap back to the native revision on mismatch.
3. A page reconnect, activity recreation, rotation, renderer loss, or stale callback renders `正在连接播放器…` without resetting current metadata. When the current native snapshot returns, it replaces the reconnect state atomically; it must not start/pause audio, replay a command, duplicate a queue entry, or announce a prior error.
4. One scoped polite live region announces a state transition once. Snapshot revisions from an old page generation, stale queue action, closed sheet/detail, or previous track are discarded without spoken feedback.

### Mini-player

1. The fixed mini-player stays above `.mobile-tabbar`, content scroll clearance includes its height plus both safe-area insets, and it remains visible with gesture navigation, three-button navigation, keyboard, portrait/landscape, 320px width, and 200% font scale.
2. With a current occurrence it renders artwork or a neutral placeholder, title, artist/source, sanitized state text, and one 48dp play/pause button. Tapping track information opens player detail; it does not toggle playback. Long text ellipsizes, never overlaps the control, and exposes the full accessible name.
3. Resolving, buffering, retrying, paused, playing, and terminal-error states are mutually exclusive. `正在播放` is permitted only after the native player reports current occurrence plus advancing position; a command acknowledgement, media descriptor, or service binding is resolving, not playing.
4. With no current occurrence, the dock uses the documented non-actionable state, hides position/mode/queue count, and never keeps a media foreground service alive merely to retain its visual shell.

### Player detail, progress, and basic controls

1. Opening player detail is a full-height phone layer with a 48dp labelled back/close target. It shows artwork, title/artist/source, safe current state, elapsed/duration, a semantic range control, play/pause, previous, next, mode, volume/mute, and `播放队列（{N}）`.
2. The timeline has a 48dp-high hit region. Dragging shows a provisional `mm:ss` value and `正在调整进度`; the committed time changes only after the next accepted snapshot revision. Releasing sends one bounded seek intent. Disable seek while resolving/error or when duration is unknown, and show `暂时无法跳转进度` only after an attempted unavailable action.
3. Previous follows accepted playback history, including a consumed queue occurrence. Next, natural completion, notification next, lock-screen next, and headset/Bluetooth next enter the same serialized native transition; the page cannot assume an index or independently consume an entry.
4. Repeat/mode cycles only through snapshot-supported states: `顺序播放` → `单曲循环` → `随机播放`. The current choice has text, icon/state label, and a non-color selected indicator. Shuffle produces no visual promise of a fixed upcoming order and must preserve the real history rule for previous.
5. Volume and mute are rendered from the same snapshot. Volume uses a labelled 48dp target/range; mute has an explicit `静音`/`取消静音` accessible label. System volume changes update the page on the next snapshot without a looped command.

### FIFO play-next queue sheet

1. `播放队列（{N}）` opens a modal bottom sheet over player detail. The sheet has a labelled heading, count, close button, focus containment while open, a scrim, and one vertically scrollable list; the player detail remains unchanged beneath it.
2. Each row represents exactly one occurrence and includes visible ordinal, artwork/placeholder, title, artist/source, and `队列第 {N} 首`. Identical track IDs/titles/artwork remain separate rows with separate occurrence IDs; UI deduplication is prohibited.
3. A queue row exposes a 48dp drag handle for direct manipulation and accessible 48dp alternatives `移到最前`, `上移`, `下移`, and `移到最后`. Boundary actions are disabled with an accessible reason. A reorder stays pending until the next snapshot; a stale/rejected operation restores the prior snapshot position without duplicate rows.
4. Each row has a 48dp `删除` action that opens the documented one-item confirmation. `清空队列` appears only when `N > 0`, opens the documented count-aware confirmation, and is destructive red—not the queue title, row, or ordinary close control. Confirmation cancellation returns focus to the initiating control.
5. When `N = 0`, show the documented empty state; when `N = 1`, display a single full-width occurrence without collapsed controls; when many, preserve ordinal order and scroll within the sheet. A long title/artist never hides queue order or remove/reorder actions.
6. When the final FIFO occurrence is consumed, the sheet updates from the new snapshot to its empty state and player detail reflects the restored originating playlist/context and mode. Queue-only occurrences never appear as permanent members of that originating playlist.

### Resolving, buffering, error, and recovery

1. A valid user play intent enters `正在准备播放…`; service binding, candidate resolution, and codec preparation do not count as playback. Buffering after an accepted playback start changes to `正在缓冲…` while retaining current metadata, position, and pause control when supported.
2. A bounded retry always targets the selected current occurrence, displays `正在尝试恢复播放（{attempt}/{max}）…`, and never moves to next, consumes another queue occurrence, or shows a different track. Candidate count/URLs and provider details stay native-only.
3. On terminal failure, stop the busy indicator, retain current title/context and queue order, show `当前歌曲暂时无法播放`, and offer only `重试播放` plus normal navigation. A retry is a fresh current-occurrence command; old retry outcomes cannot overwrite a newer occurrence/snapshot.
4. Audio focus loss, `AUDIO_BECOMING_NOISY`, headset/Bluetooth disconnect, renderer loss, and screen-off must resolve to a truthful snapshot state. Screen-off/background playback may continue through the service; noisy/disconnect/focus pause is visible as `播放已暂停` with the documented recovery. No WebView lifecycle event releases the service-owned player.
5. On process recovery, restore queue/mode/history/current occurrence and position from the durable checkpoint. If the descriptor cannot refresh, restore paused/actionable with the documented recovery copy; do not autoplay, silently skip, or persist/display expired media candidates.

### Notification, lock screen, system back, and lifecycle

1. The Media3 notification and lock screen are Android-equivalent player surfaces, not secondary mini-players. They show the same sanitized metadata/artwork fallback and expose only the currently supported play/pause, previous, next, and seek actions. Their command result must be visible in the page and mini-player through the next snapshot revision.
2. Notification/lock-screen action availability mirrors the page. If no previous/next/seek is valid, omit it from the system surface and disable its page counterpart with an accessible explanation. Never leave a tappable-looking action that native rejects.
3. Android Back resolves the nearest layer: dismiss a queue confirmation, then close queue sheet, then close player detail to the underlying content/mini-player. It does not pause or stop audio. From underlying content it retains the Phase-1 Back behavior; only leaving the activity follows normal Android history rules.
4. Rotation, Activity recreation, WebView renderer recreation, app background/foreground, and a temporary bridge disconnect preserve current audio and rebuild the same player/queue snapshot. Do not duplicate intents, reorder entries, reset shuffle/history, or restart from zero merely because the page reattached.

## Accessibility, safe areas, keyboard, and motion

- Use semantic `<button>` controls and semantic range inputs/ARIA equivalents. Icon-only controls have Chinese `aria-label`s that state action and current state; queue rows include title, artist/source, ordinal, and available actions in their accessible name.
- All controls named in this contract are at least 48dp × 48dp, including player-detail close, seek hit region, mode, volume/mute, queue open/close, reorder alternatives, remove, confirmation actions, mini-player play/pause, and notification-page equivalents where Android exposes them.
- Loading uses `aria-busy="true"` plus text. State/error/selection use text and icon/shape as well as color. The queue sheet uses modal semantics, initial focus on heading/close, focus return to its invoker, and no focusable content behind the scrim.
- Fixed mini-player, tab bar, player detail, queue sheet, confirmation, and keyboard-invoking controls apply `env(safe-area-inset-top/bottom/left/right)` and `100svh` sizing. The virtual keyboard may scroll detail/sheet content but must not cover its active input, confirmation actions, mini-player controls, or sheet close target.
- At 200% font scale, text reflows before controls; no horizontal page overflow, clipped state copy, hidden queue ordinal, or inaccessible confirmation action is permitted. Maintain an explicit visible violet focus outline in both themes.
- Respect reduced motion. State/focus transitions may fade ≤150ms; the progress thumb may move with actual playback but no looping decoration, cover rotation, ambient animation, or motion-only status signal runs under `prefers-reduced-motion: reduce`.

## API-35 Device-Evidence Acceptance Criteria

Phase 2 is not accepted from source review, JVM/unit tests, instrumentation, build, notification presence, or APK assembly alone. The exact debug/release-like APK and API-35 emulator evidence record must prove, without URLs, cookies, tokens, provider bodies, raw exceptions, or personal paths:

1. One native Media3 owner is active while page, mini-player, notification, and lock screen agree on track, playing/paused state, elapsed/duration, mode, and supported controls; WebView/Activity recreation does not create a second owner.
2. From page, mini-player, notification, lock screen, and headset/Bluetooth where available, play/pause/previous/next/seek/volume/mute settle to the same native snapshot. Pause halts position; resume advances it; controls unavailable in one surface are consistently unavailable in all.
3. A queue with duplicate track entries visibly retains separate `队列第 N 首` rows. Reorder via direct or alternative controls, remove one with confirmation, clear with count-aware confirmation, consume FIFO entries, and return to originating context/mode without duplicate or skipped consumption.
4. Shuffle, repeat, and previous reflect persisted mode/history across rotation, page disconnect, Activity recreation, app restart, and process recovery. A repeated or late external control command cannot double-consume a queue occurrence.
5. Resolving, buffering, bounded retry, terminal error, focus/noisy/headset/Bluetooth interruption, screen-off background playback, renderer loss, and descriptor-refresh failure each have a terminal, understandable snapshot and safe recovery. A media failure remains on the current occurrence and never silently skips.
6. At 320px, portrait/landscape, gesture and three-button navigation, keyboard open, dark/light themes, 200% font scale, high-contrast mode, and reduced motion, the mini-player, detail, queue sheet, confirmation actions, status copy, and 48dp targets remain visible, labelled, and unobscured.
7. Evidence records timestamp/timezone, git SHA, APK SHA-256, build variant, package, API/ABI/emulator/WebView, exact commands, device state, screenshots/observations, pass/fail/blocked status, uncovered behavior, and recovery path. A blocked external provider/device prerequisite stays `BLOCKED`/`not verified`; it cannot be substituted by fixture or build evidence.

## UI Considerations

Applicable state considerations resolved: 51 covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | `mini-player`, `queue-sheet`, `player-detail` | ✅ covered | No-track dock and zero-queue sheet use the documented truthful empty copy; no action or service is fabricated. |
| loading | `mini-player`, `player-detail`, `queue-sheet`, `system-surfaces` | ✅ covered | Resolving, buffering, retry, command pending, and renderer reconnect are labelled and settle only through a newer native snapshot. |
| error | `mini-player`, `player-detail`, `queue-sheet`, `system-surfaces` | ✅ covered | Terminal failures stop busy UI, retain current occurrence/context, and expose only safe finite recovery copy. |
| populated | `mini-player`, `player-detail`, `queue-sheet`, `notification-lock-screen` | ✅ covered | Current metadata/position/mode/action availability derives from one snapshot; FIFO rows preserve every occurrence. |
| partial | `player-detail`, `queue-sheet`, `notification-lock-screen` | ✅ covered | Missing artwork/duration/action capability uses neutral placeholders or omits unsupported action while preserving safe identity and state. |
| overflow | `mini-player`, `player-detail`, `queue-sheet`, `confirmation`, `safe-area-shell` | ✅ covered | One local scroll region per detail/sheet, ellipsis for compact metadata, reflow for detail/status copy, and safe-area/keyboard clearance prevent clipping. |
| zero-one-many | `queue-sheet` | ✅ covered | Queue has explicit zero copy, one full row, and many scrollable ordinal rows without deduplication. |
| long-text | `mini-player`, `player-detail`, `queue-sheet`, `mode-and-system-controls` | ✅ covered | Compact labels ellipsize with complete accessible names; detail and confirmation copy reflow at 200% font scale without hiding actions. |

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — no shadcn setup and no React/Next.js/Vite stack |
| third-party | none | not applicable |

## Six-Pillar Self-Validation

| Dimension | Verdict | Contract evidence |
|-----------|---------|-------------------|
| 1. Copywriting | PASS | Exact Chinese CTA, empty, resolving/buffering, recovery, destructive confirmation, and safe-error copy are specified. |
| 2. Visuals | PASS | Phone surface inventory, focal states, mini-player/detail/sheet layout, system surface consistency, dark/light rendering, and API-35 visual evidence are concrete. |
| 3. Color | PASS | 60/30/10 dark/light token mapping and a finite accent-reservation list are declared; destructive use is isolated. |
| 4. Typography | PASS | Exactly four sizes and two weights with line heights, scaling, wrapping, and accessible long-text behavior are declared. |
| 5. Spacing | PASS | Multiples-of-four scale, safe-area bands, fixed-surface clearance, and 48dp hit-area rules are declared. |
| 6. Registry safety | PASS | No component registry or unvetted third-party block is introduced. |

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS (self-validation; checker confirmation pending)
- [x] Dimension 2 Visuals: PASS (self-validation; checker confirmation pending)
- [x] Dimension 3 Color: PASS (self-validation; checker confirmation pending)
- [x] Dimension 4 Typography: PASS (self-validation; checker confirmation pending)
- [x] Dimension 5 Spacing: PASS (self-validation; checker confirmation pending)
- [x] Dimension 6 Registry Safety: PASS (self-validation; checker confirmation pending)

**Approval:** pending checker verification
