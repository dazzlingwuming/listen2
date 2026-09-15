# Phase 5 Validation Contract — Mobile Route

## Applicability

This validation contract covers code and UI work under `mobile/` only. `android/` and `app/listen1_chrome_extension/` may inform fixtures or regression interpretation but are not modified or used to satisfy Phase-5 validation. The nine archived documents in `legacy-webview-plans/` have no executable validation authority.

## Deterministic Phase-5 checks

| Area | Required proof before claiming the slice works |
| --- | --- |
| Search/detail | Source/query/cursor/generation ownership; cancellation and timeout settle once; stale replies cannot overwrite current scope; later-page failure preserves rows; no duplicate append after restoration. |
| Capability/error truth | Each surfaced action maps to a real per-source capability. Empty, unsupported, login/authorization, malformed, offline and timeout remain distinguishable and expose safe actionable recovery. |
| Bilibili path | Reuse `f3q` session/part/audio behavior with safe media expiry/recovery classification; never reveal session material/signed URL. |
| Player controls | Controller/RNTP commands for play/pause, previous/next, seek, volume, mute and mode report authoritative state and roll back/retain context on native failure. |
| Queue | FIFO play-next, duplicate occurrences, reorder/remove/clear/restore and resolver failure prove occurrence-safe transactional semantics. |
| Lyrics | Provider/track/part occurrence and revision prevent stale overwrite; manual selection/clear/offset persistence obey scope and conflict rules; fallback provenance and errors are explicit. |
| Accessibility | Accessible labels/actions cover source tabs, result state/recovery, player controls, queue mutations and meaningful lyric original/translation/current-line/offset updates without per-tick announcements. |
| Security | Tests show typed bounded inputs and no arbitrary URL/header/cookie/token/native-method surface; failure/log DTOs are sanitized. |

Use the repository’s current mobile typecheck, test, lint/format and targeted test commands appropriate to the files changed. A focused test must be added where a new contract would otherwise only be inferred from UI wiring.

## Explicitly not sufficient

- A source tab rendering, a cached result, or a desktop/WebView provider adapter.
- A successful mocked request converted to empty output on failure.
- A TypeScript build, unit suite, Metro bundle, or Android source compilation by itself.
- Existing quick-task records without an integrated test for the new A/B/C gap.

## Phase 8 retained acceptance gate

The following are mandatory Phase-8 evidence and remain `not verified` until recorded against an installed APK on API 35:

- APK build/install identity and device/emulator configuration;
- live provider behavior, authorization/entitlement and real media/lyric failure modes;
- RNTP notification, lock-screen, audio focus, noisy-route, headset/Bluetooth, background, activity recreation and process recovery behavior;
- real rendering/IME/rotation/TalkBack and performance behavior.

Record only sanitized evidence (no account credentials, cookies, signed media URLs, token values or raw sensitive payloads).
