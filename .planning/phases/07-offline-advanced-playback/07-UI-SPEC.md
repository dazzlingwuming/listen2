---
phase: 7
slug: offline-advanced-playback
status: draft
shadcn_initialized: false
preset: none
created: 2026-09-15
---

# Phase 7 — Offline & Advanced Playback UI Design Contract

> Applies only to the canonical `mobile/` React Native application. It extends the existing phone-first shell and single TrackPlayer experience; it does not add a WebView/Electron screen or a second player.

## Existing Design System

| Property | Contract |
|---|---|
| Components | React Native core plus existing `ScreenLayout`, `Sheet`, `TrackRow`, `MiniPlayer`, and React Navigation patterns |
| Theme | Reuse `mobile/src/theme/index.ts`: `#090B12` base, `#10131D`/`#171B28` surfaces, `#8B7CF6` accent, `#D45B5B` destructive |
| Status | `#5DD6C7` confirmed available/complete; `#D9A441` pending/partial/repair/constraint; every color has visible text |
| Typography | System sans: 12 metadata, 14 body/control, 20 section heading, 28 screen title; regular 400 or semibold 600 |
| Spacing | 4/8/16/24/32/48/64; every action target at least 48 × 48 dp |
| Accessibility | Dynamic Type through 2.0, TalkBack labels/state/live regions, no color/motion/gesture-only meaning |

At 320dp width, action groups stack vertically; long title/artist/provider/error text wraps without hiding the recovery action. Player and cache screens leave clearance for the existing mini-player/tab/safe-area structure.

## Information Architecture

No root tab is added. Phase 7 adds or extends these existing routes/surfaces:

| Entry | Destination/behavior |
|---|---|
| Settings → `离线与缓存` | Quota controls, byte/status summary, background constraint/notification state, and `管理缓存` |
| `管理缓存` | Dedicated cache library screen with query/filter/sort/selection and owner-safe actions |
| Player → `音质` | Current authorized rendition list with selected state and entitlement/capability reasons |
| Bilibili detail/player → `分P` | Current native-reported parts; switching shows bounded resolve state and cannot retain a stale selection |
| Player → `音效` | Capability status, enable, preset, neutral reset, visualization, normalization controls |
| Existing MV screen | Authorized quality, full-screen and PiP controls only when capability is reported; audio-only fallback remains reachable |
| Existing DeepSeek settings/consent | Status-only key lifecycle and complete one-operation disclosure |

## Cache Library Contract

### Settings summary

- Heading: `离线与缓存`.
- Show `已使用 {used} / {limit}` or `已使用 {used} · 不限制`; unlimited is a real `null` value, not a very large display number.
- Quota choices are exactly `1 GB`, `2 GB（默认）`, `5 GB`, `10 GB`, `不限制`.
- Show pending/reserved bytes separately and one current background state: `等待网络`, `等待电量`, `等待存储空间`, `正在下载`, `正在验证`, `已暂停`, `需要修复`, or `无后台任务`.
- Primary action `管理缓存`; secondary action `下载通知设置` only when Android notification permission needs recovery.

### Library layout and rows

Top-to-bottom order is fixed: screen title `缓存管理`; byte/quota summary; search field; owner filters `全部 / 临时 / 歌单 / 已下载`; status filter; sort `最近使用 / 大小 / 标题 / 状态`; selection summary/actions; vertically scrolling entries.

Each entry states title, artist, source, quality/codec when known, size, owner labels, and exactly one state. Owner labels are `临时缓存`, `歌单缓存 · {playlist count}`, and `我的下载`. Never show file path, content URI, signed URL, provider host, cookie, attempt ID, or hash.

| State | Row copy/action |
|---|---|
| ready | `可离线播放` plus owner-appropriate remove/promote action |
| queued/resolving/downloading/verifying | Chinese labelled progress, bytes when known, `取消` |
| paused constraint | Specific network/battery/storage reason plus `条件满足后继续`; user may `取消` |
| entitlement denied | `当前账号无权使用此媒体` plus the native-provided `登录`, `选择可用音质`, or `移除` action |
| repair required | `缓存需要修复` plus `修复` and owner-safe `移除` |
| disk full | `存储空间不足` plus `管理缓存`; never claim the item is ready |
| failed | Safe classified reason plus `重试` when retryable |

Promotion copy is `保留为我的下载`; success becomes `已保留为我的下载` without a second row or progress reset when bytes are already valid. Removing temporary/playlist ownership explains when another owner keeps the bytes. Removing an explicit download requires confirmation: `删除“{title}”的下载？如果没有其他缓存用途，离线文件也会删除。` Buttons: `保留下载` and red `删除下载`.

Selection actions are `选择全部可见项`, `取消选择`, `删除所选`, `保留所选为我的下载`, and `修复所选`. `清理可移除缓存` never includes explicit downloads and states the affected item/byte count before confirmation. An empty filtered state says `没有符合当前筛选条件的缓存`; an empty library says `还没有缓存。实际播放、加入歌单或明确下载后会显示在这里。`

## Rendition, Part, and MV Contract

- Audio quality/part choices render only from the current native descriptor. Each row shows label, codec/container when useful, entitlement state, and selected state. Do not show a choice inferred from a desktop constant.
- Switching enters `正在切换音质…` or `正在切换分P…`; keep the current playing audio until the new descriptor is accepted, then atomically replace. Failure retains current audio and offers a safe reason/action.
- Member/login/region/DRM denial is explicit: `需要登录`, `需要相应会员权限`, `当前地区不可用`, or `此受保护媒体无法在当前设备播放`. Do not relabel denial as a network error.
- MV controls are visible only with native capability. Unsupported video says `当前设备或媒体不支持视频播放，已继续播放音频。` PiP/full-screen denial names device/settings/media capability and leaves audio controls usable.
- CDN recovery may show `正在尝试备用线路…` as bounded status but never displays a URL, host, candidate count, cookie, or request header.
- On API 24/25 with no complete verified local copy, show `当前 Android 版本需先下载完整媒体后播放。` with `下载后播放`; do not expose or pass through the remote URL. A verified local copy uses the normal player controls.

## Effects, Visualization, and Loudness Contract

The Player `音效` sheet contains:

1. Capability/status row.
2. `启用音效` switch.
3. Preset choices and `恢复原声`.
4. `实时频谱` switch and permission explanation/recovery.
5. `响度标准化（约 -14 LUFS）` switch with current analysis status.

Effects copy distinguishes app processing from device controls: `音效和响度只调整 Listen2 播放；设备音量、静音和耳机控制保持独立。` Any native failure announces `音效暂不可用，已保持原声播放。` It never stops or restarts audio merely to display an error.

Visualization has three honest visual states:

- `实时频谱` only while real current-generation native frames arrive during foreground playing.
- `频谱已暂停` for pause/seek transition.
- Static/hidden with one label: `需要录音权限以分析本应用播放`, `后台播放时不显示实时频谱`, `当前设备不支持实时频谱`, or `为减少设备负担，已隐藏实时频谱`.

There is no decorative moving spectrum when data is absent. Permission is requested only after the user turns on `实时频谱`; the pre-prompt explains that Android names the permission “录音” although Listen2 analyzes only its own player session and does not retain audio.

Loudness states are `使用原始音量`, `等待完整缓存后分析`, `正在后台分析`, `已应用 {gain} dB`, or `分析失败，使用原始音量`. First play immediately shows/uses original volume. Effect preset and normalization may both be enabled, but preset, user app volume, fixed gain, device volume, and mute have separate labels and state.

## DeepSeek Contract

- Settings shows `未配置`, `已配置`, `密钥存储不可用`, or a bounded `测试成功/测试失败` result. It never renders key characters, alias, ciphertext, HTTP body, or exception.
- `密钥存储不可用` copy: `当前设备无法安全保存 DeepSeek 密钥，因此翻译功能已停用。` There is no insecure continuation action.
- Consent title is `将当前歌词发送给 DeepSeek？`. Body must name the current song title and artist and state that the complete current lyrics are sent, the provider may charge the user's account, cancel before confirmation sends nothing, and failure does not replace/save the current translation.
- Actions are `取消，不发送` and `同意并翻译`. Focus starts on the safe cancel action. Dismiss, track/revision change, or cancel invalidates the operation.
- Success renders only validated aligned translated lines. Invalid/stale/incomplete output says `翻译结果与当前歌词不匹配，未保存。` Raw model output is never shown as an error or recovery preview.

## Loading, Error, and Recovery Rules

- Preserve last confirmed playable/audio/UI state during quality, cache, effect, analysis, and translation work; never optimistically label ready/applied before the native receipt.
- Use a polite live region for owner mutation receipt, download state transition, repair result, rendition/part outcome, effect fallback, analysis completion, and translation result. Do not announce every byte, spectrum frame, or playback tick.
- Disable only the action/identity currently pending. Browsing, pause, back, and audio controls remain usable.
- Back closes the nearest sheet/confirmation/selection mode before leaving the screen. Focus returns to the invoking action.
- Every error is classified user copy plus a valid recovery action when one exists. Never render native exception text, provider body, URL/path, secret, cookie, full prompt, or raw model response.

## State Coverage

| Surface | Empty | Loading | Partial/degraded | Error/recovery | Populated/overflow |
|---|---|---|---|---|---|
| Cache library | Defined empty/filter-empty copy | durable state labels/progress | shared owners, partial constraints | entitlement/disk/repair/retry | virtualized vertical list, selection and long text |
| Rendition/part | no authorized choice explains why | retain current audio while resolving | authorized lower quality/audio-only | exact entitlement/capability action | bounded list with selected state |
| Effects | unsupported capability | applying/session replacement | original-audio fallback | safe alert, no playback interruption | accessible switches/presets/reset |
| Visualization | hidden labelled state | waiting for current frame | paused/background/low-end labelled | permission/capability recovery | bounded real-frame renderer |
| Loudness | original volume/no complete media | background analysis | stale result ignored | original volume + reason | current identity/gain status |
| DeepSeek | not configured | testing/translating | existing validated translation retained | fail-closed safe status/retry where valid | aligned translated lyric render |

## Reduced Motion and Privacy

- Respect Android reduced-motion/remove-animation. Sheets may use the existing reduced transition; spectrum bars update only from analyzer frames and become static/hidden immediately when capture stops.
- Screenshots, accessibility labels, Redux/AsyncStorage/navigation snapshots, diagnostic copy, and tests contain no signed transport, private path, secret/key fragment, raw provider response, full serialized prompt, or unvalidated translation output.
- No new icon/font/component registry or remote UI asset is introduced.

## Checker Sign-Off

- [ ] Copy and recovery actions implemented exactly or with equivalent localized wording
- [ ] 320dp and 2.0 font-scale layouts preserve actions and 48dp targets
- [ ] TalkBack state/selection/live-region/focus behavior covered
- [ ] Static/hidden visualization is never presented as live
- [ ] Destructive cache actions preserve explicit/shared ownership contract
- [ ] No secret/transport/path/raw AI data renders or persists

**Approval:** locked by Phase 7 CONTEXT decisions; device visual/runtime proof is Phase 8 per D-10.
