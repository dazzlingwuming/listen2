# 每日主题与 Mac 安装辅助验收

最后更新：2026-10-25，America/Los_Angeles。状态：本地候选验收通过，准备推送合并与发布，尚未覆盖本机应用。

## 修改范围

- 主题馆新增桌面专用“每日主题”，保留内置主题及个人图片。使用必应允许下载为壁纸的当天图片，自动提取配色；未选中时不发起每日图请求。
- 按本地日期更新，恢复窗口/休眠后检查日期，同一天复用缓存；失败保留上次成功图片或内置背景，并显示真实状态。取消选择时停止后续工作，迟到结果不能覆盖其他主题。
- 固定 HTTPS 图源、有限时间/响应大小、原生图片解码和当日 `wp === true` 校验；图片只保存用户本机，不随安装包或源码分发。界面显示版权署名和当图来源链接。
- macOS 明确跳过项目签名和公证。在 DMG 内附完整性清单和仅针对 Listen1 的安装辅助；经核验后暂存复制、保留旧版，再仅清除新 Listen1 的下载隔离属性。没有 sudo、钥匙串或全局安全设置修改；配置目录不访问。

## 环境与相关检查

- 干净独立 clone，基线 `723c847032f067d852dfb87704985a51ceba5270`，分支 `fix/macos-daily-theme-20261025`。
- 本机 macOS 25.4.0 arm64，Node 24.15.0；实际解码及界面使用 Electron 32.3.2（其 Node 20.18.1）。打包器 electron-builder 25.1.8，依赖按原锁文件安装。未升级依赖。
- 本次没有容器或服务依赖，没有运行 Docker、Android、整仓测试或全量审计。

最终相关测试命令（2026-10-25，退出 0，71/71，0 跳过）：

```sh
node --test app/test/dailyWallpaper.test.js app/test/dailyWallpaperIpc.test.js app/test/dailyTheme.test.js app/test/dailyThemeController.test.js app/test/dailyWallpaperPalette.test.js app/test/personalAppearance.test.js app/test/macInstallHelper.test.js app/test/macPackaging.test.js app/test/mainLocalDataCache.test.js app/listen1_chrome_extension/test/app_direct_network_ui_contract.test.js
```

检查覆盖本地日界线/时区、重启缓存、无效缓存/图像、来源限制、`wp` 许可、超时/上限、取消/迟到回复、IPC 发送者、主题切换、原有个人图片与直连界面、对比度、完整性清单/权限/链接/篡改、只清隔离属性、保留配置及替换失败回滚。

修改的前端 JS 定向 ESLint、相关新模块/配置/说明的 Prettier、Bash/Node 语法、工作流 YAML/五个 run 脚本语法及 `git diff --check` 均通过。原本未统一格式的整个 `main.js` 和 HTML 不作无关重排，仅验证新增调用、语法和相关行为。独立审阅每日源与安装辅助关键逻辑没有阻断发现。

## 真实图源与界面

- 2026-10-25 必应 zh-CN 当日 JPEG，1920×1080、336859 字节，SHA-256 `f8721ff0c8ae494dfa24ba2da3573a6aed87c866e3056cc76c77e66920f39c44`。完整下载，无重定向；sips、Electron 原生解码和现有取色算法成功。
- 实际解码像素的六项文字/强调色对比度均超过 4.5；另有跨颜色样本的白色照片叠加可读性测试。
- 隔离实际前端与后端、默认 session 及应用增强直连模式：未选择每日时请求 0，选择后两次 HTTP 取得 metadata+图像，显示当天图片/日期/配色；切换原主题再切回缓存命中，无重复下载。
- 主题馆使用真实入口与卡片点击，在 1440 和 1000 宽度检查每日卡片、状态、日期和署名，无截断；相同缓存下不再请求图源。用户配置、账户、真实播放均未使用。

## Mac 候选

先单独试做 arm64，通过 DMG 容器、摘要、辅助 `--verify-only`、版本/架构和 ASAR 模块检查后，再扩大到 x64、arm64、universal 最终构建。最终构建时间为 2026-10-26 01:19:30–01:20:12 UTC（当地 2026-10-25 18:19:30–18:20:12 PDT），退出 0，三架构日志明确 `identity explicitly is set to null`。

最终制品的各架构完整性与源码比对结果已独立保存到 `dist/releases/2.35.7/local-candidate/local-acceptance.json`。三个 DMG 均通过容器校验、只读辅助验证与 10 个主要文件源码比对，全部 7 项本地摘要核对通过；该目录是本地候选，不冒称已经上传的 Release。

| 本地候选  | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| x64       | `b4a6aebfd7284e38ccfc3ec89ac88370f845baeade0aba46266e9d8612a63782` |
| arm64     | `1f0a2d4105b754750c3c81c8123e121ce3e56025e8dff8f9ed30d96dce9aefc1` |
| universal | `8da0e948a8a2f17839af56c139f457ba95be4fb605a43c6c512f67ed44bfd49a` |

实际空播放器宽/窄视图在动画稳定后均可见，无真实播放；图库卡片、署名、日期和当图来源链接正常。安装辅助方式与恢复位置见 [macOS 未签名安装辅助说明](macOS未签名安装辅助说明.md)。

## 覆盖限制与恢复

- 真实下载后的 Gatekeeper 弹窗交互、真实 `/Applications` 覆盖安装及用户听歌没有在本轮执行；不能以测试通过声称本机已更新或所有 Mac 均无系统提示。
- 日界线、后续日期及断网等使用受控时间/网络测试；没有等待多日来承诺外部图源持续可用。被限制下载的图片不强行使用。
- 隔离界面没有注册与本任务无关的音频/账户桥接，因此相关“缺少处理器”诊断不作为真实应用故障；完整应用仍使用原桥接。
- 安装辅助会保留旧应用备份，失败时回滚；意外断电/强制终止及并发外部文件系统改动不在保证范围。临时诊断目录需待发布核验及子任务结束后，按登记入口清理。
- GitHub 合并、tag、构建与实际资产的结果在下方后续补充；截至本节创建时均尚未执行。
