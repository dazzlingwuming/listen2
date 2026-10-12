---
status: complete
runtime_status: degraded
---
# Manual lyric search fields and source stages

User approved explicit required song title and optional singer. The form opens with an editable title suggestion and an empty singer; searching requires submission. Editing/reopening/closing or changing tracks cancels and invalidates old responses. The submitted fields are shown and both fields protect NetEase verification retries.

All five providers receive only confirmed manual title/artist values. Scoring retains separate fields without a hard singer filter; caches distinguish field boundaries. Sources report catalog/lyrics stages and distinguish no matching song, no synchronized lyrics, transport/payload failure, verification and timeout. Existing bounded transport/auth policy is unchanged.

## Verification

- macOS, Node 24.15.0, branch agent/kugou-lyrics-20261012; baseline e4392887aaf93307b2563cae8b2f523d1df8ce38. Working tree contained only this task's product/test edits.
- 2026-10-12 14:52:52–14:53 CST: `node --test app/test/{lyricSearch,lyricProviderRoutes,lyricDirectTransport,neteaseVerificationSession,neteaseLyricIpc,mainLocalDataCache}.test.js` — 76/76, exit 0.
- `node app/listen1_chrome_extension/test/manual_lyric_search_ui.test.js`, `netease_lyric_verification_ui_contract.test.js`, `bilibili_lyric_translation.test.js`, `deepseek_lyric_translation_ui_contract.test.js` (same directory) — all exit 0.
- Seven changed JS files passed Prettier; syntax, six locale JSON parses, added HTML/CSS fragment parsing and `git diff --check` passed. Existing unrelated HTML/CSS formatting retained. ESLint unavailable; no dependency installation or whole-repository/Android tests.
- Fresh structured registry probes: 折风渡夜 with/without 泽国同学 returned no candidates; QQ/Kugou/Kuwo/NetEase sockets reset in catalog stage, LRCLIB returned a valid empty response. 青花瓷 returned 12 synchronized LRCLIB candidates. These are present network failures, not evidence of successful repair of the user's song. The harness used product Node TLS and a curl bridge only for fixed DoH JSON through the existing local proxy. It did not use the credentialed NetEase Electron session.
- Local arm64 DMG built with existing packaging settings. All 12 changed product assets match ASAR bytes, DMG CRC valid. SHA256: 38f9a78ce855c14411c8f72ef9bbc3f03563136231e6becaefae030896dfc136. App not launched/installed; no Release/merge.

## Limits and recovery

Input/feedback optimization is complete and scoped CI passed. Current upstream reachability is degraded; live installed UI, authenticated NetEase verification/Cookie recovery and visual layout are not verified. No user settings, credentials, system proxy/DNS or running player changed. Revert the task commit for source rollback; the preview is optional and the installed application remains intact.
