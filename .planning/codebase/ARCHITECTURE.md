# Architecture Map

**Snapshot date:** 2026-08-30
**Scope:** current source tree, runtime boundaries, data flows, and safe placement of future code.

## System topology

- The repository is a desktop-first Listen2 application whose root `package.json` names `app/main.js` as the Electron entry point (`package.json:1-18`).
- Electron starts one process, acquires a single-instance lock, initializes services, creates the main window, and owns shutdown (`app/main.js:1589-1683`).
- The main `BrowserWindow` loads the shared UI from `app/listen1_chrome_extension/listen1.html` as a local `file:` URL after applying the persisted proxy (`app/main.js:1187-1243`).
- The main window deliberately runs with `nodeIntegration: true`, `contextIsolation: false`, and the legacy remote module enabled (`app/main.js:1193-1204`); its page is therefore a trusted desktop surface rather than an untrusted web page.
- Electron intercepts provider requests to add source-specific Referer/Origin/User-Agent values and changes CORS headers for media responses only (`app/main.js:1124-1185`, `app/main.js:1338-1454`).
- The desktop process registers the privileged `listen2-cache` scheme and routes it to the audio cache after initialization (`app/main.js:42-56`, `app/main.js:1606-1627`).
- `app/preload.js` is a small context-bridge for the separate floating-lyrics window; it forwards lyrics, translations, playback state, and control messages without exposing the full main-process implementation (`app/preload.js:1-20`).
- Browser/extension mode reuses the same page and classic scripts, but `js/bridge.js` selects a front player or a legacy extension background player (`app/listen1_chrome_extension/js/bridge.js:4-134`).
- The MV3 extension entry is `app/listen1_chrome_extension/manifest.json`; its service worker is `js/background.js`, and its provider/cookie permissions are declared in the manifest (`app/listen1_chrome_extension/manifest.json:1-63`).
- Android is a separate Java host around the browser-compatible UI. `MainActivity` serves an allow-listed copy through `WebViewAssetLoader` and starts at `https://appassets.androidplatform.net/assets/listen1/listen1.html` (`android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:28-67`).
- Android intentionally implements foreground WebView playback and a narrow HTTP capability, not Electron IPC, native Media3 background playback, desktop cache, or desktop Bilibili session management (`android/README.md:8-20`).

## Module boundaries

| Boundary | Responsibility | Stable hand-off |
| --- | --- | --- |
| Electron orchestration | OS windows, tray, shortcuts, proxy, lifecycle, IPC and protocol setup | `app/main.js` IPC channels and window events |
| Desktop Bilibili service | Cookie/session state, QR login, WBI requests, media manifests and variants | `app/bilibiliService.js` methods invoked by main IPC |
| Desktop local data | Audio files/index, lyric records, translation cache, history and loudness metadata | `app/audioCache.js`, `app/lyricCacheStore.js`, `app/listeningHistoryStore.js`, `app/loudnessAnalyzer.js` |
| Shared media service | Provider registry plus capability-aware desktop/Android/browser adapters | `app/listen1_chrome_extension/js/loweb.js` and provider contracts |
| Provider adapters | Search, playlist, lyric and media bootstrap for each source | `js/provider/<source>.js` methods such as `search`, `bootstrap_track`, and `lyric` |
| Playback core | Howler HTML5 playback, retries, shuffle, next queue, cache lookup, history sampling and media-session events | `app/listen1_chrome_extension/js/player_thread.js` and `js/l1_player.js` |
| Angular UI | Navigation, auth, playlist, play page, lyric picker, settings and cache controls | `js/controller/*.js` bound into `listen1.html` |
| Android shell | Asset loading, navigation policy, WebView configuration and bounded native GET bridge | `android/app/src/main/java/com/dazzlingwuming/listen2/*.java` |

## Primary data flows

### Startup and window flow

1. Electron loads settings from `electron-store`, selects platform tray/window behavior, and lazily creates service objects (`app/main.js:60-243`).
2. `app.on('ready')` initializes the audio cache, registers the custom scheme handler, creates the main window, and enables the remote integration (`app/main.js:1606-1628`).
3. The HTML page loads vendor libraries first, then utility/bridge code, providers, player/service modules, and Angular controllers; the ordering is explicit in `app/listen1_chrome_extension/listen1.html:31-78`.
4. Controllers call `MediaService`, which delegates to providers and to desktop-only IPC wrappers in `js/loweb.js`; a missing desktop capability returns an explicit unsupported result rather than silently using Electron state (`app/listen1_chrome_extension/js/loweb.js:116-190`, `:358-1012`).

### Search, bootstrap and playback

1. Search/controller code reaches a registered provider through `MediaService`; provider-specific network and normalization stay in `js/provider/*.js`.
2. For a Bilibili video track in Electron, `js/provider/bilibili.js:2372-2476` requests a manifest through `MediaService` and returns a normalized audio descriptor plus fallback URL candidates.
3. `MediaService` invokes `bilibili-media:get-manifest`; the main process delegates to `BilibiliService`, which obtains WBI context, fetches a manifest, normalizes DASH/durl variants, and caches the result (`app/main.js:762-824`, `app/bilibiliService.js:1000-1171`).
4. `Player` first asks the desktop cache for a complete local entry, otherwise bootstraps online media, retries bounded alternate candidates, and invalidates a bad cache entry before falling back (`app/listen1_chrome_extension/js/player_thread.js:1348-1750`).
5. After actual playback starts, the player schedules a low-priority cache job; `AudioCache` writes a validated `.part` file atomically, records metadata, and serves byte ranges via `listen2-cache://audio/<hash>` (`app/listen1_chrome_extension/js/player_thread.js:1779-1983`, `app/audioCache.js:807-1040`, `:1181-1251`).
6. The Howler HTML5 element is also the desktop visualizer source. Electron uses a `MediaElementAudioSourceNode` for effects/analysis, while browser extensions use a best-effort captured observer that does not reroute native audio (`app/listen1_chrome_extension/js/audio_visualizer.js:67-127`, `:674-760`, `:875-895`).

### Lyrics, translation and history

1. On track load, `PlayController` resolves automatic or manually selected lyric candidates, parses timing, and updates the lyric view; it owns UI confirmation and offset/effects state (`app/listen1_chrome_extension/js/controller/play.js:1697-2915`).
2. `MediaService` mediates V3 lyric cache get/put/clear and legacy migration over IPC; the main process persists records under the Electron user-data directory (`app/listen1_chrome_extension/js/loweb.js:576-707`, `app/main.js:521-535`, `app/main.js:229-235`).
3. Translation is opt-in from the controller. Main-process handlers validate the trusted renderer, encrypt the configured key with `safeStorage`, cache by lyric/title/artist/prompt fingerprint, and attach only validated line-aligned output (`app/main.js:602-824`, `app/machineTranslation.js:1-642`).
4. `Player` samples real forward playback, and `MediaService` sends bounded records to `ListeningHistoryStore`; annual summaries and export remain local-device operations (`app/listen1_chrome_extension/js/player_thread.js:150-240`, `app/listen1_chrome_extension/js/loweb.js:512-558`, `app/listeningHistoryStore.js:1-307`).
5. Complete cached Bilibili audio can be queued for hidden-window loudness analysis. `LoudnessAnalyzer` validates file/hash metadata, invokes the renderer analyzer, and returns a fixed-gain result to the cache/player (`app/loudnessAnalyzer.js:1-513`, `app/loudnessAnalyzerRenderer.js:1-444`).

### MV and floating lyrics

- `BilibiliMvPlayer` is a shared frontend component for `bitrack_v_<bvid>-<cid>` tracks. It asks `MediaService` for video variants, chooses a browser-supported codec, and applies bounded drift correction/recovery (`app/listen1_chrome_extension/js/bilibili_mv_player.js:1-180`, `:300-372`).
- `PlayController` owns MV visibility and the audio/MV position relationship; a failed MV refresh remains an MV error and can leave the audio path usable (`app/listen1_chrome_extension/js/controller/play.js:2948-3280`).
- Current lyric/title/playback messages cross into Electron through `currentLyric`, `trackPlayingNow`, and `isPlaying`; main updates the tray, Windows thumbbar, and floating window (`app/listen1_chrome_extension/js/controller/play.js:2002-2004`, `:3160-3232`, `app/main.js:1456-1556`).
- The floating window is a separate transparent, always-on-top `BrowserWindow` loaded from `app/floatingWindow.html`; its controls send `control` events back through the preload bridge (`app/main.js:944-1087`, `app/floatingWindow.html:416-531`).

## Security and persistence boundaries

- Main-process local-data handlers require a trusted file-renderer sender whose path ends in `listen1_chrome_extension/listen1.html`; payloads are sanitized and failures become serializable `{ok:false,status}` results (`app/main.js:330-461`).
- The desktop trust model is intentionally legacy and powerful because the main page has Node integration and direct `require('electron')` use in shared scripts; new remote/web content must not be loaded into that window (`app/main.js:1187-1204`, `app/listen1_chrome_extension/js/loweb.js:116-139`).
- Bilibili cookies remain in the Electron session, while refresh material is kept behind `safeStorage`; the renderer receives auth/media status, not raw credential storage (`app/bilibiliService.js:335-504`, `:506-753`).
- Audio cache files and V3 lyric records belong under Electron `app.getPath('userData')`; cache protocol requests validate a hash path, realpath, range, and entry metadata before opening a stream (`app/main.js:229-243`, `app/audioCache.js:1181-1251`).
- Android keeps file and universal-file access disabled, accepts only packaged appassets inside WebView, opens approved HTTP(S) links externally, and blocks all other schemes (`android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:81-107`, `:147-192`, `android/app/src/main/java/com/dazzlingwuming/listen2/NavigationPolicy.java:6-35`).
- `Listen2AndroidHttp` is a WebMessage listener exposed only to the exact appassets origin; policy permits HTTPS GET to the Bilibili API host or one bounded NetEase search route, with no caller headers and no redirects (`android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:16-161`, `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:31-410`).
- The frontend adapter validates HTTPS URLs, request IDs, bounded bodies, and protocol version before posting to that object; Bilibili and NetEase are the only current provider consumers (`app/listen1_chrome_extension/js/lowebutil.js:139-392`, `app/listen1_chrome_extension/js/provider/bilibili.js:1880-1990`, `app/listen1_chrome_extension/js/provider/netease.js:390-430`).

## Future code placement rules

- Put desktop OS integration, persistent storage, credential handling, network policy, or IPC handlers in a focused `app/<feature>.js` module and wire it from `app/main.js`; keep the main file as orchestration rather than adding another large subsystem.
- Expose a desktop capability to the shared page through a small high-level wrapper in `app/listen1_chrome_extension/js/loweb.js`; return an explicit `unsupported` shape when Electron is absent, and never make providers import Electron directly.
- Put provider-specific search, lyric, playlist, or bootstrap behavior in `app/listen1_chrome_extension/js/provider/<source>.js`; preserve the established provider method names and callback/Promise contract.
- Put cross-platform playback state and retry/queue behavior in `app/listen1_chrome_extension/js/player_thread.js` only when it is truly player-core behavior; put a new UI interaction in the nearest `js/controller/*.js` and its existing `listen1.html` markup.
- Keep shared frontend code browser-safe: guard Electron-only `require` calls with the existing `isElectron()`/capability checks, and add the script to the deliberate load order in `listen1.html`.
- Put Android host behavior in `android/app/src/main/java/com/dazzlingwuming/listen2`; keep URL and request validation in pure Java `NavigationPolicy`/`HttpBridgePolicy` helpers so JVM tests can cover it.
- To add a shared asset to Android, extend the explicit allow-list in `android/app/build.gradle:8-38`; do not copy files manually into `android/app/build/`, which is generated.
- Add Android boundary tests under `android/app/src/test/java/com/dazzlingwuming/listen2`; add desktop IPC/service tests under `app/test`; add browser/frontend contract tests under `app/listen1_chrome_extension/test`.
- Put desktop icons and native packaging resources in `app/resources` or `build` according to the existing packager references; put shared UI assets in `app/listen1_chrome_extension/css`, `images`, `fonts`, or `i18n`.
- Keep runtime state out of the repository: use Electron user data/electron-store for desktop state and WebView DOM storage only for Android UI preferences; do not add cache, credentials, or generated APK assets to source directories.
- Do not place new product source in `dist/`, `android/.gradle/`, `android/app/build/`, `node_modules/`, or other generated/ignored output directories.

## Current architectural limits

- The frontend is a large AngularJS/classic-script surface rather than a bundled module graph; changes must respect globals and script order until a deliberate migration is planned (`app/listen1_chrome_extension/js/app.js:1-508`, `listen1.html:31-78`).
- Android's documented scope is intentionally below desktop parity; native background playback, desktop cache, Electron-style Bilibili login/session, and desktop lyric windows require new designs and tests (`android/README.md:8-14`).
- Root and frontend tests cover contracts, but a passing test does not prove live provider credentials, CDN availability, or a production Android WebView; verify those separately when a change needs them (`README.md:192-202`, `android/README.md:38-52`).
