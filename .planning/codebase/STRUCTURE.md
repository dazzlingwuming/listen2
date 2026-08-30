# Structure Map

**Snapshot date:** 2026-08-30
**Repository:** `listen1_desktop` current checkout
**Purpose:** source layout, ownership boundaries, build/test locations, and where future files belong.

## Top-level layout

```text
.
├── app/                         Electron runtime plus shared browser UI
├── android/                     Android WebView host and JVM policy tests
├── build/                       Electron packaging icons and background assets
├── docs/                        Design and implementation notes
├── 图片/                        README preview images
├── .github/workflows/           Release and Android APK workflows
├── package.json                 Root Electron scripts and electron-builder config
├── package-lock.json             Root dependency lockfile
├── README.md                    Product scope, build commands, and feature notes
└── .planning/codebase/          Generated mapping artifacts, including this file
```

- The root package identifies `app/main.js` as the Electron entry point and owns `start`, platform distribution, and focused desktop test scripts (`package.json:1-23`).
- `README.md` describes the current v2.34.0 product as a multi-provider desktop player with Bilibili, lyrics, MV, cache, loudness, and translation features (`README.md:18-29`, `:47-89`).
- `build/` is referenced by electron-builder for platform icons; it is packaging input, not application logic (`package.json:42-113`).
- `docs/` contains feature/design notes such as `docs/BILIBILI_MV_LOGIN_PLAN.md` and screenshot documentation; it is not loaded at runtime.
- `.github/workflows/release.yml` builds Electron packages on macOS, Ubuntu, and Windows; `.github/workflows/android-apk.yml` builds and tests the Android app when Android or allow-listed shared assets change.
- `dist/`, installed `node_modules/`, and Android Gradle output are build products and are not source placement targets.

## `app/`: Electron runtime

```text
app/
├── main.js                    Main process, windows, tray, IPC, proxy, lifecycle
├── package.json                App-local runtime dependency manifest
├── package-lock.json           App-local dependency lockfile
├── preload.js                 Floating-window context bridge
├── functions.js               Local audio-tag and sidecar lyric reader
├── bilibiliService.js         Desktop Bilibili auth, WBI, manifest and variants
├── bilibiliFailure.js         Safe external-media failure classification
├── audioCache.js              Complete-audio cache, index, eviction and range scheme
├── lyricCacheStore.js         V3 lyric/translation persistence and migration
├── listeningHistoryStore.js   Local listening sessions and annual summaries
├── machineTranslation.js      DeepSeek prompt, request and response validation
├── loudnessAnalyzer.js        Hidden renderer coordinator for loudness jobs
├── loudnessAnalyzerPreload.js Analyzer-only preload bridge
├── loudnessAnalyzerRenderer.js Browser-side BS.1770/true-peak analysis
├── loudnessAnalyzer.html      Minimal analyzer document
├── floatingWindow.html        Desktop lyrics window UI
├── resources/                 Native tray/thumbbar/package icons
├── test/                      Node tests for Electron-side services/contracts
└── listen1_chrome_extension/  Embedded browser UI and provider adapters
```

- `main.js` is the composition root: it imports the service modules, registers IPC handlers, creates the windows, and performs orderly cache/Bilibili shutdown (`app/main.js:1-40`, `:452-600`, `:1589-1683`).
- `app/package.json` is a second, app-local manifest with runtime dependencies and an `electron main.js` start command (`app/package.json:1-32`); the root `package.json` remains the documented repository command/build entry point.
- Desktop local data is deliberately split into focused stores rather than mixed into controllers. Audio cache files/index and analyzer metadata are handled by `audioCache.js`/`loudnessAnalyzer.js`; lyrics, translation records, and history use their own stores.
- `app/resources` is consumed by platform tray/thumbbar code; `build/` is consumed by electron-builder. New native icons should follow the existing consumer rather than being put beside frontend images.
- `app/test` mirrors the desktop modules: cache tests, Bilibili service/failure tests, lyric/history tests, translation tests, loudness tests, and floating-window contract tests (`package.json:18-23`).

## `app/listen1_chrome_extension/`: shared frontend

```text
app/listen1_chrome_extension/
├── listen1.html               AngularJS page and explicit classic-script loader
├── annual_recap.html          Included annual-recap template
├── manifest.json              MV3 Chrome extension metadata and host permissions
├── manifest_firefox.json      Firefox extension metadata
├── rules_1.json               Extension declarative request rules
├── css/ fonts/ images/ i18n/  Shared UI styles, fonts, images and translations
├── js/app.js                  Angular module, directives and i18next setup
├── js/bridge.js               Front/background player-mode bridge
├── js/loweb.js                Provider registry, MediaService and desktop IPC façade
├── js/lowebutil.js            Environment/cookie helpers and Android HTTP adapter
├── js/player_thread.js        Howler player state, cache, queue and history behavior
├── js/l1_player.js            UI-facing player façade
├── js/audio_visualizer.js     Desktop Web Audio effects and real-time visualizer
├── js/bilibili_mv_player.js   Bilibili video element and drift/recovery controller
├── js/bilibili_qr.js          QR login UI helper
├── js/playlist_backup.js      Backup/merge serialization helpers
├── js/provider/                Provider-specific source adapters
├── js/controller/              Angular controllers for views/settings/playback
├── js/vendor/                 Third-party browser scripts
└── test/                      Node contract tests using browser-like harnesses
```

- `listen1.html` is the runtime root and contains the script order: vendor libraries, shared utilities, providers, player modules, Angular app, and controllers (`app/listen1_chrome_extension/listen1.html:31-78`).
- `js/provider/` currently contains adapters for NetEase, QQ, Kugou, Kuwo, Bilibili, Migu, Taihe, Xiami, local music, and playlist behavior; preserve the common provider surface when adding a source.
- `js/controller/play.js` is the largest UI coordinator and owns lyric selection/translation confirmation, playback UI, cache/history settings, MV/floating controls, and player event subscriptions; avoid growing it when a pure service can be extracted (`app/listen1_chrome_extension/js/controller/play.js:152-371`, `:2948-3450`).
- `js/loweb.js` is the shared capability façade. Its desktop-only calls resolve Electron IPC lazily and return unsupported results outside Electron; Android-specific HTTP is intentionally isolated in `lowebutil.js`.
- `manifest.json` remains extension metadata. Android does not package the manifest, tests, docs, lockfiles, or vendor-adjacent extras: Gradle copies an explicit list of UI/runtime files (`android/app/build.gradle:8-38`).
- The embedded frontend also has its own `.github/workflows/eslint.yml`, package manifests, and package-local lint configuration; `_metadata/` and installed `node_modules/` may exist in a checkout but are not application source.
- Frontend tests live beside the frontend in `app/listen1_chrome_extension/test`; the package test script runs mobile, Android adapter, player, lyric, cache UI/behavior, audio effects, and layout contracts (`app/listen1_chrome_extension/package.json:1-7`).

## `android/`: WebView shell

```text
android/
├── settings.gradle             Includes the `app` module
├── build.gradle                Android Gradle plugin configuration
├── README.md                   Scope, security model, and build command
├── app/build.gradle            Asset allow-list, SDK/JDK, and dependency wiring
├── app/src/main/AndroidManifest.xml
├── app/src/main/java/com/dazzlingwuming/listen2/
│   ├── MainActivity.java       WebView host, loading view and navigation
│   ├── NavigationPolicy.java  Packaged/external URL boundary
│   ├── HttpBridgePolicy.java  Pure validation for the native HTTP contract
│   └── AndroidHttpBridge.java WebMessage listener and bounded HTTPS executor
├── app/src/main/res/           Launch screen, theme, colors and strings
└── app/src/test/java/...       JVM tests for navigation and bridge policy
```

- `android/app/build.gradle:8-38` copies selected files from `app/listen1_chrome_extension` into generated assets and is the only supported place to change the Android asset boundary.
- `MainActivity` configures JavaScript/DOM storage while disabling file access, universal file access, mixed content, geolocation, and multiple windows (`android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:81-107`).
- Packaged appassets remain in the WebView; approved HTTP(S) links open externally and all other schemes are blocked (`MainActivity.java:147-192`, `NavigationPolicy.java:15-35`).
- `HttpBridgePolicy` is deliberately Android-API independent so `HttpBridgePolicyTest` can exercise origin, method, host, route, query, cookie, and size limits on the JVM (`android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:11-161`).
- The bridge is asynchronous and bounded in `AndroidHttpBridge`; it has no generic `addJavascriptInterface` fallback (`android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:31-410`, `android/README.md:22-36`).
- `android/app/build/` and `android/.gradle/` are generated/ignored outputs. Never edit generated copied frontend files; edit the shared source or the Gradle allow-list.

## Build and verification map

- Desktop development starts with `npm ci` and `npm run start`; packaged artifacts are written to `dist/` by electron-builder (`README.md:158-190`).
- Desktop service tests are grouped by root scripts: Bilibili, cache/lyrics, loudness, floating lyrics, machine translation, and history (`package.json:18-23`).
- Shared frontend contracts run with `npm --prefix app/listen1_chrome_extension test`; they use Node harnesses rather than a browser build pipeline (`README.md:192-202`, `app/listen1_chrome_extension/package.json:1-7`).
- Android verification is `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug` from `android`, followed by APK signature verification; CI provisions Gradle because no wrapper JAR is tracked (`android/README.md:38-52`).
- The Android workflow installs JDK 17/SDK Platform 35 and runs the same unit-test/assemble path before uploading the debug APK (`.github/workflows/android-apk.yml`).

## Future placement rules

| New concern | Place it in | Keep out of |
| --- | --- | --- |
| Desktop OS/window/IPC integration | `app/<focused-feature>.js` plus a small `app/main.js` wiring change | shared provider files and generated output |
| Desktop persistence/cache | focused store under `app/`, data under Electron user data | repository, `dist/`, frontend `localStorage` for sensitive data |
| Shared provider behavior | `app/listen1_chrome_extension/js/provider/<source>.js` | `android/` unless it is host security/network behavior |
| Shared playback/queue behavior | `app/listen1_chrome_extension/js/player_thread.js` or a focused adjacent module | Angular controller-only hacks |
| Shared UI/view behavior | existing `js/controller/`, HTML, CSS, i18n directories | new framework/bundler without a migration plan |
| Android navigation/request policy | package Java files, with pure checks in `*Policy.java` | JavaScript-originated arbitrary native APIs |
| Android-shared frontend asset | source frontend path plus `android/app/build.gradle` allow-list | `android/app/build/generated` or `android/app/build` |
| Desktop service contract tests | `app/test` | production modules containing test fixtures |
| Frontend/Android adapter contracts | `app/listen1_chrome_extension/test` and `android/app/src/test/java` | APK packaged assets |

- Match existing naming: desktop JavaScript uses lower camel case, legacy frontend/provider names may use snake case, and Android classes use PascalCase (`.planning/codebase/CONVENTIONS.md`).
- Preserve the explicit script load order and global contracts in the frontend; there is no bundler or TypeScript module graph to resolve new imports automatically.
- Keep runtime credentials, cookies, cache indexes, audio files, and translation data out of source control. New persistent desktop data belongs behind a store and a tested IPC contract.
- Keep generated mapping documents under `.planning/codebase/`; they describe the current tree and must not become runtime dependencies.
