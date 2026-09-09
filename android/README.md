# Listen2 Android

Android 端复用 `app/listen1_chrome_extension/` 的共享播放器界面，由一个
窄化的 native bridge 补足手机生命周期、受控网络、数据持久化和系统播放能力。
它不把 Electron 主进程搬进 WebView，也不把任意 URL、请求头、Cookie、文件路径
或凭据交给页面。以下范围以当前源码为准；发布或宣布可用前仍必须通过 API 35
模拟器验收。

## 当前能力

- **移动布局**：共享页面提供手机首页、发现、设置、播放底部栏、播放队列、歌单/收藏、
  本机音乐库和本地数据设置等移动入口，适配安全区、滚动、触控尺寸和窄屏布局。
  Android 页面只加载 APK 内由 `WebViewAssetLoader` 明确列出的资源；`file:`、
  `content:`、明文混合内容及未批准的导航均保持关闭或 fail-closed。
- **Bilibili**：native typed 路径覆盖搜索、视频详情/分 P、音频清单、Bilibili 音频
  目录分页与目录详情、播放以及主歌词解析。播放候选和账号 Cookie 只在 native
  播放/网络路径中使用；页面收到的是受限的曲目、歌词和状态数据。
- **NetEase**：native provider 覆盖搜索、歌单详情、默认音频清单/播放和主歌词。
  NetEase 请求使用固定的 HTTPS 路由和 native 加密参数；手动歌词搜索当前没有
  经过批准的固定路由，会返回 `NETEASE_ROUTE_UNAVAILABLE`，不会伪造空成功。
- **本机音乐与 LRC**：通过 Android Storage Access Framework 选择一个或多个音频
  文档，或选择音乐目录并持久化只读授权。native 扫描受控的音频 MIME/扩展名并读取
  标题、歌手、时长和嵌入封面；目录授权下会查找同目录、同名（仅扩展名为 `.lrc`）
  的 UTF-8 LRC。单文件授权不能枚举兄弟文档，因此不会猜测 LRC 路径；授权撤销或
  失效会显示可修复状态。
- **Media3 与后台播放**：`PlaybackService` 是唯一的 ExoPlayer/MediaSession owner，
  页面和 Activity 只发送语义命令。Media3 `MediaSessionService` 负责后台生命周期和
  系统媒体通知；队列支持顺序、随机、单曲/全曲循环、下一首队列、上一首历史、
  拖动、音量、重排、移除和重启恢复。播放、audio focus、屏幕关闭和通知属于 native
  播放路径，不能依赖 WebView 一直存活。
- **Room 数据**：`listen2.db` 使用同一条 v1→v5 migration chain，保存播放检查点/队列
  语义状态、歌词选择与内容、歌单及歌曲、收藏、听歌历史、缓存目录、SAF 授权和本机
  音乐目录，以及非敏感设置。URI、缓存文件位置、Cookie 和凭据不会出现在页面 DTO
  或备份中。
- **下载、缓存与离线**：Bilibili 和 NetEase 支持显式 native 下载、状态查询、取消、
  删除和清理。下载只接受 provider allow-list 中的 HTTPS 候选；文件写入应用私有目录，
  通过有界 Range/超时、SHA-256 和原子元数据校验后才标记为可用。已验证缓存会在
  播放解析前优先使用，因此可在断网时重播；临时、歌单和“下载”保留策略参与有界
  容量淘汰（默认目录容量 512 MiB，设置允许 32 MiB–8 GiB；单次媒体下载上限为 2 GiB）。
- **歌单备份与恢复**：Android 系统文件选择器导出/导入版本 1 JSON，最大 4 MiB，
  采用严格 schema，只包含歌单、曲目和收藏。导入先预览，可选择合并或在二次确认后
  覆盖；备份不包含账号、API key、SAF URI、本地路径、缓存、歌词或历史。
- **Bilibili 扫码登录**：native 只允许固定的 Bilibili QR 生成、轮询和退出路径，页面
  仅看到等待/扫码/过期/成功等状态及受限的渲染 URL。刷新材料不回传页面，Cookie 由
  native `CookieManager` 管理，刷新材料由 Android Keystore 加密保存；Keystore 或网
  络不可用时登录能力保持不可用。
- **DeepSeek 歌词翻译**：Android native 使用固定 DeepSeek endpoint；API key 由
  Android Keystore 加密保护，页面只能看到状态，不能读取密钥。翻译必须由用户明确
  同意歌词、歌名、歌手、可能费用、取消行为和失败影响后才提交，且不会自动触发；
  没有可用安全存储或同意收据不完整时请求 fail-closed。

## 明确不可用的高级能力

Android capability 矩阵只宣布已经有 native 生命周期和安全边界的能力。当前以下
能力保持关闭，不应按桌面端功能宣传或在 UI 中假设可用：

- 画质/高级音质选择、MV、画中画（PiP）、音效、WebAudio 可视化和响度分析/标准化；
- NetEase 手动歌词搜索，以及 Bilibili/NetEase 以外尚未安装 typed route 的平台；
- Electron 桌面歌词窗口、Electron IPC、桌面缓存协议及任意 provider HTTP。

Bilibili 的分 P 选择是语义队列能力，不等于画质选择或 MV 能力。缺少 native capability
时，页面应展示不可用状态或安全错误，不能退回任意 URL、浏览器 CORS 或 caller header。

## Bridge 与安全边界

`Listen2AndroidHttp` 是仅对精确 `appassets.androidplatform.net` origin 开放的
WebMessage listener。当前页面使用版本化 typed RPC（provider、歌词、播放、本机数据、
下载、账号和翻译操作）；请求/响应有界、可取消、有限重试、无重定向，并把 provider
失败映射成可诊断状态。WebView 不支持 `WEB_MESSAGE_LISTENER` 时不降级到
`addJavascriptInterface`，整项 native bridge 保持不可用。

## 开发、构建与验证

环境要求：JDK 17、Android SDK Platform 35、Build Tools 35.0.0、Gradle 8.10.2。
仓库没有 Gradle wrapper JAR；请使用本机或 CI 提供的上述 Gradle 版本。开发迭代先
运行纯 JVM 和 Node 契约测试，不反复组装 APK：

```sh
# Android/JVM policy、provider、Room/cache/backup/Keystore contract tests
cd android
gradle --no-daemon :app:testDebugUnitTest

# shared mobile UI、typed provider/RPC contract tests
cd ../app/listen1_chrome_extension
npm test
```

前述测试通过后，最后只做一次 API 35 模拟器门禁：组装 debug APK、安装/启动并运行
instrumentation/系统媒体验收（包括 WebView 安全边界、Media3 通知/屏幕关闭、播放队列、
Room 恢复和需要用户交互的 SAF 页面）。例如在已启动 API 35 模拟器的环境中：

```sh
cd android
gradle --no-daemon :app:assembleDebug :app:connectedDebugAndroidTest
```

JVM、Node 或 APK 组装成功都不能替代模拟器端到端结果；没有可用模拟器、真实 provider
响应、SAF 文件或用户自行提供的 DeepSeek/Bilibili 账号时，相关项应记录为
`not verified`，不能写成已发布能力。当前 Android instrumentation 与 Phase-01
证据入口分别位于 `app/src/androidTest/` 和
[`evidence/phase01/README.md`](evidence/phase01/README.md)。

Debug 包使用并行 ID `com.dazzlingwuming.listen2.debug`，不会替换已有 release 安装；
release 包保留 `com.dazzlingwuming.listen2`。本文件和根目录 README 不记录任何凭据、
Cookie、API key 或用户文件内容。
