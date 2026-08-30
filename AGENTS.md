<!-- GSD:project-start source:PROJECT.md -->

## Project

**Listen2 Android 平台等价能力**

Listen2 是一个把 Bilibili、网易云音乐及其他音乐来源聚合到统一播放器中的开源项目，当前产品以 Electron 桌面端和可复用的 Listen1 浏览器前端为主。本 brownfield 项目以最新 `main` 的桌面能力为平价基线，把这些能力带到 Android；Android 使用符合手机生命周期和交互习惯的等价 UX，并通过受控的 native bridge 补足 WebView 无法安全或可靠承担的能力。

目标用户是希望在 Android 手机上搜索、播放、管理音乐并继续使用桌面端已有歌单、歌词、缓存和播放体验的 Listen2 用户。

**Core Value:** Android 用户能够在其账号和平台实际授权范围内，从搜索到播放、歌词和后续控制完成可靠的端到端听歌流程。

### Constraints

- **技术栈**：优先复用共享前端与 provider/player 契约；Android 原生能力集中在 `android/app/src/main/java/com/dazzlingwuming/listen2`，新增安全/网络策略保持纯 Java helper 可测试，避免引入未经评估的框架迁移。
- **架构边界**：采用“共享前端 + 窄 native bridge”；native 只提供版本化、高层、allow-listed 能力，不能暴露任意 URL、caller header、cookie 控制或通用 JavaScript 接口。
- **平台差异**：桌面窗口、托盘、浮动歌词等必须转成 Android 等价 UX；播放、后台、audio focus、通知和生命周期由 Android 原生服务负责，不能依赖 WebView 永不被销毁。
- **安全与合规**：不绕过会员/付费/DRM/地区/账号权限；token、cookie、API key、签名材料和本地用户数据不进入源码、备份、日志、APK 明文或规划文档。
- **网络可靠性**：默认 HTTPS、精确 host/path/query allow-list、bounded body、超时、取消和有限重试；外部接口变化必须显示为可诊断的 provider 错误，而不是伪装成空结果。
- **性能与资源**：优先解决启动、首屏、首搜和首播延迟，同时约束低内存、后台、电量、磁盘和流量；缓存/歌词/历史/翻译存储需有大小、增长和损坏恢复策略。
- **验证环境**：Android 模拟器端到端验收是必需门禁，静态契约、JVM 测试或 APK 构建成功不能替代它；真实账号凭据若需要，由用户在仓库外提供并按最小权限使用。
- **发布权限**：本项目不授权 merge/deploy；正式签名依赖用户后续提供的签名凭据，在此之前只做可重复构建、debug/release-like 检查和模拟器验证。

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## 快照与范围

- 分析日期：2026-08-30；当前分支：`agent/android-mobile-rebuild`；HEAD：`e98960d`。
- 仓库包含 Electron 桌面端、嵌入式 Listen1 浏览器前端和 Android WebView 样例，三者共享 `app/listen1_chrome_extension/` 的部分静态资源。
- 桌面端入口是 `app/main.js`；根 `package.json` 的 `main` 指向该入口，产品版本为 `2.34.0`。
- Android 入口是 `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java`，不是 Electron 移植。
- 本次映射未读取任何 `.env` 内容；仓库中未检测到 `.env` 或 `.env.*` 文件，`.gitignore` 仅保留了示例配置的可能性。

## 语言、运行时与框架

- 桌面主进程使用 CommonJS JavaScript，核心代码位于 `app/main.js` 和 `app/*.js`。
- 浏览器端使用原生 HTML/CSS/JavaScript 与 AngularJS 1.8.2；页面入口为 `app/listen1_chrome_extension/listen1.html`。
- 前端没有 TypeScript、React/Vue、打包器或转译步骤；脚本通过 HTML 的固定顺序直接加载。
- `app/listen1_chrome_extension/js/vendor/` 内置 Angular、axios、Howler、async、LRU、i18next、Notyf、forge 等浏览器库，运行时不依赖 CDN。
- 服务提供商以全局 JavaScript 类/对象注册到 `app/listen1_chrome_extension/js/loweb.js`，不是独立 npm 包或服务端微服务。
- Android 使用 Java 17、AndroidX WebKit `WebViewAssetLoader` 和 `WebMessageListener`；桥接实现位于 `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java`。
- Android Gradle 插件为 `8.8.2`，目标/编译 SDK 为 35，最低 SDK 为 26；仓库没有 Gradle wrapper JAR，构建依赖外部 Gradle 8.10.2。

## 依赖与版本来源

| 范围 | 清单 | 直接依赖/用途 |
| --- | --- | --- |
| 根开发工具 | `package.json`、`package-lock.json` | Electron `^32.3.2`、electron-builder `^25.1.8`、Prettier `^2.6.2` |
| Electron 应用 | `app/package.json`、`app/package-lock.json` | `@electron/remote`、`electron-store`、`electron-updater`、`music-metadata`、`chardet` |
| 前端运行时 | `app/listen1_chrome_extension/package.json` | `color`、jQuery、jquery-lazyload、node-vibrant；其余大量库在 `app/listen1_chrome_extension/js/vendor/` 内 vendored |
| 前端开发工具 | 同上清单 | ESLint 7、Airbnb 配置、Prettier、husky、lint-staged |
| Android | `android/app/build.gradle` | `androidx.webkit:webkit:1.12.1`；单元测试使用 JUnit `4.13.2` |

- 根锁文件锁定 Electron 32.3.2；嵌套 `app/package-lock.json` 的依赖树出现 Electron 34.3.0，版本来源和实际打包边界需要统一。
- 根 `npm ci` 只直接依据根清单安装，运行时依赖却声明在 `app/package.json`；发布前应把嵌套依赖安装/打包策略固化为可重复的 workspace 或明确的安装步骤。
- 前端的 `package-lock.json` 只服务于测试/ESLint，Android 的 `syncListen1Assets` 不把清单、锁文件、测试和文档复制进 APK。

## 桌面运行时与模块边界

- `app/main.js` 创建主窗口、浮动歌词窗口和音量分析窗口，注册 IPC、快捷键、托盘、代理、自动更新和单实例锁。
- 主窗口通过 `file://` 加载 `app/listen1_chrome_extension/listen1.html`，当前启用 Node 集成、关闭 context isolation，并使用 `@electron/remote`。
- `app/preload.js` 仅服务浮动歌词窗口，通过 `contextBridge` 暴露受限的 `window.api`；音量分析窗口使用独立 preload 和隔离环境。
- `app/bilibiliService.js` 负责 Bilibili 登录、Cookie 刷新、WBI 签名和音频/视频清单；`app/machineTranslation.js` 负责 DeepSeek 歌词翻译。
- `app/audioCache.js` 使用自定义 `listen2-cache` 协议管理 Bilibili 媒体缓存；`app/loudnessAnalyzer.js` 提供 LUFS/峰值分析；`app/lyricCacheStore.js` 和 `app/listeningHistoryStore.js` 管理本地歌词、翻译与听歌历史。
- `app/functions.js` 读取本地音频标签和相邻 LRC 文件，编码识别由 `chardet` 完成，媒体元数据由 `music-metadata` 完成。

## 持久化、配置与打包

- Electron Store 保存窗口状态、代理、Bilibili 认证状态、翻译配置/缓存和听歌历史；敏感刷新信息在支持的平台上经 Electron `safeStorage` 加密。
- 默认音频缓存目录是 Electron `userData/audio-cache-v1`，歌词缓存目录是 `userData/lyric-cache-v3`；缓存容量和保留策略由 IPC 暴露给前端。
- 前端使用 `localStorage` 保存播放器状态、播放列表备份、GitHub/Last.fm 会话等；浏览器 Cookie 由扩展 API 或 Electron 默认 session 管理。
- 根 `package.json` 的 electron-builder 配置输出 macOS DMG、Linux tar.gz/AppImage/deb、Windows NSIS/7z，目标包含 x64、arm64、ia32 等架构。
- `.github/workflows/release.yml` 在 push 上执行 Node 20 的 Electron 构建；tag push 会发布制品，当前 workflow 未包含独立部署服务步骤。
- `android/app/build.gradle` 通过 allow-list 将前端静态资源复制到 APK；`android/app/src/main/AndroidManifest.xml` 仅声明网络权限并禁止明文流量。

## 验证入口

- 桌面开发启动：`npm ci` 后执行 `npm run start`；开发脚本为 `npm run dev`。
- 桌面单元测试入口包括 `npm run test:bilibili`、`npm run test:desktop-cache`、`npm run test:loudness`、`npm run test:desktop-lyric`、`npm run test:machine-translation` 和 `npm run test:listening-history`。
- 前端契约测试：在 `app/listen1_chrome_extension/` 执行 `npm ci && npm test`；ESLint workflow 位于 `app/listen1_chrome_extension/.github/workflows/eslint.yml`，其 CI 仍使用 Node 16。
- Android 本地验证：在 `android/` 使用 `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug`，再用 SDK 35 的 `apksigner` 验证 debug APK。
- Android CI 位于 `.github/workflows/android-apk.yml`，固定 JDK 17、SDK 35、Build Tools 35.0.0 和 Gradle 8.10.2，并上传 debug APK 制品。

## 当前风险与使用建议

- 建议先统一根、`app/`、前端三套依赖清单及 Electron 版本，明确发布机器是否需要额外执行 `npm --prefix app ci`，并在 CI 中验证最终 ASAR 内容。
- 建议将主窗口迁移到 context isolation + 最小化 preload IPC，移除 `nodeIntegration`、`enableRemoteModule` 和对原始 `ipcRenderer` 的暴露。
- `app/main.js` 的通用 URL 打开 IPC、广泛的 CORS/Referer 重写和 provider 直连应改为发送方、目标域名及用途 allow-list。
- 检测到硬编码 OAuth/API 凭据，需要轮换并迁移到安全配置；文档不记录任何凭据值。
- Provider 接口是外部、非稳定契约；建议为 Bilibili、NetEase 等关键路径保留失败契约测试、超时/降级监控和定期端到端回归。
- Android 当前是 UI/前台播放样例，不具备 Media3 后台播放、原生登录、离线缓存或桌面 IPC 能力；若要宣称功能 parity，应另行立项并补齐原生服务。

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Scope and source layout

- The desktop runtime is CommonJS Electron/Node code under `app/*.js`; the main process and IPC entry point is `app/main.js`.
- The shared browser UI is an AngularJS 1.x application, not modern Angular/TypeScript. Its root module is created in `app/listen1_chrome_extension/js/app.js` and bootstrapped by `app/listen1_chrome_extension/listen1.html`.
- Browser scripts are classic globals loaded in a deliberate order in `app/listen1_chrome_extension/listen1.html`; there is no bundler or module import graph for this UI.
- Angular controllers live in `app/listen1_chrome_extension/js/controller/`; platform adapters live in `app/listen1_chrome_extension/js/provider/`; playback state is concentrated in `app/listen1_chrome_extension/js/player_thread.js`.
- Android is a small Java WebView host. Activity/UI code is in `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java`, while URL and HTTP policy are isolated in `NavigationPolicy.java` and `HttpBridgePolicy.java`.
- Generated Android files under `android/app/build/` and `android/.gradle/` are ignored. Never hand-edit generated assets; change the allow-list task in `android/app/build.gradle` instead.

## Naming patterns

- Desktop modules use lower camel case such as `app/audioCache.js`, `app/bilibiliService.js`, and `app/lyricCacheStore.js`.
- Legacy browser modules use a mixture of lower camel case and snake case (`app/listen1_chrome_extension/js/l1_player.js`, `app/listen1_chrome_extension/js/controller/my_playlist.js`, `app/listen1_chrome_extension/js/provider/bilibili.js`). Match the directory's established name when adding a file.
- Frontend tests are `*.test.js` in `app/listen1_chrome_extension/test/`; desktop tests use the same suffix in `app/test/`.
- Java production and test classes use PascalCase (`MainActivity`, `AndroidHttpBridge`, `HttpBridgePolicyTest`) and remain in the package directory.
- New desktop functions use lower camel case and descriptive verbs (`getBilibiliService`, `ensureAudioCacheAvailable`, `createBilibiliFailure`).
- Angular/controller and general UI code uses lower camel case for new functions, but provider compatibility methods intentionally retain snake case (`get_video_context`, `bootstrap_track`, `search_lyric_candidates`).
- Event callbacks are usually named by event or operation (`onPostMessage`, `handleNavigation`, `submitListeningHistory`); preserve the existing callback signatures at provider and IPC boundaries.
- Java methods use lower camel case and explicit visibility. Keep pure policy helpers package-private when their only consumer is the same package's tests.
- JavaScript constants are `UPPER_SNAKE_CASE` (`MAX_LYRIC_LENGTH`, `DEEPSEEK_PROMPT_VERSION`); local values and object keys are lower camel case.
- `Player` keeps legacy private-ish state with an underscore prefix (`_shuffle_queue`, `_media_retry_state`). Do not rename these fields casually because tests and the UI harness inspect them.
- Java constants are `private static final` or package-visible `UPPER_SNAKE_CASE`; mutable instance state is lower camel case.
- There are no TypeScript interfaces or type aliases. Use JSDoc only when a cross-boundary shape is non-obvious, and use Java types for Android contracts.

## Formatting and linting

- Root JavaScript formatting is described by `.prettierrc`: two spaces, LF, semicolons, double quotes, trailing ES5 commas, and parentheses around arrow parameters.
- The embedded frontend has its own `app/listen1_chrome_extension/.prettierrc`, which changes strings to single quotes while retaining ES5 trailing commas. Follow this config for files under that directory.
- Frontend linting extends `airbnb-base` plus `prettier` in `app/listen1_chrome_extension/.eslintrc.json`, uses ECMAScript 2020 syntax (`ecmaVersion: 11`), and ignores `app/listen1_chrome_extension/js/vendor/*.js`.
- Existing frontend files use file-level `/* global ... */` and targeted `eslint-disable` comments because classic script globals and legacy provider APIs are intentional. Prefer a narrow rule suppression with a reason over broad new disables.
- Root `package.json` exposes Prettier as a dev dependency but has no root `lint` or `format` script. Do not claim root formatting is CI-enforced; run the configured formatter/check explicitly when changing root modules.
- The extension package has Husky/lint-staged configuration in `app/listen1_chrome_extension/package.json`; it runs ESLint/Prettier on staged files when that package's hooks are installed.
- Android Java uses four-space indentation, braces on the declaration line, explicit `final` where useful, and comments/Javadoc for security boundaries. Gradle Groovy in `android/app/build.gradle` uses four spaces and single-quoted dependency/configuration strings.

## Import and dependency organization

- CommonJS `require` calls are at the top of desktop modules, with Node built-ins first and local modules after them (`app/main.js`, `app/audioCache.js`). There are no path aliases or barrel files.
- Browser scripts intentionally depend on globals established by HTML order (`angular`, `axios`, `Howl`, providers, `MediaService`). Add a `/* global ... */` declaration when introducing a new external global.
- Keep `app/listen1_chrome_extension/listen1.html` script order valid: vendor libraries, utility/bridge modules, providers, player/service modules, the Angular app, then controllers.
- Android imports are grouped by Android framework, AndroidX, JSON, Java standard library, and `javax` as shown in `AndroidHttpBridge.java`; keep policy code independent of Android APIs where possible.

## Error handling

- Throw for invalid internal inputs or violated invariants in service modules, attaching a stable `code` when the caller needs to classify the failure (`app/bilibiliService.js`, `app/machineTranslation.js`, `app/audioCache.js`).
- At Electron IPC boundaries, catch errors and return a serializable `{ ok: false, status: ... }` result. `registerLocalDataHandler` in `app/main.js` also validates the sender and normalizes payloads before dispatch.
- Use `app/bilibiliFailure.js` as the pattern for external media errors: classify retryability and expose safe status/kind fields, never raw exception messages, signed URLs, cookies, or headers.
- Browser-only paths return explicit `{ ok: false, status: 'unsupported' }` when desktop IPC is absent (`app/listen1_chrome_extension/js/loweb.js`). Preserve this contract instead of throwing on a normal capability difference.
- Cache stores serialize writes through `writeChain` and return stable statuses such as `invalid-input`, `stale-revision`, `manual-locked`, and `not-found` (`app/lyricCacheStore.js`, `app/audioCache.js`). Keep expected business failures distinguishable from transport failures.
- For cleanup or optional enrichment, a deliberately ignored catch is acceptable only when the primary operation remains valid; document the reason as in `attachMachineTranslationToLyricCache` in `app/main.js`.
- Legacy providers commonly use `success`/`failure` callbacks and `{ status: 'success' | 'fail' }`; newer paths use Promises. Preserve the API style of the provider being changed and bridge both styles explicitly when needed.
- Isolate independent provider/lyric failures with fallback values or `Promise.allSettled` where the UI can continue (`app/listen1_chrome_extension/js/provider/bilibili.js`). Do not silently turn a required operation into success.
- Controller catches should reset pending/loading state and show a localized `notyf` message (`app/listen1_chrome_extension/js/controller/play.js`). Keep raw errors out of user-visible notifications.
- `HttpBridgePolicy` returns `ValidationResult.error(code)` for invalid scheme, host, route, query, size, or method; `AndroidHttpBridge` maps parse/network/timeout/redirect failures to explicit `BridgeReply` error codes.
- Keep the WebView bridge bounded and asynchronous: fixed queue, timeouts, no redirects, bounded response bodies, and no caller-supplied headers. A destroyed WebView is an expected late-reply case and is caught in `replyOnMain`.
- `NavigationPolicy` treats malformed or untrusted URLs as false rather than throwing. Maintain the packaged-asset boundary and never broaden it to arbitrary `file:`, `content:`, or `intent:` navigation.

## Logging and comments

- There is no application logging framework. Runtime diagnostics use bounded in-memory playback diagnostics (`player_thread.js`) and occasional `console.warn`; tests use `console.log`/`console.error` for script completion/failure.
- Log only sanitized state, status, stage, and bounded identifiers at boundaries. Never log API keys, cookies, signed media URLs, or arbitrary exception messages.
- Comments should explain why a security, retry, cache, queue, or compatibility choice exists. Examples include the security rationale in `HttpBridgePolicy.java` and the bounded cleanup/retry comments in `app/audioCache.js`.
- Existing TODOs are plain `// TODO:` comments (for example in `app/listen1_chrome_extension/js/provider/qq.js` and `app/listen1_chrome_extension/js/loweb.js`). Add an issue/reference when one exists and avoid creating TODOs that hide a required behavior change.

## Function and module design guidance

- Prefer guard clauses and explicit returns for validation, unsupported capabilities, and empty state; this is the dominant style in `app/lyricCacheStore.js`, `app/listeningHistoryStore.js`, and the Android policy classes.
- Use an options object for operations crossing process/module boundaries or needing several values; retain existing positional signatures only for legacy provider callbacks.
- The codebase contains intentionally large legacy modules (`app/main.js`, `app/audioCache.js`, `app/listen1_chrome_extension/js/controller/play.js`, and provider files). For new work, extract pure validation/classification helpers and keep side effects at boundaries instead of growing these files further.
- Desktop modules expose named CommonJS exports for tests; browser modules expose globals or UMD-style exports (`app/loudnessAnalyzerRenderer.js`, `app/listen1_chrome_extension/js/playlist_backup.js`). Keep new reusable pure logic exportable without requiring Electron.
- Before changing a contract, update the relevant test and the corresponding IPC/provider status shape together. Preserve old aliases only when the consuming browser or extension path still requires them.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

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

### Search, bootstrap and playback

### Lyrics, translation and history

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

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
