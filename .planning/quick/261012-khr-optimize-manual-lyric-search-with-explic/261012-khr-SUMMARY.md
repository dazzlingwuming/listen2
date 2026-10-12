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

## Final connection recovery follow-up

The failed first live run exposed a recovery gap: valid DNS answers could lead to unreachable addresses without trying another fixed resolver. The existing direct transport now performs at most one connection-triggered resolver fallback (four unique public sockets, three fixed DoH calls maximum). Each DoH attempt/body has a two-second sub-budget within the original eight-second request deadline. Failed addresses leave cache, reachable addresses get preference, any HTTP response stops fallback, and late timed-out responses close their unused bodies. TLS, allow-lists, proxy/user settings and credential isolation are unchanged.

Final scoped CI, 2026-10-12 15:01:24 CST, baseline a2aa1fa75b0d184197ef9ddc9cf87f29e123ee20: same six selected Node suites above passed **84/84**. Transport syntax and its two changed files' Prettier/diff checks passed. Earlier four frontend contracts remain applicable; their source did not change during this follow-up. No full gate was run.

Live checks used the default product resolver order and actual structured `MediaService.searchLyrics` registry, with no injected addresses or altered responses. First title-only 折风渡夜: QQ5 + Kugou2 synchronized candidates in 6.8s. Small batch: 折风渡夜 title-only Kugou2 in 7.3s; title plus 泽国同学 Kugou2 in 4.5s; 青花瓷 Kugou2 + LRCLIB12 in 4.0s. After final late-response cleanup, a fresh 折风渡夜 process returned QQ2 + Kugou1 in 11.3s, including matching singer and non-credit lyric lines. Candidate count/latency still varies; QQ has intermittent invalid payloads, Kuwo remains unavailable, and anonymous NetEase returned invalid responses in this harness. This evidence demonstrates sample recovery, not every provider's stability or the credentialed Electron NetEase session.

The **final** arm64 preview replaces the earlier UI-only preview. All 13 changed ASAR product assets match source bytes; final DMG SHA256 `9438b4255e50e4cd8f1d624f926dbe1ddf631166085596dde223dc1c3eabdfdb`. Installed UI/visual layout and authenticated session acceptance remain not verified. No app was launched/replaced and no merge/Release was performed. Source rollback: revert this task's input and connection-recovery commits; runtime settings need no rollback.
