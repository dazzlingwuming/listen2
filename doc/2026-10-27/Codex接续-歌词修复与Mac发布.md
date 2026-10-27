# Codex接续：歌词修复与Mac发布

更新：2026-10-27，Asia/Shanghai。用户明确要求另一Codex接手完成；本文件是接手入口。

## 先看真实状态

| 项目 | 状态 |
| --- | --- |
| 桌面歌词空白的代码修复 | 已完成并本地提交 |
| 相关局部CI与1059×722实际页面 | 已通过，范围见后文 |
| 本轮源码push / PR / merge | 未完成 |
| 包含本轮歌词修复的新Mac安装包 | 未生成 |
| 原v2.35.7 Release附件再次更新 | 未执行 |
| 当前用户App覆盖安装 | 未执行 |
| 当前后台CLI/原生DMG工具恢复 | 未恢复 |

不要把旧包、旧合并或旧Release回执当作本次交付完成。

## 唯一工作副本与源码

- 仓库：`dazzlingwuming/listen2`，远端 `https://github.com/dazzlingwuming/listen2.git`。
- 实际桌面工作副本：`/Users/fluenteng/gsd-workspaces/listen2-mac-daily-theme-20261025/listen1_desktop`。
- 当前分支：`fix/lyric-visible-20261026`。业务修复提交：`e867c910c2f7df1ddcef5a7229587bc77badea3a`；原交付记录提交：`89de97be051620eaccad46a079b30b6dd43ba16c`。此次交接会再增加仅文档的提交，实际最终HEAD用 `git rev-parse HEAD` 和下述manifest核对。
- 最近确认远端main：`13e8ee85bd56ca3c9fe68636038c9b8f16e14475`；恢复后先fetch，不能假定远端未继续更新。
- 开始先读根AGENTS及唯一协作契约 `/Users/fluenteng/公司项目相关/相关数据/相关agent规则/COLLABORATION.md`。
- 用户最初打开的 `/Users/fluenteng/个人相关/listen1` 及其中desktop/Android混合工作树不是此次修复的工作副本，不往那里覆盖源码。

业务文件：

1. `app/listen1_chrome_extension/listen1.html`：4处正文/加载/空/错误状态表达式。
2. `app/listen1_chrome_extension/test/desktop_lyric_visibility.test.js`：实际缓存、provider、手动选择状态链回归。
3. `app/listen1_chrome_extension/package.json`：把新测试登记到现有前端test入口。

共享controller、CSS、Android、网络策略、签名配置均未在本次歌词修复中修改。

## 已证实的歌词故障与修复

实际 `applyLyricResult` 接受结果后将状态设为 `synchronized`、`text-only` 或 `insufficient-timestamp`；桌面模板却只接受 `content`。所以手动来源、搜索/翻译/偏移按钮存在，歌词正文仍被ng-hide隐藏。

已修正文gate：接受实际3种有效状态和兼容content，同时要求当前歌曲身份一致且有可解析行。加载/空/错误视图同样关联当前歌曲，识别新的终态；合法状态但数组为空时有空提示，防止全空。保留背景透明和上轮频谱/底栏时间修复。

纯文本无时间戳目前经原parser得到空数组，修复只令它显示“暂无可用歌词”；不可声称新增了纯文本解析。

## 验证与限制

正式证据目录：`doc/2026-10-25/player-ui-evidence/lyric-regression-20261026/`。

- `local-ci.json`：8阶段均exit0，包含新测试、手动选择UI、native歌词合同、播放布局合同、语法、ESLint、Prettier与diff检查；原始时间、分支、SHA、工作树快照保留。
- `1059x722-daily-after.json`：真实Angular/生产HTML/CSS/实际apply函数，4行原文+4行译文、正文447px、原/译高亮可见、歌词面板透明、时间caption距底栏44.5px；主Agent查看过真实截图。
- `1059x722-daily-before.json`：旧gate确实隐藏8行数据；早期夹具展开几何不完整，仅用于隐藏因果，不作为布局通过证据。
- `验收说明.md`、`handoff-check.json`：测试范围、旧模板失败基线、接力脚本本地检查与未发布状态。
- 没有完成所有尺寸/主题、真实平台网络、Mac首次安装或当前用户App验收；额外宽屏夹具展开配置问题没有被伪称通过。既有canvas负半径错误未扩大修复范围。

业务输入未改时，使用 `git diff --exit-code e867c91 HEAD -- app package.json package-lock.json scripts .github` 绑定原CI到最终文档提交，不机械重跑整仓。若整合新main实际改动了相关输入，再执行必要定向检查。

## 当前执行通道的问题

用户正常终端中gh2.96.0已用keyring登录dazzlingwuming并成功push。此后台却有：

- gh默认DNS解析api.github.com失败；auth status结构化error为no such host，不是GitHub返回401/403，不据invalid字样认定用户token过期。
- Node os.userInfo / uv_os_get_passwd失败；launchctl读取gui域也异常。
- 2026-10-27仅含probe.txt的隔离DMG探针仍 `hdiutil: create failed - Device not configured`，未生成产品包。
- 当前exec父链为旧managed app-server3333→daemon1795；旧会话/系统服务上下文异常是候选原因，尚未经恢复验证。
- 用户改回时区后本机已CST+0800，但上述故障仍在。

新的Codex先核对执行环境。新的窗口若仍连接同一后台，未必解决问题；不要循环重登gh、复制token、清Keychain、改TLS/DNS或强停未知进程。共享后台重启可能中断其他任务，须按协作契约确认影响和授权。支持的管理入口已通过本机help确认：`~/.codex/packages/app-server-daemon/current/bin/codex app-server daemon restart`；未执行。

完整诊断记录：`../2026-10-26/GitHubCLI后台会话恢复-2026-10-26至2026-10-27.md`。

## 用户已授权的剩余工作

1. 在正常执行环境核对 `gh auth status --active`、`gh api user --jq .login`、目标仓库；实际发布者必须dazzlingwuming。
2. fetch并保留最新main；推送此本地分支，正常创建PR并merge，不force/admin/bypass。
3. 用现有 `.github/workflows/release.yml` 构建固定源码的三架构Mac候选；非tag push上传 `mac-release-candidate-<SHA>`，不会自动发布Release。
4. 核验三DMG布局/架构/版本/ASAR运行文件和manifest；`scripts/verify-mac-artifacts.cjs`提供现成验收器。先读验收合同，失败不能当成功。
5. 重新备份当时实际v2.35.7的8个Mac/校验附件，保留4项Windows附件；按架构分批替换，每批核对大小/摘要及未替换附件不变。
6. 更新同一个v2.35.7 Release说明与附件，独立公开下载arm64核对摘要，保存正式回执。最后维护原任务记录并清理本任务已登记的临时目录。

授权保持原样：不新建版本/tag、不移动v2.35.7 tag，不加签/补签/公证/证书，不处理隔离标记、不弱化系统安全、不增加安装辅助脚本。普通DMG只含App和Applications链接。Mac Gatekeeper首次打开旧问题未解决，是独立任务，不以新包构建成功宣称它已修复。

## 现成发布接续入口

目录：`.task-workspaces/player-layout-progress-20261025/scratch/lyric-publish/`。

- `publish.cjs`、`manifest.json`、`publish.test.cjs`、`README.md`。
- 已做语法/mock/本地--check，无真实远端执行。manifest需与最终HEAD/tree及证据hash一致；本次交接收尾会固定到文档提交，接手时先用--check核对。
- `node <上述目录>/publish.cjs --check`：仅本地预检。
- 无参数运行会实际依次push、正常PR merge、等待Macjob、下载候选、原生只读验包、备份和分批更新原Release及公开下载验hash。先审阅README与源码。
- 脚本只有全部通过才写verified receipt，并正确登记task-workspace published；不在自己运行时清理scratch。成功后由接手Agent复核回执、更新记录，再调用complete --accepted收尾。
- 若本机原生能力仍异常，不能假称此脚本全链已通过。不要继续依赖本异常后台；接手后选择正常执行环境并记录验证事实。

## 制品与恢复位置

| 路径 | 含义 |
| --- | --- |
| `dist/releases/2.35.7/player-layout-20261025/` | 已发布的上一份包，源码a0eac89；仍有本次歌词空白故障 |
| `dist/releases/2.35.7/before-player-layout-20261025/` | 更早Release附件回退备份 |
| `dist/releases/2.35.7/lyric-visibility-20261026/` | 新修复包的预定正式目录，交接时尚不存在 |
| `dist/releases/2.35.7/before-lyric-visibility-20261026/` | 脚本将从当前Release创建的发布前备份，尚未创建 |

原v2.35.7：https://github.com/dazzlingwuming/listen2/releases/tag/v2.35.7 。原PR14是上一轮完成的UI/时间/透明背景发布，不是本轮歌词回归的PR。

两个登记临时工作区 `player-layout-progress-20261025`、`github-cli-session-20261026`均保留恢复现场；全部本任务UI夹具server已停止。禁止清理其他项目/来源不明文件，不删除唯一正式包或接续脚本。

原完整UI任务记录：`../2026-10-25/播放页频谱避让与进度时间-2026-10-25至2026-10-27.md`。
