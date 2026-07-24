<div align="center">

# Listen2

### 把 Bilibili 上的优质音乐，整理成真正好用的桌面播放器

不再为了基础播放、歌词、翻译和舒服的桌面界面，额外购买一套音乐会员服务。

[![License](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE.md)
[![Electron](https://img.shields.io/badge/Electron-32-38bdf8.svg)](https://www.electronjs.org/)
[![macOS](https://img.shields.io/badge/macOS-Universal-111827.svg)](#平台支持)
[![Windows](https://img.shields.io/badge/Windows-supported-2563eb.svg)](#平台支持)
[![Based on Listen1](https://img.shields.io/badge/based%20on-Listen1-a78bfa.svg)](https://github.com/listen1/listen1)

</div>

> Listen2 是 [Listen1](https://github.com/listen1/listen1) 的社区增强版本。它保留了 Listen1 的聚合播放与歌单能力，把 Bilibili 上用户可正常访问的音乐内容整理成更完整的桌面体验：搜索、播放、歌单、同步歌词、翻译和现代化 UI。

## 界面预览

![Listen2 沉浸式播放页、实时频谱与双语歌词](图片/img.png)

![Listen2 Bilibili 分 P 歌单与现代化音乐库](图片/img_1.png)

> 更多实际播放效果和操作演示可通过项目的 Bilibili 视频查看。

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

这个项目最直接的出发点也很简单：我不希望只是为了获得完整的播放、歌词、翻译和桌面 UI，再去开一个音乐会员。Bilibili 上已经存在大量用户可以正常访问的优秀音乐资源；如果能把歌曲信息整理好、把歌词与翻译补齐，再配上一套真正适合日常使用的界面，体验就已经非常完整。

Listen2 做的是整理和改善这些可访问内容的播放体验，而不是解锁用户原本无权访问的资源。当前版本集中完成了四件事：

1. 让桌面播放器更现代、更有沉浸感。
2. 让 Bilibili 内容更容易搜索、识别和播放。
3. 在视频没有歌词时，尽可能准确地补全同步歌词。
4. 优先寻找现成译文，所有歌词源都没有译文时再用整首机器翻译兜底。

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
- 搜索歌词时会标记哪些候选包含译文；当前来源没有译文时，会继续从其他高匹配歌词源寻找。
- 所有歌词源都没有译文时，可以使用 DeepL 进行机器翻译兜底。程序会将整首歌词作为一个请求发送，利用完整上下文翻译，再按原始时间戳逐行回填，不会逐句调用 API。
- 翻译行数或行号无法完整对应时，会丢弃整次机器翻译结果，避免错行；成功结果会缓存，减少重复请求与费用。
- DeepL API 密钥通过 Electron 安全存储加密保存，不会暴露给播放器网页。
- 自动匹配不可靠时，可以搜索候选并由用户手动选择；选择结果会针对当前曲目保存。
- 对没有逐词时间戳的歌词只做可靠的逐行高亮，不伪造逐词卡拉 OK 进度。

> 翻译顺序固定为：当前歌词自带译文 → 其他高匹配歌词源的译文 → 用户主动启用的整首机器翻译兜底。Listen2 不会把不相关文本或无法可靠对齐的结果当作歌词展示。

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

## 当前状态

- Bilibili 搜索、分 P 解析、音频播放和歌曲线索提取已经可用。
- 现代黑/白主题、沉浸式播放页、实时频谱和新版播放栏已经完成。
- 自动歌词匹配、手动搜索、跨来源译文和 DeepL 整首翻译兜底已经接通。
- Windows 11 x64 安装包已经完成实机架构与打包内容核验；macOS 仍保留 Intel、Apple Silicon 和 Universal 构建能力。

## 后续路线图

### 1. 使用 Bilibili 视频作为 MV

- 在播放页直接加载当前 Bilibili 视频，让同一个资源可以在“纯音频”和“MV”之间切换。
- 保持音频、视频、进度条和歌词时间轴同步，切换模式时不从头播放。
- 支持分 P 视频、全屏播放和清晰度选择，并在视频不可用时自动退回纯音频模式。

### 2. 接入 Bilibili 登录态，提升可用音质

- 增加安全、可退出的 Bilibili 登录流程。
- 登录后请求该账号本身有权访问的更高音质，并明确显示当前实际音质。
- 安全保存必要的登录态，处理过期、退出和匿名播放回退。
- 登录功能只使用用户账号已有的访问权限，不绕过会员、付费内容、DRM 或平台访问控制。

## 与原版 Listen1 的关系

| 项目     | Listen1 原版               | Listen2                                      |
| -------- | -------------------------- | -------------------------------------------- |
| 核心能力 | 多平台聚合搜索、播放和歌单 | 完整保留                                     |
| 界面     | 经典桌面布局与主题         | 新增现代黑/白与沉浸式播放页                  |
| Bilibili | 基础搜索与播放             | 更新接口、清理标题、补充元数据与歌词         |
| 动态效果 | 基础播放反馈               | 真实音频驱动的频谱和环形视觉                 |
| 歌词     | 依赖来源直接返回           | 自动匹配、跨源译文、整首机器翻译、双语时间轴 |
| 随机播放 | 传统随机跳转               | 无重复洗牌队列与播放历史                     |
| 桌面歌词 | 基础悬浮窗口               | 锁定穿透、双语显示与 macOS 窗口优化          |

本仓库保留上游提交历史与 MIT 许可证，方便追溯来源。后续若条件允许，也欢迎将通用修复反馈给上游项目。

## 平台支持

核心播放器界面、Bilibili 适配、实时频谱和歌词逻辑由 macOS、Windows、Linux 共用。

| 平台                        | 当前状态         | 说明                                                                                |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| macOS Intel / Apple Silicon | 已构建并实际使用 | 支持 x64、arm64 与 Universal 安装包                                                 |
| Windows x64                 | 已构建并实机核验 | 已生成 NSIS 安装包；核心 UI、歌词搜索、跨源翻译与整首机器翻译功能已进入最终打包产物 |
| Windows ia32 / arm64        | 保留构建能力     | 当前没有对应设备的实机回归                                                          |
| Linux                       | 保留上游构建能力 | 不是当前版本的主要测试平台                                                          |

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
├── 图片/                            # 当前版本界面预览
├── package.json                    # 开发与打包脚本
└── README.md
```

## 已知限制

- 音乐平台和歌词接口可能随时调整，无法保证所有来源永久可用。
- Bilibili 视频标题并不总是包含规范歌名和歌手；自动匹配坚持较高阈值，遇到不确定结果时请使用手动歌词搜索。
- 逐词高亮需要来源提供逐词时间戳。普通 LRC 只能可靠地做到逐行同步。
- 机器翻译是所有歌词源均无译文时的可选兜底，需要用户自行配置 DeepL API Free 或 API Pro 密钥。
- Bilibili 视频 MV 与账号登录音质增强仍在路线图中，尚未进入当前版本。
- Windows 和 Linux 的安装包建议由对应系统构建和验证。

## 贡献

欢迎提交 Issue 或 Pull Request，尤其欢迎以下方向：

- Bilibili 接口兼容与歌曲元数据识别
- Bilibili 视频 MV、音画同步与清晰度切换
- Bilibili 登录态、音质选择与安全退出
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
