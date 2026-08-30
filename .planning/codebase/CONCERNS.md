# Codebase Concerns

**Analysis Date:** 2026-08-30  
**Branch:** `agent/android-mobile-rebuild`  
**Scope:** Static review of the Electron application, the packaged browser UI, and the Android WebView shell. This is a risk map for follow-up work, not a claim that every provider or device path is currently failing.

## Executive summary

The Android work is intentionally a foreground WebView sample, while the product README describes a desktop application. The largest delivery risk is therefore a feature-contract mismatch: the APK can render the shared UI and has two narrowly scoped search routes, but it does not yet own playback, authentication, cache, lyrics, or lifecycle behavior. The next Android milestone should define an explicit supported feature matrix before adding more UI.

The largest security risk is the legacy Electron trust boundary. The main window enables Node integration, `@electron/remote`, and disables context isolation; an injection in provider data, lyrics, OAuth handling, or a remote page can become arbitrary local code execution. A hard-coded OAuth secret and a separate third-party API signing secret are also shipped inside the browser assets, including the Android allow-list.

The largest reliability risk is the callback-oriented provider layer. Several legacy requests do not reject or call a failure callback, the aggregate search assumes every provider returns a well-shaped result, and auto-failover launches unbounded parallel provider work. Third-party WBI/weapi/eapi and referer workarounds are brittle and have little live or device-level coverage.

## P0/P1 security and trust-boundary concerns

### 1. Renderer has a privileged, non-isolated Electron runtime (P0)

Evidence: `app/main.js:1188-1197` sets `nodeIntegration: true`, `enableRemoteModule: true`, and `contextIsolation: false`; `app/listen1_chrome_extension/js/lowebutil.js:30-83` and `app/listen1_chrome_extension/js/controller/navigation.js:939-960` consume `@electron/remote` from that renderer. The page also loads many third-party response paths and embeds provider metadata.

Impact: any XSS, malicious playlist/lyric field, compromised dependency, or unsafe navigation can read local files, access Electron APIs, and exfiltrate account data. This is especially dangerous because the same renderer handles local file selection, GitHub/Last.fm credentials, cookies, and playback URLs.

Mitigation: migrate to a preload-only API with `contextIsolation`, sandboxing, and `nodeIntegration: false`; remove `@electron/remote`; expose schema-validated, sender-checked IPC methods only. Treat every provider field as untrusted until the DOM sink audit is complete. Add a regression test that refuses privileged APIs after navigation.

### 2. OAuth callback is concatenated into executable JavaScript (P0)

Evidence: `app/main.js:1143-1155` extracts `code` with `split('=')` from any URL matching a broad callback filter and interpolates it into `executeJavaScript`. `app/listen1_chrome_extension/js/github.js:49-70` exchanges that code in the renderer without state or PKCE validation.

Impact: a crafted callback query can break out of the string passed to `executeJavaScript`; combined with the privileged renderer, this is an arbitrary-code-execution and token-theft path. Missing OAuth state also permits login CSRF/account confusion.

Mitigation: parse with `new URL`, validate the exact callback origin and a one-time state/PKCE verifier, then send the code over a typed IPC channel. Never construct JavaScript source from URL data. Reject callbacks when the initiating window/session does not own the state.

### 3. Credentials and account tokens are shipped to/browser-stored in web assets (P0)

Evidence: `app/listen1_chrome_extension/js/github.js:7-18` contains a hard-coded GitHub OAuth client secret and stores the resulting access token in `localStorage` at `:51-66`; `app/listen1_chrome_extension/js/lastfm.js:3-7` contains a hard-coded Last.fm API secret. `android/app/build.gradle:8-35` packages both files into the APK.

Impact: APK/installer users can extract the values, impersonate the application, abuse provider quotas, or replay user tokens from renderer storage. A public client identifier is not a substitute for a client secret; a Last.fm signing secret must be treated as compromised if it is intended to be private.

Mitigation: revoke/rotate the existing secrets before any release that contains them; migrate GitHub to PKCE or a server-side exchange and move user tokens to OS secure storage (or remove the integration). Keep only intentionally public provider identifiers in assets, with provider-side restrictions and a documented rotation procedure. Add a secret scan to CI that checks built assets/APKs without logging values.

### 4. Untrusted HTML is written into multiple windows and gist content (P1)

Evidence: lyrics are assigned with `innerHTML` in `app/floatingWindow.html:415-423`; QR SVG is assigned in `app/listen1_chrome_extension/js/controller/auth.js:83-118`; fetched SVG is inserted by `app/listen1_chrome_extension/js/controller/profile.js:181-184`; user/provider metadata is interpolated into Markdown/HTML by `app/listen1_chrome_extension/js/github.js:147-167`.

Impact: lyrics, titles, artist names, cover URLs, or future remote SVG changes can create stored or reflected XSS. In the current privileged Electron renderer, this crosses the P0 trust boundary above; gist consumers can also be exposed to malicious generated markup.

Mitigation: use `textContent` for lyric text, construct DOM nodes instead of HTML strings, and sanitize unavoidable SVG/markup with a narrowly configured sanitizer. Allow only `https` cover URLs and safe image attributes. Add payloads containing tags, event handlers, and dangerous URL schemes to renderer security tests.

### 5. Legacy IPC and arbitrary URL loading lack a consistent sender/payload policy (P1)

Evidence: `app/main.js:1456-1561` handles `currentLyric`, `trackPlayingNow`, `isPlaying`, and `control` without the trusted-frame check used by newer local-data handlers; `app/main.js:1563-1582` calls `BrowserWindow.loadURL(arg)` for arbitrary renderer input. `app/main.js:1344-1453` also rewrites request headers based on broad URL substring rules.

Impact: a compromised or unexpected renderer can toggle global shortcuts, inject floating-window content, change proxy state, or open an arbitrary remote page. Header spoofing and broad URL matching increase the chance of leaking cookies or making future provider requests behave unexpectedly.

Mitigation: centralize `assertTrustedSender`, validate every payload with an allowlisted schema, and restrict `openUrl` to explicitly approved provider/login origins (or use `shell.openExternal`). Add navigation/window-open handlers and log only redacted, structured failure codes. Replace substring-based header rewriting with per-host rules and regression fixtures.

### 6. Local file and cache boundaries rely on caller-provided absolute paths (P1)

Evidence: `app/functions.js:7-35` accepts an arbitrary `filePath` and reads tags plus a neighboring `.lrc`; `app/loudnessAnalyzer.js:168-188` validates only that its path is absolute before queuing analysis. The normal callers are `app/listen1_chrome_extension/js/controller/navigation.js:939-975` and `app/audioCache.js:683-690`, but the privileged renderer can reach these APIs.

Impact: an IPC/remote caller could read metadata or sidecar lyrics from unrelated local files, or ask the analyzer to process a large/expensive path outside the cache root. Errors returned from `functions.js` also contain the raw error object, which may disclose filesystem details.

Mitigation: resolve and enforce an approved root (user-selected file handles for imports; `audio-cache-v1/assets` for analysis), reject symlinks and path traversal, and return fixed error codes rather than raw errors. Test a path outside each root, a symlink, and a disappearing file.

## Android parity, lifecycle, and transport concerns

### 7. APK has no Android-owned background playback (P1)

Evidence: `android/README.md:8-14` explicitly limits the app to a foreground-playback sample; `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:56-67` creates one WebView and `:134-145` destroys it with the Activity. `app/listen1_chrome_extension/js/bridge.js:44-50` selects the front player when Electron/background APIs are unavailable, while `app/listen1_chrome_extension/js/player_thread.js:1791-1797` creates a Howler HTML5 player.

Impact: screen-off, Activity recreation, process reclaim, audio focus changes, notification controls, headset actions, and lock-screen metadata are not a supported playback contract. A shared UI can appear functional while audio stops as soon as Android evicts the WebView.

Mitigation: define the Android feature matrix first, then move playback ownership to a Media3 `MediaSessionService`/foreground service with audio focus, notification actions, wake/lifecycle handling, and a typed UI bridge. Preserve queue/current track/position in saved state and test screen-off, rotation, process death, Bluetooth/headset actions, and transient audio focus loss.

### 8. Native HTTP coverage is search-only and does not match provider UI claims (P1)

Evidence: `android/README.md:22-36` and `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:41-85` permit only HTTPS GETs to `api.bilibili.com` and the exact NetEase search route. `app/listen1_chrome_extension/js/provider/netease.js:300-395` still uses direct playlist/playback requests, while `:560-667` uses direct album/artist/lyric requests. `app/listen1_chrome_extension/js/provider/bilibili.js:2271-2422` uses direct legacy playback and `:2593-2643` expects desktop auth IPC. Other providers remain direct browser `axios` clients.

Impact: Android Bilibili/NetEase search may work in the new shell, but clicking a result, opening playlists, retrieving lyrics, logging in, or using QQ/Kugou/Kuwo/Migu/Taihe is likely to hit CORS, cleartext, cookie, or missing-IPC failures. `app/listen1_chrome_extension/js/loweb.js:7-64` still advertises several login capabilities globally, so the UI can promise unsupported actions.

Mitigation: expose provider capabilities per platform and disable unsupported controls until implemented. For supported providers, design versioned native adapters (or an approved proxy) for metadata, manifest, stream URL, cookies/auth, lyrics, and errors; never broaden the bridge to arbitrary URLs just to make legacy calls work. Add device tests for each advertised capability and provider.

### 9. Android bridge compatibility, cancellation, and error UX are incomplete (P1)

Evidence: `app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:56-79` returns no bridge when `WEB_MESSAGE_LISTENER` is unavailable; `:119-133` uses a single worker and queue size 16. `app/listen1_chrome_extension/js/lowebutil.js:139-389` times out pending requests but has no page-unload cancellation or request abort. `MainActivity.java:172-177` only changes a loading label and has no retry/offline action.

Impact: older WebView providers, rapid search, navigation, or Activity destruction can yield `BRIDGE_BUSY`, timeout, and stale-result races. The page can remain in an empty/error state without explaining whether the bridge, TLS, provider, or network failed.

Mitigation: show a capability/upgrade diagnostic, debounce and cancel superseded searches, propagate request IDs through cancellation, and reject all pending promises during page teardown. Add bounded retry/backoff only for transient failures, preserve HTTP/error categories, and provide a retry UI with telemetry that excludes URLs/cookies.

### 10. Android lifecycle and window-inset handling are only partially covered (P1)

Evidence: `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:69-79` returns without applying insets on pre-R devices and no `onSaveInstanceState`/restoration path exists. The manifest opts into broad `configChanges` at `android/app/src/main/AndroidManifest.xml:14-17`, masking recreation paths.

Impact: content can be clipped under system bars on API 26–29, while configuration changes and process death can lose page state, queue, and pending network work. The manifest may hide bugs in rotation tests without covering real process reclaim.

Mitigation: use one inset implementation compatible with the minimum SDK, decide edge-to-edge behavior explicitly, and implement state/position restoration. Remove unnecessary `configChanges` or test each retained configuration deliberately; add emulator coverage across API 26, current API, gesture/navigation modes, rotation, and low-memory recreation.

### 11. Android release/reproducibility path is debug-centric (P1)

Evidence: `android/app/build.gradle:44-63` uses `versionCode 1`, enables minification only for release, and has no release signing/publishing configuration. `android/app/proguard-rules.pro:1` is only a comment. `android/README.md:49-52` states that a Gradle wrapper JAR is absent; `.github/workflows/android-apk.yml:45-52` runs only JVM tests and `assembleDebug`, then verifies a debug APK.

Impact: no gate currently proves that the minified release build preserves WebView bridge behavior, has a monotonic upgrade version, or can be installed/upgraded with production signing. Builds depend on externally provisioned Gradle rather than a repository-pinned wrapper distribution.

Mitigation: add a checked-in, checksum-pinned Gradle wrapper or a documented reproducible builder; use a release versioning policy and secret-managed signing; build/test release artifacts in CI, inspect merged assets, and install the release APK on representative emulators. Add keep rules only when reflection/bridge integrations require them and test the minified artifact.

## Provider drift and runtime error handling

### 12. Provider protocols and referer hacks are high-drift integration points (P1)

Evidence: NetEase crypto constants and request formats are embedded in `app/listen1_chrome_extension/js/provider/netease.js:34-75`, with legacy `/weapi`/`/eapi` calls at `:300-395` and `:635-667`. Bilibili WBI signing/retry is in `app/listen1_chrome_extension/js/provider/bilibili.js:1809-1853`, while manifest requests hard-code `qn`, `fnval`, and `fourk` at `app/bilibiliService.js:1031-1047`. Electron-wide referer rewriting is in `app/main.js:1344-1453`.

Impact: provider schema, signature, CDN, cookie, codec, or anti-bot changes can break search, lyrics, or playback without a code-level signal. `bilibiliService.js:1000-1016` falls back to `pages[0]` when a requested CID is absent, which can silently play the wrong part instead of reporting an invalid selection.

Mitigation: isolate each provider behind versioned adapters, validate response schemas and requested IDs, keep fixture tests for known API shapes, and expose a provider-health/error state distinct from “no results.” Fail closed on a missing CID; refresh WBI/manifest keys using bounded retries and a feature flag. Avoid relying on global referer mutation where a provider-specific request can carry the required headers.

### 13. Callback APIs can hang or crash on partial provider failure (P1)

Evidence: requests such as `app/listen1_chrome_extension/js/provider/netease.js:88-100`, `:317-350`, `:379-395`, `:567-592`, `:604-632`, and `:648-667` have success-only promise chains; Bilibili playlist/track paths at `app/listen1_chrome_extension/js/provider/bilibili.js:1943-1982`, `:2014-2031`, and `:2523-2534` similarly lack a consistent failure callback. `app/listen1_chrome_extension/js/loweb.js:292-321` assumes every all-provider result has `type` and `result`, and `:878-899` calls a possibly undefined provider.

Impact: one API rejection can leave spinners open, throw while merging results, or silently return no callback. The UI cannot distinguish an empty catalog from timeout, quota, CORS, malformed JSON, or a retired endpoint.

Mitigation: convert provider methods to a single Promise/result contract with per-call deadlines, schema normalization, and explicit `{ok,status}` errors. Use `Promise.allSettled` for aggregate search and show partial results. Guard unknown provider/item IDs, add failure callbacks during the migration, and test rejected HTTP, malformed response, and never-settled callback cases.

### 14. Auto source failover creates unbounded, unsafe request work (P1)

Evidence: `app/listen1_chrome_extension/js/loweb.js:1122-1187` queries every configured fallback provider in parallel, builds `keywords` without `encodeURIComponent` at `:1149-1154`, and relies on a rejection-as-success workaround. It has no cancellation when the user changes tracks and compares only exact title/artist strings.

Impact: a single failed play can fan out into multiple provider calls, trigger rate limits, race late callbacks against the current track, or miss a valid alternate because punctuation/metadata differs. Unencoded titles can alter query parsing or produce malformed requests.

Mitigation: use a cancellable, sequential or small-concurrency policy with a global budget, encode query parameters, and cancel attempts when the track/session changes. Normalize titles/artists and include duration/quality confidence before selecting a source. Record redacted per-provider failure codes so retries can be tuned without leaking signed URLs.

### 15. Bilibili service reads unbounded response text and collapses auth/network states (P1)

Evidence: `app/bilibiliService.js:350-416` and `:418-452` call `response.text()` without a content-length or streaming cap. `:472-503` converts all navigation failures into a public `loggedIn: false` state, while QR polling at `:785-875` stops the login session on a transient request error rather than retrying with backoff.

Impact: an unexpectedly large or malicious response can consume memory; users see “logged out” during outages; transient QR failures force a fresh scan and make support diagnosis difficult.

Mitigation: enforce content-length and bounded streaming reads before parsing; classify offline, provider rejection, expired session, and logged-out states separately. Retry only idempotent transient QR/network failures with a deadline and jitter, and retain the session until expiry. Add tests for oversized, truncated, invalid JSON, offline, and repeated poll responses.

## Storage and performance debt

### 16. Local stores have growth and corruption-recovery gaps (P2)

Evidence: `app/main.js:286-310` writes the machine-translation cache as an ever-growing object with no size/age eviction. `app/listeningHistoryStore.js:1-13` and `:129-191` cap session markers but not historical tracks/days; `app/lyricCacheStore.js:74-103` and `:241-253` likewise have no record-count/byte budget. Both lyric and audio index readers treat corruption as an empty store (`lyricCacheStore.js:84-102`, `audioCache.js:270-305`).

Impact: long-lived users can accumulate large JSON stores, increasing startup and synchronous `electron-store` write cost. A power loss or malformed index can silently hide existing cache/lyrics/history and overwrite the only recoverable copy on the next write.

Mitigation: define retention/size budgets and LRU/age eviction for translation, lyric, and history data; move large histories to an append-only or indexed format. On parse failure, quarantine the corrupt file, preserve a backup, surface a recoverable warning, and rebuild only after explicit confirmation. Add multi-year growth and interrupted-write tests.

### 17. Browser audio format assumptions are brittle on Android and CDN responses (P2)

Evidence: `app/listen1_chrome_extension/js/player_thread.js:1785-1797` forces Howler `format: 'mp3'` while Bilibili manifests select `audio/mp4`/DASH variants in `app/bilibiliService.js:1050-1110`; playback remains an HTML5 media element. `app/main.js:1167-1185` rewrites CORS response headers for every media URL.

Impact: an MP4/DASH stream can be mislabeled or unsupported by a device WebView, causing load/play errors that look like provider failures. The global CORS rewrite can hide server policy mistakes and couples playback to a broad Electron hook that may change with Chromium.

Mitigation: pass MIME/codec candidates to the player, probe `canPlayType`, and keep a tested fallback matrix per Android WebView/desktop platform. Scope CORS handling to approved CDN hosts and media responses, preserve range/cache headers, and add real stream tests for MP3, AAC/MP4, DASH, redirects, and signed CDN expiry.

### 18. Loudness analysis and cache work can compete with playback (P2)

Evidence: `app/audioCache.js:655-727` schedules analysis for every missing cached entry, and `app/loudnessAnalyzer.js:378-419` reads a whole file into memory up to the 96 MiB analyzer limit. The analyzer is a separate hidden renderer, but the scheduler has no visible global CPU/IO budget beyond one analysis job.

Impact: first-run cache repair or a large playlist can create sustained disk reads, decoding, and memory pressure while a user is playing audio, especially on low-memory machines. A valid cache file can be retained with no loudness result after resource pressure, leaving inconsistent normalization.

Mitigation: schedule analysis only while idle/charging where applicable, expose queue progress, enforce a global byte/CPU budget, and prefer streaming/segment analysis when the decoder permits. Test cancellation during playback, suspend/resume, low-memory behavior, and analyzer failure recovery.

## Test and release blind spots

### 19. Android tests cover pure policy only, not the APK runtime (P1)

Evidence: `android/app/src/test/java/com/dazzlingwuming/listen2/NavigationPolicyTest.java:8-27` and `HttpBridgePolicyTest.java:9-102` test helper decisions. `android/app/build.gradle:50,88-90` declares a JVM JUnit dependency but no instrumentation/UI/media dependencies. `.github/workflows/android-apk.yml:45-52` runs only `testDebugUnitTest`, `assembleDebug`, and signature verification.

Missing coverage includes WebViewAssetLoader startup, JavaScript bridge delivery, TLS/redirect/body limits, CookieManager behavior, Activity recreation, network loss, background audio, external navigation, and release/minified APK behavior. The shared UI contract tests cannot prove any of these.

Mitigation: add an emulator/instrumentation suite with a local HTTPS fixture server, WebView feature matrix, bridge cancellation/queue tests, lifecycle tests, and media-session tests. Run it against both debug and minified release artifacts; keep external provider smoke tests opt-in and fixture-based so CI remains deterministic.

### 20. JavaScript coverage is mostly source/VM contracts and release does not run it

Evidence: `app/listen1_chrome_extension/package.json` chains static HTML/source and VM-mocked provider tests; `mobile_ui_contract.test.js` and `mobile_startup_performance_contract.test.js` assert strings and CSS rather than measured startup or device behavior. Root `package.json` exposes split test scripts but no aggregate test gate, and `.github/workflows/release.yml:33-47` installs dependencies and builds/publishes Electron artifacts without invoking those suites.

Impact: tests can remain green while browser lifecycle, real Howler codecs, CORS/cookies, Angular digest timing, provider schema drift, or signed release behavior is broken. A tag push can publish an artifact that never passed the repository's own tests.

Mitigation: create one documented local CI command that runs all applicable Node/extension/Android checks, make release depend on it, and add browser/e2e smoke coverage for startup, search, play, pause, lyrics, auth failure, cache hit, and recovery. Keep static contract tests as cheap guards, but do not treat them as runtime validation.

## Recommended order of remediation

1. Rotate/remove shipped secrets and close the OAuth/privileged-renderer trust boundary before distributing another desktop or APK build.
2. Publish an Android capability matrix; implement Media3/background playback and only the provider adapters the matrix promises.
3. Normalize provider errors, add bounded/cancellable networking, and fail closed on invalid Bilibili page/CID or manifest data.
4. Add APK emulator/release tests and a single local CI gate before enabling release publication.
5. Add bounded local-store retention/quarantine and measure startup, memory, CDN playback, and analyzer impact on representative devices.

**Verification note:** this mapping was produced by static source/configuration review on 2026-08-30. No external provider, signed release, physical Android device, background-playback session, or production credential was exercised; those remain explicitly `not verified`.
