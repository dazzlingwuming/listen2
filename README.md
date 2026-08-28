<div align="center">

# Listen2

### 把 Bilibili 与多平台音乐内容，整理成更好用的桌面播放器

[![License](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE.md)
[![Version](https://img.shields.io/badge/version-2.34.0-8b5cf6.svg)](https://github.com/dazzlingwuming/listen2/releases/tag/v2.34.0)
[![Electron](https://img.shields.io/badge/Electron-32-38bdf8.svg)](https://www.electronjs.org/)
[![Windows](https://img.shields.io/badge/Windows-x64-2563eb.svg)](https://github.com/dazzlingwuming/listen2/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Universal-111827.svg)](#平台支持)
[![Based on Listen1](https://img.shields.io/badge/based%20on-Listen1-a78bfa.svg)](https://github.com/listen1/listen1)

[下载最新版](https://github.com/dazzlingwuming/listen2/releases/latest) · [报告问题](https://github.com/dazzlingwuming/listen2/issues) · [构建说明](#本地开发与构建)

</div>

Listen2 是 [Listen1](https://github.com/listen1/listen1) 的社区增强版本。它保留多平台聚合搜索、播放和歌单能力，并重点改善 Bilibili 音乐播放、同步歌词、歌词翻译、桌面歌词、MV 和现代化桌面体验。

> Listen2 只整理和播放用户本来就有权访问的内容，不解锁会员、付费、DRM、地区限制或其他受限资源。

## v2.34.0 更新

- 新增桌面端 Bilibili 完整音频缓存：首次播放后在后台校验并保存，缓存命中时支持离线播放，并提供容量、清理与单曲数据管理。
- 新增曲目响度标准化：按 `-14 LUFS` 与 `-1 dBTP` 测量整曲并应用固定增益，兼容解码器支持的不同来源采样率，不修改原始音频。
- 响度分析进度会在有任务时每 2 秒自动更新，任务完成后停止轮询；无法安全分析的歌曲继续保持原音量。
- 自动匹配歌词、手动选择歌词和对应翻译均可持久化；手动选择始终覆盖旧的自动结果。
- 新增用户确认后才调用的 DeepSeek 整曲歌词翻译，并对逐行对应关系、缓存和密钥存储进行严格校验。
- 歌单备份默认采用合并导入，保留目标设备已有歌单；同时改进 Bilibili CDN 恢复、随机播放、桌面歌词控制和现代黑/白界面。

## 界面预览

![Listen2 沉浸式播放页、实时频谱与双语歌词](图片/img.png)

![Listen2 Bilibili 分 P 歌单与现代化音乐库](图片/img_1.png)

## 功能亮点

### 现代化播放器

- 现代黑、现代白两套主题，覆盖音乐库、播放详情、弹窗与底部播放栏。
- 沉浸式播放详情页，包含圆形封面、环形进度、背景氛围光和分层信息布局。
- 由真实音频分析驱动的频谱与动态效果，而不是与音乐无关的预设动画。
- 重新设计播放进度、音量、状态反馈和高频操作区域。
- 可选的曲目响度标准化会在播放时减少歌曲间的音量跳变，不修改原始音频，也不使用动态压缩冒充归一化。

### Bilibili 音乐、登录与 MV

- 支持 Bilibili 搜索、分 P 解析、音频播放、封面和作者信息展示。
- 自动清理“4K 修复”“无损”“动态歌词”等标题噪声，提取更可靠的歌名与歌手线索。
- 支持使用 Bilibili 客户端扫码登录；二维码在本地生成，不发送给第三方二维码服务。
- 登录后按账号和视频实际权限展示可用音质、画质，不绕过平台访问控制。
- 支持纯音频与 MV 切换、分 P、画质选择和全屏播放；MV 不可用时可退回纯音频。
- 音频地址失效或 CDN 异常时，按顺序尝试备用地址并有限刷新媒体信息。
- 区分临时网络故障、超时、内容不存在和权限错误，避免无限重试或连续误切歌曲。

### 歌词、翻译与 DeepSeek

- 支持同步歌词、播放偏移校正、当前行高亮和原文/译文双语显示。
- 为 Bilibili 内容从多个歌词来源检索候选，并综合歌名、歌手和时长进行匹配。
- 自动匹配不可靠时，可手动搜索、选择并保存当前歌曲的歌词来源。
- 优先使用当前歌词自带译文，其次寻找其他高匹配来源中的现成译文。
- 所有歌词源都没有译文时，可由用户明确确认后，调用 DeepSeek 翻译整首歌词。
- DeepSeek 翻译一次提交整首歌词，按原时间轴回填；结果行无法可靠对应时不会强行展示。
- 成功的机器翻译会缓存，减少重复请求和 API 费用。
- 桌面端会持久化成功的自动匹配歌词；用户手动选择后，该选择会替代自动结果并保持最高优先级。
- DeepSeek 成功译文会随对应歌词持久化，不再按固定歌曲数量静默淘汰；只有与当前原文完整对应的译文才会显示。
- DeepSeek API 密钥通过 Electron `safeStorage` 加密保存，不会返回给播放器页面。

> Listen2 不会在播放、切歌或加载歌词时自动调用 DeepSeek。只有用户在确认面板主动同意后才发送歌名、歌手和整首歌词；请求可能产生 DeepSeek API 费用。

### 桌面离线缓存

- 歌曲真正开始播放后，桌面端会低优先级后台缓存完整的 Bilibili 音频；第一次播放仍直接使用在线流，不等待下载。
- 未加入“我的歌单”且未被用户明确下载的音频属于临时缓存，只在当前会话复用，并在正常退出 App 时统一清理。
- “我的歌单”中的缓存会跨重启保留但仍参与容量淘汰；用户明确下载的歌曲会永久离线保留，只有用户主动取消或删除时才移除。
- 只有完整下载并通过校验的文件才会进入离线缓存，失败下载和临时文件不会交给播放器。
- 默认容量为 2 GB，也可选择 1 GB、5 GB、10 GB 或不限制；达到上限时仅按最近最少使用顺序清理音频。
- 缓存命中后可在断网时播放；本地文件损坏时会删除该项，并在网络可用时回到原有 CDN 恢复流程。
- 桌面侧栏的“缓存与下载”音乐库可搜索、排序和管理全部缓存曲目，筛选下载、歌单和临时缓存，并将现有缓存切换为永久离线下载；支持单首或批量删除。设置页仅保留缓存开关、容量、状态、清空、删除当前歌曲和跳转入口。
- Chrome 扩展不启用桌面音频缓存；缓存文件不会进入歌单备份或 GitHub Gist。

### 曲目响度标准化

- 桌面端可按需启用“统一曲目音量”，目标为流媒体常用的 `-14 LUFS`，并以 `-1 dBTP` 为峰值上限。
- 完整缓存的 Bilibili 音频会在本地后台测量整曲响度和 True Peak；分析不上传音频、不阻塞首次播放。
- 首次播放、尚未分析或无法安全解码分析的歌曲保持原音量，不会在播放过程中突然追踪调节。
- 已分析歌曲只在播放时应用固定增益，保留歌曲内部的动态关系；用户音量、静音和系统音量仍然独立。
- 响度结果与缓存文件内容哈希绑定；临时清理或容量淘汰会保留小型响度档案，只有再次取得完全相同的音频字节时才复用。用户主动删除缓存或当前歌曲本地数据时会一并移除。

### 桌面歌词与播放控制

- 支持桌面歌词置顶、拖动、透明度、字号、颜色和双语显示。
- 未锁定时可直接控制上一首、播放/暂停和下一首，并显示真实播放状态。
- 锁定后歌词区域支持点击穿透，同时保留明确的解锁入口。
- 针对 macOS 多桌面空间和全屏应用做了单独窗口适配；Windows 使用对应的原生置顶行为。

### 更可靠的随机播放

- 使用 Fisher–Yates 洗牌生成每轮随机队列。
- 一轮内每首可播放歌曲只出现一次，新一轮避免立即重复上一首。
- “上一首”沿真实播放历史返回，重启播放器后也会正确恢复随机模式。

### 年度回响与“下一首播放”

- 桌面端默认在本机记录实际向前播放的时长；暂停、缓冲和拖动进度不会伪造听歌时间。
- 一首歌曲播放超过 30 秒，并达到歌曲一半时长或 4 分钟（取较小值）后，才计为一次有效播放。
- “年度回响”汇总总听歌时间、有效播放、歌曲和歌手数量、年度歌曲、年度歌手与月度趋势；没有足够数据时会明确显示空状态。
- 听歌记录仅保存在当前设备，不包含搜索、歌词、页面或设置行为；可随时关闭、导出或清除。
- 歌曲菜单中的“添加到下一首播放”使用独立 FIFO 队列：连续添加多首会严格按添加顺序播放，完成后回到原歌单、随机或单曲循环上下文。
- 下一首队列支持重复歌曲、上移、下移、删除、清空和重启恢复；列表中的曲目时长统一显示为 `分:秒` 或 `时:分:秒`。

### 安全的歌单备份与跨设备导入

- 新备份文件只包含我的歌单和收藏歌单，不导出登录凭据、本地音乐路径、主题或歌词设置。
- 本地文件与 GitHub Gist 默认使用合并导入：保留当前设备的歌单，再追加备份中的歌单。
- 完全相同的歌单会跳过；同名歌单可独立保留，ID 冲突但内容不同时会生成新 ID，不覆盖本机版本。
- 兼容旧版 `listen1_backup.json`；“覆盖当前歌单”仍保留为需要应用内二次确认的高级选项。

## 下载与安装

前往 [GitHub Releases](https://github.com/dazzlingwuming/listen2/releases/latest) 下载适合当前系统的安装包。

### Windows

下载文件名包含 `win_x64.exe` 的 NSIS 安装包并运行。目前安装包未使用商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”；请核对下载来源和 Release 页面提供的 SHA-256。

### macOS

下载 DMG 后拖入“应用程序”。当前 macOS 构建未使用 Apple Developer ID 签名或公证，首次打开时可能出现系统安全提示。

## 平台支持

核心播放器界面、Bilibili 适配、频谱和歌词逻辑由 Windows、macOS 与 Linux 共用。操作系统原生窗口行为会有少量差异。

| 平台                        | 状态         | 说明                                                                  |
| --------------------------- | ------------ | --------------------------------------------------------------------- |
| Windows 10/11 x64           | 已构建并验证 | 提供 NSIS 安装包；包含现代 UI、Bilibili、MV、桌面歌词与 DeepSeek 翻译 |
| macOS Intel / Apple Silicon | 已构建并验证 | 支持 x64、arm64 与 Universal DMG；当前未签名或公证                    |
| Windows ia32 / arm64        | 保留构建能力 | 尚未在对应设备上完成系统性回归                                        |
| Linux                       | 保留构建能力 | 不是当前版本的主要测试平台                                            |

## 使用提示

### Bilibili 登录

在账号区域选择 Bilibili 登录并使用手机客户端扫码。登录 Cookie 保存在 Electron 会话中，刷新令牌使用系统安全存储加密；退出登录会同时清理服务端会话与本地数据。

### DeepSeek 歌词翻译

1. 在设置中填写自己的 DeepSeek API 密钥并测试连接。
2. 播放有同步歌词但没有现成译文的歌曲。
3. 在翻译确认面板查看说明，主动确认后才会发起翻译。
4. 如不再使用，可在设置中清除密钥。

机器翻译仅在 Electron 桌面客户端提供，Chrome 扩展模式不支持该能力。

## 本地开发与构建

### 环境要求

- Node.js 18 或更高版本
- npm
- Windows、macOS 或 Linux 桌面系统

### 运行开发版

```bash
git clone https://github.com/dazzlingwuming/listen2.git
cd listen2
npm ci
npm run start
```

前端代码已经位于 `app/listen1_chrome_extension`，不需要额外初始化 Git 子模块。

### 构建安装包

```bash
# Windows x64 NSIS 安装包
npx electron-builder --win nsis --x64

# macOS：按项目配置构建 x64、arm64 和 Universal DMG
npm run dist:mac

# Linux
npm run dist:linux
```

构建产物位于 `dist/`。公开分发前，请在目标系统实机测试并按平台要求完成代码签名。

### 运行测试

```bash
npm run test:bilibili
npm run test:desktop-cache
npm run test:loudness
npm run test:desktop-lyric
npm run test:machine-translation
npm run test:listening-history
npm --prefix app/listen1_chrome_extension test
```

## 项目结构

```text
listen2/
├─ app/
│  ├─ main.js                    # Electron 主进程、IPC 与桌面窗口
│  ├─ bilibiliService.js        # Bilibili 登录、媒体清单与会话管理
│  ├─ audioCache.js             # 桌面端完整音频缓存、容量与 Range 服务
│  ├─ lyricCacheStore.js        # 自动/手选歌词及译文持久化
│  ├─ machineTranslation.js     # DeepSeek 歌词翻译与结果校验
│  ├─ floatingWindow.html       # 桌面歌词窗口
│  └─ listen1_chrome_extension/ # 共用播放器前端与音乐平台适配
├─ build/                        # 应用图标与打包资源
├─ docs/                         # 设计、验证与实现文档
├─ 图片/                         # README 界面预览
├─ package.json                  # 开发、测试与打包配置
└─ README.md
```

## 已知限制

- 音乐平台、歌词接口和 Bilibili Web 接口可能变化，无法保证所有来源永久可用。
- Bilibili 标题不总是包含规范的歌名和歌手；匹配不确定时请使用手动歌词搜索。
- 登录只使用账号实际拥有的访问权限，不保证获得固定音质或画质。
- MV 可用性受视频、地区、CDN 和设备解码能力影响；不可用时请继续使用纯音频模式。
- 逐词高亮需要歌词源提供逐词时间戳；普通 LRC 只能可靠地逐行同步。
- 机器翻译需要用户自行配置 DeepSeek API 密钥，翻译准确性和费用由对应服务决定。
- 离线缓存只覆盖已成功播放并完整缓存的 Bilibili 音频；第一次播放仍需要网络。
- 响度分析器会把解码器支持的来源采样率统一重采样到 48 kHz 分析域；超过时长或资源限制、无法解码的完整 Bilibili 缓存保持原音量。

## 贡献

欢迎提交 Issue 或 Pull Request，尤其欢迎以下方向：

- Bilibili 接口兼容、媒体播放与元数据识别
- Windows、macOS 和 Linux 实机兼容反馈
- 歌词匹配准确率、多语言翻译与无障碍体验
- 播放性能、网络恢复和界面优化

提交问题时，请尽量附上系统版本、复现步骤、内容来源链接和必要日志；请勿上传受版权保护的音频文件、登录 Cookie 或 API 密钥。

## 开源许可与致谢

本项目基于以下开源项目继续开发：

- [listen1/listen1](https://github.com/listen1/listen1)
- [listen1/listen1_desktop](https://github.com/listen1/listen1_desktop)
- [listen1/listen1_chrome_extension](https://github.com/listen1/listen1_chrome_extension)

项目继续使用 [MIT License](./LICENSE.md)。感谢 Listen1 的作者和所有贡献者建立了这个项目的基础。

## 免责声明

Listen2 本身免费、开源，不托管、不上传、不销售任何音乐或歌词内容，也不提供绕过付费、DRM 或平台访问控制的功能。搜索结果、音频、视频、封面和歌词来自相应第三方平台，相关权利归原权利人所有。

使用者应遵守所在地法律法规、内容版权要求及第三方平台服务条款。本项目仅供学习、研究与个人使用。
