# Listen2 Android 平台等价能力需求

日期：2026-08-30

本文件以当前 main 的桌面 v2.34.0 时代能力为行为基线，定义 Android v1 必须交付的用户结果、手机等价 UX、失败边界和证据门禁。用户已明确要求“最新 main 桌面能力在 Android 完整平台等价实现”，所以 table stakes、PROJECT Active 和显式桌面 parity 均属于本版本；未实现或未验证的条目保持 Pending，不得静默延期。

约定：

- 每个需求只有一个唯一 ID；每行一个可验收的用户结果。
- [T] 是 table stakes，[P] 是桌面 parity，[E] 是 Android-equivalent UX，[S] 是安全/反误导约束。
- [ ] 仅表示当前尚未完成；完成时必须附实现和证据，不能用页面入口、静态资源、HTTP 200、JVM 测试或 debug APK 构建替代运行时证明。
- capability matrix 是 Android 功能声明的唯一入口；开发过程中不支持或未验证能力必须显示可操作的 degraded/not verified 状态，但该状态不计为需求完成或 parity-ready。

## Baseline 与覆盖承诺

桌面基线已包含多 provider 搜索/目录/歌单/收藏和统一播放器；Bilibili 搜索、分 P、音频、MV、质量权限、QR 登录、CDN 恢复和歌词候选；同步歌词、偏移、手选、双语及用户确认后的 DeepSeek 翻译；播放详情、FIFO 下一首、随机、系统控制、频谱、音效和响度归一化；临时缓存、歌单缓存、明确下载、完整性校验、容量淘汰、离线命中；本地音乐标签/LRC；本机历史/年度回响；歌单安全备份与合并导入。下列需求覆盖这些行为及 PROJECT.md 的 Active 项。

Android 保留共享前端，但 native 只提供窄的、版本化、可取消的能力层；Media3 MediaSessionService 是唯一播放 owner，Room 保存用户可见领域数据与索引，DataStore 只保存小型设置，Keystore 保存 session/API key，SAF URI 取代桌面绝对路径。桌面窗口形态改为手机可用的通知、锁屏、底部面板、全屏或其他等价 UX。

## Requirements

### 启动/性能（PERF）

- [ ] **PERF-001** [T][E] 作为 Android 用户，我能在 API 26 和当前目标 API 的代表性模拟器冷启动，并在 TTID p95 不超过 3 秒内看到可交互本地 shell、TTFD p95 不超过 4 秒内看到播放入口；instrumentation 记录设备、构建、样本数、TTID 和 TTFD。
- [ ] **PERF-002** [T][P] 在固定脱敏 fixture 上，我的首个搜索结果在 p95 不超过 5 秒内出现、首个可听音频在 p95 不超过 6 秒内开始；报告分开记录资源、bridge、网络和 Media3 时间，并记录内存、CPU、电量与流量。
- [ ] **PERF-003** [T][E] 低内存杀死进程后，我重新打开应用能恢复队列、当前曲目、播放模式、位置误差不超过 3 秒和可解释的登录状态，且不会重复请求、消费 queue 或计历史；连续 10 分钟 fixture 播放不发生 ANR。

### 移动 UI（UI）

- [ ] **UI-001** [T][P][E] 我能通过手机底部导航、搜索、库、账户、mini-player、播放详情、队列、歌词、歌单和设置完成主流程，并用系统返回安全退出当前层级。
- [ ] **UI-002** [T][E] 在刘海、状态栏、手势/三键导航、软键盘、横竖屏、字体缩放至至少 200%、高对比度和减少动画条件下，内容、播放栏、输入框和确认面板不被遮挡；主要控件触控目标至少 48 dp。
- [ ] **UI-003** [P][E][S] 桌面浮动歌词、托盘和 thumbbar 在 Android 上由底部/全屏面板、通知、锁屏和系统媒体控件提供等价操作；所有入口由 capability matrix 控制，不显示死按钮、假成功或不可解释空列表。

### provider 网络（NET）

- [ ] **NET-001** [T][S] 前端与 native 使用带协议版本、operation、request id、page epoch、结果或结构化错误的类型化 RPC；仅接受可信 appassets 主 frame/source 和精确 HTTPS provider allow-list，拒绝任意 URL、重定向、明文、caller header/cookie、文件 URI 和原始媒体代理。
- [ ] **NET-002** [T][E][S] 我能取消搜索、目录、媒体、歌词和登录请求；每次调用都有请求/响应大小上限、deadline、有限退避和真正取消，取消、超时、页面销毁和过期响应各返回一次 terminal result。
- [ ] **NET-003** [P][T][E] 在实际授权范围内，我能完成 Bilibili 搜索 → 详情/分 P → 媒体 manifest/音质 → 播放 → 主歌词入口闭环；adapter 校验 schema、CID、MIME、权限和过期时间，并对无结果、网络/TLS、接口变更、登录和权限错误给出真实恢复动作。
- [ ] **NET-004** [P][T][E] 在实际授权范围内，我能完成 NetEase 搜索 → 详情/歌单曲目 → 媒体清单 → 播放 → 主歌词入口闭环；QQ、Kugou、Kuwo、Migu、Taihe 各有独立的搜索、目录、详情、媒体、歌词、fallback、登录和权限字段，未经 fixture/设备证据的字段保持未启用。

### 搜索/目录（SRCH）

- [ ] **SRCH-001** [T][E] 我可以提交、取消和重新提交带 query、provider、分页和 request id 的搜索；重复提交、快速输入和旧响应不会覆盖当前结果，成功、空结果、部分失败和取消均有终态。
- [ ] **SRCH-002** [T][P][E] 对矩阵声明支持目录的 provider，我能执行目录 → 详情 → 曲目列表 → 播放并保留游标；旋转、返回或重进不会重复追加，封面失败不阻塞文字和播放。
- [ ] **SRCH-003** [T][E] 每条结果显示来源、标题、艺人/作者、封面、时长、结果类型和可播放/需登录/不支持状态；坏 JSON、超时、离线、权限拒绝和 provider 部分失败显示可操作错误，不清空已成功结果。

### 播放/队列（PLAY）

- [x] **PLAY-001** [T][P][E] Media3 ExoPlayer、MediaSession 和队列由一个 native playback owner 持有；WebView/Howler 只发送 track/part 意图和渲染 snapshot，页面、mini-player 和通知共享同一 PlaybackState。
- [ ] **PLAY-002** [T][P][E] native 根据受控 track/part 标识解析真实 MIME、容器、codec、时长和 rendition，按账号权限选择音质/画质并执行有上限的 CDN 候选恢复；MV 在设备/授权/codec 支持时可切分 P、画质、全屏和画中画，不支持时回退音频或显示可操作错误。
- [x] **PLAY-003** [T][P][E] 我能使用播放/暂停、seek、进度、时长、音量、静音、上一首和下一首；媒体 URL 失败保留当前曲目上下文并可重试，不错误切歌。
- [x] **PLAY-004** [P][E] 我能把曲目加入独立 FIFO play-next 队列并查看来源顺序；队列支持重复项、上移、下移、删除、清空、重启恢复，消费完成后回到原歌单或播放模式。
- [x] **PLAY-005** [P][E] shuffle 每轮采用 Fisher–Yates 且不重复可播放曲目，repeat 与上一首真实历史指针在重启后保持；自然结束、快速 next、失败重试不会跳过或重复消费。
- [ ] **PLAY-006** [T][P][E] 屏幕关闭、Activity 销毁、renderer 被杀或进程回收后，MediaSessionService/合法 mediaPlayback foreground service 继续或可恢复播放；通知/锁屏、audio focus、AUDIO_BECOMING_NOISY、耳机和 Bluetooth/AVRCP 控制与页面一致，无播放时不常驻高耗电服务。

### 歌词/翻译（LYR）

- [ ] **LYR-001** [P][E] Bilibili 与 NetEase 能按 provider/track/时长匹配主歌词候选、时间轴和已有译文；播放页按 Media3 时钟显示当前行、偏移、双语和滚动状态，暂停、seek、切歌和恢复不会使用旧曲目时钟。
- [ ] **LYR-002** [P][E] 我可以手动搜索、选择并持久化歌词来源，手选按 track/provider/revision 覆盖自动结果；无歌词、纯文本、时间戳不足、超时和失配显示清晰降级，不阻塞首播。
- [ ] **LYR-003** [T][P][E] TalkBack 能读出歌词行、当前行状态、偏移和原文/译文切换；切歌竞态、旧响应和错误回调不会覆盖新曲目、卡住 loading 或伪造时间戳。

### 歌单/库（LIB）

- [ ] **LIB-001** [P][E] 我的歌单、收藏歌单、provider 远端歌单和本地音乐在库中显示不同来源与同步状态；无网络时我仍能浏览/播放有效本地内容，远端失败不删除本地内容。
- [ ] **LIB-002** [T][P][E] 我可以创建、改名、编辑、删除歌单，添加/移除/重排曲目和收藏/取消收藏；重复曲目规则与桌面一致，破坏性删除需要确认并在失败时保留原数据。
- [ ] **LIB-003** [T][E] 快速连续编辑、旋转、重启和进程回收后，歌单排序、收藏和曲目标识保持事务一致；播放、下一首、歌词、下载和删除操作仅在对应 capability 可用时出现。

### 登录/会话（AUTH）

- [ ] **AUTH-001** [P][E] 账户页按 provider 区分未登录、登录中、已登录、过期、网络故障和权限不足；登录入口与 QQ、Kugou、Kuwo、Migu、Taihe、Bilibili、NetEase 的 matrix 状态一致。
- [ ] **AUTH-002** [P][E] 我能完成 Bilibili QR 的生成、等待、成功、过期、取消、重试和会话刷新；对 matrix 声明支持的其他 provider，登录 route 也必须有受控 fixture/错误恢复，未验证者不显示假登录按钮。
- [ ] **AUTH-003** [T][S] token、cookie、refresh token 和 API key 只在 Keystore 或等价 native 安全存储中存在；过期/登出会清理可识别 session、通知和受保护缓存引用，但保留用户歌单、历史和本地音乐，重新登录不复用旧 session。

### 本地文件（LOCAL）

- [ ] **LOCAL-001** [T][P][E] 我可以通过 ACTION_OPEN_DOCUMENT/多选导入 mp3、flac、mp4、ogg、wav 和 webm，不授予全盘权限；应用只持久化 SAF URI grant 与内容标识。
- [ ] **LOCAL-002** [P][E] 应用能从 ContentResolver 读取标签、封面、时长和相邻或显式选择的 LRC；本地曲目可加入歌单、进入队列并由 Media3 播放，且标明本地来源。
- [ ] **LOCAL-003** [T][S][E] URI 被撤销、文件不可读、格式不支持、重复导入或云 provider 不可 seek 时，我看到修复/移除入口；绝对路径、file URI 和任意本地句柄不会传给 JS、bridge 或备份。

### 备份数据（DATA）

- [ ] **DATA-001** [T][E] Room migration 能持久化歌单、收藏、队列 checkpoint、歌词元数据、历史、cache catalog 和 SAF records；DataStore（或等价设置存储）只保存小型非敏感设置，不存大列表或 secret。
- [ ] **DATA-002** [P][S] Android 版本化备份只含我的歌单和收藏歌单及必要非敏感元数据，明确排除 token、cookie、refresh token、API key、本地路径/URI grant、主题、歌词设置、媒体文件和缓存。
- [ ] **DATA-003** [P][E] 我默认导入备份时保留当前歌单，完全相同跳过、同名独立、ID 冲突生成新 ID，并能预览摘要；覆盖只能二次确认，损坏、过大、旧版本或中断导入在有界时间内失败且可恢复。

### 历史回响（HIST）

- [ ] **HIST-001** [P][E] 有效播放仅在实际向前播放超过 30 秒且达到歌曲时长一半或 4 分钟中的较小阈值后计入；暂停、缓冲、seek、预加载、失败和页面浏览不计入，重复回调不重复计数。
- [ ] **HIST-002** [P][E] 进程死亡、重启、跨午夜和跨年后，我的有效播放、播放历史指针和年度回响保持一致；年度页显示总时长、有效播放、歌曲/艺人数量、年度歌曲/艺人、月趋势和数据不足空态。
- [ ] **HIST-003** [P][S][E] 我可以关闭记录、导出和清除本机历史；关闭后不再增长，清除后不能从 cache、日志、备份或远端恢复统计，且历史写入不阻塞首播。

### 缓存/下载（CACHE）

- [ ] **CACHE-001** [P][T][E] 播放后临时缓存、歌单缓存和用户明确下载使用不同 owner、目录和索引；只有原子写入完成、长度/hash 校验通过且 Media3 可读取的完整媒体才可播放。
- [ ] **CACHE-002** [T][E] 断网时我能播放完整且仍有权访问的缓存；断点/恢复、取消、损坏 repair、进程杀死、网络切换和旧 URL 失效不会产生重复文件或把 partial 文件交给播放器。
- [ ] **CACHE-003** [P][E] 缓存设置默认 2 GB，并提供 1 GB、5 GB、10 GB 和不限制选项；达到上限按最近最少使用淘汰非明确下载项，明确下载只由我取消/删除。
- [ ] **CACHE-004** [P][E][S] 缓存库可以搜索、排序、筛选临时/歌单/下载状态，支持单曲/批量删除、清空和转为明确下载；后台任务遵守网络、电量、Doze、通知和取消约束，磁盘满/索引不一致可有界修复，缓存不进备份或日志。

### 音效/响度（FX）

- [ ] **FX-001** [P][E] 我可以启用、停用、选择和重置音效预设；设备音量、静音、耳机/Bluetooth 和应用固定增益独立，异常 effect 不停止播放。
- [ ] **FX-002** [P][E] 支持设备上的频谱/可视化由真实音频分析驱动并与暂停、seek、切歌同步；后台、低端设备或能力不足时显示静态/隐藏降级，不伪造实时数据。
- [ ] **FX-003** [P][E][S] 响度标准化在完整媒体上按约 -14 LUFS、-1 dBTP 测量并应用固定增益；首播不等待分析，未分析/失败保持原音量，媒体 hash/采样率/codec 变化会使结果失效。

### DeepSeek（AI）

- [ ] **AI-001** [P][E][S] 我可以在设置中输入、测试和清除 DeepSeek API key；页面只显示已配置/未配置和测试结果，key 只由 Keystore 保护且不回显。
- [ ] **AI-002** [P][E] 只有我在确认面板明确同意后，应用才发送当前整首歌词、歌名和艺人；面板说明数据范围、可能费用、取消和失败影响，未确认或取消不发请求。
- [ ] **AI-003** [P][E][S] 翻译响应必须校验 schema、整曲行数、顺序、时间轴/行对应关系和文本完整性后才缓存；旧 revision 失效，key、整曲歌词和模型响应不出现在日志、页面状态、APK、WebView storage 或备份中。

### 安全（SEC）

- [ ] **SEC-001** [T][S] bridge 仅接受固定 appassets HTTPS origin、主 frame、可信 source 和当前 epoch；跨 origin/iframe/旧页面消息以及 javascript、file、content、intent 等危险导航被拒绝或交给安全系统策略。
- [ ] **SEC-002** [T][S] WebView 在 debug 与 release-like 配置均关闭 file/universal-file access、混合内容、地理位置和不必要多窗口；provider 网络禁止 cleartext，外部导航不携带 token/cookie。
- [ ] **SEC-003** [T][S] operation、字段类型、长度、枚举、请求/响应大小、URL、HTML/SVG/metadata sink 和 provider 数据逐项 allow-list/安全编码；恶意标题、歌词、封面和 JSON 不可执行脚本、原型污染或提升 bridge 权限。
- [ ] **SEC-004** [T][P][S] source、APK、assets、WebView storage、日志、崩溃报告、备份和测试产物扫描不打印 secret 值；所有播放、下载、MV、离线和质量选择尊重实际 entitlement、会员、地区、DRM 和账号权限，拒绝时如实失败或降级。

### 测试/验收（TEST）

- [ ] **TEST-001** [T][P] JavaScript contract tests 和 Android JVM policy tests 覆盖 provider registry、搜索、播放、队列、歌词、歌单、备份、缓存、历史、origin/HTTPS、schema、大小、timeout、redirect、redaction 的成功、取消、竞态和错误分支。
- [ ] **TEST-002** [T][E] WebView/Media3/storage instrumentation 覆盖真实 WebMessage handshake、取消、页面销毁、renderer recovery、唯一 player、通知/锁屏、audio focus/noisy、SAF grant、Room migration、Keystore session、缓存完整性和进程恢复。
- [ ] **TEST-003** [T][P][E] Android 模拟器 E2E 必须复现冷启动/移动布局、Bilibili 与 NetEase 搜索/结果播放/歌词翻译、登录状态、歌单/队列/历史、缓存离线、SAF 本地音乐、备份恢复、屏幕关闭后台播放、旋转/进程回收、断网恢复和外部导航。
- [ ] **TEST-004** [T][E][S] 每份证据记录日期、API、设备/模拟器、网络、构建变体、fixture、命令、结果、未覆盖项和恢复路径；TalkBack、字体/对比度、性能指标、secret/cleartext 扫描和失败日志均脱敏可复核。

### 构建发布准备（REL）

- [ ] **REL-001** [T][E] 在记录的 JDK/Gradle/AGP 与 compile/target API 组合上，依赖解析、资源复制、测试、R8 和 APK 构建可重复；debug 与 minified/release-like APK 均通过 asset、bridge、Media3 service、通知和迁移 smoke。
- [ ] **REL-002** [T][S] release-like APK 通过 manifest/权限、Network Security、版本升级、zip alignment、签名检查、artifact hash 和 secret 扫描；正式签名凭据不进入仓库、文档、测试或 APK。
- [ ] **REL-003** [T][P][E] 只有 58 个需求均有实现并通过证据支持的 Android 等价 UX，且关键 emulator E2E、后台播放、数据/安全、性能和 release-like 门禁全部通过时，候选版本才标记 parity-ready；degraded/not verified 只用于诚实展示开发状态，不满足完成条件，本项目不执行 merge 或 deploy。

## Provider capability matrix

此矩阵是 v1 的声明入口；Pending 表示尚未取得本项目证据，不等同于已支持。除 Bilibili、NetEase 的闭环外，其他 provider 只有在 adapter、HTTPS allow-list、fixture、设备行为和权限前提均有记录后才可在 Android selector 显示可用能力。

| Provider / 来源 | 搜索 | 目录/歌单 | 详情/曲目 | 媒体/播放 | 歌词/fallback | 登录/session | 状态与最小证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bilibili | 必须 | 必须，含分 P | 必须，含 CID/权限 | 音频、MV、音质/画质、CDN | 主歌词、候选、手选 | QR、刷新、退出 | Pending；NET-003、SRCH、PLAY、LYR、AUTH-002、TEST-003 闭环 |
| NetEase | 必须 | 必须，含远端歌单 | 必须，含曲目 | 真实 rendition | 主歌词、候选、手选 | 按已声明 route | Pending；NET-004、SRCH、PLAY、LYR、AUTH-002/003、TEST-003 闭环 |
| QQ | 按 adapter 声明 | 按 adapter 声明 | 按 adapter 声明 | 按权限/codec | 按 route 声明 | 按受支持 session | Pending；NET-004、AUTH、TEST-001/003 逐项证明 |
| Kugou | 按 adapter 声明 | 按 adapter 声明 | 按 adapter 声明 | 按权限/codec | 按 route 声明 | 按受支持 session | Pending；NET-004、AUTH、TEST-001/003 逐项证明 |
| Kuwo | 按 adapter 声明 | 按 adapter 声明 | 按 adapter 声明 | 按权限/codec | 按 route 声明 | 按受支持 session | Pending；NET-004、AUTH、TEST-001/003 逐项证明 |
| Migu | 按 adapter 声明 | 按 adapter 声明 | 按 adapter 声明 | 按权限/codec | 按 route 声明 | 按受支持 session | Pending；NET-004、AUTH、TEST-001/003 逐项证明 |
| Taihe | 按 adapter 声明 | 按 adapter 声明 | 按 adapter 声明 | 按权限/codec | 按 route 声明 | 按受支持 session | Pending；NET-004、AUTH、TEST-001/003 逐项证明 |
| Local Music | SAF 导入/本地库 | 本地歌单 | 标签/文件详情 | Media3 本地播放 | 相邻/显式 LRC | 不适用 | Pending；LOCAL、LIB、PLAY、TEST-002/003 证明 |

## 需求计数与状态

| 分组 | ID 范围 | 数量 |
| --- | --- | ---: |
| PERF | PERF-001–PERF-003 | 3 |
| UI | UI-001–UI-003 | 3 |
| NET | NET-001–NET-004 | 4 |
| SRCH | SRCH-001–SRCH-003 | 3 |
| PLAY | PLAY-001–PLAY-006 | 6 |
| LYR | LYR-001–LYR-003 | 3 |
| LIB | LIB-001–LIB-003 | 3 |
| AUTH | AUTH-001–AUTH-003 | 3 |
| LOCAL | LOCAL-001–LOCAL-003 | 3 |
| DATA | DATA-001–DATA-003 | 3 |
| HIST | HIST-001–HIST-003 | 3 |
| CACHE | CACHE-001–CACHE-004 | 4 |
| FX | FX-001–FX-003 | 3 |
| AI | AI-001–AI-003 | 3 |
| SEC | SEC-001–SEC-004 | 4 |
| TEST | TEST-001–TEST-004 | 4 |
| REL | REL-001–REL-003 | 3 |
| **Total** | **按分组 ID** | **58** |

## Traceability

此表先为全部需求建立追踪行。当前没有获准的阶段分配，因此每行 Phase 均为 TBD、Status 均为 Pending；阶段规划只能补充证据，不能删除或延期这些需求。

| Requirement | Phase | Status | Evidence target |
| --- | --- | --- | --- |
| PERF-001 | Phase 10 | Pending | cold-start instrumentation |
| PERF-002 | Phase 10 | Pending | fixture timing/resource report |
| PERF-003 | Phase 10 | Pending | process-kill/ANR recovery |
| UI-001 | Phase 10 | Pending | mobile navigation E2E |
| UI-002 | Phase 10 | Pending | inset/accessibility test |
| UI-003 | Phase 10 | Pending | Android-equivalent UX matrix |
| NET-001 | Phase 1 | Pending | typed bridge/origin policy |
| NET-002 | Phase 1 | Pending | cancel/timeout/error fixture |
| NET-003 | Phase 1 | Pending | Bilibili closed-loop E2E |
| NET-004 | Phase 3 | Pending | NetEase/five-provider matrix |
| SRCH-001 | Phase 1 | Pending | query/paging/cancel contract |
| SRCH-002 | Phase 1 | Pending | directory/detail E2E |
| SRCH-003 | Phase 1 | Pending | negative/partial result fixture |
| PLAY-001 | Phase 2 | Complete | sole Media3 owner test |
| PLAY-002 | Phase 9 | Pending | rendition/CDN/MV fixture |
| PLAY-003 | Phase 2 | Complete | unified PlaybackState test |
| PLAY-004 | Phase 2 | Complete | FIFO queue persistence |
| PLAY-005 | Phase 2 | Complete | shuffle/repeat transition |
| PLAY-006 | Phase 2 | Pending | service/focus/lockscreen recovery |
| LYR-001 | Phase 3 | Pending | Bilibili/NetEase lyric fixture |
| LYR-002 | Phase 3 | Pending | manual/offset persistence |
| LYR-003 | Phase 3 | Pending | stale/error/TalkBack test |
| LIB-001 | Phase 4 | Pending | source/offline library E2E |
| LIB-002 | Phase 4 | Pending | playlist CRUD/favorite test |
| LIB-003 | Phase 4 | Pending | transactional/capability test |
| AUTH-001 | Phase 5 | Pending | session-state matrix UI |
| AUTH-002 | Phase 5 | Pending | QR/login provider fixture |
| AUTH-003 | Phase 5 | Pending | Keystore/refresh/logout test |
| LOCAL-001 | Phase 6 | Pending | SAF import instrumentation |
| LOCAL-002 | Phase 6 | Pending | tag/LRC/local playback |
| LOCAL-003 | Phase 6 | Pending | revoke/path-boundary test |
| DATA-001 | Phase 2 | Pending | Room/DataStore migration |
| DATA-002 | Phase 6 | Pending | backup allow-list scan |
| DATA-003 | Phase 6 | Pending | merge/conflict/rollback |
| HIST-001 | Phase 6 | Pending | threshold/dedup fixture |
| HIST-002 | Phase 6 | Pending | lifecycle/annual aggregation |
| HIST-003 | Phase 6 | Pending | opt-out/export/clear |
| CACHE-001 | Phase 8 | Pending | atomic/hash/catalog test |
| CACHE-002 | Phase 8 | Pending | offline/resume/repair |
| CACHE-003 | Phase 8 | Pending | quota/LRU policy |
| CACHE-004 | Phase 8 | Pending | cache library/disk-full |
| FX-001 | Phase 9 | Pending | effect preset device test |
| FX-002 | Phase 9 | Pending | spectrum/degradation test |
| FX-003 | Phase 9 | Pending | LUFS/hash/background analysis |
| AI-001 | Phase 9 | Pending | key settings/Keystore |
| AI-002 | Phase 9 | Pending | confirmation/no-call test |
| AI-003 | Phase 9 | Pending | alignment/cache/secret scan |
| SEC-001 | Phase 1 | Pending | origin/navigation policy |
| SEC-002 | Phase 1 | Pending | cleartext/WebView config scan |
| SEC-003 | Phase 1 | Pending | schema/sink negative test |
| SEC-004 | Phase 7 | Pending | secret/entitlement audit |
| TEST-001 | Phase 7 | Pending | JS/JVM contract suites |
| TEST-002 | Phase 10 | Pending | WebView/Media3/storage suite |
| TEST-003 | Phase 11 | Pending | emulator E2E evidence |
| TEST-004 | Phase 11 | Pending | accessibility/perf/redaction report |
| REL-001 | Phase 11 | Pending | reproducible APK/R8 smoke |
| REL-002 | Phase 11 | Pending | release-like/signature/hash scan |
| REL-003 | Phase 11 | Pending | parity-ready gate |

Coverage is self-consistent: 58 requirement checkboxes, 58 unique IDs, 58 traceability rows, and 58 uniquely assigned roadmap phases; all 58 Status=Pending rows remain incomplete until their implementation and evidence pass.

## Definition of Done

1. 58 个需求均有实现和可复核证据；capability matrix 中任何 degraded/not verified 项都保持需求未完成，不能用降级状态替代本里程碑已承诺的桌面平价能力；不存在死按钮、静默 fallback 或仅凭页面入口宣称完成。
2. Bilibili 与 NetEase 各自通过搜索 → 详情/分 P/曲目 → 媒体清单 → 实际播放 → 主歌词/翻译入口闭环；错误、取消、过期、权限、离线和 codec 限制可恢复或如实说明。
3. Media3 MediaSessionService 是唯一播放 owner；屏幕关闭、通知、锁屏、audio focus、耳机/Bluetooth、Activity/renderer/进程重建、MV 回退和 queue 恢复均有模拟器或真机证据。
4. QQ、Kugou、Kuwo、Migu、Taihe 和 Local Music 在 capability matrix 中逐字段记录；已声明能力有 adapter、allow-list、fixture、权限前提和设备证据，未验证能力不会出现在可用入口。
5. 移动 shell、inset、键盘、旋转、返回、48 dp 触控、字体缩放、对比度、减少动画和 TalkBack 验收通过；桌面窗口形态已转为 Android 等价 UX。
6. Room/DataStore/Keystore、SAF、本地音乐、歌单/收藏、备份合并、历史/年度回响、临时缓存/歌单缓存/明确下载、完整性/配额/离线恢复/登出清理通过迁移、进程死亡、权限撤销、磁盘满和损坏测试。
7. DeepSeek 仅在用户确认后发送整曲歌词，响应行对应关系和缓存校验通过，key/歌词不泄露；音效、真实频谱、响度归一化和 MV 按设备能力诚实降级且不阻塞首播。
8. JavaScript/JVM/WebView/Media3/存储/网络/无障碍/模拟器 E2E 测试通过；性能报告包含 TTID、TTFD、首搜、首播、内存、CPU、电量、流量、设备/API 和未覆盖项。
9. debug 与 minified/release-like APK 的资源、bridge、权限、cleartext、依赖、版本迁移、签名检查、artifact hash 和 secret 扫描可复核；正式签名凭据、merge 和 deploy 不在本项目范围内。

## Out of Scope

- 访问控制绕过：不绕过会员、付费、DRM、地区、账号或 provider entitlement，只处理用户本来有权访问的内容。
- 桌面窗口原样复制：不把浮动歌词窗口、托盘、thumbbar、多窗口等桌面形态原样搬到手机，改用 Android 等价 UX。
- merge/deploy/正式签名凭据：本项目不执行分支合并、生产部署，也不接收、保存或使用正式签名凭据。

## Future Requirements

无。用户未授权将任何能力延期；困难、外部依赖或设备差异只能在当前需求的 capability matrix 中记录 Pending、degraded 或 not verified，不能将 table stakes、PROJECT Active 或桌面 parity 改列为未来需求。

## Source basis

- .planning/PROJECT.md：2026-08-30 Android parity 目标、Active 范围、约束和验证门禁。
- .planning/research/FEATURES.md：桌面/旧移动端/当前 Android 矩阵、provider 边界、table stakes、anti-features 和验收行为。
- .planning/research/SUMMARY.md：Media3 sole owner、窄 typed bridge、Room/DataStore/Keystore、SAF、缓存分层、测试和发布证据边界。
- 根 README.md：Listen2 v2.34.0 桌面播放器、Bilibili/MV/登录、歌词/DeepSeek、缓存、响度、队列、历史和备份行为。
