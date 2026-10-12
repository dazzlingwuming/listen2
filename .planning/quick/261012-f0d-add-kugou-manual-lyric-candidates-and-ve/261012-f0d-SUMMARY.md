---
quick_id: 261012-f0d
status: incomplete
---

# Kugou manual lyric implementation handoff

Pure-title correction and scoped local checks complete at source level. Version remains 2.35.2. Default proxy/DNS route acceptance remains degraded; no GUI launch/restart, new installer, commit, push, merge or Release action performed by the resumed executor. The earlier preview installer described below predates the pure-title correction.

## Approved Keychain phase: source implementation complete (2026-10-12)

User confirmed the password dialog is macOS Keychain and authorized avoiding unnecessary checks during startup/configuration metadata reads. This phase is independent of the unresolved lyric-network route; no network configuration or additional installer work performed.

- `getPublicMachineTranslationConfig` returns a process-local `null`/`true`/`false` cache and never checks `safeStorage`. Real API-key encryption/decryption still calls `isEncryptionAvailable` before cryptographic use, updates the cache, rejects unavailable storage and propagates denied cryptographic operations without persisting plaintext.
- Bilibili public auth responses likewise expose cached availability initialized to `null`; token reads/writes retain real checks, encrypted storage and refresh behavior. Anonymous auth metadata, offline responses, signed-in metadata with `refreshIfNeeded:false`, and empty token reads perform zero availability calls in spy tests.
- Frontend availability starts as `null`; both settings layouts display unavailable only for `=== false`, avoiding a false error while availability is unknown.
- Preserved the 653 existing CRLF sequences in `main.js` with byte-preserving local replacements. Formatted only the changed credential-boundary fragments there and in `bilibiliService.js`; HTML has only the two condition edits. No whole-file main/HTML formatting.

Scope limitation: `getPublicAuthState` still defaults to `refreshIfNeeded:true`; a genuinely due cookie refresh may read/decrypt its refresh token and request Keychain authorization. Explicit API-key saving/testing/translation may also request authorization. No cookie-encryption fuse was changed; the installed Electron binary was independently verified to have that fuse disabled. This change does not promise that actual secret access, OS credential handling or every startup condition is prompt-free; changing ad-hoc code identity can still cause legitimate authorization. No GUI launch/restart, OS Keychain interaction, mock-keychain product flag, certificate trust change or real credential test performed.

Scoped local CI **PASS**: `/private/tmp/listen2-kugou-20261012`, branch `agent/kugou-lyrics-20261012`; HEAD before/after `0e497d8b6d1310cef16ba9f19f84e8d1196e807c`; macOS, Asia/Shanghai; 2026-10-12 11:43:37–11:43:38 +0800. Intentional dirty tree consists of this phase's seven product/test files plus quick PLAN/SUMMARY. Run-local-ci skill applied; no Docker stage or full repository gate. Commands all exit 0:

- `npm run test:machine-translation` — IPC regression with zero metadata-check spies, real encrypt/decrypt counts, unavailable backend and user-denial paths.
- `npm run test:bilibili` — 18 tests, including encrypted refresh rotation and three new credential-boundary cases.
- `node --test app/test/mainLocalDataCache.test.js` — 4 passed.
- `node app/listen1_chrome_extension/test/deepseek_lyric_translation_ui_contract.test.js` — both unknown-state UI conditions verified.
- `node --check app/main.js`, `node --check app/bilibiliService.js`, `node --check app/listen1_chrome_extension/js/controller/play.js`.
- `./node_modules/.bin/prettier --check app/test/bilibiliService.test.js app/listen1_chrome_extension/js/controller/play.js app/listen1_chrome_extension/test/deepseek_lyric_translation_ui_contract.test.js`.
- `./node_modules/.bin/prettier --single-quote --check app/test/machineTranslationDeepSeek.test.js` — preserves that existing test's quote convention.
- Prettier API `check` on the changed main/Bilibili credential-boundary fragments and `git diff --check`.

No new OS-level acceptance or full gate claimed. Root owns task-record synchronization and the separately authorized commit/push; executor performed neither. Restore only this phase's diff to return to the prior eager metadata checks, without changing lyric-source work.

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


## Approved isolated direct lyric transport (2026-10-12)

Implemented only the trusted `lyrics:request` route with new `app/lyricDirectTransport.js`; other Electron sessions/providers keep their existing networking. Fixed Google/Cloudflare public DoH JSON requests use Electron `net.fetch`, while lyric HTTP GETs use Node HTTPS directly with resolved public addresses, original Host/SNI and certificate hostname verification. No fixed provider IP, proxy fallback, caller headers/cookies, redirect, TLS bypass or system configuration change. Preserve the existing fixed Kugou mobile User-Agent previously applied by `webRequest`. Exact Kuwo `https://search.kuwo.cn/r.s` joins the endpoint allow-list in coordination with root's separate provider route change.

DNS accepts only registered lyric hostnames, checks the returned question, bounds JSON to 64 KiB, TTL cache to 300 seconds/24 entries, and uses at most two public addresses. Reject private/local/link-local/fake-IP/documentation IPv4 and non-global/mapped/private IPv6. Only failures before HTTP response permit a second address; HTTP errors and malformed/oversized bodies remain explicit failures. GET bodies are identity encoding, at most 2 MiB. The original single eight-second request deadline includes DNS, HTTPS and body; manual search retains its twelve-second deadline. Cancellation closes active requests. 204/205 null-body responses cannot throw asynchronously.

Scoped local CI PASS, `/private/tmp/listen2-kugou-20261012`, `agent/kugou-lyrics-20261012`, HEAD before/after `645c690eafbb2d1d58024368cb2f1e5a0f9ffa40`; macOS Node v24.15.0, Asia/Shanghai. Time 2026-10-12 12:10:10–12:10:11 +0800. Intentional dirty worktree contains this transport phase and root-owned provider/i18n changes; no stash/reset/commit/push/build/GUI actions. All commands exit 0:

- `node --test app/test/lyricDirectTransport.test.js app/test/lyricSearch.test.js app/test/mainLocalDataCache.test.js app/test/lyricProviderRoutes.test.js` — 44 passed, including 17 new direct transport tests.
- `./node_modules/.bin/prettier --check app/lyricDirectTransport.js app/lyricTransport.js app/test/lyricDirectTransport.test.js app/test/lyricSearch.test.js`
- `node --check app/main.js`, `node --check app/lyricDirectTransport.js`, `node --check app/lyricTransport.js`, `git diff --check`.

Main's existing 653 CRLF sequences are preserved; no whole-file main reformat. No whole-repository gate, Docker stage, packaged Electron GUI or installed-player acceptance performed.

Live source probe, roughly 12:08–12:10 +0800: `/tmp/listen2-live-direct-lyrics.cjs` evaluates the actual source provider with `requestLyric(createDirectLyricFetch(...))`; third argument `http://127.0.0.1:7897` obtains only fixed DoH JSON through diagnostic curl with the current proxy, while all lyric/catalog bodies use actual product Node HTTPS, with TLS verification. No resolver IP injection and no full lyrics/tokens logged. Latest representative run: bare `折风渡夜` completed in 6,412 ms, KUGOU 2 synced/KUWO 1 synced/LRCLIB 0; `青花瓷` in 2,637 ms, LRCLIB 12 synced/KUWO 2 synced/KUGOU 0. Kugou catalog intermittently returns valid HTTP 200/status 1/lists 0, including earlier runs for the first song, so its catalog availability remains degraded; mobile UA did not eliminate this upstream behavior. Do not reinterpret valid empty responses as transport errors or retry another IP after HTTP. Root's Electron DoH/session integration and installed-player acceptance remain to be verified. Roll back only this transport phase's source commit to restore the previous Session-based lyric request path.


## Final resolver refinement and five-source verification (2026-10-12)

This supersedes the Google-first network limitation recorded above. Fixed HTTPS AliDNS is now first, followed by Google and Cloudflare only on DNS failure, under the same shared eight-second deadline. Strict Question validation accepts Ali's object shape and the array shape; exact hostname/type, public address filtering, TLS identity, two-address limit and bounded TTL/body remain unchanged. Failed DNS HTTP bodies are cancelled before fallback. No provider IP, custom query/singer or system proxy/DNS configuration is embedded.

Read-only alternatives did not justify widening the Kugou allow-list: `msearchcdn.kugou.com/api/v3/search/song` failed hostname certificate validation in both songs/two rounds; `mobileservice.kugou.com/api/v3/lyric/search` returned HTTPS 200 HTML instead of JSON. Original songsearch query and the publicly documented WebFilter variant each returned five valid catalog rows across both songs/two rounds with AliDNS; therefore no extra provider query parameters or empty-result retry were added. Primary implementation references: https://github.com/keyule/KuGou-API, https://github.com/bingaha/kugou-lrc/blob/main/README.md, https://github.com/CharlesPikachu/musicdl/blob/master/musicdl/modules/sources/kugou.py .

Final actual source probe at 12:26 +0800: `node /tmp/listen2-live-direct-five.cjs /tmp/listen2-kugou-20261012 http://127.0.0.1:7897 2`. Uses current provider functions, exact manual hints and actual `lyric_search` three-worker/twelve-second search. Only the product-selected fixed DoH JSON is obtained via diagnostic curl through the configured proxy; response JSON is unmodified, no IP or resolver mapping injected. Actual lyric bodies use final product `createDirectLyricFetch` / Node HTTPS and are not printed. Counts are downloaded synced candidates:

| Round | Exact query | QQ | Kugou | Kuwo | LRCLIB | NetEase | Total elapsed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 折风渡夜 | 5 | 2 | 2 | 0 | verification-required | 1,751 ms |
| 1 | 青花瓷 | 6 | 2 | 1 | 12 | verification-required | 2,096 ms |
| 2 | 折风渡夜 | 5 | 2 | 2 | 0 | verification-required | 1,564 ms |
| 2 | 青花瓷 | 6 | 2 | 2 | 12 | verification-required | 2,356 ms |

Final scoped local CI PASS at 2026-10-12 12:26:26–12:26:27 CST (+0800), macOS Node v24.15.0; worktree `/private/tmp/listen2-kugou-20261012`, branch `agent/kugou-lyrics-20261012`, HEAD before/after `645c690eafbb2d1d58024368cb2f1e5a0f9ffa40`. Intentional dirty tree includes this phase and root-owned provider/signing/doc changes; no changes discarded. Commands exit 0:

- `node --test app/test/lyricDirectTransport.test.js app/test/lyricSearch.test.js app/test/mainLocalDataCache.test.js app/test/lyricProviderRoutes.test.js` — 51 passed (20 direct transport tests).
- `./node_modules/.bin/prettier --check app/lyricDirectTransport.js app/test/lyricDirectTransport.test.js app/test/lyricSearch.test.js`
- `node --check app/main.js`, `node --check app/lyricDirectTransport.js`, `git diff --check`.

No whole-repository gate, Electron launch or installed-player UI acceptance was performed. Runtime Electron `net.fetch` DoH integration remains root's acceptance responsibility; Node HTTPS source pipeline is verified. No credentials, full lyrics, public download access tokens or raw verification responses were logged or persisted. NetEase verification restrictions remain explicit and are not bypassed; LRCLIB valid empty catalog coverage for the first title remains honest. Root owns commit/push/package and persistent task records. Roll back the isolated transport commit to restore the prior Session-based lyric path; no system configuration recovery is necessary.
