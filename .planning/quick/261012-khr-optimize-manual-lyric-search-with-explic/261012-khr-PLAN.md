# 手动歌词搜索字段优化计划

状态：source complete / runtime degraded · 2026-10-12

## 目标与范围

把 Bilibili 曲目的手动歌词搜索改为独立的必填歌名与可选歌手字段。打开面板时只预填建议、不发起搜索；用户提交后，以其编辑值为准，绝不从 Bilibili 上传者回填歌手。QQ、LRCLIB、酷狗、网易云、酷我五个来源都支持仅歌名查询，并逐源报告目录无匹配、无同步歌词、歌词下载失败、验证要求和超时等结果。保留现有 HTTPS 窄 transport、取消、缓存及网易云持久验证契约。

基线：产品仓库 `/tmp/listen2-kugou-20261012`，分支 `agent/kugou-lyrics-20261012`，HEAD `e4392887aaf93307b2563cae8b2f523d1df8ce38`。本计划只覆盖歌词面板、六种语言、`loweb`/provider 搜索路由及相关行为测试；不做网络层重构，不涉及 merge、release 或 GUI 验收。

## 执行步骤

1. **调整搜索面板与交互状态。** 修改 `app/listen1_chrome_extension/listen1.html`、`js/controller/play.js` 和必要的 `css/redesign.css`：歌名必填、歌手可空且分开编辑；打开时预填 `getLyricSearchQuery(track)` 作为歌名建议，歌手默认空（不使用曲目artist/上传者），状态保持 idle；只有表单提交才搜索。搜索及面板状态按当前曲目和本次输入保护，切歌、关闭或重提时取消旧请求。为 `i18n/{zh-CN,zh-TC,en-US,fr-FR,pt-BR,ko-KR}.json` 增补字段标签、占位、必填反馈和逐源结果说明。

2. **贯通五源输入与逐源结果。** 修改 `js/loweb.js`、`js/lyric_search.js` 与现有 provider 实现（当前五个来源集中于 `js/provider/bilibili.js`）。将人工 `title`、可选 `artist` 和取消信号明确传给 QQ、LRCLIB、KUGOU、网易云、KUWO；各源独立决定目录查询文本，不丢弃用户字段，也不退回上传者。歌名单字段可直接查询。区分“目录无匹配”“有目录项但没有同步歌词”“歌词获取失败”“verification-required”“timeout”；沿用窄 HTTPS transport、现有缓存键的正确输入维度、取消语义及网易云验证重试和旧 query/token 防护，不扩大 host/route/header 权限。

3. **补行为回归并按样例验收。** 扩展 `app/test/lyricSearch.test.js`、`app/test/lyricProviderRoutes.test.js`，并为面板/控制器增加可执行行为测试（可抽出纯状态辅助函数或用受控 MediaService 假件，不以源码正则替代行为验证）。覆盖五源参数、空歌手/仅歌名、不使用上传者、面板打开不请求、显式提交、取消、缓存隔离/命中、各结果分类、网易云验证回调及旧 query 保护。以“折风渡夜”“青花瓷”检查仅歌名和歌名+歌手两类请求；运行这些定向 Node 测试及六份 JSON 解析检查，并报告未覆盖的在线上游行为。

## 验收与风险

- 用户可只输入歌名完成五源搜索；歌手为空不会让请求退回曲目上传者或造成字段错位。
- 打开面板不触发网络请求；用户点击搜索后才显示每个来源的独立状态，旧请求不能覆盖新输入结果。
- 已有 HTTPS allow-list、有限超时、abort、缓存、网易云持久验证及验证后重搜行为保持原契约。
- 目录与同步歌词服务本身可能返回相同空响应；实现须依据各 provider 可验证的阶段证据分类，不能把下载失败伪装为无匹配或空结果。此项由测试固定每源响应阶段与预期状态。

## 回滚

若逐源状态或验证重试无法保持现有契约，回退本任务对应的 UI、provider/路由和测试改动；不触碰缓存存储格式或 transport allow-list。
