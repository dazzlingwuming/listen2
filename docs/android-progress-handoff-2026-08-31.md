# Listen2 Android 进度与接手说明

**最后更新：** 2026-09-12（Asia/Shanghai）

**分支：** `agent/android-mobile-rebuild`

**新版入口：** `mobile/`

**状态：** React Native 整体蓝本开发中，未生成新的验收 APK。

## 1. 已确认的方向

用户已明确否定“桌面页面 + WebView + 持续扩大 native bridge”路线。新版按
原作者 `listen1_mobile` 的方法实现：独立 React Native 应用、手机导航、Redux 状态、
原生后台音频和单一 provider client。

为了能在当前 Android 工具链上维护，实现使用 React Native 0.87.1、React 19、
Redux Toolkit/Redux Persist 和 `react-native-track-player` 4.1.2，不照搬原项目已过时的
RN 0.59/Gradle 5/JDK 8 依赖。

开发节奏也已确认：

- 先把整体功能代码铺完，再集中生成 APK 验收。
- 编码期只运行快速 typecheck、lint、Jest 和 Metro bundle 检查。
- 不跑整仓 CI，不为每个小功能反复组装 APK。

## 2. 当前已实现

### 手机产品骨架

- 底部四栏：我的、发现、搜索、设置。
- 搜索页有来源切换、加载/取消/空结果/错误/分页状态。
- 迷你播放器、全屏播放器、播放进度、上一首/下一首、播放队列和歌词面板。
- 手机安全区、窄屏单列布局、深色主题和中文无障碍标签。

### 播放与本地数据

- TrackPlayer 是唯一音频所有者，支持后台服务、系统媒体通知、audio focus、
  进度、seek、音量、单曲/循环/随机。
- 播放列表、独立 FIFO “下一首播放”、真实上一首历史和位置恢复。
- 切歌在 provider bootstrap 成功后才消费队列项；失败不再提前丢掉 FIFO 歌曲。
- 本地收藏、最近播放、自建歌单、加入/移除歌曲，经 AsyncStorage 持久化。

### Provider 能力

| 来源     | 搜索   | 播放                      | 歌词        | 歌单详情 |
| -------- | ------ | ------------------------- | ----------- | -------- |
| 网易云   | 已接入 | 已接入                    | 主歌词+译文 | 已接入   |
| 酷狗     | 已接入 | 已接入                    | 未接入      | 未接入   |
| 酷我     | 已接入 | 需 Cookie/Secret，未接入  | 未接入      | 未接入   |
| QQ 音乐  | 已接入 | 匿名 vkey 无 purl，未接入 | 已接入      | 未接入   |
| 哔哩哔哩 | 已接入 | 已接入                    | 未接入      | 未接入   |

所有网络路由 provider 内部固定 host/path/query/header profile；UI 不能传入任意
URL、header、Cookie 或 token。未证明的能力返回 typed unavailable，不伪装成空成功。

## 3. 已完成的真实网络探测

- 网易云搜索“青花瓷”返回歌名为“青花瓷”的结果；固定 outer media URL 返回
  302 到 `music.126.net`。真实 TrackPlayer 完整播放仍待模拟器验收。
- 哔哩哔哩无固定客户端请求头时会返回 412 HTML；加入 provider 内置 User-Agent
  和 Referer 后返回 200 JSON，“青花瓷”前几项即包含周杰伦相关结果。
- 哔哩哔哩 CDN 的 Range GET 在仅带固定 Referer 时返回 206；因此 API 头与媒体头已拆分。
- 酷狗真实搜索和公开 playInfo 已返回受限的 HTTPS `sharefs.kugou.com` 媒体地址。
- QQ 歌词在固定 `https://y.qq.com/` Referer 下返回成功；匿名播放 vkey 探测的
  `purl` 为空，所以不宣称可播放。

这些是低频、只读的单样本探测，不代表账号、地区、CDN 和所有歌曲都已验证。

## 4. 当前验证

- `npx tsc --noEmit`：通过。
- `npx eslint . --quiet`：通过。
- mobile Jest：4 suites，22 tests 通过。
- Android production Metro bundle：成功，JS bundle 约 1.4 MiB。
- 未跑整仓 CI；未组装新 APK；未完成模拟器端到端播放。

## 5. 仍未完成

高优先级：

- 在模拟器上验证网易云、酷狗和哔哩哔哩的首播、切歌、后台和通知。
- 搜索实体目前主要是歌曲；还需把远程歌单搜索与详情完整接入 UI。
- 歌词已能加载原文/译文，但还没有做按原生进度的当前行高亮。
- 备份导入/导出、本朰音乐导入、离线下载/缓存、账号登录、Bilibili 分 P/MV、
  DeepSeek 翻译、音效/可视化/响度等桌面高级能力尚未迁移。
- release 签名未配置；正式凭据必须由用户在仓库外提供。

## 6. 下次继续的顺序

1. 先补远程歌单 UI 链和歌词时间轴。
2. 补备份和本地音乐，再补离线缓存。
3. 补登录和其他需授权的 provider 能力。
4. 完成一批整合功能后只做一次 Android 构建，安装到模拟器做主链验收。
5. 用户体验整体 APK 后，再集中修改差异。

## 7. 重要文件

- `mobile/README.md`：新应用范围、环境和开发命令。
- `mobile/src/api/`：受控 provider client。
- `mobile/src/player/`：TrackPlayer 所有者和后台 service。
- `mobile/src/store/`：播放和本地音乐库持久化。
- `mobile/src/screens/`：手机界面。
- `android/`：旧 WebView 工程，暂时仅作迁移证据，不是新版发布入口。

## 8. 不要误报

- 当前不能说 Android 版已完成或已与桌面端完全等价。
- mocked tests、Metro bundle 或 API 单样本成功不等于模拟器真实播放通过。
- QQ 和酷我当前不可播；未授权、VIP、DRM 或地区受限内容不会被绕过。
