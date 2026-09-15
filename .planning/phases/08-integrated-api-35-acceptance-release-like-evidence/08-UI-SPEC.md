# Phase 8 UI Acceptance Contract

## Scope

This phase validates the existing mobile UI; it does not redesign it. The exact hashed release-like APK must satisfy the following black-box contract on API 35.

## Viewport and System Matrix

| Mode | Required check |
|---|---|
| 360×800 portrait | Bottom navigation, source selector, mini-player, sheets, keyboard and destructive confirmations remain reachable with no desktop layout. |
| 800×360 landscape | Active route and playback state survive rotation; player/MV controls remain reachable. |
| Font scale 2.0 | Primary copy reflows, no essential action is clipped, and scroll restores reachability. |
| Gesture and three-button navigation | Safe-area clearance remains visible and system Back closes the nearest layer. |
| High contrast / reduced animation | Selected, disabled, loading, error, focus and playing states remain distinguishable without motion-only or color-only meaning. |
| TalkBack | Order is route title → primary content/action → mini-player → bottom navigation; lyric updates do not continuously steal focus. |

## Journey Assertions

- Search exposes exactly the ordered source labels NetEase, Kugou, Kuwo, QQ, Bilibili and retains the query `青花瓷` while changing sources.
- Results expose source, title, artist/author, duration/type, and real play/login/unavailable state. An external failure renders an actionable state rather than an empty successful list.
- Player, queue, lyric, notification and lock-screen state agree on the current occurrence, position, play/pause state and duplicate queue ordering.
- Library, local audio, backup, cache, history, account, DeepSeek, MV, effects and loudness controls expose honest busy/success/error/unavailable state and confirmation where destructive.
- The no-key DeepSeek path proves that cancel sends nothing and no key is rendered. The autonomous runner never accepts a key or Bilibili session through CLI/environment/file/clipboard/ADB; without prior authorized visible in-app entry, credential-controlled rows display and record `NOT_VERIFIED`. A live reached entitlement/region/CDN/codec limitation displays and records `DEGRADED` with its recovery action.
- External HTTPS navigation leaves the app through an approved system handler; file/content/intent/custom schemes remain inside the rejection path.

## Screenshot Rules

Retain only named checkpoints: cold shell, each source result/capability state, NetEase/Bilibili detail, playing/lyrics/queue, library/local/backup/cache, MV/PiP, effects/loudness, DeepSeek/account status, and recovery. Before hashing a screenshot, inspect it for QR codes, account identifiers, notification contents, local filenames, keys, provider URLs, or other user data; redact by reproducing the state with sanitized fixtures rather than painting over secret pixels.
