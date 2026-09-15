---
phase: 6
slug: personal-library-continuity
status: draft
shadcn_initialized: false
preset: none
created: 2026-09-15
---

# Phase 6 — Personal Library & Continuity UI Design Contract

> Visual and interaction contract for the canonical `mobile/` React Native application. This phase extends the existing phone-first shell; it does not introduce an Angular/Electron/WebView surface, a component registry, or a second player.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — React Native `StyleSheet` theme already in `mobile/src/theme/index.ts` |
| Preset | not applicable |
| Component library | React Native core, React Navigation, existing local `Sheet`, `ScreenLayout`, `TrackRow`, and `MiniPlayer` components |
| Icon library | none; retain existing text marks only when paired with visible text and accessible labels |
| Font | Android system sans-serif; do not bundle a new typeface for this phase |

**Existing-system source:** `mobile/src/theme/index.ts`, `ScreenLayout.tsx`, `Sheet.tsx`, `RootNavigator.tsx`, Phase 5 UI-SPEC. There is no `components.json` and this is React Native rather than a React/Next/Vite web project, so the shadcn initialization gate is not applicable.

## Spacing Scale

Declared values (all multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Inline status/icon gap and title-to-metadata gap |
| sm | 8px | Compact row/action gap; list item internal spacing |
| md | 16px | Standard card padding, page side padding, form-field padding |
| lg | 24px | Screen section separation and modal/sheet horizontal padding |
| xl | 32px | Large section separation and empty-state vertical breathing room |
| 2xl | 48px | Screen bottom clearance above the mini-player/tab bar |
| 3xl | 64px | Existing dock/tab and large control reference; do not add page padding at this size |

Exceptions: all primary, secondary, destructive, list-row, and icon-only targets are at least **48 × 48 px**. Read-only status badges may be smaller because they are not targets. A row may grow vertically for translated/long text or Dynamic Type; never compress a touch target below 48 px.

## Typography

Use exactly these four sizes and two weights for Phase-6 surfaces. Use system font scaling; do not set `allowFontScaling={false}` or cap a user's font scale.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata / badge | 12px | regular (400) | 17px |
| Body / control label | 14px | regular (400) | 21px (1.5) |
| Section heading | 20px | semibold (600) | 24px (1.2) |
| Screen title | 28px | semibold (600) | 34px (1.21) |

At Android font scale 2.0, use `minHeight` rather than fixed text-row heights, allow button groups to wrap/stack, and retain full action labels. Titles may wrap to two lines; track/playlist titles use a two-line clamp, while secondary artist/source/status lines use one-line ellipsis with the full value in the accessibility label.

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#090B12` | App background and empty/loading canvas |
| Secondary (30%) | `#10131D` / raised `#171B28` | Cards, list rows, sheets, mini-player, tab bar, selected non-primary surface |
| Accent (10%) | `#8B7CF6` / soft `#26223D` | Primary confirmation buttons, selected tab/filter, keyboard-focus outline, non-destructive text action, current selection/progress only |
| Destructive | `#D45B5B` | Confirmed delete/remove/clear action and destructive failure emphasis only |

Use `#5DD6C7` only for a confirmed healthy/available/synced state and `#D9A441` only for pending, expired, partial, repair-needed, or offline-stale state. `#F5F7FB` remains primary text, `#8F97AA` metadata, `#262B3A` separators, and `#222838` artwork placeholder. Status is always text plus color/icon; color is never the only indication.

Accent reserved for: “新建歌单”, “导入本地音乐”, “开始/重新获取二维码”, “预览备份”, “合并导入”, “重试”, enabled capability-gated “播放” actions, selected navigation/filter controls, and the current selection/progress. It is not a generic decoration for every row or provider identity.

## Information Architecture and Phone Layout

The existing four-tab parent remains **我的 / 发现 / 搜索 / 设置**, with the mini-player above the 64px tab bar. Phase 6 adds child screens or sheets from **我的** and **设置**; it does not add another root tab or router.

| Surface | Layout and content contract |
|---------|-----------------------------|
| 我的 | Focal hierarchy is fixed: **library summary → one primary action (`新建歌单` when a library exists, otherwise `导入本地音乐`) → personal playlists and favorites → remote provider playlists → local music → recent history**. Sections remain vertically scrollable; collection type and state are visible in text, not inferred from artwork. |
| Playlist detail | Reuse summary card and `TrackRow`; display type/source/sync state beneath title. Use explicit 48px “上移” / “下移” controls rather than drag-only reordering. Keep playback/lyrics/download controls hidden unless their operation capability is true. |
| Account state | A Settings child screen/list headed “账号与来源”. Each provider is one 64px-or-taller semantic row with provider name, public state, and an allowed recovery action. |
| Bilibili QR | Full-width card/sheet: public status copy, a 192px QR image only while its attempt is waiting/scanned, expiry/retry/cancel controls, then sign-out when authenticated. The QR data itself, token, cookie, refresh material and attempt internals never render, copy, log, enter accessibility labels, or enter backup. |
| Local music import | “导入本地音乐” opens Android `ACTION_OPEN_DOCUMENT` multi-select. After return, show an import/inspection result list with safe title, artist, duration, artwork placeholder/artwork, LRC association state, and a non-secret access status. |
| Backup | Settings card exposes “导出我的歌单” and “导入备份”. Import stays in a scrollable bottom sheet: select/paste, validate, preview, merge, and explicit overwrite confirmation. |
| History and recap | A Settings child screen headed “听歌历史与年度回响”: recording preference, recent valid listening, annual selector/summary, export, and clear-history privacy actions. |

On 320dp-width phones, cards stay full-width with 16px side padding; controls within a card stack vertically instead of overflowing horizontally. The only horizontal scroll area is an already-established labelled tab/filter strip; it must expose its selected item to TalkBack.

## Interaction and State Contract

### Library, playlists, favorites, and remote projections

- Collection headings and rows state their type exactly: **我的歌单**, **我喜欢的音乐**, **远端歌单 · {provider}**, or **本地音乐**. Remote rows additionally state one of **已同步**, **离线缓存（上次更新 …）**, **同步失败**, **需要登录**, or **此来源暂不可用**. Do not show “已同步” after a failed/unknown response.
- Create uses a labelled modal with a 52px text input, 80-character limit, `放弃创建` and `创建歌单`. Rename uses the same form with `放弃修改` and `保存歌单名称`. Disable the outcome action for blank/unchanged names and retain typed text after an acknowledged failure.
- A mutation enters a visible “正在保存…” pending state only after dispatch. Keep the old confirmed order/favorite state on screen until the native repository receipt returns. Prevent a duplicate tap for that same command but keep unrelated browsing available.
- On native success, update from the returned snapshot/receipt and announce `已创建歌单`, `已重命名`, `已收藏`, `已取消收藏`, `已移动到第 N 位`, or `已从歌单移除`. On revision/conflict, refresh the affected collection, retain no fictional optimistic result, announce `歌单已在其他操作中变更，已刷新，请重试`, and provide `重试` only when the command is still valid.
- Do not silently invent a duplicate rule. A repository result that permits a duplicate displays it as a distinct occurrence (including its ordinal in TalkBack); a rejected duplicate leaves the list unchanged and says `这首歌已在此歌单中`. Rapid mutation/restart recovery must render only the transactionally confirmed snapshot.
- Reorder uses explicit `上移` and `下移` actions with disabled state and explanation at the first/last position. No drag gesture is required for completion and no row is visually moved before acknowledgement.
- Deleting a playlist opens a destructive confirmation: `删除“{playlist}”？歌曲本身不会被删除。` Buttons: `不删除歌单` and red `删除歌单`. A delete failure dismisses neither the current detail screen nor its confirmed data; show `未能删除歌单，请重试。` as an alert.
- Removing a local record confirms `从本地音乐移除？只会移除 Listen2 记录，不会删除设备上的原文件。` Favorites/removing a track use an immediate receipt-backed action and an undo only if the repository can guarantee it; otherwise the post-action confirmation is sufficient.
- A remote failure or offline state never removes personal/local/favorite rows. Existing valid local content remains browsable/playable; a remote row retains last confirmed metadata and exposes `重试同步` only when network/capability permits.

### Account matrix and Bilibili QR lifecycle

The account screen always renders this seven-row matrix, in this order: **QQ 音乐、酷狗音乐、酷我音乐、咪咕音乐、Taihe、哔哩哔哩、网易云音乐**. Every row names the provider, a public account/capability state, and either its controlled recovery action or the explicit unavailable reason. Only a provider with a declared controlled native login route may render a sign-in action. In this phase, Bilibili is the only permitted QR sign-in row; QQ/Kugou/Kuwo/Migu/Taihe/NetEase must show their truthful capability/unverified/unavailable state and no fabricated login control.

| Public state | Required UI and action |
|--------------|------------------------|
| 未登录 | `未登录` plus `扫码登录` only for Bilibili; other providers show their truthful capability text, not a fake login button. |
| 正在生成 / 等待扫码 | QR card, `请使用 Bilibili 扫码登录。`, live-region status update, and `取消登录`. |
| 已扫码待确认 | Keep QR visible; show `已扫码，请在 Bilibili 中确认登录。` and `取消登录`. |
| 已登录 | Public display name/avatar only when supplied by the safe public DTO; show `已登录` and `退出登录`. |
| 已过期 / 已取消 / 可重试错误 | Remove/hide stale QR, show a safe reason and `重新获取二维码` / `重试`. |
| 网络故障 / 权限不足 / 不可用 / 未验证 | Show a stable safe reason and a recovery path when one exists; do not offer login where no controlled route exists. |

Sign-out confirmation reads `退出 Bilibili 登录？这不会删除你的歌单、历史或本地音乐。` Successful logout returns that provider row to `未登录`; expired/logout state never exposes old profile/session/QR content.

### SAF local audio, metadata, LRC, repair

- Entry copy: `从系统文件选择器导入。不会请求全盘存储权限，也不会复制原文件。` The picker accepts Phase-6 supported formats (`mp3`, `flac`, `mp4`, `ogg`, `wav`, `webm`) and may present rejected-item count, never a URI/path.
- While native inspection runs, use a labelled non-blocking row/skeleton: `正在读取 {N} 个文件的信息…`; do not treat picker return as a usable-track success.
- A successful row shows safe metadata in this order: title, artist/album when known, duration when known, `本地音乐`, and one status: `可用`, `歌词已关联`, `歌词未添加`, `需要修复`, `访问已撤销`, `格式不支持`, `文件重复`, or `当前云端文件不可定位播放`.
- There are two safe LRC routes. When the user has granted a SAF **directory** and native code resolves a same-name adjacent LRC within that grant, the UI may show the native-safe result `已关联同名歌词`; it never exposes the directory, filename path, URI, or grant. A single-document audio import (or a directory grant with no safe native match) instead offers **explicit** `选择歌词文件`, opens a document picker, and reports `已关联歌词` / `未能读取歌词，请重新选择`. JavaScript never scans an adjacent directory or receives either URI.
- `修复访问` reopens the picker for the named record and retains the library row until a new usable record is confirmed. `移除记录` uses the local-removal confirmation above. A failed repair does not delete the record, its playlist membership, or prior confirmed metadata.
- The JS-facing UI receives opaque record IDs and safe metadata only. Never render, place in an accessibility label, export, persist to Redux, or copy an external `content:` URI, `file:` URI, absolute path, grant, bookmark, signed media URL, or raw native exception.

### Backup, migration, and rollback

- Portable export copy: `仅导出我的歌单、收藏歌单及必要的非敏感信息。不包含登录凭据、本地音乐、路径或 URI、队列、歌词、设置、媒体文件和缓存。` Primary CTA: **导出我的歌单**.
- Import begins with `选择备份文件` or `粘贴备份文本`, then `预览备份`. Validation/loading uses `正在检查备份…` and does not mutate data.
- The preview must state backup version; personal-playlist count; favorite-playlist/item count; identical-item skips; same-name independent playlist count; ID-conflict new-ID count; and excluded categories. It never prints secrets, paths, URIs, media URLs, or raw parser errors.
- **合并导入** is the primary/default action. It preserves existing data, skips identical items, retains same-name distinct playlists, and creates a fresh ID for an ID conflict. **覆盖当前资料…** is secondary and opens a second destructive confirmation: `覆盖当前我的歌单和收藏？现有符合条件的资料将被替换，且无法撤销。` Buttons: `保留当前资料` and red `确认覆盖`.
- Applying state uses `正在安全导入…` with controls disabled but a readable preview. Close the sheet only after one native transaction returns a success receipt. Interrupted/malformed/oversized/unsupported-old-version imports show a stable safe error, keep existing data untouched, retain the sheet, and offer `重新选择` / `重新预览`. On transaction failure say `未能导入备份；当前资料没有改变。请重试。`
- Startup migration is a blocking, labelled app-data state (`正在安全迁移你的资料…`) before mutable library projections render. A migration failure offers `重试` and `查看恢复说明`; it never starts with an empty library or destructively resets data. Recovery diagnostics contain status/time only, never serialized user data.

### History, recap, and privacy

- History recording is enabled by default only when the repository preference says so. The setting is a labelled switch with state text: `正在记录本机有效听歌历史` or `已停止记录新的听歌历史`. Turning it off does not erase past data and takes effect before new ledger writes are accepted.
- Recent history displays only committed valid listens, not play attempts, seeks, preload, buffering, or stale callbacks. Each row includes title, artist, source, and completion-local date/time; duplicate play instances remain separate where actually recorded.
- Annual recap displays year, total listening duration, valid-play count, distinct songs/artists, top song, top artist, and monthly trend. Its empty state is `这一年还没有足够的有效听歌记录` with `继续收听，达到有效听歌条件后会显示在这里。`; do not fabricate a “top” result from partial play state.
- `导出听歌历史` presents a safe share/export route and never contains credentials, local handles, cache/media data, or raw logs. `清除本机历史` opens: `清除本机听歌历史？这会永久删除历史和年度统计，无法撤销。` Buttons: `保留本机历史` and red `清除历史`. During/after clear, a generation fence prevents late playback events from repopulating the screen; success announces `本机听歌历史已清除`.

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `导入本地音乐` on My Music; `导出我的歌单` / `预览备份` in their respective data flows |
| Library empty | Heading: `还没有自建歌单` Body: `新建后，可以从歌曲详情加入。` Action: `新建歌单` |
| Local music empty | Heading: `还没有本地音乐` Body: `从系统文件选择器导入支持的音频文件。` Action: `导入本地音乐` |
| Remote/offline error | `暂时无法同步这个歌单。请检查网络后重试；你的本地音乐和已有歌单不会受影响。` Action: `重试同步` |
| Local repair error | `无法访问这个本地文件。原文件可能已移动、权限已撤销或设备无法读取。` Actions: `修复访问` / `移除记录` |
| Backup error | `未能导入备份；当前资料没有改变。请重新选择或重新预览。` |
| Migration error | `无法完成资料迁移。你的现有资料尚未被清除。请重试或查看恢复说明。` |
| History empty | `这一年还没有足够的有效听歌记录` / `继续收听，达到有效听歌条件后会显示在这里。` |
| Destructive confirmation | Delete: `不删除歌单` / `删除歌单`; overwrite: `保留当前资料` / `确认覆盖`; history: `保留本机历史` / `清除历史` |

All user-visible errors are product-safe classified messages. Never expose exception strings, HTTP bodies, credentials, cookies, token/refresh state, URI/path, or raw backup payload.

## Accessibility, Motion, and Focus

- Every screen title is `accessibilityRole="header"`; every interactive Pressable has a specific verb+noun `accessibilityLabel`, role, disabled/busy/selected state, and 48px target. Icon-only controls always have labels.
- Mark provider/account/library state cells as labelled text with their provider and status; do not force TalkBack users to infer state from a color badge or QR image. QR image label is only `Bilibili 登录二维码` while present.
- Use polite live regions for mutation receipt, import progress/completion, QR state change, backup validation/result, history clear, and local repair result. Do not announce every playback tick, retry poll, or list re-render.
- Modal/sheet opening moves accessibility focus to its header; closing or completing returns focus to the invoking control. Destructive confirmations focus the explicit safe outcome first (`不删除歌单`, `保留当前资料`, or `保留本机历史`). Back closes the nearest sheet/modal/confirmation before navigating away.
- Support system dark mode as the existing dark mobile theme, Android font scale through 2.0, TalkBack linear navigation, and contrast via text-plus-status semantics. No essential state is conveyed by artwork, emoji, color, motion, or swipe-only interaction.
- Respect the Android reduced-motion/remove-animation setting. Use no auto-playing decorative animation. Where the existing modal/sheet would slide/fade, use an immediate state change or the platform-reduced transition; loading uses a static labelled skeleton/progress copy, never an endlessly animated indicator as the only signal.

## UI Considerations

Applicable state considerations resolved: **24 covered, 6 backstop, 0 unresolved**. Empty/error copy is defined in the Copywriting Contract above; this table defines behavior and testable state coverage.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Personal playlists, favorites, local music, remote list, history/recap | ✅ covered | Each has a distinct, actionable empty state; a remote failure is never represented as an empty local library. |
| loading | Migration, library projection, remote sync, local inspection, QR lifecycle, backup validation/apply | ✅ covered | Labelled loading preserves last confirmed data where available and disables only the pending transaction. |
| error | CRUD receipts, remote/account, local repair, backup, migration, history export/clear | ✅ covered | Safe classified error plus retry/recovery; confirmed data remains intact on failure. |
| populated | Library collections, account matrix, local result list, backup preview, history/recap | ✅ covered | Rows expose source/type/status, capabilities, and safe action affordances at normal volume. |
| partial | Remote playlist/sync, batch local import, backup preview, recap metadata | ✅ covered | Show what succeeded, count/reason for excluded/unavailable entries, and do not claim full sync/import. |
| overflow | Long collections, sheets, recap trend, preview | ✅ covered | Vertical scrolling; bottom sheets cap at 78% of viewport and their content scrolls above the safe-area action region. |
| zero-one-many | Playlists, tracks, local files, import results, history | ✅ covered | Singular/plural counts use `1 首` / `N 首`; zero has the defined empty state; duplicates remain distinguishable occurrences. |
| long-text | Playlist/track/provider/error/action labels | 🧪 backstop | 2x font-scale visual/screen test proves no overlap, target loss, clipped destructive label, or hidden recovery action. |
| overflow | Account/provider matrix and narrow phone layout | 🧪 backstop | 320dp visual test proves rows wrap/stack rather than horizontally clipping provider/state/action text. |
| loading | Backup application and migration | 🧪 backstop | Screen test proves no mutation controls become available before receipt and failure retains confirmed data. |
| error | SAF repair/revocation and remote offline state | 🧪 backstop | Screen test proves repair/retry is exposed and personal/local data survives the failed request. |
| partial | Batch import and backup import plan | 🧪 backstop | Contract test proves rejected/skipped/conflict counts are visible without URIs or raw errors. |
| populated | QR account lifecycle and history privacy controls | 🧪 backstop | Screen test covers waiting/scanned/authenticated/expired and disabled/export/clear states with safe accessible labels. |

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — `components.json` absent and mobile React Native uses no shadcn registry |
| third-party | none | no third-party registry blocks declared as of 2026-09-15 |

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
