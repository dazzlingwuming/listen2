---
quick_id: 261012-f0d
status: incomplete
---

# Kugou manual lyric implementation handoff

Pure-title correction and scoped local checks complete at source level. Version remains 2.35.2. Default proxy/DNS route acceptance remains degraded; no GUI launch/restart, new installer, commit, push, merge or Release action performed by the resumed executor. The earlier preview installer described below predates the pure-title correction.

## Current correction: authoritative editable query (2026-10-12)

The user clarified that the search field is authoritative. Automatic prefill may remain editable, but changing songs, Bilibili uploader names or track singer metadata must not alter the submitted query. Root confirmed the current Bilibili artist is the uploader, not the singer.

- All five manual provider requests now preserve the entered text, including singer text, quotation marks, hyphens and version words, with only surrounding whitespace trimmed. Automatic lyric matching keeps its existing cleanup. Scoring normalization is independent of the network query.
- KUGOU now performs one exact-input HTTPS catalog search at `songsearch.kugou.com/song_search_v2` (page 1, pagesize 5, at most 5 parsed rows). It validates public song hashes, titles, singers and second-based duration, deduplicates hash/recording metadata, then requests lyrics for at most two catalog songs with their validated hash and explicit millisecond duration. It downloads at most two synced LRC candidates: maximum five requests, same cancellation signal and overall 12-second deadline.
- Removed automatic singer appending, generated separator variants, KUGOU artist cache context, and the six-language artist-required hint. Singer is display metadata only. Generic optional provider cache-context support remains unused by this query-only registration.
- Exact catalog route added to the bounded HTTPS transport. Malformed catalog responses/rows and transport errors stay distinct from valid empty responses; partial lyrics and other providers survive isolated failures.

Live verification without any GUI: the real provider source and real `requestLyric` policy were evaluated in Node; a diagnostic curl transport used `--noproxy '*' --resolve <host>:443:<independently-DoH-resolved-address>` and the product Referer/Accept/User-Agent headers, retaining hostname/certificate verification. No mock bodies, product IP pins, system DNS/proxy changes or TLS bypass. Exact input `折风渡夜`, with a deliberately wrong uploader supplied but ignored, returned two synced candidates; final post-dedup run used five requests, completed in 3,781 ms, with 49 timed lines per candidate. Earlier same-pipeline `青花瓷` run completed in 4,270 ms, two candidates with 37 timed lines each. This proves the pure-title catalog/hash/download path under diagnostic routing; it does not prove the user's configured `127.0.0.1:7897` route.

Catalog diagnostics also showed valid-empty responses on another independently resolved edge and intermittent empty results; no fabricated fallback results were introduced. The user's default route still fails TLS in root's audit and remains **DEGRADED / NOT VERIFIED**. No additional preview installation should be presented as complete end-to-end recovery.

Scoped local CI for the resumed source: branch `agent/kugou-lyrics-20261012`, HEAD before/after `89939102fe0efc219398d99489a26f9898374c47`; macOS, Asia/Shanghai; 2026-10-12 11:22:47–11:22:48 +0800; intentional task-only dirty tree. Run-local-ci skill applied, no Docker stage. All following commands exit 0:

- `node --test app/test/lyricSearch.test.js app/test/lyricCacheStore.test.js app/test/mainLocalDataCache.test.js` — 27 passed.
- `node app/listen1_chrome_extension/test/bilibili_lyric_translation.test.js`
- `node app/listen1_chrome_extension/test/deepseek_lyric_translation_ui_contract.test.js`
- `node app/listen1_chrome_extension/test/desktop_cache_renderer_contract.test.js`
- `./node_modules/.bin/prettier --check app/lyricTransport.js app/test/lyricSearch.test.js app/listen1_chrome_extension/js/provider/bilibili.js app/listen1_chrome_extension/js/loweb.js`
- `node --check` on the three changed production JavaScript files, six locale JSON parse checks, and `git diff --check`.

Coverage limits: no full repository gate, frontend ESLint dependencies absent, default-route/user-existing-player UI acceptance not completed. Root owns the task record, commit/push and further decisions. Restore only this resumed diff to return to the previously committed preview; that preview still has the reported pure-title limitation.

## Initial implementation history (query fallback now superseded)

- Register KUGOU among the initial three manual-search workers; existing concurrency and 12-second overall cancellation deadline remain in force.
- Allow only exact HTTPS `lyrics.kugou.com/search` and `/download` routes through existing 8-second, 2-MiB, no-redirect/no-cookie desktop transport.
- Read anonymous lyric candidates, try at most three deduplicated singer/separator queries after valid empty responses, download at most two top candidates and decode bounded UTF-8 base64 LRC. Reject malformed tokens, payloads, encoding and oversized lyrics; exclude unsynced bodies. Preserve other successful sources and partial successful downloads.
- Preserve KUGOU candidate/source identity through existing manual lyric records. Per-download public access tokens stay ephemeral and never enter candidates or records.
- Isolate the lyric-search cache by singer context for KUGOU; forced retries still bypass cached results. Add six-language empty-source guidance for artist/title separator variations.

## Verified public evidence (2026-10-12 Asia/Shanghai)

Default system DNS/proxy produced TLS connection-closed errors for Kugou. Google DoH independently resolved the lyric host; diagnostic curl retained hostname/certificate verification with `--noproxy '*' --resolve lyrics.kugou.com:443:<resolved-address>`. No product IP pin, system DNS/proxy changes, TLS bypass or credentials used.

- Anonymous HTTPS search `泽国同学 折风渡夜`, duration=0: status 200, 10 candidates. First `fmt=lrc` download: status 200, 486 decoded characters, 19 timed lines. No full lyrics copied to this record.
- Anonymous HTTPS search `周杰伦 - 青花瓷`, duration=0: status 200, 10 candidates.
- Root's fresh Electron actual `MediaService.searchLyrics` acceptance with isolated diagnostic host resolution and `session.defaultSession.setProxy({mode:'direct'})` after startup (then `closeAllConnections`, preserving TLS verification): 折风渡夜 completed in 2,728 ms, KUGOU 2 candidates with 19/16 timed lines, LRCLIB 0; 青花瓷 completed in 3,221 ms, KUGOU 2 candidates with 34/37 timed lines, LRCLIB 12. No mocked response used. QQ/NetEase/Kuwo unavailable in that diagnostic environment. These overrides affect only the isolated test process and are not product networking changes.
- Bare title searches returned valid status 200 with zero candidates in this environment; singer/separator variations matter. Artist is taken from current track only for KUGOU; unknown singers receive explicit UI guidance. Catalog coverage is not guaranteed.
- Primary contract reference: https://raw.githubusercontent.com/ddddxxx/LyricsKit/master/Sources/LyricsService/Provider/Kugou.swift (search/download parameter shape); this implementation uses verified HTTPS and LRC rather than that client's HTTP/KRC path.
- Earlier omission is confirmed to be the manual lyric source registry containing QQ, NetEase, LRCLIB and Kuwo only. Historical motivation is unknown.

## Scoped local CI

Repository `/private/tmp/listen2-kugou-20261012`; branch `agent/kugou-lyrics-20261012`; HEAD before/after checks `d6637e60298b70f450c5d69a089abcaa4920eff7`. macOS host, Asia/Shanghai. Source worktree intentionally dirty with this task's 12 product/test files plus quick artifacts. Run-local-ci skill read and applied. Verification window 2026-10-12 10:59:54–11:01:09 +0800; no Docker stage required.

Passed (exit 0):

- `node --test app/test/lyricSearch.test.js app/test/lyricCacheStore.test.js app/test/mainLocalDataCache.test.js` — 24 tests.
- `node app/listen1_chrome_extension/test/bilibili_lyric_translation.test.js`
- `node app/listen1_chrome_extension/test/deepseek_lyric_translation_ui_contract.test.js`
- `node app/listen1_chrome_extension/test/desktop_cache_renderer_contract.test.js`
- `./node_modules/.bin/prettier --check app/lyricTransport.js app/test/lyricSearch.test.js app/listen1_chrome_extension/js/provider/bilibili.js app/listen1_chrome_extension/js/loweb.js app/listen1_chrome_extension/js/lyric_search.js`
- `node --check` on changed production JavaScript; `git diff --check`; JSON parse and key-presence check on six locale files; Prettier parser on new HTML hint fragment.

Coverage limitations: no whole-repository gate; frontend ESLint dependency is absent in this worktree. Full `listen1.html` Prettier check reports existing style drift; formatting it would produce ~1,630 diff lines, so unrelated reformatting was avoided. Fresh-app actual transport verified by root; source rendering, selection/restart and local package acceptance remain with root. Default DNS/proxy path remains an environment limitation; isolated direct DoH-resolved diagnostic path is verified by curl and root's Electron probe, not embedded in the product.

## Recovery / next steps

User subsequently asked to use their existing player and stop opening test instances. Only the user's installed player remains running; no more GUI startup/restart tests are authorized without first explaining them. Selection/restart persistence and default-network recovery remain unverified. Use the existing player for read-only observations; it still runs the old installed code. Revert only this task's source commit to roll back. Do not alter system proxy/DNS or publish pinned IPs.

Local installer: `listen1_2.35.2_kugou-preview_mac_arm64.dmg`; SHA256 `83dddd6ff9ca7420a053d4da65fb740c804d5a7ebb785bff4b42f47f727099a1`. Build with electron-builder 25.1.8 / Electron32.3.2, custom ad-hoc signing, no Apple notarization. DMG and mounted `codesign --verify --deep --strict` pass. Source files in ASAR match final source. Building and static inspection do not interrupt the user's running player. This is a preview with a disclosed default-network limitation, not an updated public Release.
