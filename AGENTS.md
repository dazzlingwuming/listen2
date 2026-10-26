# Listen2 桌面协作入口

开始非琐碎工作前，读取用户全局 AGENTS.md 规则和唯一协作契约 `/Users/fluenteng/公司项目相关/相关数据/相关agent规则/COLLABORATION.md`。保留已有修改，桌面任务不得混入 Android 的未验收改动。

## macOS 分发的用户决定

用户明确要求 macOS 不新增任何签名，包括 ad hoc 签名，也不公证、不配置证书、钥匙串或全局系统信任。保留 `build.mac.identity: null`、`notarize: false` 和 `CSC_IDENTITY_AUTO_DISCOVERY=false`。不能仅设置最后一个环境变量就声称保证跳过签名；也不能将 Electron 自带的链接器签名误称为项目重新加签。

2026-10-25 用户明确同意本项目提供 **仅针对 Listen1** 的安装辅助：校验指定版本及所有文件的完整性后，仅处理该应用的 `com.apple.quarantine`，保留配置、其他扩展属性及旧应用备份。该授权不包括其他应用、电脑整体安全设置、禁用 Gatekeeper、签名/补签或自动删除备份。提供辅助的决定已经确认，不要反复索要相同方案批准；实际覆盖本机应用须有当前任务的安装授权。

安装辅助见 [说明](doc/2026-10-25/macOS未签名安装辅助说明.md)；生成入口是 `build/macInstallHelper.cjs`，模板在 `build/mac-install/`。构建成功不等于用户已可安装，严格签名检查失败也不应自动触发补签。必须核对实际 DMG、架构、版本、哈希和辅助 `--verify-only` 的结果；未验证的真实 Gatekeeper/安装行为应如实标明。

## 临时工作区

沿用 `scripts/task-workspace.cjs`，通过 `LISTEN2_TASK_ID` 指定独立任务（默认 `macos-daily-theme-20261025`）：

- `prepare` / `resume`：创建或恢复 `.task-workspaces/<task>/scratch/`。
- `run <label> -- <command> [args]`：登记执行状态并保存时间和退出结果。
- `retain <reason>`：保留中断/失败证据三天，不自动清理未知依赖。
- `published <receipt.json>`：登记已核对的正式 GitHub 发布回执。
- `complete <dist/releases/.../artifact> --accepted`：核对正式制品及发布摘要，确认没有登记中的运行任务后，仅清理该任务 scratch。

清理前确认子任务已结束、正式结果独立保存，且临时目录没有其他任务的恢复依赖。来源不明的历史文件不自动清理。持续任务记录统一在 `doc/<起始日期>/任务名-起始日期至最后维护日期.md`，同一任务继续更新原文档。
