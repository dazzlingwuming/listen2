<div align="center">

# Listen2

### 基于 Listen1 的现代化桌面音乐播放器

让 Bilibili 上值得被听见的音乐，拥有更完整、更舒服的播放体验。

[![License](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE.md)
[![Electron](https://img.shields.io/badge/Electron-32-38bdf8.svg)](https://www.electronjs.org/)
[![macOS](https://img.shields.io/badge/macOS-Universal-111827.svg)](#平台支持)
[![Windows](https://img.shields.io/badge/Windows-supported-2563eb.svg)](#平台支持)
[![Based on Listen1](https://img.shields.io/badge/based%20on-Listen1-a78bfa.svg)](https://github.com/listen1/listen1)

</div>

> Listen2 是 [Listen1](https://github.com/listen1/listen1) 的社区增强版本。它保留了 Listen1 的聚合播放与歌单能力，重点重新设计桌面端界面，并改善 Bilibili 音乐搜索、歌词匹配、翻译歌词与播放体验。

## 界面预览

> 项目截图正在整理。建议先拍摄“现代黑播放详情页”，它最能展示圆形封面、实时频谱、同步歌词和新版播放栏。完整的截图尺寸与文件名见 [截图指南](./docs/screenshots/README.md)。

<!-- SCREENSHOTS:START
<p align="center">
  <img src="./docs/screenshots/now-playing-dark.webp" alt="现代黑播放详情页" width="100%" />
</p>

<table>
  <tr>
    <td width="50%"><img src="./docs/screenshots/library-dark.webp" alt="现代黑音乐库" /></td>
    <td width="50%"><img src="./docs/screenshots/now-playing-light.webp" alt="现代白播放详情页" /></td>
  </tr>
  <tr>
    <td align="center">音乐库与新版播放栏</td>
    <td align="center">现代白主题</td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/screenshots/lyrics-search.webp" alt="歌词搜索与手动选择" /></td>
    <td width="50%"><img src="./docs/screenshots/desktop-lyrics.webp" alt="桌面双语歌词" /></td>
  </tr>
  <tr>
    <td align="center">歌词搜索与手动匹配</td>
    <td align="center">桌面双语歌词</td>
  </tr>
</table>
SCREENSHOTS:END -->

## 为什么做这个版本

Listen1 是一个很有价值的开源项目，但随着音乐平台接口与版权策略不断变化，一些旧接口已经不再稳定。与此同时，Bilibili 上仍有大量现场、翻唱、音乐区作品和独立创作者内容，却经常存在标题信息复杂、没有内嵌歌词、封面比例不统一等问题。

Listen2 没有改变 Listen1 的核心定位，而是集中做了三件事：

1. 让桌面播放器更现代、更有沉浸感。
2. 让 Bilibili 内容更容易搜索、识别和播放。
3. 在视频没有歌词时，尽可能准确地补全同步歌词与翻译。

## 主要改动

### 全新的现代播放器

- 新增“现代黑”和“现代白”两套主题，统一音乐库、播放详情页、弹窗与底部播放栏。
- 重做沉浸式播放详情页：圆形封面、环形播放进度、背景氛围光与分层信息布局。
- 重做播放栏、音量滑杆、进度反馈和交互状态，使高频操作更清晰。
- 使用真实音频分析驱动频谱与环形动态效果；动画响应当前歌曲，而不是随机播放预设动画。
- 保留必要的动效层次，同时避免封面反复缩放造成视觉干扰。

### 更完整的 Bilibili 音乐体验

- 更新 Bilibili 视频与音频相关接口适配。
- 支持从复杂的视频标题、分 P 信息与播放器元数据中提取更干净的歌曲线索。
- 针对“4K 修复”“无损”“MV”“动态歌词”等常见标题噪声进行清理，提高歌曲识别率。
- 改善 Bilibili 搜索、播放地址解析、封面与作者信息的展示。
- 当原视频没有歌词时，根据歌名、歌手、时长等信息进行高置信度匹配。

### 歌词、翻译与手动匹配

- 支持同步歌词、播放偏移校正和当前行高亮。
- 支持原文与翻译按各自时间轴同步显示，播放页与桌面歌词可分别开启翻译。
- 为 Bilibili 内容增加多来源歌词候选，并通过标题、歌手和时长综合评分，避免仅凭模糊歌名直接套用错误歌词。
- 自动匹配不可靠时，可以搜索候选并由用户手动选择；选择结果会针对当前曲目保存。
- 对没有逐词时间戳的歌词只做可靠的逐行高亮，不伪造逐词卡拉 OK 进度。

> 歌词数据是否包含翻译取决于可用来源。Listen2 不会把不相关文本或未经确认的机器翻译当作歌词展示。

### 更可靠的随机播放

- 使用 Fisher–Yates 洗牌生成每轮随机队列。
- 一轮内每首可播放歌曲只出现一次，切换到下一轮时避免立刻重复上一首。
- 每次重新进入随机播放或替换歌单都会生成新顺序。
- “上一首”沿真实播放历史返回，不会再次随机跳转。

### 桌面歌词

- 支持桌面歌词置顶、拖动、透明度、字号与颜色调节。
- 锁定后歌词区域保持点击穿透，只保留明确的解锁入口。
- 支持原文与翻译同时显示。
- macOS 下针对多桌面空间、全屏应用和原生窗口按钮做了单独处理。

## 与原版 Listen1 的关系

| 项目     | Listen1 原版               | Listen2                                  |
| -------- | -------------------------- | ---------------------------------------- |
| 核心能力 | 多平台聚合搜索、播放和歌单 | 完整保留                                 |
| 界面     | 经典桌面布局与主题         | 新增现代黑/白与沉浸式播放页              |
| Bilibili | 基础搜索与播放             | 更新接口、清理标题、补充元数据与歌词     |
| 动态效果 | 基础播放反馈               | 真实音频驱动的频谱和环形视觉             |
| 歌词     | 依赖来源直接返回           | 自动匹配、手动选择、偏移调节、双语时间轴 |
| 随机播放 | 传统随机跳转               | 无重复洗牌队列与播放历史                 |
| 桌面歌词 | 基础悬浮窗口               | 锁定穿透、双语显示与 macOS 窗口优化      |

本仓库保留上游提交历史与 MIT 许可证，方便追溯来源。后续若条件允许，也欢迎将通用修复反馈给上游项目。

## 平台支持

核心播放器界面、Bilibili 适配、实时频谱和歌词逻辑由 macOS、Windows、Linux 共用。

| 平台                        | 当前状态         | 说明                                                                                                              |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| macOS Intel / Apple Silicon | 已构建并实际使用 | 支持 x64、arm64 与 Universal 安装包                                                                               |
| Windows x64 / ia32 / arm64  | 支持构建         | 核心 UI 效果一致；桌面歌词的置顶、锁定和窗口行为由 Windows/Electron 原生能力实现，建议发布前进行 Windows 实机回归 |
| Linux                       | 保留上游构建能力 | 不是当前版本的主要测试平台                                                                                        |

Windows 与 macOS 会看到相同的现代主题、播放详情、频谱、歌词搜索和双语歌词。两者不会完全相同的部分是窗口标题栏、多桌面空间以及桌面歌词置顶等操作系统原生行为。

## 开始使用

### 环境要求

- Node.js 18 或更高版本
- npm
- macOS、Windows 或 Linux 桌面系统

### 本地运行

```bash
git clone https://github.com/dazzlingwuming/listen2.git
cd listen2
npm ci
npm run dev
```

本仓库已将修改后的前端代码直接放在 `app/listen1_chrome_extension` 中，不需要再初始化 Git 子模块。

### 作为 Chrome 扩展调试界面

不生成桌面客户端也可以预览和调试大部分前端页面：

1. 打开 Chrome 的 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择 `app/listen1_chrome_extension` 目录。
5. 修改前端后，在扩展管理页点击“重新加载”。

桌面歌词、窗口置顶、系统托盘等 Electron 原生功能仍需运行桌面客户端。

## 构建安装包

```bash
# macOS：按当前配置生成 x64、arm64 和 Universal DMG
npm run dist:mac

# Windows：生成 NSIS 安装包和 7z 包
npm run dist:win

# Linux
npm run dist:linux
```

构建产物位于 `dist/`。公开分发前建议在目标系统实机测试，并按各平台要求完成代码签名。

## 项目结构

```text
listen2/
├── app/
│   ├── main.js                    # Electron 主进程与桌面窗口
│   ├── floatingWindow.html        # 桌面歌词窗口
│   └── listen1_chrome_extension/  # 共用播放器前端与音乐平台适配
├── build/                          # 应用图标与打包资源
├── docs/screenshots/               # README 截图
├── package.json                    # 开发与打包脚本
└── README.md
```

## 已知限制

- 音乐平台和歌词接口可能随时调整，无法保证所有来源永久可用。
- Bilibili 视频标题并不总是包含规范歌名和歌手；自动匹配坚持较高阈值，遇到不确定结果时请使用手动歌词搜索。
- 逐词高亮需要来源提供逐词时间戳。普通 LRC 只能可靠地做到逐行同步。
- Windows 和 Linux 的安装包建议由对应系统构建和验证。

## 贡献

欢迎提交 Issue 或 Pull Request，尤其欢迎以下方向：

- Bilibili 接口兼容与歌曲元数据识别
- Windows / Linux 桌面歌词实机反馈
- 歌词匹配准确率与多语言翻译
- 无障碍、键盘操作与性能优化

提交问题时，请尽量附上系统版本、复现步骤、内容来源链接和日志；请勿上传受版权保护的音频文件。

## 开源许可与致谢

本项目基于以下开源项目继续开发：

- [listen1/listen1](https://github.com/listen1/listen1)
- [listen1/listen1_desktop](https://github.com/listen1/listen1_desktop)
- [listen1/listen1_chrome_extension](https://github.com/listen1/listen1_chrome_extension)

项目继续使用 [MIT License](./LICENSE.md)。原始版权声明保留在许可证与相关源文件中。

感谢 Listen1 的作者和所有贡献者建立了这个项目的基础。

## 免责声明

Listen2 本身免费、开源，不托管、不上传、不销售任何音乐或歌词内容，也不提供绕过付费、DRM 或平台访问控制的功能。搜索结果、音频、封面和歌词来自相应第三方平台，相关权利归原权利人所有。

使用者应遵守所在地法律法规、内容版权要求以及第三方平台的服务条款。本项目仅供学习、研究与个人使用；若某项内容不应被访问或展示，请通过 Issue 提供必要信息。
