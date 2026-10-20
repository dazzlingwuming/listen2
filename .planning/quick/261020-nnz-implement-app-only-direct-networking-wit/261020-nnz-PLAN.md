---
mode: quick
status: verified-release-preparation
date: 2026-10-20
branch: fix/app-direct-20261020
baseline: bc267d334bdc48800846bfca8c6bda7f1d57fe37
---

# 仅本应用直连

用户要求电脑代理继续供其它软件使用，同时让Listen1全部自有网络直连；已有按钮执行请求与最新范围澄清作为实施依据。已有DeepSeek修复c9ce651保留。系统DNS/代理/TUN配置、当前安装版不在本阶段写入范围；先交付可验收代码和候选包。

## Workflow context

已执行gsd-workspace并创建此独立worktree，已执行gsd-quick init（261020-nnz）。干净桌面基线没有ROADMAP.md，故完整quick工作流不可用；本文件记录定向执行计划，不伪造Android路线图。用户仅允许Luna/Sol，未调用固定其它模型的GSD角色；由显式分工的Sol/Luna执行并由主Agent集成验收。

权威持续任务记录仍在原checkout的 `doc/2026-10-20/桌面播放与歌词网络诊断-2026-10-20至2026-10-20.md`。此处为执行计划，不创建平行任务记录。

## Scope and ownership

1. Sol策略负责人：app/desktopNetworkPolicy.js及app/test/desktop_network_policy.test.js。统一direct+secureDNS、default/updater会话、串行设置、旧proxyConfig兼容、失败恢复和即时持久化。
2. Luna界面负责人：profile.js、listen1.html全部代理模板、六种i18n、frontend单文件行为测试。按钮“仅本应用直连”；明确仅作用本软件；pending/ack/失败反馈，容忍未知状态。
3. 独立集成负责人：main.js、网络IPC/启动接入测试、package.json定向测试入口。更新器独立session须在start前完成策略；旧control IPC也必须经过统一入口。
4. 主Agent：接口裁决、代码整合复核、真实同轮解析与请求、隔离GUI/媒体验证、相关CI、提交推送、候选打包与交付记录。

## Contract

- 主session覆盖renderer搜索/Gist/LastFM、Howler HTML5音频/MV、B站API、缓存、DeepSeek；electron-updater使用独立electron-updater session，需显式接入。
- Node歌词已有agent:false公网HTTPS；网易persist:netease-lyrics-v1继续使用本地公网CONNECT，不被批量setProxy覆盖。其DoH经default session。
- 主进程API：network:getState / network:applyConfig；响应只固定安全状态，成功ack后UI才变更；配置mode新增enhanced-direct。
- 持久化保留原proxyConfig，另networkPolicy={version:1,enhancedDirect}；普通模式明确关闭overlay，成功后保存。
- secureDNS服务模板固定Google/AliDNS/Cloudflare官方HTTPS端点；恢复automatic/空列表与平台默认built-in（darwin true，其它false）。保持TLS校验和动态CDN解析，不做静态hosts/IP表。
- 应用不能单方面保证绕过系统TUN。外部浏览器是其它软件，不改变其代理；mac更新下载打开外部浏览器的既有行为按此边界解释。

## Validation

定向覆盖：default/updater均应用；网易session不触碰；并发串行；设置/持久化失败恢复；启动无互联网依赖；未知状态可恢复；IPC发送方限制；UI pending和失败不虚报；旧custom兼容。

先网易/酷狗两个公开小样本同轮验证公网解析与成功GET，失败立即诊断；通过后再验证动态音频/CDN Range与歌词/翻译网络入口、隔离实际设置UI和重启持久化。不能以API/单元测试通过声称全部真实播放已修复。仅相关本地CI，不跑整仓/Android门禁。

所有一次性探针/日志/截图在已登记任务runtime，由task_workspace.py resume/retain/complete管理；正式包独立保存在此worktree dist/app-direct-20261020。相关检查通过后只提交本任务改动并推送fix/app-direct-20261020，不合并、不创建release。

## 扩展授权与实现结果

用户已明确批准更新本机（保留配置），安装与直连保存已核实，并反馈正常好用。随后进一步授权推送、合并 main 和发布安装包；正式版本准备为2.35.5。35项network及DeepSeek相关检查通过，原生双session/安全DNS/公开搜索/媒体Range和冷启动验证完成。详见 `doc/2026-10-20/仅本应用直连验收.md`。发布需在最终main创建版本tag，等待仓库发布workflow完成资产核验，不能以已触发当作完成。
