---
title: Listen2 Android parity implementation architecture research
snapshot: 2026-08-30
scope: shared AngularJS WebView, native provider/session/playback/data boundary
status: research-only
---

# Android parity implementation architecture

## 结论

Android 应保持“共享 AngularJS WebView + 受控 native capability layer”的产品形态，但要把网络 provider、账号会话、实际音频播放、文件权限和可恢复的持久化从 WebView 中移出。推荐的 Android 单一运行时边界如下：

```text
AngularJS WebView (UI/projection only)
        │  versioned WebMessage RPC; exact appassets origin
        ▼
AndroidRpcBridge → RpcDispatcher → capability services
        │                         ├─ ProviderGateway → provider adapters → HTTPS transport
        │                         ├─ SessionVault (Keystore-backed; secret never crosses bridge)
        │                         ├─ Library/lyric/history repositories → Room
        │                         ├─ Settings repository → DataStore
        │                         ├─ SAF/file broker → ContentResolver/URI grants
        │                         └─ Cache/download coordinator → Media3 cache/download service
        │
        └── PlaybackGateway → MediaController → MediaSessionService
                                └─ ExoPlayer + CacheDataSource → local cache or provider stream
```

`MediaSessionService` 是实际播放和系统控制的唯一运行时 owner；WebView 只发高层意图、接收状态快照和有限事件。`Room` 是用户可见领域数据的持久化真相，`DataStore` 只保存小型设置，WebView `localStorage` 只可保留非敏感的短暂 UI 偏好。签名媒体 URL、Cookie、token、DeepSeek key 和本地文件绝不进入 WebView、备份或日志。

这份研究只修改本文件，不实现产品代码、不生成 APK、不提交 commit。实现顺序必须先冻结能力与协议，再做 Bilibili/网易云的端到端切片，之后才扩展后台播放、持久化、文件和其他 provider。

## 1. 当前基线与边界

代码和文档核查得到的事实：

- `MainActivity.java` 通过 `WebViewAssetLoader` 从固定的 `https://appassets.androidplatform.net/assets/listen1/` origin 加载 allow-list 资源；它目前只负责前台 WebView、导航和生命周期清理。
- `AndroidHttpBridge.java` 是 v1 的单 worker、有限队列 HTTPS GET bridge；`HttpBridgePolicy.java` 只允许 Bilibili host（路径仍偏宽）和一个精确 NetEase 搜索路径。它没有 provider 详情/播放/歌词、原生账号、Media3、Room、SAF 或下载能力。
- `lowebutil.js` 的 `Listen2AndroidHttpAdapter` 暴露的是通用形状的 GET 适配器；Bilibili/NetEase provider 只在搜索分支使用它。这个形状只能作为迁移兼容层，不能成为 Android parity 的最终 API。
- 共享页面由 `listen1.html` 按固定 classic-script 顺序加载 AngularJS、provider、`loweb.js`、`lowebutil.js`、`player_thread.js` 和 controllers。不能通过一次 bundler/框架迁移解决移动问题。
- `player_thread.js` 当前由 Howler 持有媒体对象、重试、随机/下一首队列和听歌采样；`l1_player.js`/`play.js` 将其状态投影给 UI。Android 不能让 Howler 和原生 Player 同时成为可写 owner。
- Android Gradle 只复制显式资源 allow-list；不得编辑 `android/app/build/` 或 generated assets。所有新共享脚本都必须同时进入源目录的加载顺序和 Gradle allow-list。

仓库现状证据：`.planning/codebase/ARCHITECTURE.md`、`.planning/codebase/INTEGRATIONS.md`、`.planning/codebase/STRUCTURE.md`、`android/README.md`，以及上述源文件的当前 checkout（HEAD `e98960d`）。这些是项目内部证据，不把当前测试通过误称为真实 provider、生命周期或后台播放已验证。

### 旧版 `listen1_mobile` 可借用与不可借用

官方 `listen1/listen1_mobile@v0.8.2` 只作为领域/行为兼容证据：

- `src/api/client.js` 暗示稳定的 provider 入口：按两字符 `platformId`/track id 前缀选择 provider，并暴露 `showPlaylist`、`search`、`getPlaylist`、`bootstrapTrack`、`parseUrl`。当前 Android adapter 可以保留这些语义，但映射到高层 RPC 和当前桌面字段。
- `src/redux/player.reducer.js` 暗示播放领域字段和行为：`playMode`、`nowplayingTrack`、`tracks`、`shuffleIds`、`skipIds`，以及 loop/shuffle/repeat-one 三种模式。当前 Android `QueueEngine` 可用这些行为编写迁移 fixture，但以桌面最新的 Fisher–Yates、播放历史和 FIFO “下一首”语义为准。
- `src/views/player/background-player.screen.js` 证明移动端需要 play/pause/next/previous、进度、audio focus 和耳机拔出暂停等系统控制；实现改用 Media3 的 `MediaSessionService`/`MediaController`。
- `src/modules/state-json-convert.js` 暗示旧备份的 `language`、`player-settings`、`current-playing`、`playerlists` 及 playlist id 结构，可用于解析旧文件和生成冲突 fixture；当前安全备份仍以桌面 `playlist_backup.js` 的白名单和合并语义为准。

可复用的是字段名、ID 前缀、队列不变量和备份兼容样例；不可复用的是 RN 0.59 runtime、`react-native-video`、`react-native-music-control`、Redux-persist storage、旧 native Gradle module、直接 HTTP/CookieProvider 和旧生命周期假设。它们不是当前 Android 安全、codec、后台限制或 provider API 的权威。

## 2. 组件边界与职责

| 组件 | 所在进程/owner | 负责 | 不负责 / 交接契约 |
| --- | --- | --- | --- |
| `Application`/composition root | app process，单例 | 创建 Room、DataStore、SessionVault、transport、provider registry、cache/download coordinator；只持有 `applicationContext` | 不持有 Activity/WebView 引用；服务和 Activity 都从同一组单例取得 repository |
| `MainActivity` + `WebViewHost` | UI 进程 | `ComponentActivity` 生命周期、insets、WebView 建立/销毁、asset origin、外部导航、Activity Result | 不持有播放真相；不直接发 HTTP；销毁时取消 page-scoped RPC，但不停止仍在播放的 service |
| `AndroidRpcBridge` + `RpcDispatcher` | UI 进程入口，后台执行 | 校验 origin/frame/version/schema、请求上限、page epoch、取消/事件回传；按 op 路由 capability service | 不接受任意 URL、header、Cookie、JavaScript object；不传音频字节 |
| `ProviderGateway` | app process | 校验 provider/track id、选择 adapter、统一错误和 capability 状态、规范化 Listen1 track/playlist/lyric/media DTO | 不把 provider 原始 JSON 或签名 URL交给 WebView；不绕过会员、DRM、地区或登录权限 |
| `ProviderAdapter`（Bilibili、NetEase，之后其他） | app process，adapter-owned transport | provider-specific URL/path/query、WBI/WeAPI 等合法协议、详情/歌词/媒体 candidate、账号流程 | 不向调用者暴露 Cookie/header；每个 adapter 只能访问自己的 `ProviderRequestPolicy` |
| `SessionVault` + `SessionRepository` | app process | Keystore key、加密 session blob、过期/刷新/登出状态；内存中短暂提供给对应 adapter | 不把 secret 放 Room/DataStore/backup/log/WebView；登录 UI 只收到状态或短期 challenge |
| `PlaybackService` (`MediaSessionService`) | service，独立于 Activity/WebView | 创建/释放 ExoPlayer 和 MediaSession、系统通知、MediaController、audio focus、media button、播放 resumption | 不依赖 WebView 存活；不接受页面传来的媒体 URL/header；队列命令经 `PlaybackGateway`/MediaController |
| `PlaybackCoordinator` + `QueueEngine` | service owner | 将 track id 解析成内部 `MediaLocator`，管理 base queue、FIFO play-next、shuffle cycle/history、repeat、失败恢复和有效播放采样 | 不让 WebView/Howler改变 queue；Media3 playlist 是 materialized projection，不是业务队列的另一写入口 |
| `PlaybackStateRepository` | service owner | 从 Player.Listener + 定时 position sample 生成不可变快照，保存轻量 checkpoint，向 bridge/controller 发布 | 不把每个 position tick 写 Room；不接受 UI 直接 patch 状态 |
| `LibraryRepository`/`LyricRepository`/`HistoryRepository` | app process，Room-backed | 歌单、收藏、歌词/翻译、有效听歌记录和队列 checkpoint 的事务读写 | 不保存 secret、signed URL 或实际文件 bytes；所有异步 DAO 不跑主线程 |
| `SettingsRepository` | app process，DataStore-backed | theme、音量、repeat/shuffle、缓存上限、history/translation 开关和 feature flags | 不保存大集合、凭据或歌词正文；每个 DataStore 文件同进程只能有一个实例 |
| `SafFileRepository` | Activity Result + app process | 打开/创建 audio、directory、backup URI，持久化用户明确授予的 URI 权限，读取标签/LRC/备份 | 不接受原始 path 或任意 `file://`；不通过 bridge 读全盘 |
| `CacheRepository` + Media3 cache | app/service | 临时流缓存、完整性/容量/淘汰、离线命中与损坏清理 | WebView 只看 metadata；播放器用 CacheDataSource，不读取 cache directory 的裸文件 |
| `DownloadService` + `DownloadCoordinator` | foreground/data-sync service | 用户明确下载的可恢复任务、通知、暂停/取消、DownloadIndex 与 Room catalog reconciliation | 临时 cache 与永久下载目录分离；下载状态通过 repository 投影给 UI |
| shared JS adapter/projection | AngularJS WebView | 兼容现有 provider/controller surface，发送 intent、渲染 snapshot、处理 capability/error | 不存 auth/cache/playback 真相，不直接调用 axios 获取 Android 已承诺的 provider 能力 |

## 3. 单一真相与数据流

### 3.1 真相矩阵

| 领域 | 唯一可写 owner | 其他层只能看到 | 恢复策略 |
| --- | --- | --- | --- |
| 实时播放 | Media3 Player in `PlaybackService` | `PlaybackStateSnapshot`、系统 MediaSession、WebView projection | service 重建时从 Room checkpoint/queue ids 恢复；signed URL 重新解析，不能恢复旧 URL |
| base/play-next/shuffle/history | `QueueEngine` + `QueueRepository` | Media3 的 materialized playlist、WebView queue snapshot | 事务保存 queue version、current track id、history cursor；重复命令以 version/idempotency key 拒绝 |
| 歌单/收藏 | Room `Playlist*` tables | bridge snapshot/事件 | Room migration；备份导入在单事务中合并，冲突产生新 id，不覆盖本机 |
| provider session | `SessionVault`/adapter | `SessionStatus`（未登录、过期、网络未知、权限不足） | Keystore 可解密则 refresh；失败保留脱敏状态并要求重新登录 |
| settings | 一个 DataStore 文件/`SettingsRepository` | WebView settings projection | DataStore 原子 update；损坏回默认并记录非敏感错误 |
| lyrics/translation | Room lyric record + provider adapter | timed-line DTO、来源/匹配置信度、translation status | 按 track/content hash 复用；原文 hash 不同则丢弃旧译文 |
| cache/download | Room catalog 是用户可见真相；Media3 SimpleCache/DownloadIndex 只是执行索引 | cache/download metadata/progress | app/service 启动时校验 catalog 与 cache/index，孤儿临时文件删除，完整下载重新登记 |
| SAF local file | Android URI grant + Room `LocalTrack` | display metadata、opaque `localFileId` | grant 失效时标记 `permission_required`，要求重新选择，不猜测 path |
| WebView route/scroll/input | WebView/轻量 `SavedStateHandle` | UI 视图 | Activity recreate 使用受限 saved state；复杂数据从 Room 重新查询 |

### 3.2 搜索/详情/歌词

```text
Angular search intent
  → RPC provider.search(provider, query, page)
  → RpcDispatcher → ProviderGateway
  → ProviderAdapter builds approved HTTPS request
  → bounded transport + schema validation
  → normalized SearchPage (track/playlist DTO, no raw URL)
  → one result or bounded stream → Angular projection
```

详情、歌词和媒体解析复用同一 gateway，但 op 必须分开授权和限额。provider 的原始 JSON、Cookie、WBI/WeAPI key 和 `MediaLocator` 只在 native memory 中存在；错误仅包含稳定 error code、retryable、provider 和可选 HTTP 状态类别。

### 3.3 播放/恢复

```text
Angular play(trackId, queueContext)
  → RPC playback.load (opaque track id + queue version)
  → PlaybackGateway → MediaController → PlaybackService
  → QueueEngine checks context
  → ProviderGateway.resolveMedia (finite candidates, TTL, internal headers)
  → MediaItem + provider DataSource / CacheDataSource
  → ExoPlayer prepares and plays
  → Player.Listener + 250–500 ms position sampler
  → PlaybackStateRepository snapshot
  → visible WebView event stream + Android MediaSession notification
```

音频和下载内容不经过 WebMessage。网络断开时只尝试完整本地 cache；部分 cache 不得被冒充为完整离线资源。CDN candidate 失败必须有限重试、失效当前 locator 并回到 resolver，不得无限切歌或循环 fallback。

### 3.4 歌单、备份与本地音乐

Room transaction → `library.snapshot` → Angular renders. 用户点导入/导出时，WebView 只能请求 `file.pick`/`backup.import`/`backup.export`：

1. Activity 通过 SAF 获得明确的 `content://` URI 并持久化 grant。
2. native 以 `ContentResolver` bounded stream 读取/写入，不向 JS 返回 URI path 或 file handle。
3. `BackupCodec` 只接受版本化、白名单字段；导入做单次 Room transaction 和 conflict report。
4. 导出只包含歌单、收藏、稳定 track metadata 和格式版本；不包含 credentials、cookies、API keys、local paths、cache bytes、theme 或歌词设置。

## 4. 版本化 message RPC

### 4.1 Envelope

保留 `WebViewCompat.addWebMessageListener` 的 exact origin/frame 校验，但新增独立对象 `Listen2AndroidBridge` 和协议 v2。旧的 `Listen2AndroidHttp` v1 只能在迁移窗口保留为受限搜索兼容层；v2 稳定后删除，不能将 v1 扩大为通用 HTTP。

请求（示意，字段和大小需要在 contract test 中冻结）：

```json
{
  "version": 2,
  "pageInstanceId": "p-opaque-random",
  "requestId": "r-opaque-sequence",
  "op": "provider.search",
  "payload": {"provider": "bilibili", "query": "...", "page": 1},
  "stream": false
}
```

成功结果、事件和终止错误共用 envelope，`kind` 区分语义：

```json
{
  "version": 2,
  "pageInstanceId": "p-opaque-random",
  "requestId": "r-opaque-sequence",
  "kind": "result",
  "ok": true,
  "data": {"items": [], "total": 0, "capability": "provider.search"}
}
```

```json
{
  "version": 2,
  "pageInstanceId": "p-opaque-random",
  "subscriptionId": "playback",
  "kind": "event",
  "seq": 42,
  "data": {"stateVersion": 9, "state": "buffering", "trackId": "bitrack_v_..."}
}
```

```json
{
  "version": 2,
  "pageInstanceId": "p-opaque-random",
  "requestId": "r-opaque-sequence",
  "kind": "error",
  "ok": false,
  "error": {"code": "NETWORK_TIMEOUT", "retryable": true, "safeMessage": "网络请求超时"}
}
```

实现约束：

- JS 首次发送 `hello`；native 校验 `sourceOrigin`、`isMainFrame`、scheme/host/port 后回 `ready`（protocol version、capability matrix、session epoch）。`pageInstanceId` 是防旧页面事件串线的 epoch，不是认证凭据。
- 请求 ID、subscription ID、op、字符串和 JSON body 都有上限；当前 16 KiB message / 2 MiB response 的限制可作为基线，v2 对单个 chunk 使用较小上限（建议 64 KiB），总响应按 op 再限额。
- op 是静态 allow-list，例如 `capabilities.get`、`provider.search`、`provider.details`、`provider.lyrics`、`provider.resolveMedia`、`session.status/start/complete/logout`、`library.snapshot/mutate`、`playback.load/command/snapshot/subscribe`、`cache.snapshot/mutate`、`download.enqueue/cancel`、`backup.import/export`、`file.pickAudio/pickTree`、`translation.request`。不得出现 `http.get(url)`、`setCookie`、`setHeader` 或 `readFile(path)`。
- 所有结果都由 native schema validator 生成；未知版本、未知 op、未知字段、错误类型或过大 body 都返回可诊断错误，不降级为空结果。
- 订阅只在 WebView 可见时推送；恢复时先 `snapshot` 再按新 `seq` 接收事件。事件需携带 `stateVersion`/`seq`，旧事件静默丢弃。

### 4.2 取消、超时与 streaming

`RpcDispatcher` 为每个 page epoch 建立 `requestId → RpcCall`，其中包含 `Future`、transport cancellation handle、reply proxy、terminal-sent 标记。JS `AbortController` 超时后发送：

```json
{"version":2,"pageInstanceId":"p-...","requestId":"cancel-...","op":"rpc.cancel","payload":{"requestId":"r-..."}}
```

native 处理取消的顺序是：标记 terminal、`Future.cancel(true)`、中断 transport、发布单个 `CANCELLED` terminal response；任何竞态完成只可被丢弃。`HttpsURLConnection.disconnect()`、线程 interrupted 检查和 provider adapter 的有限等待必须由 transport 测试覆盖。Activity stop/destroy、renderer termination 和 page epoch 变化自动取消该页面的所有 in-flight calls。

Streaming 只用于有界 metadata、backup chunk 或进度/状态事件，不能传输音频和任意文件：

- `JavaScriptReplyProxy` 仅在 JS 先 post message 后可用于回传；native 通过主线程 `Handler` 安全投递，持有 proxy 的生命周期绑定 page epoch。
- 每块包含 `streamId`/`seq`/`eof`，最大 chunk、总字节数、event rate 和超时均有限；JS 只接受下一个序号，缺块即结束并显示 `STREAM_INVALID`。
- `WebMessageCompat.TYPE_ARRAY_BUFFER` 不用于大文件。官方 API 明确提示大 ArrayBuffer 可能在低端设备造成 OOM；下载和音频使用 Media3/ContentResolver 的 native stream。
- 若目标 WebView 对异步多次 `JavaScriptReplyProxy.postMessage` 的行为不一致，instrumentation test 必须先证明；否则退回“单次结果 + 可重新查询的 progress snapshot”，不发明任意 JS 注入通道。

## 5. Provider adapters、网络和 session vault

### 5.1 Provider contract

native adapter 的实现级接口可保持 Java `CompletableFuture`/callback 形状，以适配当前 Java host；取消 token 由 `RpcCall` 向下传递：

```text
ProviderAdapter {
  providerId()
  capabilities()
  search(SearchRequest, CancellationToken) -> SearchPage
  details(StableTrackId, CancellationToken) -> TrackDetails
  resolveMedia(StableTrackId, Quality, CancellationToken) -> MediaResolution
  lyrics(StableTrackId, LyricRequest, CancellationToken) -> LyricResult
  sessionStatus()/beginLogin()/finishLogin()/logout()
}
```

`ProviderGateway` 验证 `bitrack_`/`netrack_` 等 ID 前缀、页码、query、quality 和 queue context，adapter 再用自己的 `ProviderRequestPolicy` 构造 HTTPS URL。返回给共享前端的是当前 Listen1 track/playlist/lyric 字段和 capability status；`MediaResolution` 只在 native service 内流转：候选 URL、过期时间、MIME、content length hint 和 provider 内部 request metadata 不可序列化到 bridge/Room。

初始垂直切片仅承诺 Bilibili 和 NetEase：

| provider | 首阶段 native op | 路由策略 | 未覆盖时的 UI 行为 |
| --- | --- | --- | --- |
| Bilibili | search、view/part、media manifest、primary lyric、匿名 fingerprint；登录在后续切片 | 精确列出 `/x/web-interface/search/type`、view/player、audio service、fingerprint 等真实需要的 path/query；保留 HTTPS、无重定向和 bounded body | capability matrix 标记 `search_only`/`login_required`，不显示假播放按钮 |
| NetEase | search、song detail、media URL、primary lyric | 精确列出 search/details/lyric/player/login 所需 path/query；区分匿名可用和需要 Cookie 的 op | search 可用但 resolve/playlist/login 不可用时展示明确状态 |
| QQ/Kugou/Kuwo/Migu/Taihe | capability discovery 后逐 provider 接入 | 每个 provider 独立 host/path/query policy；KuGou 旧 HTTP 路由在 HTTPS 替代前保持 Android unsupported | 不让共享 provider 的 axios 直连绕过 native policy |
| Local Music | SAF import、tag/LRC、local playlist | 不走网络 policy；仅接收已授予的 URI | 未授予/失效时请求重新授权 |

错误分类至少包含 `AUTH_REQUIRED`、`AUTH_EXPIRED`、`PERMISSION_DENIED`、`NOT_FOUND`、`RATE_LIMITED`、`NETWORK_TIMEOUT`、`TLS_ERROR`、`HTTP_STATUS`、`SCHEMA_INVALID`、`UNSUPPORTED_MEDIA`、`OFFLINE_NOT_CACHED`、`CANCELLED`、`QUOTA_EXCEEDED`。错误日志只能记录 provider、op、非敏感状态码和 request correlation id；不得记录完整 URL query、Cookie、Authorization、signed URL 或歌词原文。

### 5.2 网络安全策略

- `HttpsURLConnection`（或等价 Android 平台 HTTPS transport）由 native adapter 使用，禁止 WebView caller 注入 header、Cookie、Referer、Origin、UA。需要 provider 特定 header 时由 adapter 的固定 policy 生成。
- URL 校验使用 scheme、精确 host、正常端口、精确 raw path、允许 query key/value、长度和数值边界；redirect 关闭。若 provider 返回新的 CDN candidate，必须在 native 再验证 host/path/TTL 后才交给 Media3。
- 保持 manifest 的 `usesCleartextTraffic="false"`，增加 `network_security_config.xml` 时只配置全局 cleartext deny，不为旧明文接口增加例外。KuGou 的 `http://mobilecdnbj.kugou.com` 必须降级/停用，而不是为了“修复”功能放宽明文。
- Bilibili 匿名 `buvid3` 继续只在内存中使用；native session Cookie 与 WebView `CookieManager` 分离。WebView 不被当作 provider 登录容器，也不接受任意 `document.cookie` 透传。
- 响应 body 有上限并校验 content length；媒体下载不走 bridge，使用 Media3 cache/download 的受控 stream、磁盘配额和取消。

### 5.3 SessionVault

`SessionVault` 使用 Android Keystore 中不可导出的 AES key（建议每 provider/account 一个 alias）加密小型 session record；record 可包含 provider、account id、Cookie/token ciphertext、expiry、refresh metadata 和 schema version。加密采用随机 IV、认证模式（如 AES-GCM）和 provider/account AAD；key/明文只在对应 adapter 的短生命周期内存在。

- Room 仅存 `SessionStatus`、provider、expiry 和 vault record id；DataStore 不存 secret；`BackupCodec` 明确排除 vault。
- login challenge/QR payload 如必须显示在 WebView，只传一次性、短期且无 refresh secret 的展示数据；轮询、Cookie 写入和刷新由 native adapter 完成。
- Keystore key 被系统锁屏/生物识别策略或升级失效时，返回 `AUTH_EXPIRED`/`REAUTH_REQUIRED`，不尝试导出或复制 key。
- DeepSeek key 复用 vault 边界；只有用户确认整曲歌词翻译后才执行请求，成功结果按 lyric hash 缓存，key 永不进入页面、日志或导出文件。

## 6. Media3 播放、service/session 和 UI playback state

### 6.1 Service 结构

新增 `PlaybackService extends MediaSessionService`：

1. `onCreate()` 创建单例 `ExoPlayer`，注入 provider-aware `MediaSource.Factory`/`CacheDataSource.Factory`，配置音乐 `AudioAttributes` 并启用自动 audio focus，然后创建 `MediaSession`。
2. `onGetSession()` 只返回该 session；`MediaSession.Callback.onConnect` 允许本 app、系统媒体控制和明确支持的可信 controller，未授权第三方只读或拒绝。
3. `Player.Listener` 把 `onPlaybackStateChanged`、`onIsPlayingChanged`、`onMediaItemTransition`、`onPlayerError` 转为 `PlaybackStateSnapshot`；position 没有持续 listener，使用 service handler 在播放/订阅期间定时采样。
4. `onDestroy()` 先持久化 queue/current/position checkpoint，再 release session/player/cache references。Media3 官方建议把 player/session 放在 service 中，以支持锁屏、媒体按键、系统控制和 Activity 独立生命周期。

Manifest 需要 `FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`、media playback service（`foregroundServiceType="mediaPlayback"`）和 `MediaButtonReceiver`；下载若采用 Media3 `DownloadService`，另加 `FOREGROUND_SERVICE_DATA_SYNC`、`POST_NOTIFICATIONS` 的产品/运行时权限流程。播放 notification 使用 Media3 自动生成的 MediaStyle metadata，不由 WebView 直接画锁屏控制。

Activity 在 `onStart()` 建立 `SessionToken`/`MediaController`，在 `onStop()` 移除 listener 并 release controller；这只断开 UI controller，不停止仍在播放的 service。通过 MediaController 调用 standard play/pause/seek/skip/volume，收藏/queue/cache 等应用行为走 bridge 的高层 op，再由 native gateway 发送对应 command。

### 6.2 QueueEngine 与播放行为

为了保持桌面和旧移动端可感知的行为，`QueueEngine` 是业务队列 owner，Media3 只执行 materialized order：

- `baseQueue`、`playNextQueue`、`playHistory`、`currentTrackId`、`repeatMode`、`shuffleCycle` 和 `queueVersion` 是可持久化模型。
- play-next 是允许重复条目的 FIFO；耗尽后返回原 base/shuffle context。shuffle 使用当前桌面的无立即重复、每轮一次、上一首沿真实历史返回规则，不直接依赖不可控的默认随机顺序。
- 每次 queue mutation 带 expected `queueVersion`，native 生成新 version 并将对应 Media3 playlist 物化；WebView 只显示响应，不在 JS 再维护一份可写 queue。
- resolver 只提前解析当前和有限的下一项；候选失败做有限尝试并发出 `PLAYBACK_FAILED`，不自动吞掉用户可恢复的 auth/permission/error。
- 有效听歌统计在 native 按向前 position 与 wall clock 采样，继承桌面“暂停/缓冲/拖动不计入”的语义；WebView 重建不会重复提交 session。

### 6.3 PlaybackStateSnapshot

建议字段：`stateVersion`、`trackId`、稳定 metadata、`playbackState`（idle/buffering/ready/playing/paused/error）、`isPlaying`、`positionMs`、`durationMs`、`bufferedPositionMs`、`queueVersion`、当前 queue ids、`playNextCount`、`repeatMode`、`shuffleEnabled`、`volume`、`errorCode`、`retryable`、`updatedAt`。不包含 signed URL、Cookie、内部 headers 或 resolver raw response。

状态流程：

```text
Player event/position sample
  → PlaybackStateReducer (monotonic stateVersion)
  → in-memory current snapshot
  ├─ MediaSession/notification (always as required)
  ├─ Activity MediaController (while started)
  └─ bridge subscription (only while WebView visible)
```

position checkpoint 只按 pause、track transition、service background 和有限周期写 Room；每个 250 ms position tick 不写数据库。lyrics UI 使用 snapshot position + 本地显示 timer 对齐 timed lines；歌词行本身由 `LyricRepository` 返回，不由 native 高频推送。

### 6.4 Audio focus、耳机和 codec 降级

ExoPlayer 配置 `AudioAttributes`/`handleAudioFocus=true`，响应 focus loss、becoming noisy、Bluetooth/headset 控制，并在不支持的 codec 或 provider MIME 上返回 `UNSUPPORTED_MEDIA`。Android 音效、真实频谱和响度分析属于后续切片：native Media3 输出后不能继续假设 WebView 的 Howler `MediaElementAudioSourceNode` 能观察同一音频；在原生分析未完成前，Android capability 必须显示“无频谱/无响度”或使用明确的低成本降级。

## 7. Room、DataStore、SAF、cache 和 download

### 7.1 Room schema

建议单一 `Listen2Database`（singleton，schema version + 手写 migration）包含：

- `TrackEntity(trackId PK, provider, title, artist, album, coverUri, durationMs, playable, updatedAt)`。
- `PlaylistEntity(playlistId PK, provider, title, coverUri, isFavorite, updatedAt)` 与 `PlaylistTrackEntity(playlistId, trackId, position, addedAt)`。
- `QueueEntryEntity(queueVersion, lane[base|next|history], position, trackId)` 与 `PlaybackCheckpointEntity(currentTrackId, positionMs, repeatMode, shuffleEnabled, queueVersion, updatedAt)`。
- `LyricEntity(trackId, source, lyricHash, timedLinesJson, translationJson, selected, offsetMs, updatedAt)`；只存 bounded、validated 内容，不存请求凭据。
- `ListeningSessionEntity(sessionId, trackId, startedAt, cumulativeForwardMs, qualified, finalizedAt)`。
- `CacheEntryEntity(cacheKey PK, trackId, kind[temp|download], state, bytes, contentHash, lastAccessAt, pinned, expiresAt)` 与 `DownloadEntryEntity(trackId PK, state, requestId, progress, errorCode, updatedAt)`。
- `LocalTrackEntity(localFileId PK, contentUri, treeUri, displayName, mimeType, size, modifiedAt, lrcUri/status)`；`contentUri` 是用户授予的 URI 字符串，不是未经授权的 path。

Room 是 library/lyrics/history/queue checkpoint/cache catalog 的业务真相。DAO 使用异步 query；Java 路径可用 AndroidX `LiveData` 观察、app executor 做 one-shot，或在已批准依赖后使用 Room RxJava 3 adapter。数据库 singleton、DAO 不泄漏数据库细节、migration/DAO 在设备上测试；禁止 `fallbackToDestructiveMigration()` 丢用户歌单。

### 7.2 DataStore

`SettingsRepository` 用一个受控 DataStore 文件保存小型不可变设置：theme、volume、repeat/shuffle、cache enabled/max bytes、history enabled、translation enabled、locale、feature flags、last route。大集合、关系和部分更新放 Room，不放 DataStore。

当前 host 是 Java；实现可采用官方 `datastore-preferences-rxjava3` adapter，或增加很薄的 Kotlin façade（只暴露 Java callback/immutable settings），二选一后锁定依赖，不让 AngularJS 直接读 DataStore 文件。必须遵守“同一进程每个文件只创建一个 DataStore 实例”；如未来开启 OS backup，把普通 settings 与 secure state 分文件并显式排除后者。当前 manifest `allowBackup=false` 继续保留，用户导出备份仍走 SAF 和应用格式。

### 7.3 SAF / local music

- audio 单文件：`ACTION_OPEN_DOCUMENT` + `CATEGORY_OPENABLE` + `audio/*`，保存 `content://` URI 和 `takePersistableUriPermission` 的实际 flags。
- 目录导入：`ACTION_OPEN_DOCUMENT_TREE`，只遍历用户选定 tree；相邻 LRC 只有在同一有权限的 tree/document provider 可读时才尝试。
- 备份导入/导出：`ACTION_OPEN_DOCUMENT`/`ACTION_CREATE_DOCUMENT`，bounded UTF-8 stream，校验 schema/version/size 后 Room transaction。
- native 播放 local track 时使用 `ContentResolver.openFileDescriptor`/Media3 `content://`，不把 path、fd 或 provider token 序列化给 JS。grant 失效、文件被移动/删除或 provider 拒绝时显示 `PERMISSION_REQUIRED`/`FILE_NOT_FOUND` 并允许重新选择。
- 默认不申请全盘存储权限；若产品未来选择从 MediaStore 浏览其他应用音频，单独评估 `READ_MEDIA_AUDIO` 和 capability，不把它混入 SAF 默认路径。

### 7.4 Cache/download 目录和完整性

使用 app-private dedicated directories，例如 `filesDir/media-cache-v2` 与 `filesDir/media-download-v2`，不暴露给 WebView；临时 cache 可用 Media3 `SimpleCache` + LRU evictor，下载 cache 使用 `NoOpCacheEvictor`。同一 `SimpleCache` directory 只能有一个实例，清理必须调用 Media3 的 delete/release API，不能直接删目录。

- 在线播放使用 `CacheDataSource.Factory`：命中完整 cache 即离线播放；未命中时从 native `MediaLocator` upstream 读取并按策略写入临时 cache。
- 用户下载使用 Media3 `DownloadService`/`DownloadManager`/`DownloadIndex`，`DownloadCoordinator` 将 transfer state reconciliation 到 Room `DownloadEntry`；UI 不直接查询 DownloadIndex。
- `.part`/hole span 只有在 Media3 commit、长度/媒体可读性和可用 hash（若 provider 提供）校验成功后才变成 `complete`；崩溃/取消/超额产生的 partial state 必须可清理。
- 临时 cache 参与 LRU/上限；明确下载默认 pinned、用户取消/删除才移除。任何 `contentLength`/hash 不可信时，不把“下载完”仅凭 HTTP 200 认定为完整。
- Download service 需要网络约束、有限重试、暂停/取消和 target 33+ notification 流程；不因为后台限制把无限网络重试塞进 bridge。

## 8. WebView lifecycle 与 Angular projection

`MainActivity` 建议迁移到 AndroidX `ComponentActivity`（保留 Views，不要求 Compose），将当前手写 host 抽成 `WebViewHost`：

1. `onCreate`: 建立 asset loader、safe WebView settings、system bar insets、`WebViewClientCompat`、`AndroidRpcBridge`，仅加载 packaged start URL；若有受限 saved state，先用 `WebViewCompat.saveState/restoreState`，不把大对象塞入 Bundle。
2. `onStart`: 建立 MediaController、请求 `capabilities.get`、订阅 playback/library/cache projection；bridge `hello` 创建新的 `pageInstanceId`。
3. `onStop`: 取消 page-scoped RPC、取消 UI subscriptions、release MediaController、`webView.onPause()`；不停止 `PlaybackService`、下载或 Room。
4. `onSaveInstanceState`: 只保存小型 route/scroll/input key 和受限 WebView navigation state；搜索结果、queue、歌词和 playback 从 native snapshot/Room 重建。官方文档指出 saved state 有严格大小上限，不能把大 JSON/音频塞进去。
5. `onRenderProcessGone`: 按官方 Termination Handling API 从 parent remove、destroy 旧 WebView、创建新实例；播放继续，由新页面 handshake + snapshot 重放。不要复用 renderer 已死亡的 WebView。
6. `onDestroy`: remove bridge listener、cancel all calls、stopLoading、remove parent、clear history where policy allows、destroy WebView、清空 Activity refs；避免 `JavaScriptReplyProxy`/listener 反持有 Activity。
7. `onLowMemory`: 记录脱敏诊断、降低 renderer priority only when termination handler exists；可销毁/重建 WebView，不能动 service-owned playback/cache。

AngularJS 只做 projection：`android_bridge.js` 负责 promise/abort/event sequencing，`loweb.js` 负责能力 façade，`player_thread.js`/`l1_player.js` 在 Android mode 下转为 native backend façade，`play.js` 负责渲染和用户意图。保留 `isElectron()` 桌面路径；Android 分支不得调用 `require('electron')`、Howler 或 raw axios 对已承诺的 native provider op。初期可保留 desktop Howler 代码用于 Electron/Browser，但 Android capability 开启后必须只有 native playback writer。

## 9. 现有文件修改与新增文件

下表是实现阶段的明确落点；本研究阶段不修改这些产品文件。

### 9.1 现有文件

| 文件 | 建议修改 | 首次出现阶段 |
| --- | --- | --- |
| `android/app/build.gradle` | 添加 Media3 (`media3-exoplayer`/`media3-session`/cache/download)、Room runtime/compiler、DataStore Java façade/adapter、Lifecycle/Activity、WorkManager（若用于 cache warm）、instrumentation test 依赖；继续 explicit shared asset allow-list | P1 |
| `android/app/src/main/AndroidManifest.xml` | 声明 playback/download foreground permissions、`PlaybackService`、可选 `DownloadService`、media button receiver、notification policy；不加 cleartext 或全盘存储放宽 | P1/P3 |
| `android/app/src/main/java/.../MainActivity.java` | 改为 lifecycle-aware host，注入 composition root、WebViewHost、MediaController、SAF Activity Results、saved/renderer state；保留导航 allow-list和外部浏览器策略 | P1/P3/P4 |
| `android/app/src/main/java/.../AndroidHttpBridge.java` | 迁移为 `AndroidRpcBridge` 的兼容薄层，v1 只读搜索并可观测；禁止继续添加通用 URL/headers/cookies | P1→P2 移除 |
| `android/app/src/main/java/.../HttpBridgePolicy.java` | 拆为 `BridgePolicy`（origin/envelope/size）和 `ProviderRequestPolicy`（provider host/path/query）；保留纯 Java 测试入口 | P1 |
| `android/app/src/main/java/.../NavigationPolicy.java` | 继续精确 appassets/external scheme 规则；补 renderer recovery 和 intent 安全测试 | P1/P6 |
| `android/app/src/main/res/values/*` | 增加 notification/loading/permission/error strings；不放 secrets 或 provider tokens | P3 |
| `android/app/src/main/res/xml/network_security_config.xml`（新增后在 manifest 引用） | base cleartext deny；不为旧 HTTP provider 配例外 | P1 |
| `android/README.md` | 每个 parity slice 完成且 E2E 证据存在后更新 scope；不能提前宣称完整平价 | P6 |
| `app/listen1_chrome_extension/listen1.html` | 按固定顺序加入 `android_bridge.js`（如新增），保持 vendor/provider/player/controller 全局依赖顺序 | P1/P2 |
| `app/listen1_chrome_extension/js/lowebutil.js` | 将 v1 GET adapter 迁移为 v2 handshake/call/abort/stream client；保留 browser/Electron fallback；不暴露 URL bridge | P1→P2 |
| `app/listen1_chrome_extension/js/loweb.js` | 加入 capability discovery、native provider/library/session/playback/cache façade；desktop IPC 分支不变 | P1/P2 |
| `app/listen1_chrome_extension/js/provider/bilibili.js`、`netease.js` | Android mode 调高层 native ops，复用 normalization 但不再让 provider 直连 Android 已承诺路径；保留 Electron path | P2 |
| `app/listen1_chrome_extension/js/player_thread.js`、`l1_player.js` | 加 Android native backend/projection compatibility；禁用 Android Howler writer，保留 desktop/browser implementation | P2/P3 |
| `app/listen1_chrome_extension/js/controller/play.js` | 使用 playback/lyric snapshot、capability/error state；把桌面浮窗、Electron IPC、Web Audio 控件做 Android 等价或隐藏 | P2/P5 |
| `app/listen1_chrome_extension/js/playlist_backup.js` | 冻结白名单、版本和 merge/conflict semantics；native `BackupCodec` 用相同 fixture，不把 credentials/local paths 加回来 | P4 |
| `app/listen1_chrome_extension/test/*` | 增加 RPC envelope/cancel/stream、native projection、capability matrix、provider DTO 和 race tests；现有 desktop tests 继续运行 | 每阶段 |
| `.github/workflows/android-apk.yml` | 只在任务/依赖确实改变后更新测试命令；不把 APK assemble 当作 E2E 或 provider 验证 | P6 |

### 9.2 新增 native source

建议按职责分包，避免把 `MainActivity` 变成新的单体：

```text
android/app/src/main/java/com/dazzlingwuming/listen2/
  Listen2Application.java
  bridge/
    AndroidRpcBridge.java
    RpcDispatcher.java
    RpcEnvelope.java
    RpcError.java
    BridgeSession.java
  provider/
    ProviderAdapter.java
    ProviderGateway.java
    ProviderRequestPolicy.java
    ProviderTransport.java
    ProviderError.java
    MediaLocator.java
    BilibiliProviderAdapter.java
    NetEaseProviderAdapter.java
    LocalMusicAdapter.java
  session/
    SessionVault.java
    SessionRepository.java
    SessionRecord.java
  playback/
    PlaybackService.java
    PlaybackGateway.java
    PlaybackCoordinator.java
    QueueEngine.java
    PlaybackStateSnapshot.java
    PlaybackStateRepository.java
  data/
    Listen2Database.java
    entity/*.java
    dao/*.java
    repository/LibraryRepository.java
    repository/LyricRepository.java
    repository/HistoryRepository.java
    repository/CacheRepository.java
    repository/DownloadRepository.java
    SettingsRepository.java
  files/
    SafFileRepository.java
    BackupCodec.java
    LocalTrackRepository.java
    CacheKeyPolicy.java
    DownloadCoordinator.java
    Listen2DownloadService.java
  ui/
    WebViewHost.java
    PlaybackControllerConnection.java
```

测试对应放置：纯校验在 `android/app/src/test/java/...`；Keystore、Room migration、WebView listener、MediaController、SAF grant、service/notification、renderer recovery 在 `android/app/src/androidTest/java/...`。新增 `android_bridge.js` 时更新 `android/app/build.gradle` allow-list和前端 test fixture；绝不手工改 generated assets。

## 10. 测试分层与验收证据

| 层 | 目标 | 必须覆盖 |
| --- | --- | --- |
| shared JS Node contract | 不依赖 Android runtime 验证 page client | v2 schema、origin/epoch 交接、Promise/AbortController、timeout/cancel、chunk seq、Angular digest、capability-driven UI、旧 v1 fallback |
| JVM pure Java | 快速验证安全和领域不变量 | `BridgePolicyTest`、`RpcCodecTest`、provider URL/path/query policy、track ID/quality validation、error redaction、QueueEngine shuffle/FIFO/history、BackupCodec fixtures、CacheKeyPolicy |
| JVM repository with fakes | 验证 app/service orchestration | fake transport/provider、cancellation propagation、Room repository transaction boundaries、session state machine、cache reconciliation |
| Android instrumentation | 验证真实 platform contract | WebViewAssetLoader origin、WebMessageListener reply/stream/cancel、Activity recreate/save size、`onRenderProcessGone` recovery、Keystore encrypt/decrypt/invalidation、Room DAO/migrations、SAF persisted grants、MediaController ↔ `PlaybackService`、audio focus/noisy、DownloadService notification/requirements |
| emulator E2E | 验证用户旅程和生命周期 | cold start → Bilibili/NetEase search → details → play → primary lyrics；screen off/lock/headset/notification；rotation/renderer kill/process reclaim；offline complete cache；SAF local audio/LRC；backup merge/conflict；download pause/resume/cancel；网络/TLS/auth/permission errors |
| release-like/security/perf | 验证 APK 边界而非仅 build | debug/minified asset allow-list、no cleartext、no secrets in APK/log/export、signature check、startup/first result/first audible metrics、RSS/renderer OOM、disk quota、battery/network budget |

E2E 真实 provider、真实登录、CDN codec、后台进程回收和 release signing 目前均是 `not verified`；JVM test、HTTP 200 或 APK assemble 不能替代模拟器证据。Room migration 优先设备测试；WebView renderer killed 后必须重新创建实例；播放恢复必须用 stable ids + local metadata，不能依赖过期 signed URL。

## 11. Phased build order

每阶段有明确 gate；前一阶段的协议/真相未通过测试，不扩大 provider 或用户数据范围。

### P0 — 冻结 capability matrix 与 contract（无产品代码）

- 将每个平台的 `search/details/media/lyrics/session/library/cache/download/local` 能力、权限前提、error/降级和证据写成 machine-readable fixture。
- 冻结 v2 envelope、op allow-list、大小/超时/取消/streaming 规则、normalized DTO、Room 初版 schema、备份白名单和 threat model。
- 以当前桌面 `loweb.js`、provider methods、`player_thread.js`、`playlist_backup.js` 和旧 mobile fixtures 写 contract tests；不把旧 RN runtime 引入 Android。

### P1 — native foundation（bridge + persistence skeleton）

- 建 composition root、BridgePolicy/ProviderRequestPolicy、v2 handshake/cancel/one-shot result，扩展 origin/frame/schema tests。
- 建 Room/DataStore/SessionVault interfaces 和 migration skeleton；只保存非敏感 fixture，验证 Keystore path 和 DataStore singleton。
- 保留 v1 search adapter 作为短期 fallback，记录 capability，不改变 Android 用户可见承诺。

Gate：纯 Java + shared JS + WebView instrumentation 对 origin、stale page、cancel、oversize、redaction 全绿；没有任意 URL/header/cookie fallback。

### P2 — Bilibili/NetEase vertical slice：search → details → foreground play → primary lyrics

- 先接 Bilibili/NetEase native adapters 和精确 route policy；保留当前 provider normalization 语义。
- 实现 `PlaybackService`、`MediaController`、Media3 stream/cache data source；Android mode 的 JS 只发 track id/intent，Howler 不再写真实播放。
- 先做 primary lyric/source marker；跨 provider lyric fallback 和 DeepSeek 放后续切片，但 UI 显示明确 unsupported/failed 状态。

Gate：隔离 emulator fixture/测试账号能完成首搜、首播、暂停/seek/错误恢复和 lyric snapshot；网络/TLS/auth/permission 失败可区分。

### P3 — 后台播放、队列和生命周期恢复

- `MediaSessionService` manifest/notification/media button/audio focus/noisy；QueueEngine 接管 shuffle、play-next、previous/history。
- Activity controller onStart/onStop；Room checkpoint + Media3 playback resumption；WebView save/restore、renderer termination、低内存重建。
- 将有效听歌历史采样从 `player_thread.js` 移至 service，避免页面重建重复计数。

Gate：屏幕关闭/锁屏/耳机/蓝牙、旋转、进程回收后播放和队列行为有模拟器证据；service 不依赖 WebView。

### P4 — Room domain、SAF、本地音乐、cache/download、backup

- 迁移歌单/收藏/歌词/history/queue 到 Room，设置到 DataStore；Angular 只渲染 snapshots。
- SAF audio/tree/backup Activity Results、URI grant、标签/LRC、失效授权恢复；BackupCodec 兼容旧 mobile + 当前桌面白名单，事务 merge/conflict。
- 分离临时 LRU cache 与用户 download cache，接入 Media3 `CacheDataSource`/`DownloadService`，进度/取消/配额/损坏恢复。

Gate：断网完整 cache 播放、下载暂停恢复、容量淘汰不删除 pinned、文件 permission revoke、备份导入冲突均可重现且不泄露路径/凭据。

### P5 — session/login、fallback/translation、provider expansion、Android UX parity

- Bilibili QR/session refresh、NetEase/其他已批准登录流程；SessionStatus 与 UI 区分未登录/过期/网络/权限。
- 跨源歌词 fallback、用户确认 DeepSeek translation、content hash cache；key 只在 vault。
- 逐 provider 扩大 capability matrix；QQ/Kugou/Kuwo/Migu/Taihe 仅在 HTTPS、policy、adapter 和 E2E 证据齐备后启用。
- Android 等价通知/底部播放面板/歌词；对桌面浮窗、托盘、Electron Web Audio/effects 给出明确降级，不显示不可用控件。

Gate：每个新增 capability 具备 contract + instrumentation + emulator evidence，真实权限/会员受限时保持诚实失败。

### P6 — hardening、性能和移除迁移兼容

- debug/minified APK asset/manifest/signature/security 检查、性能/内存/电量测量、外部 navigation 和 backup privacy audit。
- 在至少一个稳定周期的 v2 证据后移除 `Listen2AndroidHttp` v1、Android Howler writer 和未使用 Electron fallback；更新 `android/README.md`、capability matrix 和 DoD 证据。
- 未验证的真实 provider/登录/device codec/release signing 保持显式标记；不因 CI assemble 通过而关闭未完成项。

## 12. 官方一手资料、信心与未决验证

### 官方 Android/AndroidX 资料

- [Media3 background playback with `MediaSessionService`](https://developer.android.com/media/media3/session/background-playback)：service 中创建 player/session、foreground permissions、notification、controller 和 playback resumption。
- [Media3 Player interface and architecture](https://developer.android.com/media/media3/session/player) 与 [connect to a media app with `MediaController`](https://developer.android.com/media/media3/session/connect-to-media-app)：Player/MediaController 的队列、position、controller lifecycle 和 Activity/service 边界。
- [Media3 player events](https://developer.android.com/media/media3/exoplayer/listening-to-player-events) 与 [audio focus](https://developer.android.com/media/optimize/audio-focus)：事件监听、position 需定时查询、自动 audio focus。
- [Media3 downloading media](https://developer.android.com/media/media3/exoplayer/downloading-media)、[`CacheDataSource`](https://developer.android.com/reference/androidx/media3/datasource/cache/CacheDataSource) 和 [`SimpleCache`](https://developer.android.com/reference/androidx/media3/datasource/cache/SimpleCache)：`DownloadService`/`DownloadManager`/`DownloadIndex`、cache playback、dedicated directory 和不可直接读 download files 的边界。
- [Load in-app content with `WebViewAssetLoader`](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[`WebViewCompat.addWebMessageListener`](https://developer.android.com/reference/androidx/webkit/WebViewCompat)、[`JavaScriptReplyProxy`](https://developer.android.com/reference/androidx/webkit/JavaScriptReplyProxy)：固定 HTTPS asset origin、origin rules、reply proxy 和大 ArrayBuffer OOM 提示。
- [Manage WebView objects](https://developer.android.com/develop/ui/views/layout/webapps/managing-webview)、[handle WebView renderer termination](https://developer.android.com/develop/ui/views/layout/webapps/handle-termination)：save/restore size boundary、remove/destroy、`onRenderProcessGone` 重建和内存策略。
- [Room](https://developer.android.com/training/data-storage/room)、[Room asynchronous queries](https://developer.android.com/training/data-storage/room/async-queries) 和 [Room database testing/migrations](https://developer.android.com/training/data-storage/room/testing-db)：entity/DAO/database、非主线程 query、设备 migration/DAO tests。
- [DataStore](https://developer.android.com/topic/libraries/architecture/datastore)：小型 key/value/typed state、Flow/transactional update、Room vs DataStore 和单例限制；Java 工程使用官方 RxJava adapter 或薄 façade。
- [Storage Access Framework documents/files](https://developer.android.com/training/data-storage/shared/documents-files)：`ACTION_OPEN_DOCUMENT`/`ACTION_OPEN_DOCUMENT_TREE`/`ACTION_CREATE_DOCUMENT`、URI grant 和 `takePersistableUriPermission`。
- [Android Keystore system](https://developer.android.com/privacy-and-security/keystore) 与 [`KeyGenParameterSpec`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec)：不可导出 key、用途限制、AES/GCM 配置和失效处理。
- [Network Security Configuration](https://developer.android.com/privacy-and-security/security-config) 与 [cleartext communications](https://developer.android.com/privacy-and-security/risks/cleartext-communications)：全局 cleartext deny、TLS trust 和不为旧接口放宽明文。
- [WorkManager persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent)：只有需要跨 app/reboot 持续的 cache warm 或协调任务才使用；Media3 download service 仍是下载执行 owner。

### Listen1 一手源码资料

- [listen1_mobile `client.js` at v0.8.2](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/api/client.js)：provider ID 前缀和 search/playlist/bootstrap contract。
- [listen1_mobile `player.reducer.js` at v0.8.2](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/redux/player.reducer.js)：play mode、track list、shuffle/skip 行为和持久化排除项。
- [listen1_mobile `background-player.screen.js` at v0.8.2](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/views/player/background-player.screen.js)：旧移动端 progress、media controls、audio focus/noisy 行为参考。
- [listen1_mobile `state-json-convert.js` at v0.8.2](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/modules/state-json-convert.js)：旧备份字段和 playlist merge fixture 参考；不是当前安全格式的唯一 authority。

### 信心与必须实测项

- **高信心**：仓库当前边界和 file placement；官方 Media3 service/session/controller、Room/DataStore、SAF、Keystore、WebView origin/lifecycle API 的职责与限制；“native owns playback/secrets/files，WebView projects state”的单一真相分层。
- **中信心**：Media3 `CacheDataSource` 与各 provider signed candidate/header 的组合、Android API 26–35 codec 行为、Media3 DownloadIndex 与 Room catalog reconciliation。需用 fake transport、instrumentation 和 emulator 验证。
- **低/未验证**：Bilibili/NetEase 当前线上 API、WBI/WeAPI、登录/refresh、CDN 可用性、真实账号权限、WebView provider cookie 行为、异步多次 `JavaScriptReplyProxy` stream 在所有 WebView 版本上的一致性、低端设备 RSS/电量。它们不能由静态 source mapping、HTTP 200、JVM tests 或 APK assemble 推断。

实现过程中若这些验证推翻 provider 路由或平台能力，应将 capability 标为 `blocked`/`degraded`/`not verified`，保留证据并停在对应阶段，而不是放宽 allow-list 或复制旧 RN runtime。
