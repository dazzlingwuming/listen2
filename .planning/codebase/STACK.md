---
title: Listen2 技术栈映射
analysis_date: 2026-08-30
repository: listen1_desktop
branch: agent/android-mobile-rebuild
head: e98960d
---

# 技术栈映射

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

分析日期：2026-08-30。
