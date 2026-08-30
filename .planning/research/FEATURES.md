# Android 音乐播放器 capability landscape

研究日期：2026-08-30。本文是 Android 重建的能力基线和验收合同，不是把旧移动端功能清单直接当作实现计划。

## 结论先行

- 桌面 `v2.34.0` 是当前产品行为基线：它已经明确了 Bilibili 音频缓存、响度归一化、歌词和手工翻译、DeepSeek 确认流程、播放队列、历史/年度回响、歌单合并备份等行为。[桌面 README（v2.34.0）](https://github.com/dazzlingwuming/listen2/blob/v2.34.0/README.md)
- 当前 Android 只是受信任 appassets origin 中的共享前端 WebView，加上一个“搜索用”的受限 HTTP bridge。它没有 Media3 后台服务、原生登录/session、SAF 本地音乐、离线缓存、Electron IPC、桌面歌词工作流或已验证的 parity。[Android README](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/android/README.md)
- `listen1/listen1_mobile@v0.8.2` 只能作为历史行为/数据合同证据。该 tag 的提交时间是 2021-05-12，README 仍写 v0.8.1；它有 provider 搜索/浏览、收藏歌单、基础播放器、后台控制和剪贴板备份，但没有足以证明歌词 UI、SAF、缓存下载、MV、年度回响、DeepSeek 或 Android Keystore 的实现。旧代码的直接 provider HTTP 和“导入覆盖当前数据”行为不能复制为新 Android 合同。[旧移动端 v0.8.2](https://github.com/listen1/listen1_mobile/tree/v0.8.2)
- 因而每项能力都必须同时回答四件事：桌面已有行为是什么、旧移动端是否真的有证据、Android 等价 UX 如何落地、以及如何在真实设备上验收。

## 标记与复杂度

| 标记 | 含义 |
| --- | --- |
| `[T]` | Android 音乐播放器的 table stakes；没有它就不应宣称可用播放器。 |
| `[P]` | 当前桌面显式 parity 要求；行为、错误边界和数据语义要对齐，不能只做同名按钮。 |
| `[E]` | Android-equivalent UX：可以使用 Android 原生交互/生命周期，但用户结果要等价。 |
| `[AF]` | anti-feature：明确不做，或必须防止的危险/误导行为。 |
| `D` / `A` / `M` | 桌面当前证据、当前 Android 证据、旧移动端 v0.8.2 证据。`—` 表示该来源未提供证据，不能据此断言“从未存在”。 |
| `S / M / L / XL` | 复杂度：小屏/策略、跨层数据流、原生媒体/存储生命周期、跨 provider 与安全/设备矩阵。 |

## 能力矩阵

| 能力 | 标签与现状 | 已确认事实（不要越界推断） | Android 等价 UX / 数据合同 | 复杂度与依赖 | 可验证行为 |
| --- | --- | --- | --- | --- | --- |
| 启动、移动 UI、导航 | `[T][P][E]`；D✓ A△ M✓；`L` | 共享前端已有移动 library hub、我的/收藏/创建歌单、本地音乐、账户、年度和设置入口；Android 当前只加载 packaged WebView asset。旧移动端有 Home/Details/Playlist/Player/Settings 等路由和 mini/modal player，但不是当前原生实现。 | Android 启动后先显示可交互 shell，再惰性加载 i18n、profile、auth、playlist；底部/返回手势、系统 inset、旋转和深链接不能破坏当前播放。桌面能力在小屏改为 bottom sheet、tab、mini-player，不隐藏必需状态。启动预算须按代表性 API 级别测量并记录，不凭感觉宣称“快”。 | `L`；WebView asset、生命周期、WindowInsets、状态恢复、导航状态机。可参考 Android 启动时间指标。[Launch-time guidance](https://developer.android.com/topic/performance/vitals/launch-time) | 冷启动/热启动记录 TTID/TTFD；API 26 与当前 API、手势/三键导航、横竖屏各通过；首次网络不可用时仍能打开本地 shell；进程被杀后恢复可解释，且不重复发起未完成请求。 |
| 搜索 | `[T][P][E]`；D✓ A△ M✓；`M` | 桌面 `MediaService.search` 汇总多 provider；旧 v0.8.2 `Client.search` 有分页 FlatList 和播放结果，但只启用 NetEase、KuGou、Kuwo、QQ。当前 Android bridge 只允许受限 Bilibili GET 和一个精确 NetEase web-search 路由，不能当作完整 provider 搜索。 | 搜索框、提交/取消、分页或滚动加载、provider 标签/过滤、结果类型和可播放状态要明确；每个请求带 query/request id，超时、取消、部分 provider 失败要显示可恢复错误，不能把被拒绝请求伪装为空结果。 | `M/L`；provider capability registry、bridge allowlist、请求取消/超时、前端结果模型。 | 固定 fixture 下 query、分页、取消、重复提交、部分失败和空结果均有确定状态；bridge 拒绝越权 URL、超长 query、非 GET、错误 origin；真实设备不因一个 provider 失败而卡住全部列表。 |
| 目录、provider 浏览、详情 | `[T][P][E]`；D✓ A— M✓；`L` | 桌面 provider registry 当前含 NetEase、QQ、KuGou、Kuwo、Bilibili、Migu、Taihe 等；旧移动端有 provider tabs、playlist grid、playlist detail 和分页。Android 当前没有对应的 native/provider 完整路由。 | 目录页要能区分“搜索支持”“歌单浏览”“详情/曲目”“登录后内容”“媒体获取”能力；分页游标、刷新、重试和 provider 空目录有一致状态；封面加载失败不阻塞文字和播放。 | `L`；registry、bridge routes、图片缓存/解码、分页状态、错误模型。 | 对每个宣称支持的 provider 至少验证：目录→详情→曲目→播放；能力矩阵中的不支持项显示禁用/说明而非死按钮；返回、旋转和重进页面不重复追加曲目。 |
| 歌单、收藏、我的库 | `[T][P][E]`；D✓ A△ M✓；`L` | 桌面有我的/收藏歌单、创建/编辑/删除/排序及 backup merge；旧移动端 reducer 支持 favorite、create/save/edit/recover 和去重，UI 有“我的” tab。当前 Android 共享 UI 资产存在入口，但 Android 本地数据和登录歌单同步未验证。 | 本地歌单与 provider 远端歌单分层；创建、改名、增删曲、重排、收藏/取消收藏、删除均可撤销或给出确认；重复曲目的规则沿用桌面。离线可浏览本地歌单，远端刷新失败不清空已有内容。 | `L`；持久化 schema/migration、provider auth、并发写入、排序、冲突策略。 | 重启、进程杀死、升级 schema 后歌单仍可读；重复 add、快速连续编辑、远端失败、删除确认均有测试；不得把 session/cookie/API key 写入歌单。 |
| 播放器核心 | `[T][P][E]`；D✓ A△ M✓；`L` | 桌面 player 支持 play/pause/toggle/seek/next/prev/random/loop/mute/volume、当前曲目和恢复；旧移动端使用 `react-native-video`，有 mini/full player、seek、favorite、模式和播放失败处理。当前 Android 是 WebView media，未接原生播放服务。 | 当前曲目、封面、标题/作者、缓冲/时长/进度、seek、音量/静音、播放/暂停、上/下一首在小屏和通知中一致；媒体 URL 失败要保留曲目上下文并可重试/切换候选。 | `L/XL`；Media3 ExoPlayer、MediaSession、音频解码、provider bootstrap、生命周期。 | 夹具音频验证首帧、seek、暂停/恢复、断网、URL 失败、自然结束和重复模式；UI、通知、耳机按钮读到同一 `PlaybackState`；不产生双重播放器实例。 |
| 播放队列、模式、历史指针 | `[T][P][E]`；D✓ A— M△；`L` | 桌面有独立 FIFO `play-next-queue`，支持重复、重排、移除、清空、重启恢复；shuffle 为每周期 Fisher–Yates，无周期内重复，previous 依赖真实历史。旧移动端 reducer 的 `add-next` 是“插到当前曲目后”，不等同于桌面独立 FIFO，不能误报 parity。 | 队列 sheet 显示来源、顺序、重复项；play-next 与当前歌单分开；shuffle/loop 的语义在重启后保持，previous 不应凭算法猜上一首。 | `L`；持久化、player state machine、Media3 queue、历史栈、并发事件去重。 | 测试 duplicate/reorder/remove/clear/restart、shuffle 周期和 previous；快速 next、自然结束、URL 失败、进程恢复不会跳过/重复消费 queue；旧移动端 add-next 行为不作为验收标准。 |
| 歌词、同步、手工翻译 | `[P][E]`；D✓ A— M—；`XL` | 桌面有 synced lyrics、offset/highlight/bilingual、跨 provider 候选、手动选择并持久化、已有翻译；DeepSeek 翻译另列。旧 v0.8.2 只有 provider metadata 中的 `lyric_url` 字段，没有 lyric UI/controller 证据，不能称为旧移动端现成能力。 | 播放页/歌词页支持候选选择、滚动同步、offset、原文/译文切换和“无歌词/时间戳不足”降级；手工选择按 track/provider/revision 绑定，旧响应不能覆盖新曲目；翻译仅在用户确认后执行。 | `XL`；歌词 provider bridge、时间轴模型、播放器时钟、持久化、翻译确认/缓存、无障碍 live region。 | fixture 覆盖无歌词、纯文本、错位、双语、手工覆盖、切歌竞态、offset 边界；重启后选择和译文可恢复；未确认不发生 DeepSeek 请求，不能把机器译文标成原文。 |
| 后台播放、通知、焦点、耳机/蓝牙 | `[T][P][E]`；D✓ A— M✓；`XL` | 旧移动端 `background-player.screen.js` 用 `react-native-music-control` 注册 play/pause/next/prev，处理锁屏元数据、进度、自然结束和 audio focus loss；Android 当前 `MainActivity` 没有 Media3 service，销毁 Activity 会销毁 bridge/WebView。 | 用 `MediaSessionService` 承载唯一播放器；前台播放显示媒体通知，锁屏/蓝牙/耳机控制与页面同源；audio focus loss、duck、电话/导航打断按系统规则恢复；screen-off、Activity 重建和进程回收都要有明确状态。后台下载与后台播放分开授权。 | `XL`；Media3 `MediaSessionService`、通知/foreground service、AudioFocus、Bluetooth/AVRCP、启动与电量策略。参考 [Media3 background playback](https://developer.android.com/media/media3/session/background-playback)、[MediaSession controls](https://developer.android.com/media/media3/session/control-playback)、[audio focus](https://developer.android.com/media/optimize/audio-focus)。 | 真机锁屏、通知 action、线控、蓝牙连接/断开、电话/导航焦点、Activity 重建、屏幕熄灭、进程杀死逐项验证；通知中的曲目、播放位置、队列与页面一致；无播放时不常驻高耗电服务。 |
| 登录、刷新、session、退出 | `[P][E]`；D✓ A— M△；`XL` | 桌面 Electron session 有 Bilibili QR/cookie/refresh token safe storage、登录用户歌单和退出清理；旧移动端 client 的 provider 集合不含 Bilibili，README 只表述旧式 provider 能力；当前 Android bridge 不转发 caller headers，也没有登录 session。 | 登录页先显示 provider 支持/权限范围；QR 状态有等待、成功、过期、取消、重试；session 只在 native 安全存储，JS 只拿短生命周期能力结果；logout 清 server/local session、通知和缓存索引中可识别的凭据引用，不删除用户明确保留的歌单。 | `XL`；各 provider auth contract、WebView cookie 隔离、Android Keystore、生命周期/时钟、隐私 UI。参考 [Android Keystore](https://developer.android.com/privacy-and-security/keystore)。 | fixture/测试账号验证 login→refresh→过期→重登→logout；旋转、后台、进程杀死不会泄露 token；日志、备份、错误、WebView JS、APK 资源中没有 cookie/refresh token；未经用户选择不自动登录第三方。 |
| 本地音乐与 SAF | `[T][P][E]`；D✓ A— M—；`L` | 桌面 Electron file picker 读 flac/mp3/mp4/ogg/wav/webm tags，并读取相邻 LRC；保存的是桌面 `file://` 路径。旧移动端未提供 SAF 证据。当前 Android 只有 library 入口，不能把入口当作导入已完成。 | 使用 `ACTION_OPEN_DOCUMENT`/`OpenMultipleDocuments`，持久化 URI grant 和内容标识，不要求广泛文件权限、不把绝对路径传入 JS/备份；ContentResolver/FD 读取 tags，允许用户显式选择相邻歌词或可访问 URI；本地曲目和远端曲目有明确来源图标。 | `L`；SAF、URI permission、媒体解码/tag parser、Media3、schema migration。参考 [Document provider](https://developer.android.com/guide/topics/providers/document-provider)、[shared documents](https://developer.android.com/training/data-storage/shared/documents-files)。 | 选择单个/多个文件、重启/升级/撤销权限、SD/云 provider、不可读/重复/大文件逐项验证；失去 URI 权限显示修复入口而不是崩溃；备份中不出现路径和 URI grant 私密材料。 |
| 备份、恢复、歌单合并 | `[P][E][AF]`；D✓ A△ M✓（语义不同）；`L` | 桌面备份格式 `listen2-playlist-backup` v2，只备份我的/收藏歌单；排除 credentials、local paths、theme、lyrics；默认 merge，identical skip、同名独立、ID conflict 生成新 ID，并保留旧格式兼容；旧移动端 export/import 是 JSON clipboard，import 会警告后覆盖当前数据。 | Android 通过 SAF 导出/导入文件；默认 merge、预览变更、逐歌单冲突摘要和失败回滚；覆盖必须是高级显式确认并可恢复。不得把 cache、token、历史隐私、设备路径、Keystore 内容塞进备份。 | `L`；版本化 schema、SAF、原子写入、冲突/去重、大小上限、迁移。 | 导出→清空测试数据→导入、重复导入、同名/ID 冲突、损坏/超大/旧版本文件、导入中断均有确定结果；默认导入不会删除现有歌单；恶意 JSON 不触发原型污染/超额内存。 |
| 播放历史、年度回响 | `[P][E][AF]`；D✓ A— M—；`L` | 桌面只计实际 forward listening，合格阈值为播放超过 30 秒且达到半首或 4 分钟下限；有年度总时长/播放数/曲目/艺人/Top/月趋势、本地 opt-out/export/clear。旧移动端没有历史/年度功能证据。 | 记录应在 Media3 播放事件与应用生命周期交界处去重；页面提供启用说明、年度切换、空态、导出和清除；统计默认本地，不上传，也不把暂停/seek/失败算作听完。 | `L`；持久化、时钟/前后台事件、队列来源、年度聚合、隐私开关。 | fixture 模拟短听、半首、4 分钟、seek 回退、重复回调、跨午夜/跨年、进程杀死；摘要与导出一致；关闭开关后不再增长，clear 后不可从缓存/日志恢复统计。 |
| 缓存、下载、离线恢复 | `[P][T][E][AF]`；D✓ A— M—；`XL` | 桌面 Bilibili 音频在真实播放后低优先级完整缓存，并区分 temporary、playlist、explicit download 保留；默认容量 2GB/设备可用上限，原子索引、完整 hash、LRU、离线命中、损坏恢复和自定义 Range protocol；缓存不进 backup/Gist。旧移动端没有缓存/下载证据。 | Android 缓存置于 app-private 存储，索引与媒体文件原子提交、hash/size 校验；离线先命中完整媒体，损坏项可删除重取；用户能查看容量、保留级别、删除/清空；显式 download 与“播放后缓存”分开，后台网络/电量策略透明。 | `XL`；Media3 cache/DataSource、WorkManager 或前台下载通知、磁盘配额、hash、并发取消、Doze/网络约束。 | 断网播放命中/未命中、部分下载、hash 错误、磁盘满、进程杀死、重复下载、LRU/保留级别、升级索引逐项验证；不会返回未完整文件；清除缓存不删除歌单/历史；不在 backup/log 中携带媒体或路径。 |
| MV、视频、画中画 | `[P][E]`；D✓ A— M—；`XL` | 桌面有 Bilibili MV player、part/quality、fullscreen 和音频 fallback，但 `canPlayBilibiliMv` 当前检查 Electron；README 已提示 codec/CDN/device 限制。旧移动端 tag 没有 MV 实现证据。 | Android 只有设备/codec/授权可行时才显示视频播放；从音频结果进入 MV 要保留队列/进度语义；旋转、全屏、画中画、锁屏和返回必须可恢复；不支持时明确回退音频，不显示黑屏成功。 | `XL`；Media3 video/codec、Window fullscreen/PiP、CDN/quality manifest、流量和缓存策略。 | 真机 API/codec 矩阵验证加载、part、quality、横竖屏、PiP/返回、CDN 失败和音频 fallback；不支持设备显示可行动错误；视频缓存不会绕过 provider 权限或 DRM 限制。 |
| 音效、频谱、可视化 | `[P][E][AF]`；D✓ A— M—；`L/XL` | 桌面播放器有 AudioContext 频谱和 play controller 音效；README 称 real spectrum、theme 和 loudness。旧移动端没有等价音效/频谱证据。Android WebView AudioContext 在后台/设备上不能假定可靠。 | 优先原生 audio output/effect 或设备能力探测；频谱关闭、权限/性能不足时显示静态/隐藏状态，不能伪造实时数据；音效 preset、开关、重置和耳机/蓝牙切换要可解释。 | `L/XL`；Media3 audio pipeline、AudioEffect/Visualizer、采样率、线程/电量、设备兼容性。 | 在支持和不支持设备验证频谱实时性、音效启停、切歌/暂停、后台、蓝牙切换；CPU/电量有预算；异常 effect 不让播放链崩溃。 |
| 响度分析与归一化 | `[P][E][AF]`；D✓ A— M—；`L/XL` | 桌面目标约 `-14 LUFS`、`-1 dBTP`，本地后台分析、不上传、不阻塞首播，仅在分析 ready 时固定增益；结果按音频 hash 绑定。README 也明确 decoder/resampling/limits 是边界。旧移动端没有证据。 | Android 在本地完整媒体上做受约束的后台分析；首播不等待，未 ready 保持原音量；输出显示可关闭/重置，避免系统音量与固定 gain 叠加失真。 | `L/XL`；native decoder/resampler、WorkManager、hash index、线程/电池、输出链路。 | 已分析/未分析/分析失败三态；同一 hash 命中一致 gain，媒体变更失效；真峰值 clipping、暂停、切歌、耳机切换和低电量策略可测；无网络上传。 |
| DeepSeek 歌词翻译 | `[P][E][AF]`；D✓ A— M—；`XL` | 桌面要求用户配置 key、测试连接并在完整歌词翻译前确认；按行对齐、缓存，key 使用 Electron safeStorage；README 明确可能产生费用，绝不自动调用。旧移动端没有证据。 | Android key 只进 Keystore；设置页说明数据、费用、保留和失败；一次完整歌词请求有确认、取消、超时、隐私提示和缓存命中；没有 key/网络/用户确认时仍能正常播放原文。 | `XL`；Keystore、网络 bridge、provider lyric model、response schema/line alignment、加密缓存、rate limit。 | 单元 fixture 验证确认/取消、超时、部分/乱序 JSON、行数不匹配、重复缓存和退出登录；日志不含 key/全文歌词；无隐式预取、无首播阻塞、无把模型输出当权威事实。 |
| 安全、权限与信任边界 | `[T][P][E][AF]`；D△ A△ M—；`XL` | 当前 bridge 只接受可信 appassets origin、协议 v1、HTTPS、无 userinfo、默认 443、精确 Bilibili/NetEase 路由，限制 URL/message/response 大小、无 redirects/自定义 caller headers、in-memory `buvid3`；WebView 关闭 file/content access、mixed content 和 geolocation。另一方面，桌面/legacy JS 有 secrets/cookies 边界风险，发布流程偏 debug。 | 将 provider capability/URL/headers/cookies 作为 native allowlist；JS 不得任意 fetch、读文件或拿长期凭据；错误码不回显 token；最小权限、Network Security、备份排除和日志脱敏随 release 配置执行。 | `XL`；WebView hardening、native bridge schema、Keystore、provider auth、APK signing、静态扫描/渗透用例。 | 静态+instrumentation 测试 origin、scheme/host/port/path/query、超长/重定向/非 GET、文件 URI、JS 注入、恶意 manifest、cookie/token 泄漏；release APK 检查签名、资源和日志；任何拒绝都有结构化恢复路径。 |
| 无障碍与包容性 | `[T][P][E][AF]`；D△ A— M[AF]；`M/L` | 共享前端有部分语义/UI contract 测试，但没有真实 TalkBack/大字体设备证据；旧 `App.js` 设置 `allowFontScaling=false`，这是不能继承的 anti-feature。 | 所有按钮/图标/播放状态/歌词行/通知 action 有可读 label、role、state；焦点顺序跟随视觉/播放状态；触控目标至少 48dp、对比度/大字体/横屏可用，支持 TalkBack、减少动画；歌词同步不以颜色为唯一信息。 | `M/L`；WebView semantics、native views/content descriptions、font scale/insets、RTL/contrast、通知可访问性。参考 [Android accessibility](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views)。 | TalkBack 手工走完搜索→播放→队列→歌词→设置；font scale、display size、contrast、reduce motion 下无裁切/不可达控件；静态 lint/Accessibility Scanner 与 instrumentation contract 通过；不得关闭系统字体缩放。 |
| 错误、离线、恢复与可观测性 | `[T][P][E][AF]`；D△ A△ M△；`L/XL` | README 记录 provider/API drift、CDN fallback、MV codec、word-level timestamps、DeepSeek accuracy/cost、cache integrity 等真实限制；CONCERNS 指出 Android bridge 没有页面卸载取消、provider bootstrap/fallback 有挂起或无界风险。旧 client 对未知 bootstrap 可返回永不 settle 的 Promise，不能复制。 | 所有跨层调用有 deadline、cancel、request id、稳定 error code、用户可执行 retry；stale response 不得覆盖新曲目；offline、权限丢失、session 过期、cache 损坏、媒体 codec 不支持分别呈现。 | `L`；统一 error envelope、协程/线程取消、状态机、日志/崩溃报告脱敏、网络 fixture。 | 人为注入 408/5xx/DNS/断网/进程杀死/权限撤销/坏 JSON/坏音频；每项在有限时间内结束，UI 不死转；重试有上限/退避；恢复后只补发安全请求，不能重复添加队列或历史。 |
| 测试、发布与真实设备证明 | `[T][P][E]`；D△ A△ M—；`XL` | 当前测试主要是 Node feature tests、约 21 个 extension plain-Node contracts 和两组 Android JVM policy tests；workflow 运行 JVM tests、assembleDebug、apksigner，没有 emulator/instrumentation/Espresso/Robolectric、真实 WebView/audio/login/provider 证明。[测试说明](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/.planning/codebase/TESTING.md) | 将测试分层：纯策略/bridge/schema、JS feature contracts、Robolectric/instrumentation、API 级别 emulator、真机媒体/蓝牙/SAF/通知、release/minified smoke；provider 使用脱敏 fixture，禁止把真实账号/音频/凭据放入测试。 | `XL`；Gradle/JDK17、instrumentation runner、emulator matrix、Media3 test player、SAF provider fixture、签名 release、可重复网络 fixture。 | CI 至少运行 JVM+JS+instrumentation+release smoke；设备验收有日期/API/机型/网络条件和未覆盖项；失败保留日志但脱敏；“debug APK 构建成功”不等于后台播放、登录、缓存或 parity 已验证。 |

## Provider 与来源边界矩阵

这是“当前能否宣称支持”的最小矩阵。`当前 Android` 一栏按现有代码，不按计划或旧移动端 README 猜测。

| Provider / 来源 | 桌面 v2.34.0 | 旧移动端 v0.8.2 | 当前 Android | Android 进入 parity 的最小合同 |
| --- | --- | --- | --- | --- |
| NetEase | registry/search/playlist/bootstrap 等桌面链路 | client 已启用，支持 search/playlist/bootstrap | bridge 只开放精确 web-search 路由；不是完整 provider | 明确 search 与 playlist/media/auth 的独立 capability；每条路由都过 allowlist、取消和 fixture。 |
| QQ | 搜索/歌单/登录等桌面链路 | client 已启用 | 无 QQ route 证据 | 先补受限 route 和 session，再宣称目录/播放；不得沿用旧版直连 API。 |
| KuGou | 桌面 registry/provider | v0.8.2 已启用 | 无 route 证据 | provider contract、分页/播放 URL、错误和登录边界分别实现。 |
| Kuwo | 桌面 registry/provider | v0.8.2 已启用 | 无 route 证据 | 同上；把旧 direct HTTP 当历史证据而非安全实现。 |
| Bilibili | 音频、MV、QR login、manifest/CDN fallback、歌词候选等桌面链路 | client 中 import 被注释，不能称旧移动端已启用 | 受限 Bilibili GET/search 能力；没有 native auth/media manifest parity | 明确 API 与用户 session 分层；QR、manifest、音频/MV、歌词分别验收；不把 search bridge 当播放完成。 |
| Migu / Taihe | 桌面 registry/provider（登录能力依 provider 配置） | v0.8.2 client 未启用的证据 | 无 route 证据 | 只有实现并测试 capability 后才出现在 Android provider selector。 |
| Xiami / legacy provider | 当前 shared registry 中隐藏/legacy，不是默认支持声明 | source 中有 provider 文件但未由 client 启用；不能从文件存在推断可用 | 无 route 证据 | 只能作为迁移/兼容研究项，默认不显示、不发请求。 |
| Local music | 桌面 Electron picker、tags、相邻 LRC | 无 SAF/本地文件实现证据 | 仅有 shared UI 入口，导入未验证 | 以 SAF URI contract 和可撤销权限为准，不传桌面 `file://` 路径。 |

## 明确的 anti-features

以下不是“以后再做”的模糊项，而是产品边界或验收时应主动反测的禁止行为：

- 不绕过 paywall、DRM、地区限制或 provider 权限；桌面 README 的“只处理用户有权访问的内容”继续适用于 Android。[产品边界](https://github.com/dazzlingwuming/listen2/blob/v2.34.0/README.md#L18-L20)
- 不把旧移动端的 direct provider HTTP、永不 settle 的未知 bootstrap、clipboard 覆盖式导入带回 Android；新 bridge 必须是 HTTPS、精确 allowlist、有限超时、可取消、结构化错误。
- 不在没有用户确认时调用 DeepSeek、上传完整歌词/本地文件、消耗流量或产生可能计费的机器翻译；不把 API key、cookie、refresh token 写入 JS、备份、崩溃日志或 APK 资源。
- 不默认收集云端行为分析；历史/年度回响保持本地、可 opt-out/export/clear，且只有满足桌面定义的实际 forward listening 才计入。
- 不把“播放器入口”“provider 列表”“搜索结果”伪装成已支持的目录、登录、媒体、歌词或后台播放；capability selector 必须与真实 route 和设备测试一致。
- 不返回未完整或 hash 不匹配的缓存，不无限重试/无界 fallback，不因一项 provider/歌词/MV 失败而清空歌单或卡住主播放器。
- 不伪造频谱、时间戳、翻译或 MV 成功状态；设备 codec/网络/权限不支持时给出可行动的降级（例如音频 fallback）。
- 不继承旧移动端 `allowFontScaling=false`，不以颜色/动画作为唯一状态，不在未播放时用常驻高耗电服务维持假“后台能力”。

## 建议的依赖顺序与出入口

这些顺序是能力之间的真实依赖，不代表本文件已批准实施：

1. **信任边界与可取消 bridge**：冻结 provider capability、error envelope、session/secret 规则，补静态/JVM/instrumentation policy tests；未通过前不扩展网络路由。
2. **移动 shell 与原生播放骨架**：启动/insets/导航状态机，唯一 Media3 player + MediaSessionService，完成通知、audio focus、耳机/蓝牙、队列恢复；这是后台、历史、歌词和缓存的共同时钟。
3. **数据能力**：provider 搜索/目录、歌单 schema、登录/session、SAF URI、本地持久化、备份 merge；每个 provider 按 capability 逐项启用。
4. **离线与增强媒体**：cache/download、历史/年度、歌词/手工翻译、MV、音效/频谱、响度；每项都遵守电量、流量、设备 codec 和隐私边界。
5. **AI 与发布证明**：DeepSeek 明确确认/Keystore/费用/缓存，再做 release/minified、API/真机矩阵、无障碍和恢复 UAT；所有未覆盖设备/ provider 在交付记录中标注 `not verified`。

## 证据索引

### 当前仓库（官方 GitHub 源）

- [桌面 README v2.34.0](https://github.com/dazzlingwuming/listen2/blob/v2.34.0/README.md)：产品边界、现代播放器、歌词/DeepSeek、缓存、响度、歌词窗口、shuffle/queue、历史/年度、备份、登录和限制。
- [项目目标与 Android active requirements](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/.planning/PROJECT.md)：当前 Android 不足、目标 parity、Media3、SAF、Keystore、测试与验收范围。
- [Android README](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/android/README.md)：WebView asset、bridge allowlist、构建和当前不支持边界。
- [Android MainActivity](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/android/app/src/main/java/com/listen1/android/MainActivity.java)：WebView hardening、生命周期、origin 和媒体手势配置。
- [Android HttpBridgePolicy](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/android/app/src/main/java/com/listen1/android/HttpBridgePolicy.java) 与 [AndroidHttpBridge](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/android/app/src/main/java/com/listen1/android/AndroidHttpBridge.java)：协议 v1、URL/消息/响应上限、host/path/query、队列、取消/销毁行为。
- [Android asset allow-list](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/android/app/build.gradle)：共享前端中被打包的 UI/provider/controller/backup/annual 等资产；资产存在不代表 native route 已完成。
- [当前 Android workflow](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/.github/workflows/android-apk.yml)：JVM policy tests、debug assemble、签名检查；没有 emulator/instrumentation。
- [测试说明](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/.planning/codebase/TESTING.md) 与 [已知 concerns](https://github.com/dazzlingwuming/listen2/blob/5fc7265a5ade9af543714abf52210115038b4234/.planning/codebase/CONCERNS.md)：现有测试层级、未验证项、bridge/lifecycle/provider/cache/release 风险。

### 旧移动端（官方 tag，只作历史证据）

- [v0.8.2 源码树](https://github.com/listen1/listen1_mobile/tree/v0.8.2) 与 [README](https://github.com/listen1/listen1_mobile/blob/v0.8.2/README.md)：旧版本功能表和依赖，README 标题/内容滞后于 tag。
- [provider client](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/api/client.js)：实际启用的 NetEase、KuGou、Kuwo、QQ，以及 search/showPlaylist/getPlaylist/bootstrap/parseUrl 方法。
- [routes](https://github.com/listen1/listen1_mobile/blob/v0.8.2/Routes.js)、[playlist/search](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/views/playlist/search.screen.js)、[playlist detail](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/views/playlist/playlist.screen.js)：旧导航、分页搜索、歌单曲目和播放入口。
- [background player](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/views/player/background-player.screen.js)、[player reducer](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/redux/player.reducer.js)：旧 native video/music-control、焦点、锁屏控制和 reducer 语义；不等于当前 Android Media3 实现。
- [myplaylist reducer](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/redux/myplaylist.reducer.js)、[state converter](https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/modules/state-json-convert.js)、[import/export screens](https://github.com/listen1/listen1_mobile/tree/v0.8.2/src/views/setting)：旧收藏/创建歌单与 clipboard 覆盖式备份；新 Android 应以桌面 v2 merge contract 替代。

### Android 官方平台契约

- [Media3 background playback](https://developer.android.com/media/media3/session/background-playback) / [MediaSessionService reference](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)：后台播放、service 和系统控制。
- [MediaSession controls](https://developer.android.com/media/media3/session/control-playback)：通知、锁屏、耳机和蓝牙控制。
- [Audio focus](https://developer.android.com/media/optimize/audio-focus)：焦点、duck/pause 和系统音频交互。
- [Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider) / [shared documents](https://developer.android.com/training/data-storage/shared/documents-files)：SAF URI、持久 grant 和文件访问。
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)：凭据/API key 的 native 密钥边界。
- [Launch-time performance](https://developer.android.com/topic/performance/vitals/launch-time) / [Accessibility](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views)：启动测量、TalkBack、触控和可访问状态。
