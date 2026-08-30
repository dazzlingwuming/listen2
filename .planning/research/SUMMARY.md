# Project Research Summary

## Key Findings

### Executive summary

Listen2 Android 的目标是以桌面 v2.34.0 能力为行为基线，完成手机生命周期、安全边界和交互习惯下的等价用户旅程；不是把现有页面打包成 APK。当前 Android 已有固定 `appassets` origin 的共享 AngularJS WebView、受限搜索 bridge 和移动布局，但仍缺原生播放服务、登录/session、SAF、本地持久化、离线缓存、完整歌词链路以及真实设备证明。[PROJECT.md](../PROJECT.md)

推荐的实现主线是：共享 AngularJS 只做 UI projection；Java native capability layer 负责 provider、权限、文件、会话和数据；`MediaSessionService` 中的 Media3/ExoPlayer 是唯一音频和队列 owner；Room 保存用户可见领域数据，DataStore 只放小型设置，Keystore 保护 secret；WebView 通过版本化、类型化、可取消的窄 bridge 获取状态快照。该分层直接回应当前 Howler/WebView、Electron IPC 和 Activity 生命周期不能承担 Android 后台播放的事实。[ARCHITECTURE.md](ARCHITECTURE.md)

所有能力都必须由 capability matrix 驱动，并同时记录权限前提、降级、错误和证据。静态资源存在、provider registry 注册、JVM 测试通过、HTTP 200 或 debug APK 构建成功，都不能证明真实 provider、后台播放、登录、缓存或 parity。[FEATURES.md](FEATURES.md)

### Explicit technical decisions

| Decision | Implementation consequence | Status / evidence boundary |
| --- | --- | --- |
| Shared WebView + narrow native capability layer | 保留现有 classic-script/AngularJS 前端；native 只暴露高层 op 和状态，不暴露任意 URL、header、Cookie、path 或音频字节。 | 推荐；架构和项目约束一致，仍需 bridge instrumentation。 |
| Native Media3 is the sole playback owner | `MediaSessionService` 持有 ExoPlayer、MediaSession、audio focus、通知和恢复；WebView/Howler 只能发送意图和渲染 snapshot。 | 推荐；当前 Android 尚无该 service，必须先做唯一播放器 gate。 |
| v2 typed RPC, exact origin, real cancellation | 使用固定 HTTPS `appassets` origin、main-frame/source 校验、静态 op allow-list、大小/超时/epoch/request-id 限制；取消必须中止 native call。旧 v1 仅短期保留为受限搜索兼容层，不能扩展成通用 HTTP。 | 推荐；当前 v1 不具备可映射的原生取消句柄。 |
| Provider adapters are policy-owned | Bilibili 与 NetEase 先做独立 search/details/media/lyrics adapter；各自校验 host/path/query、schema、MIME、权限和过期时间，失败返回结构化错误。 | 首片范围；线上 API、登录、CDN 和 codec 尚未验证。 |
| Candidate dependency line | 当前 compile 35 可先验证 Media3 `1.9.4`；研究记录的 1.10.1/1.11.0 AAR 需要 compile 36。Room `2.8.4`、WorkManager `2.11.2`、DataStore `1.2.1`、WebKit `1.17.0` 是候选，不是已集成证明。 | 版本门槛证据较强；本仓库 resolve、R8、Java API 和设备行为待 phase spike。 |
| Room / DataStore / Keystore ownership | Room 保存歌单、收藏、队列 checkpoint、歌词元数据、历史、cache catalog 和 SAF records；DataStore 仅保存小型设置；Android Keystore AES-GCM 保存 session/API key，secret 不过 bridge、日志、备份或 WebView storage。 | 推荐；schema、迁移、DataStore Java façade 和失钥恢复待验证。 |
| SAF URI, not filesystem paths | 通过 `ACTION_OPEN_DOCUMENT`/`OPEN_DOCUMENT_TREE` 获取持久 URI grant，由 `ContentResolver` 读取；不申请全盘权限，不将 `file://` 或绝对路径交给 JS/备份。 | 平台合同明确；provider、不可 seek stream、grant revoke 需设备验收。 |
| Separate temporary cache and explicit download | Media3 临时 LRU cache 与用户明确下载使用不同目录、owner 和索引；只有完整、可校验内容才进入 `complete`，WorkManager 只做清理/修复等可延迟任务。 | 推荐；完整性、配额、恢复和 entitlement 尚未验证。 |
| Android-equivalent UX and honest capability | 桌面浮窗/托盘等改为通知、锁屏、bottom sheet 等手机交互；未实现或设备不支持的 provider、MV、效果、翻译入口隐藏或显示可行动的 `degraded/not verified` 状态。 | 项目明确约束；需由每阶段 E2E 证据开启。 |

### Table stakes

下列 `[T]` 能力是“可用 Android 音乐播放器”的最低门槛；没有运行时证据不能宣称完成：

- 可交互、可恢复的移动 shell：启动、导航、inset、旋转、字体缩放和返回行为不破坏播放。
- 搜索/详情/媒体解析/播放的最小端到端旅程，至少明确支持的 Bilibili/NetEase route；空结果、权限、网络、schema 和取消状态可区分。
- 单一播放器的播放/暂停、seek、时长、音量、上一首/下一首，以及可持久化 queue、shuffle/repeat 和错误恢复。
- 屏幕关闭、锁屏、通知、audio focus、耳机/蓝牙控制和 Activity/进程重建下的后台播放；其 owner 必须是 Media3 service。
- 可操作的离线/恢复错误和隐私安全：窄 bridge、HTTPS、secret storage、无任意文件/网络代理、无假成功。
- 用户明确导入本地音乐的 SAF/URI 路径，以及可验证的歌单/收藏持久化；失效授权必须可修复。
- TalkBack、48dp 触控目标、大字体和对比度等基础可访问性，以及 API 级别模拟器/真机和 release-like APK 的证据链。

### Most critical pitfalls

| Pitfall(s) | Why it is a release blocker | Required guard |
| --- | --- | --- |
| P1/P2：把 CORS 修复成任意代理，或放宽 bridge origin/header/cookie/cleartext | 会引入 SSRF、凭据转发、跨 frame/跨 origin 注入和明文流量；会把 WebView 变成越权网络/文件入口。 | exact origin/frame + provider host/path/query allow-list、HTTPS、bounded body、无 redirect/caller headers、拒绝时返回结构化错误。 |
| P3/P14：provider 漂移、错误分集、MIME/codec/Range 假设 | 搜索可能成功但播放错误媒体、静音或错误 part；HTTP 200 不等于可播放。 | 每 provider 独立 schema/manifest/TTL/CID/MIME 校验；Media3 依据真实 rendition，unsupported 时显式失败。 |
| P4/P12：回调永不结束、无限 fallback、stale response 或销毁后幽灵回调 | 造成无限 spinner、请求放大、旧歌曲覆盖新歌曲、页面销毁后仍写 UI/播放。 | page epoch + request registry + Future/transport cancel + deadline + generation/seq；所有路径都发 terminal result。 |
| P5/P18：WebView/native session 失配或凭据进入 bundle、日志、备份、cache | UI 会伪装“已登录”，登出后仍可用旧 cookie；可复用 token/API key 或个人数据泄漏。 | SessionVault/Keystore；JS 只收到状态/短期结果；logout 清理；source/APK/backup/log 扫描只报告类型不打印值。 |
| P6/P7/P8：Howler 与 Media3 双播放器、FGS/通知/focus 不完整 | 音频、通知、锁屏和页面状态分裂；后台启动/通知权限/焦点变化时崩溃或抢占其他应用。 | Media3 service 单一 owner、合法 mediaPlayback FGS、MediaSession、audio focus/noisy 状态机和 API 级别测试。 |
| P9：Activity/WebView/进程死亡后把内存当真相 | 队列、位置、登录或播放静默丢失，旧 renderer 仍可能操作 service。 | Room checkpoint + service resumption；renderer gone 重建；Activity 只保存小型 UI state，页面重新 handshake/snapshot。 |
| P11：partial cache、无界磁盘、越权离线副本 | 半文件会被误认为可播放；缓存可能占满磁盘或绕过 entitlement/版权边界。 | 专用目录、原子提交、长度/hash/媒体可读性校验、配额/淘汰/repair；临时与明确下载分离，离线仍校验权限。 |
| P13/P16：UI 看似平价，实际死按钮；只凭静态/JVM/debug 交付 | 会把“入口存在”误报为登录、后台、下载、歌词或播放已完成。 | capability handshake 控制入口；instrumentation + emulator/真机 + release-like/secret/perf 扫描；未覆盖项标 `not verified`。 |

## Implications for Roadmap

路线按依赖拆成 12 个 phase；每一阶段只开放已验证的 slice，前一阶段的 contract/gate 未通过就停止扩量。

| Phase | Depends on | Addresses | Avoids / exit gate |
| --- | --- | --- | --- |
| R0 — Scope, capability and threat contract | 无 | 冻结桌面 parity 清单、provider capability、权限前提、Android 等价 UX、error envelope、secret/data classification、版权边界和可验收证据格式。 | 避免按 registry/旧 RN 功能表伪造支持；出口是 machine-readable matrix、反特性和 DoD。 |
| R1 — Toolchain and dependency spike | R0 | 在当前 AGP 8.8.2/compile 35/JDK 17 上实建 Media3 1.9.4、Room 2.8.4、WorkManager 2.11.2、WebKit 1.17.0 候选；评估 DataStore Java 互操作和 API 36 迁移影响。 | 避免把 Maven 元数据当集成通过；出口是可重复 build/resolve/R8 结果，失败则锁定候选或标 `blocked`。 |
| R2 — Bridge trust and cancellation foundation | R0–R1 | 实现 v2 envelope、exact origin/frame、schema/op/size 校验、page epoch、request registry、deadline/cancel/stream 规则、redaction 和 capability handshake；v1 只读兼容。 | 避免任意 URL/header/Cookie/file bridge、hang、stale response 和 feature-unsupported 的静默空结果；出口是 JS/JVM/WebView policy tests。 |
| R3 — Mobile shell, lifecycle and budget baseline | R2 | 整理 WebViewHost、WindowInsets、导航/旋转/renderer recovery、saved-state 边界，建立 cold start/TTID/TTFD、内存和网络预算及可测量点。 | 避免 UI 拥挤、Activity 持有播放真相、把静态 CSS/启动代码当性能证据；出口是 API 26/当前参考设备 shell 与生命周期 fixture。 |
| R4 — Native foreground playback vertical slice | R2–R3 | 引入唯一 Media3 ExoPlayer/MediaSession facade，完成 track id → controlled MediaLocator → foreground play、pause、seek、snapshot、错误和基础 cache data source。 | 避免 Howler/Media3 双写、直接把 signed URL 交给 JS、固定 mp3 假设；出口是 fixture 音频首帧/seek/错误恢复且仅一个 active player。 |
| R5 — Background service, focus, queue and recovery | R4 | 完成 `MediaSessionService`、mediaPlayback FGS、通知、锁屏/耳机/蓝牙、audio focus/noisy、queue engine、FIFO play-next、shuffle/previous/history pointer 和进程恢复。 | 避免“前台样例冒充后台”、焦点抢占、队列跳过/重复、Activity 销毁停播；出口是 API 级别 emulator + controller/lifecycle evidence。 |
| R6 — Bilibili/NetEase provider E2E slice | R2、R4–R5 | 按 adapter 接通 search → details/part → manifest/media → primary lyrics；严格 schema、CID、MIME、权限和错误分类，先用脱敏 fixture 再做受控 provider smoke。 | 避免把搜索 bridge 当播放完成、旧 API/旧 RN direct HTTP、错误 provider fallback；出口是两 provider 的可追溯 search/play/lyric 旅程，未覆盖能力隐藏。 |
| R7 — Domain persistence, session and local files | R2、R5–R6 | 建 Room schema/migrations、DataStore façade、Keystore SessionVault；实现 provider session 状态、歌单/收藏/队列 checkpoint、SAF audio/tree、tags/LRC、备份白名单与 merge/conflict。 | 避免 localStorage/明文列存 secret、路径传 JS、旧 clipboard 覆盖导入、破坏性 migration；出口是重启/升级/grant revoke/备份损坏和登出测试。 |
| R8 — Cache, download, offline and history | R4–R7 | 分离临时 LRU 与明确下载 cache，接入 Media3 DownloadService/DownloadIndex、Room catalog reconciliation、原子完整性/配额/取消/repair；迁移有效听歌采样和年度聚合到 native owner。 | 避免 partial 可见、无界磁盘、把 cache 当下载或绕过 entitlement、重复计历史；出口是断网命中、kill/磁盘满/hash 错误、下载 pause/resume/删除和统计阈值 fixture。 |
| R9 — Advanced parity and Android-equivalent UX | R6–R8 | 逐 provider 扩展 QQ/Kugou/Kuwo/Migu/Taihe；实现歌词 fallback/手选、用户确认后 DeepSeek、MV/音效/频谱/响度的设备能力降级，以及通知/bottom sheet/歌词等移动 UI。 | 避免死按钮、假频谱/翻译/时间戳、无确认计费请求、过时明文 provider、桌面窗口形态硬搬；出口是每项 capability 的 contract + instrumentation + emulator evidence。 |
| R10 — Accessibility, performance and security hardening | R3、R7–R9 | TalkBack/字体/insets/对比度、低端设备预算、WebView/Media3 长时稳定性、外部导航、权限与错误可观测性；扫描 source/APK/assets/log/backup 的 secret、cleartext 和依赖边界。 | 避免仅 debug/JVM 交付、renderer OOM/ANR/电量失控、日志泄漏和不安全发布配置；出口是 release-like 包、性能报告和安全审计。 |
| R11 — Device matrix and parity release evidence | R0–R10 | 在 API 26 与当前 API/代表性设备上重跑冷启动、搜索、播放、歌词、登录、歌单/队列/历史、缓存离线、SAF、备份、锁屏、进程回收、网络恢复和外部导航，记录命令/输入/时间/未覆盖项。 | 没有 emulator/真机、真实 session、Bluetooth/通知或 release-like 证据时保持 `not verified`；不包含 merge/deploy/signing 授权。 |

### Research flags

- **Target/API 36**：研究记录当前 compile/target 35 与 AGP/JDK 组合可兼容，但 2026-08-31 起的新应用/更新面向 API 36 的上架要求意味着 API 36 toolchain、Gradle、AGP、JDK 和 Media3 上限要单独验证；不能把 target 35 当长期发布方案。
- **依赖候选未集成**：Media3 `1.9.4`、Room `2.8.4`、WorkManager `2.11.2`、DataStore `1.2.1`、WebKit `1.17.0` 的版本/部分 AAR 门槛有研究证据，但本项目尚未完成 Gradle resolve、Java API、R8、迁移或设备回归。
- **Provider 未验证**：Bilibili WBI/manifest/CID/CDN/QR/session 与 NetEase WeAPI/EAPI/search/media/lyrics 的当前线上契约、账号权限、签名 URL、headers、Range 和错误形状均需脱敏 fixture、受控 smoke 和真实设备证明。
- **Runtime/device 未验证**：API 26–35 的 codec、audio focus、Bluetooth/通知、FGS、WebView provider、renderer recovery、Media3 resumption、低端内存/电量和异步 WebMessage streaming 不能由静态代码推断。
- **存储与隐私未验证**：Room migration、DataStore Java/Guava 选择、Keystore 失钥/备份排除、SAF 云 provider/不可 seek stream、cache/download reconciliation 和 logout 清理需要 instrumentation。
- **Legacy secret surface**：研究指出共享 `github.js`/`lastfm.js` 等资源有旧凭据处理且可能被打进 APK；是否存在可复用 secret 必须通过脱敏 source/APK 扫描确认，任何命中都是全局 release blocker。
- **真实验收输入缺口**：测试账号、provider fixture、API/机型矩阵、物理耳机/蓝牙和正式签名材料均不在当前研究中；没有这些输入的能力应保留 `not verified`，不能靠隐藏风险宣称完成。

### Confidence matrix

| Area | Confidence | What is supported / limitation |
| --- | --- | --- |
| 项目目标、当前 Android 边界、桌面 parity 范围 | High | `PROJECT.md`、当前 Android/桌面文件和四份研究互相一致；这是现状/目标证据，不是实现完成证明。 |
| WebView + typed bridge + native service 的 ownership 分层 | High | 架构研究与 Android 官方 WebView/Media3 lifecycle 文档支持；具体代码迁移仍待测试。 |
| MediaSessionService、SAF、Keystore、Room/DataStore 职责 | High | Android/AndroidX 一手文档支持职责和安全边界；schema、失效恢复和 Java 互操作仍需实现验收。 |
| 候选版本的门槛与模块用途 | High for metadata / Medium for integration | 研究逐项核验了部分 Google Maven/AAR 元数据；本仓库 compile、R8、运行行为未证明。 |
| Cache/download 与 Room catalog 的组合 | Medium | 官方 API 支持职责划分；signed URL、Range、完整性、配额和重启 reconciliation 需 fixture/device tests。 |
| 旧 mobile 的队列/备份/系统控制迁移线索 | Medium | v0.8.2 官方源码可支持行为线索；旧 RN 依赖、明文网络和覆盖式导入不可作为新实现合同。 |
| Bilibili/NetEase 线上接口、登录、CDN、codec | Low / not verified | 研究明确未完成真实 provider、账号和设备验证；必须按 capability 逐项开放。 |
| 性能、后台进程回收、Bluetooth/通知、WebView streaming | Low / not verified | 只能通过 API/设备 instrumentation、emulator/真机和 release-like 包建立证据。 |

### Unresolved items

| Item | Why it remains unresolved | Required decision or evidence |
| --- | --- | --- |
| 是否及何时升级 API 36 toolchain | target 35 的当前构建兼容与后续上架要求存在时间边界；升级会影响 AGP/Gradle/JDK/Media3。 | 在 R1 冻结支持 API、发布窗口和升级路线后再锁依赖。 |
| DataStore Java 实现还是受控 SharedPreferences façade | DataStore stable 坐标明确，但 Java/Guava resolve、初始化成本和 R8 还未测；设置规模很小。 | R1 spike 以编译、迁移、corruption 和启动成本决定，不把大数据放任一方案。 |
| Bilibili/NetEase 的真实 route、auth 和媒体能力范围 | provider API、WBI/WeAPI、CDN、会员/地区权限和歌词形状会变化，现有 Android 只有少数搜索 route。 | R6 使用脱敏 fixture + 受控账号/网络证据；能力 matrix 按 route 而非 provider 名称开启。 |
| 其他 provider 是否进入本里程碑 | QQ/Kugou/Kuwo/Migu/Taihe 的 HTTPS、session、媒体和设备证据尚未具备；旧 mobile direct HTTP 不能复制。 | R9 逐 provider 评估，未通过 policy/adapter/E2E 就隐藏或标 `degraded`。 |
| MV/DASH/HLS、音效、频谱、响度的 Android 支持面 | WebView codec/AudioContext 与 Electron 不等价，设备、电量和后台限制未知。 | 先完成音频 parity；R9 按设备能力和预算决定支持、静态/隐藏降级或 out of scope。 |
| 离线副本的保留、配额和 entitlement 细节 | 桌面有 temporary/playlist/explicit 三类语义，Android 目录、空间和 provider 权限尚未实现。 | R8 冻结目录、容量、删除/repair、登出和权限复核合同；不以本地文件绕过限制。 |
| Android 备份包含哪些用户域 | 桌面安全备份只含歌单/收藏，排除 credentials、路径、theme、lyrics；queue/history/local URI 是否导出仍需明确。 | R7 以白名单和默认 merge 为准，导入覆盖必须高级二次确认并可回滚。 |
| 真实设备与测试凭据覆盖 | 当前 workflow 没有 instrumentation/E2E；物理 Bluetooth、通知、provider 账号和签名材料不在研究输入内。 | R10–R11 建立脱敏 fixture、API/设备矩阵和外部输入清单；缺口显式记 `not verified`。 |

## Sources

以下仅列研究文件引用的一手来源；本摘要不新增二手资料或未经验证的外部事实。

- [Listen2 project goals and constraints](../PROJECT.md)
- [Listen2 desktop README v2.34.0](https://github.com/dazzlingwuming/listen2/blob/v2.34.0/README.md)
- [Android Media3 background playback](https://developer.android.com/media/media3/session/background-playback)；[Media3 release notes](https://developer.android.com/jetpack/androidx/releases/media3)
- [WebViewAssetLoader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)；[WebViewCompat WebMessageListener](https://developer.android.com/reference/androidx/webkit/WebViewCompat)
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)；[Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)
- [Room](https://developer.android.com/training/data-storage/room)；[DataStore](https://developer.android.com/topic/libraries/architecture/datastore)；[WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent)
- [Android Auto Backup rules](https://developer.android.com/identity/data/autobackup)；[cleartext communications](https://developer.android.com/privacy-and-security/risks/cleartext-communications)
- [listen1_mobile v0.8.2 provider client](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/api/client.js)；[legacy background player](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/views/player/background-player.screen.js)
- [Android research stack](STACK.md)、[feature landscape](FEATURES.md)、[architecture](ARCHITECTURE.md)、[pitfalls](PITFALLS.md)（本项目已读取的研究证据索引）。
