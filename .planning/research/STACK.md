# Android 等价实现：平台栈研究

> 研究日期：2026-08-30（Asia/Shanghai）<br>
> 研究类型：subsequent milestone / Android 平台等价实现<br>
> 范围：保留现有 AngularJS WebView 共享前端和 Java host，仅研究原生 Android 播放、持久化、文件、后台任务和安全边界<br>
> 证据范围：Android 官方文档、AndroidX 官方 release notes、Google Maven、当前仓库以及 `listen1/listen1_mobile` 官方仓库<br>
> 状态：版本/契约研究完成；候选依赖尚未在本仓库实际编译、真机播放或端到端 provider 上验证

## 结论摘要

建议把 Android 端做成“WebView 表现层 + Java typed bridge + Media3 播放服务”的分层，而不是把 AngularJS 播放器继续当作音频引擎：

```text
AngularJS WebView
        │ 受限、版本化的 play/pause/seek/queue/state 协议
        ▼
Java host（provider resolver、权限、URI、错误分类）
        ▼
MediaSessionService + ExoPlayer/Media3
        ├── MediaSession / 系统通知 / 锁屏 / 耳机 / Assistant
        ├── Media3 Cache / DownloadService（播放缓存与明确下载分开）
        └── Room（产品索引）+ DataStore（小型非敏感设置）

SAF URI ── ContentResolver ──┘       WorkManager ── 清理、修复、非紧急同步
```

在现有 `compileSdk 35` 下，Media3 最新稳定线不能直接采用：Google Maven 中 1.10.1/1.11.0 AAR 的 `minCompileSdk` 为 36。当前工具链可采用的 Media3 上限候选是 `1.9.4`（逐个核验的 AAR `minCompileSdk=35`、manifest `minSdk=23`）。这不是“永远锁死 1.9.4”：后续若为上架而升级到 API 36，应重新研究并升级 Media3。

`compile/target 35 + minSdk 26 + JDK 17 + AGP 8.8.2` 本身是官方兼容组合；但 Android/Google Play 的 target API 政策从 2026-08-31 起要求新应用和更新面向 API 36。因而本研究只判断“当前构建栈是否兼容”，不把 target 35 说成可持续的上架方案；API 36 的 AGP/Gradle/JDK/依赖组合应作为下一 phase 的显式研究项。

## 已知基线与行为契约

- 当前仓库的 `android/app` 已使用 AGP `8.8.2`、`compileSdk 35`、`targetSdk 35`、`minSdk 26`，Java source/target `17`，现有 AndroidX 依赖只有 `androidx.webkit:webkit:1.12.1`。
- WebView 通过 `WebViewAssetLoader` 的 `https://appassets.androidplatform.net/assets/...` 加载共享 AngularJS 1.8.2；现有 `Listen2AndroidHttp` bridge 是窄 allow-list HTTPS GET，不应被扩展成任意 URL、任意 header、cookie 或文件路径通道。
- 桌面方向已有 provider bootstrap、临时缓存/显式下载、播放队列、歌词与历史等契约；这些是 host/service 的业务输入，不应由 WebView 任意决定 URI、鉴权 header 或本地路径。
- `listen1/listen1_mobile` v0.8.2 是行为/迁移参考：旧 RN 播放器有 LOOP、SHUFFLE、REPEAT_ONE、queue/current/volume、耳机与 audio-focus 事件及 `bootstrapTrack`；其 `react-native-video`、`react-native-music-control`、React Native 0.59 不能作为本实现的依赖。

官方参考：[当前仓库 Android README](../../android/README.md)、[官方 listen1_mobile API client](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/api/client.js)、[旧播放器 reducer](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/redux/player.reducer.js)、[旧后台播放器](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/views/player/background-player.screen.js)。

## 版本兼容矩阵

| 能力 | 建议版本/方式 | 官方可核验的兼容事实 | 对当前栈结论 | 信心 |
|---|---|---|---|---|
| Android 构建 | AGP `8.8.2`；Gradle `8.10.2`；Build Tools `35.0.0`；JDK `17`；compile/target `35` | [AGP 8.8 release notes](https://developer.android.com/build/releases/agp-8-8-0-release-notes) 给出 API 35、Gradle 8.10.2、Build Tools 35.0.0、JDK 17 的组合；[JDK 文档](https://developer.android.com/build/jdks) 要求 AGP 8.x 使用 JDK 17 | 构建兼容；不是解决 2026-08-31 起 API 36 上架要求的方案 | 高 |
| 播放核心 | `androidx.media3:media3-exoplayer:1.9.4` + `media3-session:1.9.4` | [Media3 release notes](https://developer.android.com/jetpack/androidx/releases/media3)；Google Maven 的 1.9.4 AAR 元数据逐项为 `minCompileSdk=35`、manifest `minSdk=23` | 当前 compile 35 可作为首选候选；需本地 build、音频焦点、进程重启和设备测试 | 高（版本门槛）；运行行为待验证 |
| Media3 最新线 | `1.11.0`（Google Maven/release notes 当前最新稳定线） | `media3-exoplayer/session/datasource/ui` 1.11.0 AAR 元数据为 `minCompileSdk=36` | **不要在 compile 35 中引入**；待 API 36 toolchain phase | 高 |
| 播放缓存/下载 | Media3 `media3-datasource:1.9.4`、`media3-database:1.9.4`；需要时 `media3-exoplayer-dash/hls:1.9.4` | [Network stacks](https://developer.android.com/media/media3/exoplayer/network-stacks)、[Downloading media](https://developer.android.com/media/media3/exoplayer/downloading-media)；同一版本的 AAR 元数据兼容门槛同上 | 可与 Media3 1.9.4 同步；DASH/HLS 只有 provider 契约明确要求时添加 | 高（模块职责）；provider 实测待验证 |
| 后台可重试任务 | `androidx.work:work-runtime:2.11.2`；测试用 `work-testing:2.11.2` | [Work release notes](https://developer.android.com/jetpack/androidx/releases/work)；2.11.2 AAR `minCompileSdk=35`、manifest `minSdk=23`、`minAndroidGradlePluginVersion=8.6.0` | compile 35/min 26/JDK 17 满足已核验门槛；仅做可延迟任务 | 高 |
| 产品数据库 | `androidx.room:room-runtime:2.8.4` + `room-compiler:2.8.4`（Java `annotationProcessor`） | [Room release notes](https://developer.android.com/jetpack/androidx/releases/room)、[Google Maven metadata](https://dl.google.com/dl/android/maven2/androidx/room/room-runtime/maven-metadata.xml)；2.8.x manifest `minSdk=23`，官方给出 Java annotation processor | min 26 满足；Room AAR 未提供可用的 `minCompileSdk` 字段，必须在 phase 中实际 compile/migration test，不能把本行当作已建构证明 | 中高 |
| 小型设置 | `androidx.datastore:datastore-preferences:1.2.1`；Java 的 `datastore-guava:1.2.1` 仅为待核验候选 | [DataStore release notes](https://developer.android.com/jetpack/androidx/releases/datastore) 的 stable 1.2.1；[Google Maven metadata](https://dl.google.com/dl/android/maven2/androidx/datastore/datastore-preferences/maven-metadata.xml)；Preferences AAR manifest `minSdk=23` | min 26 满足；compile 门槛和 Guava artifact 的当前 resolve/API 需 phase spike。若设置面很小，可暂缓引入 | 中 |
| 加密 | 首选平台 Android Keystore + `KeyGenParameterSpec`（API 23+）；不新增 security-crypto | [Keystore](https://developer.android.com/privacy-and-security/keystore)、[KeyGenParameterSpec](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec)；`security-crypto:1.1.0` 虽 minCompile 34/minSdk 21，但官方已声明 API 全部 deprecated | 平台 API 与 min 26 兼容；不用已 deprecated 的新封装 | 高 |
| WebView | 将现有 `androidx.webkit:1.12.1` 研究升级至 stable `1.17.0` | [WebKit release notes](https://developer.android.com/jetpack/androidx/releases/webkit)、[Google Maven metadata](https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/maven-metadata.xml)；1.17.0 AAR `minCompileSdk=33`、manifest `minSdk=24` | compile 35/min 26 可用；升级前要测系统 WebView provider、渲染进程退出和 bridge | 高（版本门槛）；回归待验证 |
| 用户本地文件 | 平台 SAF + `ContentResolver`，无额外库 | [Documents and files](https://developer.android.com/training/data-storage/shared/documents-files)、[App-specific storage](https://developer.android.com/training/data-storage/app-specific) | API 26+ 可用；不扫描裸路径，不默认申请广泛存储权限 | 高 |

### 候选 Gradle 坐标（仅供 phase 计划，不是本轮产品改动）

```groovy
def media3Version = "1.9.4"
def workVersion = "2.11.2"
def roomVersion = "2.8.4"
def dataStoreVersion = "1.2.1"

implementation "androidx.media3:media3-exoplayer:${media3Version}"
implementation "androidx.media3:media3-session:${media3Version}"
// 只有使用对应能力时才加：media3-datasource、media3-database、exoplayer-dash、exoplayer-hls
implementation "androidx.work:work-runtime:${workVersion}"
implementation "androidx.room:room-runtime:${roomVersion}"
annotationProcessor "androidx.room:room-compiler:${roomVersion}"
// DataStore 为可选项；仅在 Google Maven resolve + Java API spike 通过后再加 datastore-guava
implementation "androidx.datastore:datastore-preferences:${dataStoreVersion}"
implementation "androidx.datastore:datastore-guava:${dataStoreVersion}"
```

以上不是“全部必装”：WebView UI 不需要 `media3-ui`；Java host 不需要 `room-ktx`、`work-runtime-ktx`、KSP/KAPT 或 Kotlin 插件。Room/DataStore 的 compile 和 Java 互操作仍需 phase 内以当前 Gradle wrapper 实建一次，不能仅凭坐标宣称通过。

## 播放核心：Media3 + MediaSessionService

### 推荐集成

1. 新增一个 `PlaybackService extends MediaSessionService`。在 `onCreate()` 创建单例生命周期内的 ExoPlayer 和 MediaSession，在 `onDestroy()` 释放；服务是播放队列、当前 `MediaItem`、音频焦点、noisy、resume position 的唯一 owner。
2. Activity 只负责 WebView 可见性和 typed bridge；bridge 将 `prepare/play/pause/seek/next/previous/setMode/setVolume` 转成受校验的 Java 命令，再经 `MediaController`/服务 facade 执行。服务把不可变状态快照回传给 WebView；外部控制器不依赖 WebView 是否存在。
3. 为服务声明 `FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`，以及 `android:foregroundServiceType="mediaPlayback"`；使用官方 `androidx.media3.session.MediaSessionService` action。为让系统/外部 controller 发现它，按官方示例显式处理 `exported` 和 intent-filter，不依赖默认值；再在 callback 层做命令 allow-list。API 33+ 的系统媒体控件从 session metadata/playback state 生成，Media3 可负责媒体通知。
4. `MediaSessionService` 可被 Assistant、系统控件、耳机和 Wear OS 发现/控制。实现 `MediaSession.Callback` 的连接和命令校验，只暴露必要的播放控制；不要把任意 WebView 字符串直接变成 `MediaItem` URI/header。
5. 如需系统内容浏览、Android Auto 目录或跨应用 browse，再评估 `MediaLibraryService`；当前共享 WebView 播放器的第一 slice 不需要为了“可能以后用到”引入它。

官方依据：[Background playback with Media3](https://developer.android.com/media/media3/session/background-playback)、[Control playback](https://developer.android.com/media/media3/session/control-playback)、[Media3 session](https://developer.android.com/media/media3/session)。

### 行为/系统兼容注意点

- Android 15 对 target 35 的 audio focus 有额外约束：应用需位于顶部，或已运行 foreground service；因此“让 WebView Howler 在后台继续响”不是合格的后台方案。[Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15)。
- Android 13+ 通知权限会影响用户看到媒体通知的体验；`POST_NOTIFICATIONS` 是运行时权限，但拒绝它并不等同于可省略前台服务的 manifest 声明。应在播放 UX phase 决定请求时机并实测锁屏/Task Manager。[Android 13 behavior changes](https://developer.android.com/about/versions/13/behavior-changes-13)。
- 需要播放恢复时，按官方方案注册 `MediaButtonReceiver` 并实现 `onPlaybackResumption()`；持久化 playlist、metadata、position，且不要把“正在播放”状态错误恢复成正在播放。旧 mobile 的 redux-persist 黑名单可以作为迁移语义参考。
- 不要使用 `media3-ui` 作为 WebView 的替代 UI；只有 native 控件、原生波形或视频 surface 成为明确范围时才添加。

### 替代方案与排除项

- Android platform `MediaPlayer` + legacy `MediaSessionCompat`：能播放，但不应作为新核心；会重复实现队列、下载、通知、session command 和缓存集成，且与官方当前 Media3 文档路径不一致。
- 旧 `com.google.android.exoplayer2`：不引入；Media3 是其 AndroidX 后继坐标。
- `MediaLibraryService`：仅当 Android Auto/browse 需求被批准后使用。
- 信心：MediaSessionService 的生命周期、manifest 和外部控制集成是高；provider 返回的 URL/headers、音频焦点设备差异、进程被杀后的恢复是“实现后验证”，不是本研究已证明的事实。

## 网络、缓存与显式下载

### 两种缓存必须分开

| 类型 | 目录/策略 | owner | 业务规则 |
|---|---|---|---|
| 播放临时缓存 | 独立的 app `cacheDir` 子目录；`SimpleCache` + `LeastRecentlyUsedCacheEvictor(maxBytes)` | 播放 resolver/Media3 | 可删除、可重建；不能向用户承诺离线；WebView HTTP cache 不算音频缓存 |
| 用户明确下载 | 独立的 app `filesDir`（或经容量设计的 app-specific external files）子目录；`SimpleCache` + `NoOpCacheEvictor` | Media3 `DownloadService`/`DownloadManager` + Room 产品索引 | 下载完成、hash/长度/媒体信息核验后才显示可用；用户删除时同时清理 Media3 cache、Room 索引和 UI 状态 |

两者不能共享同一个 eviction policy 或目录。Media3 `SimpleCache` 要求每个目录只有一个实例，并应使用专用目录；不要直接在它运行时删目录。下载使用 `DownloadIndex`/`DownloadManager` 持久化任务和状态，播放使用同一下载 cache 的 read-only `CacheDataSource`，而不是自行读取下载文件。对于普通播放，使用另一个临时 cache，避免一次“播放”把全部数据变成永久下载。

产品自己的 Room 表仍需记录 source/provider、稳定 media identity、cache key、hash/length、状态、用户 ownership、URI、最后访问时间、错误类别和 schema 版本；Media3 的 span/index 不是这些产品语义的替代，也不能自动证明 provider 内容 hash 正确。

官方依据：[Network stacks](https://developer.android.com/media/media3/exoplayer/network-stacks)、[Downloading media](https://developer.android.com/media/media3/exoplayer/downloading-media)、[`SimpleCache` API](https://developer.android.com/reference/androidx/media3/datasource/cache/SimpleCache)、[cache package](https://developer.android.com/reference/androidx/media3/datasource/cache/package-summary)。

### 网络栈选择

- 首选先用 Media3 内置 `DefaultHttpDataSource`/`DefaultDataSource`，由 host 生成 allow-listed URI 和 provider 所需 headers；它不要求再引入网络库。
- 若后续证据表明 API 34+ 的 `HttpEngine` 或 HTTP/3 对指定 provider 有收益，可按 API 分支选择，API 26–33 保留内置实现；此项需 provider/CDN 测量。
- `media3-datasource-okhttp` 不是默认依赖：它会增加 OkHttp 代码和自己的连接策略，不能凭空解决鉴权/缓存一致性。Cronet/Play services 也不是默认依赖，除非真实 HTTP/3 指标和分发约束证明值得付出体积及运行时复杂度。
- 当前 WebView bridge 的 GET allow-list 不能直接充当音频数据源；媒体 resolver 必须独立执行 provider bootstrap、重定向/headers 校验、超时和错误归类。

### DownloadService 与 WorkManager 的边界

- 对用户明确点击的下载，使用 Media3 `DownloadService` + `DownloadManager`；需要调度时可以使用官方 `WorkManagerScheduler`，但播放下载的数据面仍由 Media3 控制。
- 若采用官方 `DownloadService` 的 data-sync service 声明，按目标系统版本同时声明对应 foreground-service 权限/type，并把启动绑定到用户下载意图；target 35 下不从 `BOOT_COMPLETED` 自动拉起下载。其具体配额、通知和长任务行为需在下载 phase 的 API 26/35 设备上验证。
- 对清理、cache index 修复、失败重试、非紧急 provider sync、数据库迁移后的 reconciliation，使用 `WorkManager 2.11.2` 的 unique work、约束和 exponential backoff。
- WorkManager 是可延迟、可取消的持久任务，不能作为音频播放引擎，也不能承诺“点击后立即把整首歌下载完成”；普通 Worker 还有执行时限，长任务需遵守官方 long-running worker/foreground 规则。
- 不要用 `mediaProcessing` foreground service 伪装音乐播放或普通下载；Android 15 将其定义为转码等媒体处理并有 6 小时/24 小时限制。[Foreground service changes](https://developer.android.com/about/versions/15/changes/foreground-service-types)。不要从 `BOOT_COMPLETED` 自动启动媒体播放或无用户意图下载。

官方依据：[WorkManager getting started](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started)、[persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent)、[custom configuration/on-demand initialization](https://developer.android.com/develop/background-work/background-tasks/persistent/configuration/custom-configuration)。冷启动敏感时可把 WorkManager 改为 on-demand 初始化，避免首屏为尚未使用的后台能力付出初始化成本；需在 phase 中测量。

## Room、DataStore 与状态所有权

### Room 2.8.4：业务索引和可迁移数据

推荐表域：

- provider 账号的非敏感标识、会话状态/过期时间（token、cookie、API key 不放明文列）；
- playlist、favorite、queue/next queue、播放历史和年度聚合；
- lyric candidate、语言/翻译元数据、选定版本；
- cache/download 条目、hash/length、ownership、状态、失败原因、last-access；
- SAF URI、持久授权 flags、本地导入 track 的 origin URI、display name、size/hash；
- schema version、迁移和需要重试的 repair marker。

使用 DAO + transaction 把“队列变化、当前项、产品状态快照”作为原子业务操作；Media3 `DownloadIndex` 仍是下载任务状态的权威来源，Room 只做用户可见索引和跨域关联，不能维护一个会漂移的第二下载状态机。启动时做 reconciliation，避免异常退出留下半完成条目。

Java 模块使用 `room-compiler` 的 `annotationProcessor`；不引入 `room-ktx`、Kotlin coroutine 或 KSP。`room-testing` 可用于 migration/schema tests，但本轮不把它列入运行时依赖。

替代方案是 platform `SQLiteOpenHelper`：依赖少、可用，但需自行维护 DAO、迁移、线程和查询映射；对于 playlist/history/cache 多表关系，Room 的 compile-time SQL 校验和 migration contract 更合适。信心：数据建模建议高；schema 字段、迁移号和实际 SQL 需产品 phase 冻结。

官方依据：[Room release notes](https://developer.android.com/jetpack/androidx/releases/room)、[Room setup and Java annotation processor](https://developer.android.com/jetpack/androidx/releases/room)。

### DataStore 1.2.1：少量非敏感设置（可选）

只放小型 key-value 或单个不可变 settings object，例如主题、语言、用户 opt-in、缓存上限、最后路由、播放模式默认值。不要把 playlist、history、歌词全文、cache index 或大对象放 DataStore；它们需要 Room 的关系、查询和迁移。

Java host 若确实需要 DataStore，候选是 stable `datastore-preferences:1.2.1`，并以 `datastore-guava:1.2.1` 提供 Guava `ListenableFuture` API；所有实例按 application scope 单例化。DataStore 官方要求同一文件只建一个实例、写入不可变数据并处理 corruption；其文件默认位于 app files/datastore，若未来启用 Auto Backup 必须明确排除不应跨设备恢复的安全状态。

不采用 preview `1.3.0-alpha10` 作为生产基线，也不在没有安全数据模型前引入 `datastore-tink`。若 Java/Guava 互操作或小设置规模不值得新增依赖，本 phase 可以先保留一层严格封装的 `SharedPreferences`，但要把迁移出口留好；这不是把 SharedPreferences 当数据库。

信心：stable 版本和用途边界高；`datastore-guava` 的 Java API、R8/初始化开销需 phase spike，当前未编译。

官方依据：[DataStore release notes](https://developer.android.com/jetpack/androidx/releases/datastore)、[DataStore guide](https://developer.android.com/topic/libraries/architecture/datastore)、[GuavaDataStore API](https://developer.android.com/reference/androidx/datastore/guava/GuavaDataStore)、[Google Maven metadata](https://dl.google.com/dl/android/maven2/androidx/datastore/datastore-preferences/maven-metadata.xml)。

## Keystore、安全数据与备份

不建议为新代码加入 `androidx.security:security-crypto:1.1.0`：它的版本虽然可在 compile 35/min 26 构建，但该库官方 release notes 已明确说明所有 API deprecated，方向是平台 API 和直接 Android Keystore。

建议：

- 用 Android Keystore 生成不可导出的 AES-GCM key，`KeyGenParameterSpec` alias 按用途和版本隔离；随机 IV 与版本一起保存，解密前验证格式、版本和认证标签。
- 密文、IV、key version 放 app-private 文件或受控的 secure record；Room 只存引用/状态，不把 raw token/cookie/API key 放普通列、DataStore、WebView localStorage、Intent、URL、日志或异常文本。
- Keystore key 丢失、用户清除数据、设备恢复或 provider 会话过期都应进入可恢复的 re-login/relink 状态，不能把密文损坏当成空账号静默吞掉。
- 当前 manifest 已有 `allowBackup=false` 的方向；若未来启用 Auto Backup，使用 API 31+ `dataExtractionRules` 和旧设备 XML 明确排除安全文件/会话密文。`cacheDir`/`noBackupFilesDir` 的语义不能替代业务加密。

替代方案是临时兼容旧 EncryptedSharedPreferences/EncryptedFile 数据并迁移到平台 Keystore；只可将 `security-crypto:1.1.0` 当迁移桥，不再为新字段扩展 deprecated API。信心高；硬件 backing、恢复策略和备份规则需在 API 26、Android 15 设备上验收。

官方依据：[Android Keystore system](https://developer.android.com/privacy-and-security/keystore)、[KeyGenParameterSpec](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec)、[Security release notes](https://developer.android.com/jetpack/androidx/releases/security)、[Auto Backup](https://developer.android.com/identity/data/autobackup)。

## SAF、MediaStore 与 app-specific 文件

### 默认选择：SAF 明确导入

- 单文件用 `ACTION_OPEN_DOCUMENT` + `CATEGORY_OPENABLE` + 音频 MIME；目录用 `ACTION_OPEN_DOCUMENT_TREE`。用户选取后仅在系统返回 flags 时调用 `takePersistableUriPermission`。
- Room 保存 canonical `content://` URI、persisted flags、display name、size/hash、导入状态；服务经 `ContentResolver.openFileDescriptor`/stream 读取，不把 URI 转成绝对路径，不让 WebView 传 `file://`。
- 需要进程重启稳定播放时，可在 host 校验 MIME、长度、hash 后复制到 app-specific `filesDir`；保留 origin URI 便于 relink。临时转码/扫描文件放 `cacheDir` 并接受被系统清理。
- `.lrc` 或同目录 sidecar 只能在用户授予的 tree URI 范围内按 document API 访问；不可根据文件名拼接任意外部路径。

### 可选选择：MediaStore 系统媒体库

只有“扫描设备其他应用的音频”成为明确需求时才接入 MediaStore。API 33+ 访问其他应用音频需要 `READ_MEDIA_AUDIO`；更低系统按官方版本分支处理旧存储权限并逐设备测试。SAF 明确导入不需要广泛存储权限。

不要默认申请 `MANAGE_EXTERNAL_STORAGE`，不要递归扫描 shared storage 的裸 `File` 路径，也不要把媒体路径写入 WebView。分享文件时使用受控 `FileProvider` URI，并配置最小 path scope。

官方依据：[Documents and files / SAF](https://developer.android.com/training/data-storage/shared/documents-files)、[app-specific storage](https://developer.android.com/training/data-storage/app-specific)、[shared media](https://developer.android.com/training/data-storage/shared/media)、[all-files access](https://developer.android.com/training/data-storage/manage-all-files)。信心高；MediaStore 的权限分支、音频 metadata provider 差异和 SAF 授权失效体验需 phase 验证。

## WebKit 1.17.0 与共享前端边界

当前 `webkit:1.12.1` 可研究升级到 stable `1.17.0`，但必须保持现有安全模型：

- 继续用 `WebViewAssetLoader` 和 HTTPS appassets origin；使用 `WebMessageListener`/受限消息协议，不添加 `addJavascriptInterface`。
- 用 `WebViewFeature.isFeatureSupported()` 保护 profile、startup、navigation、render-process 等新 API，因为 API 26 设备的系统 WebView provider 版本不是 AndroidX 版本号的简单等价物。
- 1.17.0 的 profile HTTP cache、preconnect 等能力只服务固定 provider host 的 WebView 页面；它不替代 Media3 音频 cache，也不能承诺离线。preconnect 仅对已批准域名启用，避免扩大网络指纹/权限面。
- 处理 `onRenderProcessGone`，把渲染器退出与播放服务进程状态分离；WebView 重建后通过状态快照重新渲染，不重新执行未经授权的播放命令。
- Media3 service 不依赖 Activity 存活；WebView bridge 断开时播放和 session 可继续，重新连接时以 service snapshot 对齐 UI。

官方依据：[WebKit release notes](https://developer.android.com/jetpack/androidx/releases/webkit)、[WebViewAssetLoader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)、[WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat)。信心高；具体系统 WebView provider 兼容性需 API 26、33、35 的 instrumentation 回归。

## 明确不引入的东西

- 不引入 React Native、`react-native-video`、`react-native-music-control` 或按旧 mobile 仓库重建一套 UI；这会破坏“AngularJS WebView 共享前端 + Java host”约束。
- 不引入 Compose/Material/Navigation/ViewModel/Kotlin 协程来重写现有 UI；只有 native screen 成为批准范围时再单独做 UI 栈研究。
- 不引入 Media3 `1.10.x/1.11.0` 到 compile 35 工具链；其 AAR `minCompileSdk=36`，不是可忽略的 warning。
- 不引入 WorkManager `2.12.0-rc01`、DataStore `1.3.0-alpha10` 到生产基线；分别使用 stable 2.11.2 和 1.2.1 候选，且 DataStore 本身可暂缓。
- 不为新字段引入已 deprecated 的 `security-crypto`；不把 plaintext secrets 放 DataStore、Room 普通列、WebView storage 或日志。
- 不把 platform `android.app.DownloadManager` 当 provider 音频核心；它无法替代 Media3 的 headers、cache spans、DownloadIndex、播放复用和服务生命周期。普通用户导出文件可另行评估。
- 不默认引入 OkHttp/Cronet/Play services；先用内置 DataSource，只有真实 provider/CDN 证据支持时再做网络栈 phase。
- 不引入 `MANAGE_EXTERNAL_STORAGE`、裸路径递归扫描、混合内容、通配任意 URL/header 的 bridge，也不把 WebView HTTP cache 当离线存储。
- 不使用旧 `com.google.android.exoplayer2` 或 legacy `MediaSessionCompat` 作为新播放核心。
- 不添加 Firebase/analytics/Crashlytics 等与当前播放器等价实现无关的 SDK；隐私和分发影响需独立批准。

## 下一 phase 的最小验证门槛

下列事项不能由本研究的版本表代替，建议按顺序做一个窄 vertical slice，再扩展到完整功能：

1. 在现有 AGP 8.8.2/compile 35/JDK 17 下只加入 Media3 1.9.4 的 exoplayer + session，编译并运行 API 26/33/35；验证 manifest、foreground notification、audio focus、noisy、锁屏、耳机、外部 controller、进程重启和 bridge 断开。
2. 接入一个固定 provider fixture（不使用生产凭据），验证 host resolver 的 URI/header allow-list、重定向、错误分类和 Media3 cache；再验证独立 LRU 临时 cache 与 NoOp 永久 download cache、断点/取消/删除/hash。
3. 单独做 Room 2.8.4 Java annotationProcessor migration test；再做 DataStore 1.2.1/Guava Java spike。若 DataStore 只增加初始化和依赖成本，保持 SharedPreferences 封装，不扩大 scope。
4. 做 Keystore AES-GCM、失 key、密文损坏、备份排除、logout/re-login 测试；凭据只能来自测试 fixture，不能进入仓库。
5. 做 SAF 文件/目录授权、重启、撤销授权、ContentResolver 流式读取、长文件 hash、sidecar scope 和 MediaStore 权限分支测试。
6. 以真实构建结果复核 R8、安装包体积、冷启动、播放首帧、后台/前台切换、缓存上限和数据迁移；若必须上架，先完成 API 36 toolchain 的独立 compatibility research，再解除 Media3 1.9.4 上限。

## 一手来源索引

- 构建与 target：[AGP 8.8.0 release notes](https://developer.android.com/build/releases/agp-8-8-0-release-notes)、[Android 15 SDK setup](https://developer.android.com/about/versions/15/setup-sdk)、[JDK selection](https://developer.android.com/build/jdks)、[target API policy](https://developer.android.com/google/play/requirements/target-sdk)。
- Media3：[release notes](https://developer.android.com/jetpack/androidx/releases/media3)、[Google Maven metadata](https://dl.google.com/dl/android/maven2/androidx/media3/media3-exoplayer/maven-metadata.xml)、[background playback](https://developer.android.com/media/media3/session/background-playback)、[network stacks](https://developer.android.com/media/media3/exoplayer/network-stacks)、[downloads](https://developer.android.com/media/media3/exoplayer/downloading-media)。
- AndroidX：[Work](https://developer.android.com/jetpack/androidx/releases/work)、[Room](https://developer.android.com/jetpack/androidx/releases/room)、[DataStore](https://developer.android.com/jetpack/androidx/releases/datastore)、[Security](https://developer.android.com/jetpack/androidx/releases/security)、[WebKit](https://developer.android.com/jetpack/androidx/releases/webkit)；对应 Google Maven metadata 见各矩阵行。
- 平台能力：[Keystore](https://developer.android.com/privacy-and-security/keystore)、[SAF](https://developer.android.com/training/data-storage/shared/documents-files)、[app-specific storage](https://developer.android.com/training/data-storage/app-specific)、[MediaStore audio](https://developer.android.com/training/data-storage/shared/media)、[Auto Backup](https://developer.android.com/identity/data/autobackup)、[Android 15 FGS changes](https://developer.android.com/about/versions/15/changes/foreground-service-types)。
- 行为参考：[listen1/listen1_mobile v0.8.2](https://github.com/listen1/listen1_mobile/tree/v0.8.2) 及其上文列出的 raw source；该仓库仅用于行为/数据迁移参考，不是 Android Java 依赖。

## 证据与限制

- 版本门槛来自 2026-08-30 读取的官方 release notes/Google Maven 和候选 AAR 元数据；本文件没有复制任何凭据、生产 URL、cookie、token、state.db 或运行时日志。
- 已确认的是官方版本、模块职责和平台约束；尚未确认的是本仓库加依赖后的 Gradle resolve/R8、真实 provider/CDN、设备厂商 audio focus、Play 上架检查、冷启动/首帧/电量以及完整数据迁移。
- 因而 Media3 1.9.4、Room 2.8.4、DataStore 1.2.1、WorkManager 2.11.2、WebKit 1.17.0 都是有依据的候选；除 AGP 当前组合和已核验的 AAR 门槛外，不把“候选”表述成“已通过本项目集成测试”。
