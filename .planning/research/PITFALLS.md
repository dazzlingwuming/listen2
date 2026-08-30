# Android 音乐播放器重建：失败模式与发布阻断项

研究日期：2026-08-30（Asia/Shanghai）

本文件面向当前 Listen1 Android 重建：共享 AngularJS 前端、Android WebView 壳，以及将要补齐的原生 Media3 播放和受控 bridge。它记录的是“哪些做法最容易让表面功能看起来完成、但在真机、后台、登录、网络变化或进程死亡时失败”，不是产品代码实现说明。当前版本的能力边界以 PROJECT.md、codebase/CONCERNS.md 和 research/FEATURES.md 为准。

## 读法与发布判定

- BLOCK：在对应能力被宣传、合并或发布前必须修复并取得运行时证据。没有证据时状态是 not verified，不得用编译通过、静态检查或一次 HTTP 200 代替。
- DEGRADED / NOT VERIFIED：可以保留为明确隐藏或禁用的能力，但不能出现在“已支持”“桌面 parity”或可点击却无效的 UI 中。
- “阶段”采用本仓库建议的顺序：S0 信任边界/可取消 bridge；S1 WebView 壳与唯一 Media3 播放器；S2 provider、登录、SAF、持久化；S3 cache、历史、歌词、MV、效果；S4 AI、设备矩阵、发布证明。
- 任何 BLOCK 的安全、数据完整性、双重播放或凭据泄漏问题都优先于外观 parity。foreground-only 的早期样本可以发布给内部验证，但必须明确写出其能力限制，不能冒充完整播放器。

## 当前基线（已确认事实）

- android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java 当前只创建一个 WebView，加载 appassets.androidplatform.net 下的前端，并在 onDestroy 中销毁 WebView；没有 MediaSessionService、保存/恢复队列或 native playback owner。
- AndroidManifest.xml 只有 INTERNET；没有 mediaPlayback 前台服务、FOREGROUND_SERVICE、FOREGROUND_SERVICE_MEDIA_PLAYBACK 或 POST_NOTIFICATIONS 声明。当前 targetSdk 是 35。
- AndroidHttpBridge.java 只提供受控 HTTPS GET：Bilibili 为 host 级路径范围，NetEase 只有精确的 web search 路由；线程池队列为 16，原生请求没有暴露给 JS 的取消句柄。WebMessage listener 不可用时不提供 addJavascriptInterface 退路。
- 前端在 Android 默认走 bridge.js 的 front player 和 player_thread.js 的 Howler/HTML5 路径；desktop 的 Electron CORS 重写、IPC、Bilibili manifest 服务不能自动迁移到 Android。
- lowebutil.js 的 JS 超时只移除 pending，不会中止原生连接；provider 代码仍有直接 axios/fetch、回调式返回、硬编码 API 形状和历史 provider 假设。
- app/listen1_chrome_extension/js/github.js 与 lastfm.js 等共享资源仍包含旧的 OAuth/API 凭据处理；android/app/build.gradle 会把这些脚本一起打进 APK。不要在本文件或任何测试输出复制实际密钥值。
- 当前 Android workflow 主要跑 JVM policy test 和 assembleDebug/apksigner；移动 UI、bridge、登录、后台媒体、SAF、真机 provider 旅程未被 instrumentation/E2E 证明。

## 失败模式清单

### P1：把 WebView CORS 问题变成任意代理或 cleartext 例外

- 预警信号 / 当前证据：桌面 app/main.js 通过 Electron session 重写媒体响应头；Android 没有同等能力。前端的 NetEase、Bilibili 及其他 provider 仍有直接网络调用，而 Android bridge 只覆盖少数 GET。开发者若为“先播起来”增加任意 URL、任意 header/cookie 或 HTTP 代理，就会同时引入 SSRF、凭据转发和 cleartext 风险。
- 预防：所有网络能力做成按 provider、host、method、path、query 和响应大小的显式 adapter；没有合法 HTTPS endpoint 就标为 unsupported。禁止用户输入 URL 直接代理，禁止 caller 提供任意请求头、重定向和 cookie；保持 usesCleartextTraffic=false，不以网络安全配置放宽为默认修复。媒体 URL 也必须由受控 manifest 解析器交给播放器，而不是把代理当作 CORS 万能开关。
- 验证：在 instrumentation 中使用本地 HTTPS fixture 覆盖合法路由、错误 host、非标准端口、userinfo、HTTP、重定向、超时、超大 body 和恶意 query；验证每个已宣传的 provider 从 search 到 play 的端到端路径。对 release APK 做来源扫描，确认不存在任意 URL/header/cookie bridge 和 cleartext 例外。
- 阶段 / 依赖：S0 先冻结 capability/policy 和错误契约；S2 才按 provider 接通真实流程；S4 做 release source/APK 扫描和真机网络验证。依赖 P2、P3、P5。
- 发布门禁：任意代理、明文 provider、或核心播放只能依赖桌面 CORS hack 时 BLOCK。不能访问的 provider 可以隐藏并标为 DEGRADED，但不可以让用户看到可点击的伪支持。

### P2：WebView bridge 信任边界被放宽

- 预警信号 / 当前证据：当前实现使用 WebMessageListener 并校验固定 appassets origin、main frame 和 HTTPS；但是 Bilibili 仍是 host 下较宽的 GET 路由，且 WebMessage listener 需要运行时 feature。常见回归是把 origin 改成通配符、接受 iframe、补回 addJavascriptInterface，或为了调试开放 JS 执行、任意 header、文件路径和 cookie。
- 预防：只允许固定 HTTPS appassets origin，逐条校验 sourceOrigin、isMainFrame、协议、host、端口、method、path、query、body 和 requestId 长度；采用版本化、类型化 envelope，错误要可见。不要把 addJavascriptInterface 作为兼容 fallback；WebMessage feature 缺失应返回明确的 android-http-unavailable，并让 UI 隐藏依赖能力。bridge 不承担任意 JS、任意文件、任意导航或任意网络代理。
- 验证：注入 iframe、错误 origin、导航后旧页面、HTTP/不同端口、userinfo、越界 path/query、重复 requestId、过大消息、伪造 response 和队列饱和测试；在 API 26、当前 WebView 和 release/minified 包上执行。确认没有 listener 被安装到 wildcard origin，也没有新增 JavascriptInterface。
- 阶段 / 依赖：S0 的第一道 gate；S1/S2 新增 capability 时只能复用这套 policy。依赖 P12 的竞态/取消测试。
- 发布门禁：任何跨 origin、跨 frame、任意 URL/header/cookie/JS 的 bridge，或用不安全 JavascriptInterface 绕过 feature 检查，全部 BLOCK；该问题阻断整个 APK 发布，不只阻断一个 provider。

### P3：provider API 漂移、响应形状和分集选择被静默吞掉

- 预警信号 / 当前证据：netease.js 依赖 weapi/eapi 及固定返回层级，bilibili.js/app/bilibiliService.js 依赖 WBI、qn/fnval/fourk 和 CDN/referer 细节；这些不是稳定的公共 Android 合同。Bilibili 旧路径使用 pages.find(cid) || pages[0]，CID 不匹配时可能无提示播放错误分集。Android 目前只代理少数搜索接口，UI 却注册多个 provider 和 login 能力。
- 预防：每个 provider 有独立、版本化的 adapter，分开 search、detail、manifest、lyrics、auth；对必需字段、类型、媒体 MIME、失效时间和 requested bvid/cid 做严格校验，缺失或不匹配时 fail closed。错误分为 unsupported、unauthorized、expired、rate-limited、network、schema，不把空列表当成功。provider capability 必须由 bridge/native handshake 返回，而不是由旧 registry 猜测。
- 验证：用脱敏 fixture 覆盖当前 shape、少字段、字段类型变化、空 pages、多个同名结果、过期签名、权限错误和正确 CID；对每个宣称支持的 provider 执行真机 search→选择→manifest→play/lyrics smoke。断言错误 part 不会被 fallback 为 pages[0]，且 schema 错误能到达 UI。
- 阶段 / 依赖：S2，在 S0 capability/error contract 和 S1 唯一播放器就绪后做；P4 的超时/fallback 测试随后覆盖 provider 失败。
- 发布门禁：已宣传的核心 provider 只要没有 schema/真机证据，或会静默播放错误分集，相关能力 BLOCK；未实现 provider 应隐藏而非硬撑 parity。

### P4：回调永不结束、无界 fan-out 和过时结果覆盖当前播放

- 预警信号 / 当前证据：loweb.js 的 allmusic 使用 async.parallel，bootstrapTrack 会并行打到所有 fallback provider，且有未编码的 keywords 和“reject-as-success”式回退；provider 回调形状不一致。旧 mobile v0.8.2 的未知 provider 甚至返回永不 settle 的 Promise。这会表现为无限 spinner、搜索放大流量、旧歌曲覆盖新歌曲或 provider 一挂全页卡住。
- 预防：所有边界改为带截止时间的 Promise/result envelope，带 operation generation 和 AbortSignal/request ID；并行只使用有限白名单和小并发预算，失败采用 all-settled 分类，query 必须编码。换歌、离开页面、超时和 logout 都取消相关操作；未知 provider 立即返回 unsupported，重试采用有限次数和退避，不把失败伪装成成功。
- 验证：fixture 注入永不回调、延迟、乱序、一次失败、部分成功、HTTP 429、空结果和重复 callback；快速连续 search/next/stop，断言旧 generation 不得改变当前 track，所有 spinner 最终有成功、空结果或错误。检查 provider 请求数量、总时限和取消是否真正终止连接。
- 阶段 / 依赖：S0 定义取消和错误协议；S2 改 provider/fallback；S3 的 lyrics、MV、下载复用相同规则。依赖 P12。
- 发布门禁：核心旅程可无限等待、无界 fan-out、重试循环或 stale response 改写当前播放时 BLOCK。单个非核心 provider 暂时不可用可 DEGRADED，但必须有可见错误/空状态。

### P5：登录 cookie、token 和登出状态在 WebView/原生之间失配

- 预警信号 / 当前证据：MainActivity 接受一方 cookie、关闭第三方 cookie；AndroidHttpBridge 只在受控 URL 上读取 CookieManager 的有限 cookie（例如 buvid3 内存解析），没有 native auth/session manager、刷新和持久化合同。前端仍把 NetEase、QQ、Bilibili、Migu 标作 support_login，容易出现“UI 显示已登录但原生请求匿名”、QR 轮询把任何网络错误折叠为 logged-out，或登出后旧 cookie 继续生效。
- 预防：按 host 管理 session，明确 cookie、token、refresh、匿名标识和授权状态；敏感凭据只进 Android Keystore/受保护 native storage，JS 只拿 capability 和短期结果，禁止 caller 注入 Cookie header。登录、刷新、过期、撤销、登出要清理 WebView cookie、native store、相关缓存和 pending request，并避免把账号数据备份或写日志。需要账号权限的质量/音频不满足时，返回 unauthorized/entitlement-required。
- 验证：覆盖冷启动、二维码/网页登录回调、错误轮询、cookie 过期、token refresh、杀进程重启、登出后重播、账号切换、无第三方 cookie 和 WebView 清理；使用脱敏 fixture/测试账号，在抓包和 APK 检查中确认没有 token、完整 cookie 或 secret 进入 JS bundle、日志、URL、backup。
- 阶段 / 依赖：S0 先确定 secret/session 边界；S2 实现 provider auth/Keystore/登出；S4 在 release APK 和真机上复核。依赖 P2、P11、P18。
- 发布门禁：宣称 login、会员音质、私有播放列表或受限媒体却没有安全 session 和失效证明时 BLOCK；未完成登录能力必须隐藏，不能仅保留“登录”按钮。

### P6：WebView/Howler 和 Media3 形成两个播放器

- 预警信号 / 当前证据：bridge.js 在 Android 默认选择 front player，player_thread.js 用 Howler/HTML5 并固定刷新历史；MainActivity 又计划承载原生 Media3。若两个路径都创建 audio element/player，常见结果是双声道、暂停状态分裂、通知显示另一首、锁屏控制无效、Activity 重建后继续漏播。
- 预防：明确一个 playback owner：S1 起由 Media3 Player + MediaSessionService 持有音频和队列，WebView 只做 controller/view；禁用或隔离 Howler 音频实例，所有 play/pause/seek/next/queue/status 走带 generation 的 controller。service 与 Activity 解耦，保留 position/queue/metadata 的单一来源。
- 验证：instrumentation/真机断言全进程只有一个 active audio player；播放、暂停、seek、换歌、快速重复点击、屏幕熄灭、返回桌面、旋转和重建后分别检查实际音频、通知 metadata、WebView 状态和队列完全一致。检查 logcat 是否出现两个 playback owner。
- 阶段 / 依赖：S1 的硬 gate，先于 provider 全量接入；依赖 P7、P8、P9。
- 发布门禁：存在双重音频、通知/锁屏控制错位或 background claim 仍由 WebView Howler 承担时 BLOCK；未接 Media3 前只能标为 foreground sample。

### P7：前台服务、后台启动和通知权限被当成“加个 service”即可

- 预警信号 / 当前证据：当前 manifest 没有 service 或 FGS 权限，而 targetSdk 35 会遇到 Android 12+ 后台启动限制、Android 13+ POST_NOTIFICATIONS 运行时权限和 Android 14+ 类型/权限要求。没有 MediaSessionService 时，系统媒体通知、锁屏、进程优先级和恢复均无可靠 owner。
- 预防：使用一个 MediaSessionService，声明 mediaPlayback 类型及所需 FGS 权限；由用户可见的播放动作启动服务，后台只在合法生命周期继续，不把任意下载/刷新混成永驻 FGS。创建媒体通知 channel、metadata 和停止条件；API 33+ 解释并测试通知允许/拒绝，API 31+ 捕获 ForegroundServiceStartNotAllowedException。服务无播放时应停止。
- 验证：API 26、30、31、33、34、35 的 release-like APK 执行冷启动播放、切后台、锁屏、任务划掉、通知允许/拒绝、后台启动、停止播放；核对 dumpsys activity/services、通知和 MediaSession 状态。测试 Android 13 notification deny 不会让 app 假装“通知正常”，Android 14/15 FGS 类型错误不得被吞。
- 阶段 / 依赖：S1；依赖 P6 的唯一播放器，P8 的 focus/noisy，P9 的生命周期恢复。
- 发布门禁：宣传 background playback、lock-screen/headset control 或 service resume 却没有完整 FGS/notification/target API 证据，BLOCK。通知拒绝时可按系统限制 DEGRADED，但 UI 必须诚实且播放不能因此未处理地崩溃。

### P8：audio focus、耳机拔出和 Bluetooth 控制没有实现为状态机

- 预警信号 / 当前证据：当前 Java host 没有 audio focus/noisy/Bluetooth 处理；旧 RN background-player 的行为只能作为历史参考，不能被当作当前 Media3 合同。target API 35 还限制了不在前台或 FGS 的 focus 请求。
- 预防：让 Media3/ExoPlayer 使用正确 AudioAttributes 并集中管理 focus；在 loss、loss transient、duck、becoming-noisy 时按策略暂停/降音，停止时 abandon focus；把电话、导航、另一个媒体 app、蓝牙连接变化和媒体按键映射到同一个 session 状态机。不要让 WebView 和 native 各自请求 focus。
- 验证：用另一媒体 app、来电/模拟 focus、导航音、拔耳机、有线/蓝牙耳机、AVRCP play/pause/next 和快速连接变化测试；覆盖 API 26–30 手动处理与 API 31+ 系统 fade/mute 差异，以及 focus 被拒绝的路径。断言丢 focus 后不会继续播或失控增音。
- 阶段 / 依赖：S1，与 MediaSessionService 一起；依赖 P6/P7。
- 发布门禁：继续抢占他 app 音频、耳机拔出仍播、媒体键无效或 focus 失败导致崩溃时 BLOCK；不支持某类硬件可降级，但必须有稳定的默认暂停行为。

### P9：Activity、WebView renderer 或整个进程死亡后状态丢失

- 预警信号 / 当前证据：MainActivity 使用较宽 configChanges，onDestroy 直接 destroy WebView，没有 save/restore queue/position；Android 文档明确进程被系统杀死时不保证 onDestroy。WebView renderer 也可能独立终止。当前 pre-R insets 还直接 return，说明配置变化路径未经完整验证。
- 预防：把 durable queue、current media id、position、repeat/shuffle、auth/session 状态和 cache index 放入 repository；saved state 只存小的瞬时 UI，不把 WebView 内存当数据库。MediaSessionService 负责播放与恢复；Activity 重建以 controller 状态重新渲染，处理 renderer gone、navigation、duplicate listener 和 pending request 清理。减少依赖宽 configChanges，明确横竖屏、分屏和多窗口策略。
- 验证：旋转、语言/字体、分屏、多窗口、后台一段时间、低内存、adb kill/force-stop、WebView renderer termination、系统重启和 service 重连；确认不会重复播、丢队列、重复写历史、泄漏 cookie 或用旧页面 response 覆盖新页面。
- 阶段 / 依赖：S1 设计 owner/reconnect；S2 持久化和 session；S4 执行设备矩阵。依赖 P6/P7/P12。
- 发布门禁：进程死亡后核心播放/队列/登录状态静默丢失，或旧 renderer 还能操作 native service，BLOCK。仅 UI 草稿丢失属于可接受 DEGRADED，需有清晰恢复行为。

### P10：SAF URI 被当成本地路径，权限和长期访问没有持久化

- 预警信号 / 当前证据：FEATURES 要求本地音乐和 SAF，但当前 Android 没有 document picker、URI grant、ContentResolver 读取或可恢复的文件 repository。把 file path 传进 WebView、请求广泛存储权限或只在选择当下可读，都会在重启、SD 卡、云 provider 或重命名后失效。
- 预防：使用 ACTION_OPEN_DOCUMENT 获取可持久化 URI permission，保存 URI/document id 和 MIME/size/last-known metadata，而不是绝对路径；读取用 ContentResolver/ParcelFileDescriptor，按 provider 能力处理 seek/range。ACTION_GET_CONTENT 只用于明确的导入复制；不申请 MANAGE_EXTERNAL_STORAGE。撤销/失效时给出 re-authorize 或移除选项，歌词/封面 sidecar 也遵循用户选择。
- 验证：系统文件、SD、云盘/第三方 DocumentsProvider、不可 seek 的 stream、大文件、重启、应用升级、文件重命名、撤销 grant 和卸载重装；确认备份不包含失效本地路径，WebView 不能读取 file://。测试播放/暂停/seek 和 service 重连。
- 阶段 / 依赖：S2，与本地 provider、持久化和 backup policy 一起；依赖 S0 bridge 不能越权读文件。
- 发布门禁：广告支持“本地音乐/SAF”却只能接收路径、申请全盘权限或重启后静默失效时 BLOCK 该能力；未实现则隐藏入口。

### P11：缓存、下载和版权/账号边界被实现成不完整文件或越权副本

- 预警信号 / 当前证据：当前 Android 没有 cache/download owner、quota、完整性索引或恢复协议；桌面 provider 可能返回签名 URL、DASH/分片或依赖当前 cookie。直接把 response 写目标文件，进程杀死、磁盘满、range 失败或 token 过期后会留下“看起来存在但不能播”的半文件。应用缓存目录也可能被系统清理。
- 预防：临时文件写入后校验长度/hash/必要 metadata，再 fsync/atomic rename，并在 index 最后一次性提交；只有 complete 状态对播放器可见。使用 app-private files/cache 分层，限制年龄、大小、并发和剩余空间，显式处理 206/range、过期签名和账号登出。离线副本必须基于用户拥有的访问权和 provider 条款，不绕过 DRM、paywall、region 或账号权限；默认不备份 cache/secret。
- 验证：写入中 kill、断电模拟、磁盘满、空间不足、hash/length mismatch、重复下载、并发同一 track、过期 URL、logout、backup/restore 和离线播放；扫描目录确认没有 partial 可见文件，重启 repair 能删除孤儿并保留完整条目。验证缓存命中仍检查 entitlement，不以本地文件绕过权限。
- 阶段 / 依赖：S2 打好 storage/secret 约束，S3 实现 cache/download/history；依赖 P5、P9、P10、P18。
- 发布门禁：可能播放损坏/partial 文件、无界占满磁盘、把敏感 cookie/token 入 cache，或绕过版权/账号边界时 BLOCK。仅“稍后下载”尚未实现应隐藏，不得显示假进度。

### P12：WebMessage 请求竞态、超时和销毁后的回调造成幽灵结果

- 预警信号 / 当前证据：lowebutil.js 的 timeout 只从 JS pending Map 删除；AndroidHttpBridge 有单 worker/16 队列，但 request id 没有映射到可中止的 native call。页面导航、Activity destroy 或 renderer crash 后，原生工作仍可能完成；reply 通过 main thread 捕获 WebView destroyed，导致 spinner 永不结束或结果静默丢失。
- 预防：建立 page/session/lifecycle scoped request registry；每个 request id 绑定 native Future/connection，超时、cancel、destroy、navigation 都真正 abort，统一 reject 所有 pending。用 operation generation 丢弃旧 response，队列满立即返回 backpressure，不在回调中重新发无限请求。listener 安装/移除单一化，feature 不支持时走显式错误。
- 验证：乱序 response、JS timeout、native timeout、页面导航、旋转、WebView destroy、renderer death、重复 id、16+ 队列、慢 body、取消后晚到的 success/error；断言没有悬挂 pending、泄漏线程、旧结果覆盖新 track，UI 每条路径都有终态。
- 阶段 / 依赖：S0 必须完成；S1/S2/S3 所有 bridge consumer 复用。依赖 P2、P4、P9。
- 发布门禁：任何核心 action 会无限 spinner、销毁页面后仍能写 UI/播放，或依赖“不可靠的 late callback”恢复时 BLOCK。

### P13：UI 做出“平价”外观，但能力实际为空或不一致

- 预警信号 / 当前证据：共享 loweb.js 注册 Netease/QQ/Kugou/Kuwo/Bilibili/Migu/Taihe 和多种 login；Android README 却明确是 foreground WebView sample，缺 native login、background、offline、lyrics 等。静态 mobile_ui_contract 只能证明元素/CSS 存在，不能证明按钮完成动作。最危险的是显示下载、后台、登录、翻译、频谱、MV 控件，但点击后 no-op、toast 成功或状态会回退。
- 预防：启动时交换 capability matrix（provider/search/play/login/background/offline/SAF/lyrics/MV/effects），组件只渲染可用项；不可用项显示明确原因和下一步，错误状态不可伪装成 success。把“UI parity”和“runtime parity”分开验收，所有假数据（频谱、时间戳、翻译、歌词）必须禁止冒充真实结果。
- 验证：对 release-like APK 逐项点按所有可见控制，覆盖网络断开、cookie 失效、后台切换、无通知权限、无 SAF grant 和 provider schema error；截图/录屏加事件日志证明按钮改变了真实 native/provider 状态。检查 capability handshake 改变后 UI 无陈旧入口。
- 阶段 / 依赖：S0 定义 capability/error；S1–S3 各阶段只能开放已验证 slice；S4 做完整 UI+真机验收。依赖 P3、P6、P7、P10、P11。
- 发布门禁：任何对外宣传的能力是死按钮、假成功、假频谱/歌词/下载或 foreground 冒充 background 时 BLOCK parity release；内部样本也必须带“未实现”标识。

### P14：媒体 MIME/codec、Range、签名 URL 和 HTML5 format 假设不成立

- 预警信号 / 当前证据：player_thread.js 创建 Howl 时固定 format mp3，而 Bilibili 等 provider 可能返回 audio/mp4、DASH 或多个 CDN 音频流；WebView/设备 codec 支持并不等于桌面 Electron。签名 URL 可能短时过期、要求 Range/referer，且 desktop 的全局 CORS rewrite 在 Android 不存在。结果常是 search 成功、点击后静音/秒退/播错媒体。
- 预防：native Media3 根据 manifest MIME/codec、容器、bitrate 和 URL expiry 选择合法 rendition，正确处理 Range/206、redirect policy 和 provider-required referer；不要用 format mp3 强行覆盖真实类型。区分 audio-only、video/MV、DASH/渐进式文件；无法支持时返回 codec/manifest unsupported，不静默 fallback 到错误分集。
- 验证：API 26 和当前设备覆盖 MP3、AAC/M4A/MP4、DASH、无 Range、206、过期签名、错误 MIME、video-only 和多音轨；测冷启动、seek、切网和重试。检查实际 Media3 timeline/decoder error、通知 metadata 和听感，不能只以 URL/HTTP 200 判定成功。
- 阶段 / 依赖：S1 先建唯一 native player；S2 逐 provider 适配 manifest；S3 扩展 MV/effects。依赖 P1、P3、P6、P7。
- 发布门禁：任一核心 provider 在支持设备上无法稳定解码/seek，或 fallback 播放错误媒体时 BLOCK 该 provider；尚未覆盖的编码必须隐藏或标 unsupported。

### P15：WebView 启动、Angular/可视化和网络解析超过移动预算

- 预警信号 / 当前证据：WebView/Chromium renderer 自身占用显著内存，MainActivity 在 UI 线程创建 WebView；共享 bundle 包含多个 provider、player_thread、分析器和 Angular 初始化。频谱/AudioContext、歌词刷新、history 写入、并行 provider 和无界 response 可能在低端设备上造成 ANR、OOM、掉帧、电量异常。
- 预防：定义并记录 cold start/TTID/TTFD、首播、search、seek、内存、renderer RSS、网络 body、battery 的预算；按 capability 懒加载 provider，限制 response/并发/日志，节流可视化与 history，避免 UI 线程 JSON/磁盘/解码。只保留一个 WebView 和一个 player，及时释放 renderer、临时文件和 observer；需要时评估当前 WebKit 版本能力，不凭 undocumented workaround。
- 验证：API 26 低端和当前参考设备用 release-like 包执行 am start -W、Perfetto/FrameMetrics、dumpsys meminfo（含 renderer）、长时间播放、快速搜索/换歌、旋转、后台/恢复和磁盘接近满；记录 ANR/OOM/jank、电池和网络总量。静态的 requestIdleCallback/CSS 断言不算性能证据。
- 阶段 / 依赖：S1 建 budget 和测量点；S2/S3 在每个 provider、歌词、cache、effects 加入后重测；S4 gate。
- 发布门禁：超过已批准 SLO、发生 ANR/OOM/持续双播放器，或没有任何真机测量却宣称 production parity 时 BLOCK；单一非核心特效可在超预算时隐藏。

### P16：只跑静态/JVM/debug 检查，却把 APK 当作已验证产品

- 预警信号 / 当前证据：当前 workflow 运行 Gradle JVM tests、assembleDebug 和 apksigner；mobile_ui_contract、startup contract 及多数 JS tests 是源码/VM 静态契约。没有 emulator/instrumentation/WebView listener/Media3 service/provider login/SAF/background/release-minify 旅程，debug build 的 WebView debugging 和依赖状态也不能代表发行包。
- 预防：建立分层门禁：JVM policy；Node/provider schema；Android instrumentation（bridge origin/limits/cancel、lifecycle、SAF、storage）；local HTTPS fixture；Media3/audio focus/notification service；emulator API matrix；真实测试账号/脱敏 provider smoke；最终 release-like minified APK 安装验证。每项记录命令、输入来源、设备/API、时间、exit code 和未覆盖项。
- 验证：在本地 CI 中运行仓库定义的完整 gate，确认它确实包含上述运行时层；手动复核 workflow 没有只构建 debug 后就报告 parity。若外部 provider、签名 release、物理 Bluetooth/通知、生产模板未测，报告 not verified 而非绿灯。
- 阶段 / 依赖：S0–S3 每完成一个 slice 增加对应测试；S4 做完整 CI/device/release 证据。依赖所有能力项，尤其 P2/P6/P7/P9/P12。
- 发布门禁：核心能力仅有静态、JVM 或 assembleDebug 证据，BLOCK 发布/关闭 parity 任务；非核心未测能力可以保持隐藏并列为 NOT VERIFIED。

### P17：照搬旧 RN mobile 的明文网络、过时依赖或错误语义

- 预警信号 / 当前证据：官方 listen1_mobile v0.8.2 是 React Native 0.59.9/React 16.8.3 时代的历史实现，使用旧的视频/音乐控制栈；旧 client 的 provider 列表和未知 provider 永不 settle 不能当作当前 contract。旧 NetEase/Kugou 文件还包含 direct provider 请求、部分 cleartext endpoint/caller cookie 处理。它们与现在的 AndroidX/WebView/Media3、target 35 和 HTTPS bridge 约束不同。
- 预防：只把旧仓库作为行为线索，逐项重写到当前的 AndroidX/Media3/HTTPS/Keystore/SAF contract；禁止复制 direct HTTP、调用方 Cookie header、永不结束 Promise、旧 background service 或未维护依赖。为 queue/backup/provider fallback 写迁移测试，保留差异说明。
- 验证：对引入的代码做历史 diff、依赖审计、cleartext/header/secret 扫描；用当前 API 26–35、WebView、Media3 和 release build 跑行为测试。验证未知 provider、网络失败和 callback 都会终止；确认没有旧 RN 原生模块或转录代码偷偷进入 APK。
- 阶段 / 依赖：S0/S1 先写当前合同，再在 S2/S3 迁移具体能力；S4 做依赖与 APK 审计。依赖 P1、P4、P7、P18。
- 发布门禁：复制的历史实现带明文、任意 cookie、hang 或不可维护依赖，BLOCK；历史行为与新合同不一致时以新合同为准并隐藏未迁移能力。

### P18：凭据、token、cookie 和个人数据泄漏进 bundle、日志、备份或 APK

- 预警信号 / 当前证据：CONCERNS 已确认 github.js 有 OAuth client secret/token localStorage 处理、lastfm.js 有 API secret/session localStorage，且 android/app/build.gradle 将这些脚本打包；Electron 另有 callback/IPC 注入风险。错误日志、media URL、gist/playlist 内容和 backup 也可能携带用户数据。本文不复制任何实际 secret 值。
- 预防：发行前删除或替换客户端 private secret；OAuth 用 PKCE/受控后端交换，public client id 也不能当 secret；token/session 只留 native Keystore/受保护存储，JS 仅接收最小短期 capability。禁把 token/cookie/完整媒体签名 URL/账号数据写 localStorage、普通日志、crash payload、cache、自动备份、diagnostic 或 URL query；登出并清除。对 legacy asset 做依赖/secret 扫描，不能因为脚本“未调用”就当安全。
- 验证：使用 redacted secret scanner 和 source/APK 解包扫描（只报告文件/匹配类型，不打印值），检查 JS bundle、resources、assets、BuildConfig、日志、backup rules、cache 和 error telemetry；执行登录、刷新、登出、崩溃和网络失败，验证输出均脱敏。轮换已暴露凭据由凭据持有人另行执行并留下记录。
- 阶段 / 依赖：S0 定义 secret/data classification；S2 实现 native session/storage；S4 做 release APK、backup、日志和供应链扫描。依赖 P2、P5、P11、P16。
- 发布门禁：APK/JS/assets/日志/备份中存在 private secret、可复用 token、完整 cookie 或未脱敏个人数据时 BLOCK，必须先移除/轮换并重跑验证；这是全局 release blocker，不可用隐藏 UI 绕过。

## 建议的阶段 gate

1. S0 先冻结 bridge origin/host/path/body/timeout/cancel、capability、错误、secret 和版权边界；P1、P2、P4、P12、P18 任何一项不通过，不进入 provider 扩展。
2. S1 只实现一个 Media3 Player、MediaSessionService、通知、audio focus/noisy、controller 和生命周期恢复；P6、P7、P8、P9、P14 必须先有 API 矩阵和真机证据。
3. S2 逐 provider 实施 schema/auth/manifest/lyrics/local/SAF/persistence；按 P3、P5、P10 的 provider-specific evidence 开放 capability，不以 registry 或旧 RN 代码推断。
4. S3 再加入 cache/download/history/MV/effects；P11、P13、P15 的完整性、版权、性能和 UI 证据不足时保持入口隐藏。
5. S4 运行 release-like APK、instrumentation、emulator/physical device、通知/Bluetooth/进程死亡和 source/APK secret scan；P16 记录完整命令和覆盖限制，所有 BLOCK 清零后才可声称 parity/release。

## 一手资料与当前仓库依据

### Android / AndroidX 官方资料

- [Media3 background playback](https://developer.android.com/media/media3/session/background-playback)：后台播放应由 MediaSessionService 持有 Player/MediaSession，并声明 mediaPlayback FGS。
- [Control and advertise playback using MediaSession](https://developer.android.com/media/media3/session/control-playback)：MediaController、系统媒体控件、锁屏、耳机和 Bluetooth 的连接关系。
- [MediaSessionService reference](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)：服务生命周期、前台服务时机和单一服务模型。
- [Manage audio focus](https://developer.android.com/media/optimize/audio-focus)：focus 请求/释放、loss/duck/noisy 行为，以及 Android 12+ 和 target API 35 限制。
- [Notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission?hl=en)：Android 13+ POST_NOTIFICATIONS 的首次安装、用户拒绝和 FGS 通知测试边界。
- [Foreground-service background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)：Android 12+ 从后台启动 FGS 的限制和异常。
- [Activity lifecycle](https://developer.android.com/guide/components/activities/activity-lifecycle) 与 [process lifecycle](https://developer.android.com/guide/components/activities/process-lifecycle)：onDestroy 不保证覆盖进程被杀、系统可回收进程，状态必须另存。
- [Save UI states for Views](https://developer.android.com/topic/libraries/architecture/views/saving-states-views)：saved state 只负责小型瞬时 UI，持久业务状态放在 durable storage。
- [Document providers / SAF](https://developer.android.com/guide/topics/providers/document-provider) 与 [shared documents](https://developer.android.com/training/data-storage/shared/documents-files)：ACTION_OPEN_DOCUMENT、持久化 URI 权限和 provider 能力。
- [App-specific files](https://developer.android.com/training/data-storage/app-specific) 与 [Auto Backup](https://developer.android.com/identity/data/autobackup)：私有文件、可清理 cache、空间/配额和敏感数据排除。
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)：不可导出 key material 和 native secret storage 边界。
- [WebView native API/JS bridge](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge?hl=en) 与 [WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat)：origin-aware WebMessageListener、frame/sourceOrigin 校验、feature 可用性和 addJavascriptInterface 风险。
- [WebViewAssetLoader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)：HTTPS appassets origin、same-origin 资产加载和 file URL 边界。
- [Cleartext communications](https://developer.android.com/privacy-and-security/risks/cleartext-communications?hl=en) 与 [network security config](https://developer.android.com/privacy-and-security/security-config?authuser=2)：明文流量可被篡改/窃听，应保持禁用并使用窄例外。
- [WebView memory](https://developer.android.com/topic/performance/memory/guide/webview-memory)、[WebView startup](https://developer.android.com/develop/ui/views/layout/webapps/optimize-webview-startup) 和 [Build web apps in WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview)：renderer 内存、启动成本、UI 卡顿及销毁约束。

### Listen1 官方历史资料（仅作迁移警示）

- [listen1_mobile v0.8.2 package.json](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/package.json)：记录旧 RN/React/原生媒体依赖的历史版本，不能作为当前 AndroidX/Media3 依赖基线。
- [listen1_mobile v0.8.2 client.js](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/api/client.js)：旧 provider 列表和未知 provider 不结束的 Promise，证明 P4 的历史陷阱。
- [listen1_mobile v0.8.2 background-player.screen.js](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/views/player/background-player.screen.js)：旧 RN 播放控制行为线索；不等于当前 Media3 service 合同。
- [listen1_mobile v0.8.2 NetEase provider](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/api/providers/netease.js) 与 [Kugou provider](https://raw.githubusercontent.com/listen1/listen1_mobile/v0.8.2/src/api/providers/kugou.js)：历史直连、部分明文 endpoint 和 caller cookie 处理的迁移警示；不应复制到新 Android bridge。

### 当前仓库依据

- .planning/PROJECT.md：目标、反特性、依赖顺序、Android 当前边界和验收要求。
- .planning/codebase/CONCERNS.md：legacy Electron 权限/凭据、Android bridge、provider drift、测试和发布盲点。
- .planning/research/FEATURES.md：能力矩阵、反特性、cache/SAF/Media3/真实设备证据要求。
- android/README.md、android/app/src/main/AndroidManifest.xml、android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java、AndroidHttpBridge.java、HttpBridgePolicy.java：当前 WebView、HTTP policy、生命周期和构建边界。
- app/listen1_chrome_extension/js/bridge.js、player_thread.js、loweb.js、lowebutil.js、provider/netease.js、provider/bilibili.js、app/bilibiliService.js：共享前端的 player、callback、provider、manifest 和 bridge 现状。
- .github/workflows/android-apk.yml、app/listen1_chrome_extension/test/mobile_ui_contract.test.js、mobile_startup_performance_contract.test.js：当前静态/JVM/debug 验证范围。

本文件的结论只支持“下一阶段需要补齐哪些证据和 gate”，不把历史代码、静态测试、一次 HTTP 成功或 debug APK 误称为已完成的 Android parity。
