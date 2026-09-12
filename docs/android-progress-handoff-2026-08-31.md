# Listen2 Android 进度与接手说明

**最后更新：** 2026-09-12（Asia/Shanghai）

**分支：** `agent/android-mobile-rebuild`

**新版入口：** `mobile/`

**状态：** React Native 第三批本地音乐源码能力已接入，整体仍在开发中；未生成新的验收 APK。

## 1. 已确认的方向

用户已明确否定“桌面页面 + WebView + 持续扩大 native bridge”路线。新版按
原作者 `listen1_mobile` 的方法实现：独立 React Native 应用、手机导航、Redux 状态、
原生后台音频和单一 provider client。

为了能在当前 Android 工具链上维护，实现使用 React Native 0.87.1、React 19、
Redux Toolkit/Redux Persist 和 `react-native-track-player` 4.1.2，不照搬原项目已过时的
RN 0.59/Gradle 5/JDK 8 依赖。

原作者 `listen1_mobile` 没有本地音频或离线缓存能力，`local` 仅用于 JSON 备份。本批
将本地音频作为移动端的显式扩展：通过 Android SAF 保留用户授权的 `content://` URI，
但不把它误称为网络音频离线缓存。

开发节奏也已确认：

- 先把整体功能代码铺完，再集中生成 APK 验收。
- 编码期只运行格式、typecheck、lint、Jest 和 Metro bundle 检查。
- 不跑整仓 CI，不为每个小功能反复组装 APK。

## 2. 当前已实现

### 手机产品骨架

- 底部四栏：我的、发现、搜索、设置。
- 搜索页有来源切换、加载/取消/空结果/错误/分页状态。
- 网易云支持远程歌单搜索、详情和从详情播放。
- 迷你播放器、全屏播放器、播放进度、上一首/下一首、播放队列和歌词面板。
- 歌词支持 LRC 时间轴、原文/译文按时间配对、当前行高亮和自动滚动。
- 手机安全区、窄屏单列布局、深色主题和中文无障碍标签。

### 播放与本地数据

- TrackPlayer 是唯一音频所有者，支持后台服务、系统媒体通知、audio focus、
  进度、seek、音量、单曲/循环/随机。
- 播放列表、独立 FIFO “下一首播放”、真实上一首历史和位置恢复。
- 队列切换按事务语义处理：provider 解析和原生加载成功后才切换并消费待播项；失败不再提前丢掉 FIFO 歌曲。
- 本地收藏、最近播放、自建歌单、加入/移除歌曲，经 AsyncStorage 持久化。
- 第三批本地音乐使用 `@react-native-documents/picker` 12.0.2，通过 Android SAF
  `open`、audio、multi、long-term 模式导入；不申请媒体库权限，不复制或删除用户原文件，
  只持久化获得长期授权的 `content://` URI。
- 本地曲目可持久化并由 TrackPlayer 直接播放，参与队列和历史；移除时清理应用内引用并
  释放 URI 授权，访问失效时标记为 `needs-repair`。本地曲目不请求网络歌词，也不进入可携
  JSON 备份。
- 版本化 JSON 备份包含收藏、自建歌单和当前队列，支持分享导出、粘贴导入；默认合并，覆盖需要二次确认，并拒绝凭据、本地路径、未知字段和超限内容。

### Provider 能力

| 来源     | 搜索          | 播放                      | 歌词           | 歌单详情 |
| -------- | ------------- | ------------------------- | -------------- | -------- |
| 网易云   | 歌曲+远程歌单 | 已接入                    | 主歌词+译文+LRC | 已接入   |
| 酷狗     | 已接入        | 已接入                    | 未接入         | 未接入   |
| 酷我     | 已接入        | 需 Cookie/Secret，未接入  | 未接入         | 未接入   |
| QQ 音乐  | 已接入        | 匿名 vkey 无 purl，未接入 | 已接入         | 未接入   |
| 哔哩哔哩 | 已接入        | 已接入                    | 未接入         | 未接入   |

所有网络路由 provider 内部固定 host/path/query/header profile；UI 不能传入任意
URL、header、Cookie 或 token。未证明的能力返回 typed unavailable，不伪装成空成功。

## 3. 已完成的真实网络探测

- 网易云搜索“青花瓷”返回歌名为“青花瓷”的结果；固定 outer media URL 返回
  302 到 `music.126.net`。真实 TrackPlayer 完整播放仍待模拟器验收。
- 网易公开歌单详情样本的摘要显示 35 首，但详情响应只返回 10 首；这是公开接口样本限制，不能据此宣称完整歌单已验证。
- 哔哩哔哩无固定客户端请求头时会返回 412 HTML；加入 provider 内置 User-Agent
  和 Referer 后返回 200 JSON，“青花瓷”前几项即包含周杰伦相关结果。
- 哔哩哔哩 CDN 的 Range GET 在仅带固定 Referer 时返回 206；因此 API 头与媒体头已拆分。
- 酷狗真实搜索和公开 playInfo 已返回受限的 HTTPS `sharefs.kugou.com` 媒体地址。
- QQ 歌词在固定 `https://y.qq.com/` Referer 下返回成功；匿名播放 vkey 探测的
  `purl` 为空，所以不宣称可播放。

这些是低频、只读的单样本探测，不代表账号、地区、CDN 和所有歌曲都已验证。

## 4. 当前验证

- 格式检查、TypeScript 和 ESLint：通过。
- mobile Jest：9 suites，49 tests 通过。
- Android production Metro bundle：成功，1,471,170 bytes，19 assets。
- 未生成 APK，未完成 Gradle/原生 compile-only，也未完成模拟器端到端验收。
- 原生 compile-only 仍因访问 `plugins.gradle.org` 时 TLS 握手失败而 `not verified`；不能据此声称 Kotlin/Java 编译通过。
- 真实 `content://` URI 的后台播放与重启后播放：`not verified`。

## 5. 仍未完成

高优先级：

- 在模拟器上验证网易云、酷狗和哔哩哔哩的首播、切歌、后台和通知。
- 网易公开歌单详情仍有“摘要 35 首、详情样本 10 首”的完整性限制。
- 本地音乐导入已接入，但离线下载/缓存、账号登录、Bilibili 分 P/MV、
  DeepSeek 翻译、音效/可视化/响度等桌面高级能力尚未迁移；本地 URI 的后台与重启后播放仍待实机验证。
- QQ 匿名播放仍不可用；酷我播放仍需 Cookie/Secret。
- release 签名未配置；正式凭据必须由用户在仓库外提供。

## 6. 下次继续的顺序

1. 继续按已确认的节奏先铺功能蓝本；离线缓存可以作为下一批功能，但不能把 SAF 本地引用当作离线缓存。
2. 恢复 `plugins.gradle.org` 依赖访问并完成 Gradle/原生 compile-only 验证。
3. 完成一批整合功能后只做一次 Android 构建，安装到模拟器验收远程与本地搜索/播放、后台通知、歌词、队列和备份主链；最终集成 APK 与模拟器验收是必须门禁，不能省略。
4. 根据真实 APK 与模拟器结果集中修改差异，并继续补登录和其他需授权的 provider 能力。

## 7. 重要文件

- `mobile/README.md`：新应用范围、环境和开发命令。
- `mobile/src/api/`：受控 provider client。
- `mobile/src/player/`：TrackPlayer 所有者和后台 service。
- `mobile/src/lyrics/`：LRC 时间轴与翻译配对。
- `mobile/src/localAudio/`：SAF 本地音频选择、授权释放与备份隔离。
- `mobile/src/backup/`：版本化 JSON 备份编解码与导入计划。
- `mobile/src/store/`：播放和本地音乐库持久化。
- `mobile/src/screens/`：手机界面。
- `android/`：旧 WebView 工程，暂时仅作迁移证据，不是新版发布入口。

## 8. 不要误报

- 当前不能说 Android 版已完成或已与桌面端完全等价。
- mocked tests、Metro bundle 或 API 单样本成功不等于模拟器真实播放通过。
- 当前没有 APK，也没有模拟器端到端验收；Gradle/原生 compile-only 因 `plugins.gradle.org` TLS 握手失败而 `not verified`。
- 真实 `content://` URI 的后台播放与重启后播放尚未验证；本地音频引用也不等于网络音频离线缓存。
- QQ 匿名播放仍不可用，酷我播放仍需 Cookie/Secret；未授权、VIP、DRM 或地区受限内容不会被绕过。
