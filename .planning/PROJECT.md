# Listen2 Android 平台等价能力

## What This Is

Listen2 是一个把 Bilibili、网易云音乐及其他音乐来源聚合到统一播放器中的开源项目，当前产品以 Electron 桌面端和可复用的 Listen1 浏览器前端为主。本 brownfield 项目以最新 `main` 的桌面能力为平价基线，把这些能力带到 Android；Android 使用符合手机生命周期和交互习惯的等价 UX，并通过受控的 native bridge 补足 WebView 无法安全或可靠承担的能力。

目标用户是希望在 Android 手机上搜索、播放、管理音乐并继续使用桌面端已有歌单、歌词、缓存和播放体验的 Listen2 用户。

## Core Value

Android 用户能够在其账号和平台实际授权范围内，从搜索到播放、歌词和后续控制完成可靠的端到端听歌流程。

## Requirements

### Validated

以下能力是截至 2026-08-30 已由当前代码和文档证实存在的基线，不代表 Android 已经具备同等实现：

- ✓ **桌面多平台播放器基线**：共享 Listen1 前端已提供多 provider 搜索、歌单/收藏、播放详情、播放队列和统一播放器；provider 注册与能力入口位于 `app/listen1_chrome_extension/js/loweb.js` 及 `js/provider/`。
- ✓ **桌面 Bilibili 能力**：Bilibili 搜索、分 P、封面/作者信息、音频与 MV、按账号实际权限选择音质/画质、扫码登录、CDN 候选恢复和权限/网络失败分类已落地（`app/bilibiliService.js`、`js/provider/bilibili.js`）。
- ✓ **桌面歌词与翻译**：同步歌词、偏移校正、手动选择和持久化、跨来源 fallback、双语显示，以及用户确认后调用并校验整曲结果的 DeepSeek 翻译已落地（`app/lyricCacheStore.js`、`app/machineTranslation.js`、播放控制器）。
- ✓ **桌面播放体验**：现代黑/白主题、播放详情、真实音频频谱/可视化、音效预设、可选 `-14 LUFS` 响度标准化、随机播放、下一首队列、浮动桌面歌词和系统播放控制已落地。
- ✓ **桌面数据与离线能力**：Bilibili 完整音频临时缓存、歌单缓存、用户明确下载、容量淘汰、校验和 Range 播放；安全歌单备份/合并导入；本地音乐标签/LRC 读取；本机听歌历史与年度回响已落地（`app/audioCache.js`、`app/functions.js`、`app/listeningHistoryStore.js`）。
- ✓ **Android 安全壳**：Java WebView host 通过 `WebViewAssetLoader` 从固定 `appassets` origin 加载显式 allow-list 资源；file/universal-file access、混合内容、地理位置和多窗口等危险边界已关闭，外部链接按导航策略交给系统浏览器或阻断。
- ✓ **Android 搜索 bridge**：`Listen2AndroidHttp` 使用版本化 `WebMessage` 协议，只允许可信 appassets origin 下的 HTTPS GET；当前精确覆盖 Bilibili API 和网易云搜索路径，具备请求/响应大小、参数、超时、HTTP/JSON 错误和无重定向约束，不提供 caller headers 或 `addJavascriptInterface` fallback。
- ✓ **Android 移动壳与响应式 UI**：共享前端已接入 Android host，已有移动布局、手机导航/库访问和 Bilibili/网易云搜索适配及对应的前端/JVM 契约测试；当前实现仍是前台 WebView 播放样例，不应误称为完整平价。

### Active

#### 功能平价与手机体验

- [ ] 建立以当前 `main`（快照为 2026-08-30、v2.34.0 时代桌面代码）为基线的 Android capability matrix：逐项记录搜索、目录、歌单、收藏、播放、歌词、登录、缓存、备份和本地音乐的实现状态、权限前提、降级行为和证据。
- [ ] 补齐完整功能平价：Android 对桌面已承诺的用户能力都提供可用实现或明确的 platform-equivalent UX；不因桌面有窗口/托盘而在手机上伪造不可用控件。
- [ ] 重做手机信息架构、触控目标、滚动容器、键盘/刘海/系统栏 inset、横竖屏和无障碍状态；解决当前布局拥挤、遮挡和窄屏不可用问题。
- [ ] 优化冷启动、前端资源加载、首屏可交互、搜索首结果和首个可听音频的性能；控制 WebView 内存、CPU、电量和网络请求，确保低内存回收后能恢复状态。

#### 网络、provider 与播放

- [ ] 打通 Bilibili 与网易云的端到端链路：搜索 → 详情/分 P → 可用媒体清单 → 播放 → 歌词/翻译；修复当前 Android 搜索、播放和歌词失败，并区分无结果、网络/TLS、接口变更、权限和登录状态。
- [ ] 为 QQ、Kugou、Kuwo、Migu、Taihe、Local Music 等桌面 provider 制定逐平台能力和网络策略；实现所承诺的搜索、目录、播放、歌词与 fallback，未实现能力必须由 capability matrix 驱动而不是静默失败。
- [ ] 把 provider 请求收敛为版本化、可校验、可取消的 Android adapter/窄 bridge；保持 HTTPS、host/path/query allow-list、响应上限、超时、有限退避和脱敏错误，禁止用任意 URL bridge 或放宽明文流量来“修复”功能。
- [ ] 实现 Android 播放核心的媒体格式探测、CDN/候选恢复、队列/随机/下一首、播放进度、音量和歌词时钟同步；保留可播放内容的真实权限和质量选择。
- [ ] 将后台播放迁移到 Android 原生 Media3 `MediaSessionService`/foreground service：覆盖屏幕关闭、Activity 重建、进程回收、audio focus、通知/锁屏控制、耳机/蓝牙按键、暂停恢复和播放位置/队列恢复。

#### 登录、文件与用户数据

- [ ] 实现受支持 provider 的 Android 登录与会话生命周期（包括 Bilibili QR/会话刷新及网易云等已承诺登录路径），用 Android 安全存储管理 token/cookie；UI 必须展示“未登录、过期、网络故障、权限不足”的不同状态。
- [ ] 支持 Android 本地音乐导入、SAF 文件授权、标签和相邻 LRC 读取、本地歌单与播放；文件句柄、路径和缓存根目录必须经过校验，不能借 bridge 读取任意本地文件。
- [ ] 实现桌面备份契约的 Android 等价 UX：歌单/收藏安全导出、合并导入、冲突处理和恢复；不得把凭据、cookie、API key、本地路径、主题或歌词设置写入备份。
- [ ] 实现本机听歌历史、年度回响、有效播放统计、播放历史返回和下一首队列的持久化/恢复；不把搜索、拖动、缓冲或页面浏览误记为听歌。

#### 缓存、音效与 DeepSeek

- [ ] 实现 Android 临时缓存、歌单缓存和用户明确下载的完整音频：原子写入、完整性校验、断点/容量策略、离线命中、损坏恢复、查询/排序/清理和隐私边界均可观察且可恢复。
- [ ] 把桌面音效预设、真实频谱/可视化和安全的响度标准化适配到 Android；明确设备 codec、AudioTrack/Media3、耳机和低端设备的降级，不因分析任务阻塞首次播放。
- [ ] 提供 Android DeepSeek 歌词翻译等价能力：仅在用户明确确认后发送整曲歌词，校验时间轴/行对应关系、缓存成功结果，并以 Android Keystore 或等价安全方案保存 key；绝不在日志、页面或备份暴露 key。

#### 安全与质量门禁

- [ ] 收紧共享前端与 native host 的信任边界：所有 bridge 消息、发送方、URL、响应 schema、导航和文件操作均 allow-list 校验；清理不安全 HTML/SVG sink、token 暴露、任意外链和旧版 Electron IPC 风险，不把 Android 当作放宽桌面安全的捷径。
- [ ] 为 provider 失败、取消、超时、过期响应、Activity 销毁和离线场景提供稳定错误契约、重试/取消和用户可操作的恢复 UI；防止搜索竞态、悬挂 spinner、无限 fallback 和错误切歌。
- [ ] 扩展前端与 Android JVM 单元/契约测试，增加 WebView instrumentation、网络 fixture、bridge 队列/取消、导航/TLS/响应上限、Cookie/会话、文件权限、缓存、Media3 和生命周期测试。
- [ ] 使用 Android 模拟器做强制端到端验收：冷启动和移动布局、Bilibili/网易云搜索、结果播放、歌词/翻译、登录状态、歌单/队列/历史、缓存离线、本地音乐、备份恢复、屏幕关闭后台播放、旋转/进程回收、网络中断恢复和外部导航均须有可复现证据。
- [ ] 对 debug 与 minified/release-like APK 验证打包资源、bridge 可用性、版本升级和签名检查；正式签名仅在用户后续提供签名凭据后执行，任何凭据值不写入仓库或文档。

### Out of Scope

- **绕过会员、付费、DRM、地区或账号权限**：只整理和播放用户本来有权访问的内容；平台拒绝、需要登录或质量受限时必须如实失败或降级。
- **桌面窗口专属形态**：不把浮动歌词窗口、托盘、thumbbar、多窗口等桌面形态原样搬到手机；改为 Android 通知、锁屏、全屏/底部面板、系统分享或其他等价 UX。
- **merge / deploy**：本项目只负责实现、测试和交付证据，不包含合并分支、发布到生产或部署动作。

## Context

### Brownfield 基线

- 桌面入口为 `app/main.js`，产品页面为 `app/listen1_chrome_extension/listen1.html`；前端是 AngularJS 1.8.2 与原生 classic scripts，无 TypeScript、React/Vue 或 bundler，脚本加载顺序和全局 provider 契约必须保持。
- Android 是独立 Java WebView host（最低 SDK 26、compile/target SDK 35、JDK 17、AndroidX WebKit），通过 Gradle allow-list 复制共享前端；当前只有前台 WebView 播放样例、窄搜索 bridge 和 JVM policy tests，没有 Media3 后台服务、原生账号会话、离线缓存或桌面 Electron IPC。
- 官方历史移动端证据来自 `listen1/listen1_mobile` 的 `v0.8.2`（React Native 0.59.9，2021-05-24）：其 `src/api/client.js`、`src/redux/player.reducer.js`、`src/views/player/background-player.screen.js`、`src/modules/state-json-convert.js` 分别提供 provider 契约、队列行为、锁屏/媒体按键行为和旧备份格式参考。该项目与桌面端共享领域模型而非运行时代码，且已长期停止更新，不能作为当前 Android 安全或 API 实现基础。
- `STACK.md`、`ARCHITECTURE.md`、`STRUCTURE.md`、`INTEGRATIONS.md`、`CONCERNS.md` 与根 `README.md` 是本项目的现状证据；代码快照日期为 2026-08-30，桌面平价参考当前 `main`/`origin/main` 的 v2.34.0 时代能力。

### 要解决的问题

用户明确反馈 Android 当前加载慢、手机布局差，Bilibili/网易云的搜索、播放和歌词失败，且功能落后于最新 main。目标不是增加一个只展示页面的 APK，而是把关键用户旅程和桌面能力按 Android 生命周期、安全边界和手机 UX 重新落地。

### 风险与未知

- provider API、WBI/WeAPI/EAPI、CDN、cookie 和 referer 是外部不稳定契约；静态映射没有证明线上账号、真实 provider、CDN、WebView codec 或模拟器之外的设备行为。
- 现有 Android 测试主要覆盖纯策略和静态/契约层，尚未覆盖 WebView 启动、真实 bridge 交付、后台播放、进程回收、发布混淆包或完整登录；这些必须在本项目中补齐并明确记录 `not verified` 或失败原因。
- 现有 Electron 主窗口仍是 legacy privileged renderer；共享代码的安全修复要兼顾桌面兼容和 Android 不可越权，不能把未验证的桌面假设复制进 native bridge。
- 官方 Listen1 旧版 Android 只用于行为、交互和兼容性证据；它不是当前 API、权限模型或实现的权威，不能盲目复制旧架构。

## Constraints

- **技术栈**：优先复用共享前端与 provider/player 契约；Android 原生能力集中在 `android/app/src/main/java/com/dazzlingwuming/listen2`，新增安全/网络策略保持纯 Java helper 可测试，避免引入未经评估的框架迁移。
- **架构边界**：采用“共享前端 + 窄 native bridge”；native 只提供版本化、高层、allow-listed 能力，不能暴露任意 URL、caller header、cookie 控制或通用 JavaScript 接口。
- **平台差异**：桌面窗口、托盘、浮动歌词等必须转成 Android 等价 UX；播放、后台、audio focus、通知和生命周期由 Android 原生服务负责，不能依赖 WebView 永不被销毁。
- **安全与合规**：不绕过会员/付费/DRM/地区/账号权限；token、cookie、API key、签名材料和本地用户数据不进入源码、备份、日志、APK 明文或规划文档。
- **网络可靠性**：默认 HTTPS、精确 host/path/query allow-list、bounded body、超时、取消和有限重试；外部接口变化必须显示为可诊断的 provider 错误，而不是伪装成空结果。
- **性能与资源**：优先解决启动、首屏、首搜和首播延迟，同时约束低内存、后台、电量、磁盘和流量；缓存/歌词/历史/翻译存储需有大小、增长和损坏恢复策略。
- **验证环境**：Android 模拟器端到端验收是必需门禁，静态契约、JVM 测试或 APK 构建成功不能替代它；真实账号凭据若需要，由用户在仓库外提供并按最小权限使用。
- **发布权限**：本项目不授权 merge/deploy；正式签名依赖用户后续提供的签名凭据，在此之前只做可重复构建、debug/release-like 检查和模拟器验证。

## Verification and Definition of Done

完成判定以可追溯证据为准：

- capability matrix 中承诺的 Android 能力均有实现、明确降级和测试状态；不能用“页面能打开”代表播放、歌词、登录或后台已完成。
- Android 模拟器通过冷启动、搜索、播放、歌词、登录状态、歌单/队列/历史、缓存离线、本地音乐、备份恢复、后台播放、旋转/进程回收、网络恢复和安全导航等端到端场景。
- 前端契约、Android JVM/instrumentation、服务/存储/Media3 测试通过；关键失败路径有用户可理解的恢复操作和脱敏日志。
- 记录启动/首搜/首播、内存、恢复时间和电量/网络影响的测量结果及设备/API 配置；外部 provider、签名 release 或真实账号未覆盖的项目必须显式标记。
- 只在上述验证完成后交付实现结果；merge、deploy 和正式签名仍按本文件边界处理。

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 共享前端 + 窄 native bridge | 保留桌面已验证的 provider/UI/player 投资，同时让 Android 网络、文件、账号和生命周期能力保持最小权限、可校验、可测试。 | — Pending |
| 优先端到端垂直切片 | 先证明启动 → 搜索 → 详情 → 播放 → 歌词/恢复的完整旅程，再扩展 provider 和周边功能，避免“页面平价但核心不可用”。 | — Pending |
| 官方 `listen1/listen1_mobile@v0.8.2` 仅作行为与数据契约证据，不盲目复制 | 旧版 RN 工程使用过时依赖和明文网络，且没有当前 Bilibili、歌词、下载、登录等能力；可复用其 provider/队列/备份模型和移动交互预期，但当前 main 的功能、安全与 Android 15 生命周期优先。 | — Pending |
| 用 capability matrix 驱动声明与降级 | Android 当前只覆盖部分搜索路由，必须让 UI 与实际能力一致，不能继续展示未实现的登录、播放或歌词入口。 | — Pending |
| 模拟器端到端验收为必需门禁 | 现有策略/JVM 测试无法证明 WebView、Media3、网络、生命周期和真实用户旅程。 | — Pending |
| 只使用实际权限，不做访问控制绕过 | 保护用户账号、平台条款和项目合规边界；权限错误应可诊断、可恢复或明确不可用。 | ✓ Good |

## Evolution

PROJECT.md 是随项目演进的 living context。每次阶段转换时：

1. 将已在 Android 模拟器和自动化证据中验证的 Active requirement 移到 Validated，并附阶段/版本和证据位置。
2. 将被否定或不再符合平台/安全边界的 requirement 移到 Out of Scope，保留原因；新出现且已获批准的目标加入 Active。
3. 更新 capability matrix、Context 中的 provider/设备/性能事实，并在 Key Decisions 记录重要取舍及 `Good`、`Revisit` 或 `Pending` 结果。

每个里程碑结束时复核 Core Value、Android 等价 UX、权限边界、模拟器验收覆盖和未验证项；不要把“静态测试通过”或“构建成功”提升为真实 provider、后台播放或正式发布已验证。

| Date | Trigger | Update |
|------|---------|--------|
| 2026-08-30 | Brownfield onboarding / parity scope approved | 记录桌面 v2.34.0 时代基线、已落地 Android 安全壳/搜索 bridge/响应式 UI、Android 平价目标、模拟器验收门禁及 merge/deploy/signing 边界。 |

---
*Last updated: 2026-08-30 after brownfield codebase mapping and approved Android parity scope.*
