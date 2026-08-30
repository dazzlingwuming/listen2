---
title: Listen2 外部集成与边界映射
analysis_date: 2026-08-30
repository: listen1_desktop
branch: agent/android-mobile-rebuild
head: e98960d
---

# 外部集成与边界映射

## 快照与总体架构

- 分析日期：2026-08-30；当前分支：`agent/android-mobile-rebuild`；HEAD：`e98960d`。
- Electron 主进程位于 `app/main.js`，嵌入式页面位于 `app/listen1_chrome_extension/listen1.html`；页面中的 provider 通常直接通过 axios 访问音乐服务。
- 桌面流程可概括为：UI → `app/listen1_chrome_extension/js/loweb.js` 的 provider → 外部音乐/歌词 API；需安全或持久化能力时再走 Electron IPC → `app/*.js`。
- Android 复用 allow-list 选出的静态页面，但使用 `https://appassets.androidplatform.net/assets/listen1/`，仅以 `Listen2AndroidHttp` WebMessage bridge 代理少量搜索请求。
- 没有发现独立 Listen2 后端、数据库服务或分析平台；主要状态在本地 Electron Store、Web Storage、Cookie 和文件缓存中。

## 集成总表

| 系统 | 代码入口 | 认证/状态 | 当前状态 |
| --- | --- | --- | --- |
| Bilibili | `app/bilibiliService.js`、`app/listen1_chrome_extension/js/provider/bilibili.js` | Cookie、WBI、桌面安全存储的刷新状态；Android 只保留内存指纹 | 桌面功能完整；Android 仅受限搜索/匿名指纹 |
| NetEase | `app/listen1_chrome_extension/js/provider/netease.js` | WeAPI/EAPI、Cookie 登录；Android 仅匿名搜索 | 桌面功能完整；Android 仅精确搜索路由 |
| QQ Music | `app/listen1_chrome_extension/js/provider/qq.js` | 浏览器 Cookie、Referer/Origin 规则 | 搜索、榜单、播放、歌词和用户相关路径存在 |
| KuGou / Kuwo | `app/listen1_chrome_extension/js/provider/kugou.js`、`app/listen1_chrome_extension/js/provider/kuwo.js` | Cookie 或请求签名字段；无完整登录 | 直连外部 provider，部分旧接口仍为明文 HTTP |
| Migu / Taihe | `app/listen1_chrome_extension/js/provider/migu.js`、`app/listen1_chrome_extension/js/provider/taihe.js` | Cookie、设备/会话本地值；Taihe 无登录实现 | 直连公共接口 |
| DeepSeek | `app/machineTranslation.js` | API key 由 Electron `safeStorage` 保护 | 仅桌面歌词翻译 |
| GitHub Gist | `app/listen1_chrome_extension/js/github.js`、`app/listen1_chrome_extension/js/background.js` | OAuth code 换取 token，token 存 Web Storage | 播放列表备份/恢复 |
| Last.fm | `app/listen1_chrome_extension/js/lastfm.js` | token/session 存 Web Storage | now-playing 与 scrobble |

## Bilibili

- 前端入口是 `app/listen1_chrome_extension/js/provider/bilibili.js`；桌面增强服务是 `app/bilibiliService.js`，Android 策略位于 `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java`。
- 搜索使用 `https://api.bilibili.com/x/web-interface/search/type`；视频信息、播放上下文和 WBI 数据还会访问同一域名的 web-interface/player 路径。
- 音频目录与歌曲 URL 使用 `www.bilibili.com/audio/music-service-c/`；桌面服务也会读取 Bilibili 音频/视频 manifest 并将可用变体交给缓存层。
- QR 登录走 `passport.bilibili.com` 的二维码生成、轮询和退出接口；Cookie 刷新走 passport 的 cookie info、refresh 和 confirm 路径。
- `app/bilibiliService.js` 用默认 Electron session、credentials include、超时和内存 manifest/WBI 缓存；刷新状态写入 Electron Store，并在可用时使用 `safeStorage`。
- Android bridge 只允许 HTTPS GET 到 `api.bilibili.com`，当前 host policy 对该 host 的路径范围仍然偏宽；启动时可访问固定 fingerprint endpoint，`buvid3` 只在内存中保存。
- Android 没有原生 Bilibili 登录、Cookie 刷新、完整播放 manifest bridge 或离线缓存；前端搜索失败会返回明确的空结果/错误契约。
- 建议把 Bilibili 的 manifest、登录和刷新请求继续集中在桌面服务，给 Android 路由补充精确 path/query allow-list，并对 WBI/接口变更做回归测试。

## NetEase Music

- 入口是 `app/listen1_chrome_extension/js/provider/netease.js`，桌面默认使用 Web API 加密请求；歌曲播放 URL 使用 `interface3.music.163.com/eapi/song/enhance/player/url`。
- 搜索桌面路径是 `https://music.163.com/api/search/pc` POST；Android 改用 `https://music.163.com/api/search/get/web` GET。
- Android policy 只接受精确的 `/api/search/get/web` 路径，query 只允许 `s`、`type`、`offset`、`limit`，并限制页大小和偏移量。
- 歌词、歌单、榜单、详情、登录和用户播放列表等路径仍由桌面 provider 直接请求 music.163.com 的 Web API。
- 登录支持手机号/邮箱和 Cookie 凭据；Android 设计上不提供原生会话或登录桥接。
- 建议保持 Android 精确路由和参数边界，避免把桌面 Web API 的 Cookie/加密登录能力无意暴露给 WebView。

## 其他音乐 provider

- QQ Music `app/listen1_chrome_extension/js/provider/qq.js` 访问 `c.y.qq.com`、`u.y.qq.com`、`i.y.qq.com`，图片使用 `y.gtimg.cn`；Chrome DNR 规则为 QQ 请求补充 Referer/Origin。
- QQ provider 覆盖搜索、榜单、标签歌单、专辑、歌手、播放 URL、歌词和 Cookie 用户路径；Android bridge 不允许这些域名。
- KuGou `app/listen1_chrome_extension/js/provider/kugou.js` 使用 `m.kugou.com`、`www.kugou.com`、`songsearch.kugou.com` 和 `wwwapi.kugou.com`；部分旧移动接口仍是 `http://mobilecdnbj.kugou.com`。
- KuGou 无完整登录实现，Chrome DNR 会为相关媒体请求设置移动 UA；建议尽快移除明文 HTTP 依赖或明确其风险与降级策略。
- Kuwo `app/listen1_chrome_extension/js/provider/kuwo.js` 使用 `www.kuwo.cn`、`m.kuwo.cn`、`search.kuwo.cn`、`nplserver.kuwo.cn` 及图片域名，包含基于 Cookie/请求字段的签名流程。
- Kuwo 当前没有完整登录实现；建议把签名字段和 Cookie 处理限制在 provider 内，并为接口失效保留替代歌词/播放源。
- Migu `app/listen1_chrome_extension/js/provider/migu.js` 访问 `app.c.nf.migu.cn`、`app.u.nf.migu.cn`、`music.migu.cn`、`cdnmusic.migu.cn` 和 `d.musicapp.migu.cn`，使用设备/会话类本地值及 Cookie。
- Taihe `app/listen1_chrome_extension/js/provider/taihe.js` 以 `https://music.taihe.com/v1` 为基础地址，提供搜索、目录、播放和歌词；没有登录实现。
- Xiami `app/listen1_chrome_extension/js/provider/xiami.js` 是隐藏的旧兼容 provider，当前 registry 标为不可见、不可搜索、不可登录，主要保留旧元数据/stub 路径。
- Local music `app/listen1_chrome_extension/js/provider/localmusic.js` 只处理本地文件、音频标签和本地歌单，没有外部网络集成。
- provider 注册状态统一在 `app/listen1_chrome_extension/js/loweb.js`；netease、QQ、KuGou、Kuwo、Bilibili、Migu、Taihe 可搜索，Xiami 和本地音乐默认隐藏。

## 歌词与翻译链路

- Bilibili provider 在主源不可用时，会尝试 QQ 搜索/歌词、NetEase 搜索/歌词、LRCLIB 搜索和 Kuwo 歌词。
- QQ 歌词路径包括 `c.y.qq.com/soso/fcgi-bin/client_search_cp` 与 `i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg`。
- NetEase 歌词路径包括 `music.163.com/api/search/get/web` 与 `music.163.com/api/song/lyric`；LRCLIB 使用 `https://lrclib.net/api/search`。
- Kuwo 歌词使用 `www.kuwo.cn/search/searchMusicBykeyWord` 与 `m.kuwo.cn/newh5/singles/songinfoandlrc`。
- 桌面 `app/machineTranslation.js` 调用 `https://api.deepseek.com/chat/completions`，使用配置的 DeepSeek 模型、JSON 请求和 Bearer API key。
- 翻译请求限制歌词字节数、定时歌词行数和响应大小，主进程设置 30 秒超时，并检查行 ID 与 JSON 对齐；结果写入本地翻译缓存。
- DeepSeek key 只在桌面主进程读取，渲染层配置只得到是否已配置等状态；Android 没有对应 Electron IPC 能力。
- 建议对所有歌词 fallback 做来源标记、超时和隐私边界说明，并在 DeepSeek 供应商或模型变更时更新契约测试。

## GitHub OAuth 与 Gist 备份

- `app/listen1_chrome_extension/js/github.js` 使用 `https://github.com/login/oauth` 换取授权，并调用 `https://api.github.com` 的 user、gists 及单个 gist 路径。
- Chrome/Firefox manifest 都授予 GitHub 登录、API 和 Gist host permission；`app/listen1_chrome_extension/js/oauth_callback.js` 在 `listen1.github.io` callback 页面把 code 传回扩展后台。
- `app/listen1_chrome_extension/js/background.js` 接收 callback 并调用 GitHub client；Electron 模式通过 `@electron/remote` 打开授权窗口，浏览器模式使用 `window.open`。
- OAuth access token 当前保存在渲染层 Web Storage，axios interceptor 会在 API 请求中添加 Authorization；备份内容包含 `listen1_backup.json` 和 Markdown 摘要。
- 检测到硬编码 OAuth/API 凭据，需要轮换并迁移到安全配置；本文不记录任何凭据值。
- 建议移除随客户端发布的 OAuth client secret，改用 PKCE 或受控后端交换；同时迁移旧 Web Storage token、缩小 GitHub host/权限并增加登出清理证明。

## Last.fm

- `app/listen1_chrome_extension/js/lastfm.js` 调用 `https://ws.audioscrobbler.com/2.0/` 的 token/session、now-playing 和 scrobble 方法。
- 授权页面是 `https://www.last.fm/api/auth/`；token 与 session 当前存于 Web Storage，桌面与扩展共用前端模块。
- 检测到硬编码 OAuth/API 凭据，需要轮换并迁移到安全配置；本文不记录任何凭据值。
- 建议将 API client 配置从发布包剥离，避免在日志/导出备份中携带 session，并为用户撤销授权和清除本地状态提供明确路径。

## Electron 主机集成

- `app/main.js` 使用 Electron `session.defaultSession.webRequest` 为多个 provider/CDN 改写 Referer、Origin、UA，并在媒体响应上处理 CORS/CORP 头以支持 Web Audio 可视化。
- 这些 hook 覆盖音乐服务、Bilibili、GitHubusercontent 等多个域名；建议按实际媒体 CDN 精确收敛，避免通配 `*://*/*` 带来的跨域扩大。
- 自动更新由 `electron-updater` 在 `app/main.js` 加载时检查；当前构建配置和 workflow 证明了制品构建/发布，但没有独立部署健康检查。
- `listen2-cache` 自定义 protocol 将本地音频缓存以 Range 响应提供给播放器；缓存索引和内容位于 `userData/audio-cache-v1`。
- IPC 覆盖缓存、歌词、听歌历史、机器翻译、Bilibili 认证/manifest 和本地数据删除；主进程对部分 handler 校验发送方 URL 是否为本地 Listen1 页面。
- `openUrl` handler 会创建 sandbox 子窗口，但仍应在 handler 层验证发送方和 URL scheme/域名，避免把任意外部 URL 作为受信调用。
- 主窗口仍启用 `nodeIntegration: true`、关闭 `contextIsolation` 并启用 `@electron/remote`；建议分阶段迁移到隔离 preload 和 allow-list IPC。

## Android WebView 与网络桥接

- `android/app/src/main/AndroidManifest.xml` 声明 `INTERNET`，关闭明文流量；没有原生媒体服务、账户存储或 Bilibili/NetEase 登录权限。
- `MainActivity.java` 通过 `WebViewAssetLoader` 从 `https://appassets.androidplatform.net/assets/listen1/` 加载打包页面，禁止 file/content 跨访问、混合内容、弹窗和多个窗口。
- `NavigationPolicy.java` 只允许精确的 packaged asset origin/path；普通 HTTP(S) 外链交给系统浏览器，其余 scheme 被阻断。
- `AndroidHttpBridge.java` 只在 WebMessageListener 可用时安装，不提供 `addJavascriptInterface` fallback；桥接请求使用单 worker、有限队列、超时、无重定向和响应大小上限。
- `HttpBridgePolicy.java` 的协议为 v1，要求可信 appassets origin、HTTPS、默认 443、无 userinfo，并限制 URL/消息/响应尺寸。
- 当前允许的外部 HTTP 路由是 Bilibili `api.bilibili.com` 的 HTTPS GET，以及 NetEase 精确的 `/api/search/get/web` GET；只转发有效的内存 `buvid3` 到允许路径。
- Android 只覆盖 Bilibili/NetEase 搜索，不能据此推断桌面 provider、登录、歌词 fallback、缓存和后台播放在移动端可用。
- 建议将 Bilibili host policy 从“任意路径”收窄为实际使用的 API 路径，继续维持无重定向、无 caller header 注入和 bounded body 的安全契约。

## 浏览器扩展权限与发布边界

- Chrome MV3 清单是 `app/listen1_chrome_extension/manifest.json`：后台 service worker 为 `app/listen1_chrome_extension/js/background.js`，权限包括 cookies、notifications、unlimitedStorage、declarativeNetRequest。
- Chrome `app/listen1_chrome_extension/rules_1.json` 对 QQ Referer/Origin、KuGou UA 和 Bilibili bilivideo 媒体 Referer 设置 DNR 规则；host permission 覆盖各 provider、LRCLIB、GitHub API/login/Gist。
- Firefox 清单是 `app/listen1_chrome_extension/manifest_firefox.json`：MV2 persistent background，并额外授予 downloads、tabs、webRequest/webRequestBlocking 等更宽权限。
- OAuth callback content script 仅注入 `https://listen1.github.io/listen1/*`；建议保持 callback 单一来源并逐步减少 Firefox 的阻塞式 webRequest 权限。
- Android 的 Gradle allow-list 只复制运行页面与选定 JS，不复制扩展清单、测试、锁文件或开发文档；Android 因而不是完整 Chrome/Firefox 扩展运行时。

## 交接建议与未覆盖项

- 将外部 API 域名、路径、认证方式和允许平台整理成可测试的 machine-readable policy，provider 变更时同步更新桌面 hook、DNR 和 Android policy。
- 对 GitHub/Last.fm 的已检测硬编码凭据执行轮换；迁移后再清理历史包、构建产物和旧 Web Storage 会话，并验证登出/撤销流程。
- 为每个公共 provider 设置超时、重试上限、失败契约和备用源；尤其监控 KuGou 明文接口及 Bilibili/NetEase 非稳定 API。
- 当前静态映射没有验证真实线上账号、API 可用性、OAuth 回调完成度、更新服务器健康或 Android 真机网络行为；这些均标记为 not verified。
- 推荐验证顺序：运行 `npm run test:bilibili` 与前端 Android HTTP contract tests，再执行 `.github/workflows/android-apk.yml` 对应的 JVM 测试/构建，最后在隔离测试账号上做 OAuth 和 provider smoke test。

分析日期：2026-08-30。
