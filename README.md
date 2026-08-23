<div align="center">

# Listen2

### 把 Bilibili 与多平台音乐内容，整理成更好用的桌面播放器

[![License](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE.md)
[![Electron](https://img.shields.io/badge/Electron-32-38bdf8.svg)](https://www.electronjs.org/)
[![Windows](https://img.shields.io/badge/Windows-x64-2563eb.svg)](https://github.com/dazzlingwuming/listen2/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Universal-111827.svg)](#平台支持)
[![Based on Listen1](https://img.shields.io/badge/based%20on-Listen1-a78bfa.svg)](https://github.com/listen1/listen1)

[下载最新版](https://github.com/dazzlingwuming/listen2/releases/latest) · [报告问题](https://github.com/dazzlingwuming/listen2/issues) · [构建说明](#本地开发与构建)

</div>

Listen2 是 [Listen1](https://github.com/listen1/listen1) 的社区增强版本。它保留多平台聚合搜索、播放和歌单能力，并重点改善 Bilibili 音乐播放、同步歌词、歌词翻译、桌面歌词、MV 和现代化桌面体验。

> Listen2 只整理和播放用户本来就有权访问的内容，不解锁会员、付费、DRM、地区限制或其他受限资源。

## 界面预览

![Listen2 沉浸式播放页、实时频谱与双语歌词](图片/img.png)

![Listen2 Bilibili 分 P 歌单与现代化音乐库](图片/img_1.png)

## 功能亮点

### 现代化播放器

- 现代黑、现代白两套主题，覆盖音乐库、播放详情、弹窗与底部播放栏。
- 沉浸式播放详情页，包含圆形封面、环形进度、背景氛围光和分层信息布局。
- 由真实音频分析驱动的频谱与动态效果，而不是与音乐无关的预设动画。
- 重新设计播放进度、音量、状态反馈和高频操作区域。

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
- DeepSeek API 密钥通过 Electron `safeStorage` 加密保存，不会返回给播放器页面。

> Listen2 不会在播放、切歌或加载歌词时自动调用 DeepSeek。只有用户在确认面板主动同意后才发送歌名、歌手和整首歌词；请求可能产生 DeepSeek API 费用。

### 桌面歌词与播放控制

- 支持桌面歌词置顶、拖动、透明度、字号、颜色和双语显示。
- 未锁定时可直接控制上一首、播放/暂停和下一首，并显示真实播放状态。
- 锁定后歌词区域支持点击穿透，同时保留明确的解锁入口。
- 针对 macOS 多桌面空间和全屏应用做了单独窗口适配；Windows 使用对应的原生置顶行为。

### 更可靠的随机播放

- 使用 Fisher–Yates 洗牌生成每轮随机队列。
- 一轮内每首可播放歌曲只出现一次，新一轮避免立即重复上一首。
- “上一首”沿真实播放历史返回，重启播放器后也会正确恢复随机模式。

## 下载与安装

前往 [GitHub Releases](https://github.com/dazzlingwuming/listen2/releases/latest) 下载适合当前系统的安装包。

### Windows

下载文件名包含 `win_x64.exe` 的 NSIS 安装包并运行。目前安装包未使用商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”；请核对下载来源和 Release 页面提供的 SHA-256。

### macOS

下载 DMG 后拖入“应用程序”。当前 macOS 构建未使用 Apple Developer ID 签名或公证，首次打开时可能出现系统安全提示。

## 平台支持

核心播放器界面、Bilibili 适配、频谱和歌词逻辑由 Windows、macOS 与 Linux 共用。操作系统原生窗口行为会有少量差异。

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | 已构建并验证 | 提供 NSIS 安装包；包含现代 UI、Bilibili、MV、桌面歌词与 DeepSeek 翻译 |
| macOS Intel / Apple Silicon | 已构建并验证 | 支持 x64、arm64 与 Universal DMG；当前未签名或公证 |
| Windows ia32 / arm64 | 保留构建能力 | 尚未在对应设备上完成系统性回归 |
| Linux | 保留构建能力 | 不是当前版本的主要测试平台 |

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
npm run test:desktop-lyric
npm run test:machine-translation
```

## 项目结构

```text
listen2/
├─ app/
│  ├─ main.js                    # Electron 主进程、IPC 与桌面窗口
│  ├─ bilibiliService.js        # Bilibili 登录、媒体清单与会话管理
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
