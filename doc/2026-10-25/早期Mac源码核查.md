# 最早 Mac 源码与 10/11–12 恢复流程调查

日期：2026-10-25（America/Los_Angeles）。状态：只读源码调查完成；不推断旧包在某次机器上的真实安装结果。只写本报告；未下载、运行、签名、挂载、改变属性、安装应用、读取钥匙串、改 Git 或旧目录。

## 核心结论

1. 已追到真正最早公开 Mac Release：tag `mac`，2026-07-28 发布，指向 `03db537749f2794cc01349bf5d2704f7c8c53bf3`，应用版本 **2.33.0**。公开附件只有 `listen1_2.33.0_mac_arm64.dmg`（99,264,309 bytes），没有 Universal。它与后续 2.34.0、2.35.0、2.35.1 都没有自定义签名 hook、属性清理脚本、安装助手或权限调整入口。
2. 这些早期版本已锁定同样的 Electron **32.3.2** / electron-builder **25.1.8**。普通 DMG 内容合同、appId、asar 和三架构配置与当前恢复后的配置相同；没有找到此前 v1 比较遗漏的源码级签名/隔离/权限处理。
3. 10/11–12 确实存在一次额外签名方案，但它是**之后新加、又被用户取消并删除**的流程。`3b10b88` 的实质是撤掉 custom/fixed signing 并保留原 Electron 主程序身份；`645c690` 则推迟不必要的 SafeStorage 检查，针对启动/公开状态查询触发的 Keychain 授权。它们不能混同为当前 Gatekeeper 首次下载拦截的同一问题。
4. **Tag 源码不一定等于当日 Release 附件源码。** v2.35.2 tag 是不含 custom signing 的 `29f2f7d`，但 10/11 记录明确其 Mac 附件后来被 `4da4cf3` 的完整 ad hoc 签名构建覆盖。仅看 tag 会漏掉这个当年发布步骤。最早 `mac` tag 不满足当时 workflow 的 `refs/tags/v` 发布条件，也提示其上传来源不能仅由该 workflow 推断。

## 用户确认的历史体验

2026-10-25 用户确认：过去是从 GitHub 下载 Mac DMG，再由本人将 App 拖入“应用程序”；用户回忆 Windows 侧的一次打包改动使 Mac 安装出问题，恢复早期打包方式后曾恢复正常。此为用户的实际使用观察，不是旧安装命令日志或 Git 源码单独能证明的事实。源码调查未发现早期存在清除 quarantine、安装辅助或权限绕过入口；用户同时确认 v2.35.1 现在也会出现系统拦截，因此早期成功不代表旧配置现在仍能消除弹窗。

## 版本/提交矩阵

所有下列版本的 package-lock 均为 Electron32.3.2 / builder25.1.8。`base` 表示：`appId=com.listen1.listen1`、`asar:true`、DMG `Listen1.app` + `/Applications` 链接、x64/arm64/universal 目标、music category；无 identity/notarize 显式值、无 sign/afterPack/afterSign hook。

| 版本或事件                              | 实际提交                                                                               | Mac 处理代码/发布事实                                                                                                                                                   | 与当前恢复后 HEAD 的差异                                                             | 是否解释过去可安装                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 上游 v2.33.0 tag                        | `bbc38654bd593d4ae70143230ea7814b34d09128`（旧副本可见）                               | base；`dist:mac=CSC_IDENTITY_AUTO_DISCOVERY=false DEBUG=electron-builder electron-builder --mac`；workflow Node16 + action-electron-builder@v1                          | 当前显式列 dmg/三架构，CI Node20 原生 builder；未见额外安装处理                      | 源码无新的解释；此 tag 不在当前 fork 的公开 Release 列表                          |
| 首个公开 Mac Release：`mac`，2026-07-28 | `03db537749f2794cc01349bf5d2704f7c8c53bf3`，package2.33.0                              | 与上述 base 相同；公开仅 ARM64 DMG；README 构建段只执行 npm run dist:mac                                                                                                | 当前发布三架构；此最早实际资产是 ARM64；其原 workflow 不会对名为 mac 的 tag 自动发布 | 这是此前未纳入的真实早期范围，但仅源码/元数据不能还原那次安装或上传命令           |
| v2.34.0，2026-08-25                     | `c1b323a463f86fbba0cb9c34380ceceaac6185c5`                                             | base；旧 dist:mac `--mac`；workflow 改 Node20/npm ci/原生 builder，CSCfalse；实际公开已有三架构 DMG                                                                     | 当前 CI 增加只读 plain-DMG 验证和发布摘要/notes 阶段；构建核心相同                   | 未见隐藏签名、属性或权限流程，不能由源码证明旧安装原因                            |
| v2.35.0，2026-09-16                     | `1b8253774e8f74411f0842d34d31480c5b36d149`                                             | base；dist:mac 首次显式 `--mac dmg --x64 --arm64 --universal`；CI 同参数                                                                                                | Mac package 核心已与当前恢复配置一致                                                 | 无源码级安装修复差异                                                              |
| v2.35.1，2026-09-16                     | `59af26855d75bd94fea3c34a632721ed90ced65f`                                             | base；同 v2.35.0 构建流程；新增同意式更新模块                                                                                                                           | 当前保留普通 DMG；应用业务不同                                                       | 已有独立包字节比较证据，本次不重复；正常旧体验为用户事实                          |
| v2.35.2 原 tag，2026-10-11              | `29f2f7d19c7e075bb986121e7d71b03891a7996a`                                             | base；原 tag 无 custom signing，但实际附件随后被下行事件覆盖                                                                                                            | 不能把 tag 当作之后被覆盖附件的源码                                                  | 说明查源码必须同时查发布事件                                                      |
| 10/11 完整 ad hoc 修订                  | `4da4cf385514eaf38f425fcd89cb1ae463cbcc7c`                                             | 新增 `mac.sign=build/macosSign.js`；signAsync identity `-`，完整嵌套签名，root identifier 改为 appId；Universal 合并后签、DMG 前执行；记录明确已覆盖 v2.35.2 Mac assets | 当前已删除；此流程改变原主程序身份/DR                                                | 记录支持它与随后 SafeStorage 更新授权回归相关；不是最早正常版本的办法             |
| 10/12 固定身份方案                      | `30f13a9254a7d18d6f076d776c7b2de9317e7aec`、`d698b1e0dd421040b07135deb3931652ea1cc13b` | 新增 setupMacSigning，读取 repo 外固定身份，必要时限定签名期间临时扩展搜索列表并 finally 恢复；无固定身份时 hook 使用 ad hoc                                            | 当前已删除；不读取/执行旧身份材料                                                    | 历史记录说固定身份样本未发布且用户随后取消；不能作为正常旧版本必需条件            |
| 10/12 Keychain lazy 修复                | `645c690eafbb2d1d58024368cb2f1e5a0f9ffa40`                                             | 公开配置/登录状态不再调用 isEncryptionAvailable；null 表示尚未检查；真正加解密继续检查                                                                                  | **当前仍保留**，见下文实现位置                                                       | 解释启动/状态查询时 Keychain 授权路径，不解释应用尚未获启动许可的 Gatekeeper 提示 |
| 10/12 恢复原办法                        | `3b10b8830ba8462d213afa78be9b12120ceb4c4e`                                             | 删除 mac.sign、macosSign.js、setupMacSigning.js、专用测试/README 设置流程；恢复 v1 package 宏配置                                                                       | 当前 Mac 核心仍同此恢复；无证书/hook 默认流程                                        | 保留旧主程序身份是记录支持的恢复方向；真实旧 ACL/安装结果仍需当时环境验证         |
| 本次调查的当前源码                      | `2e27e3f3feb2f0f6eee27e3c3b4c6de6fee115f7`                                             | base；显式三架构命令；不含 helper/sign hook；CI 只增加内容验证/摘要发布                                                                                                 | 比较基准；并非声称冻结的 v2.35.7 tag 已移动                                          | 不由源码承诺系统提示结果                                                          |

## 10/12 实现区别：Keychain 与 Gatekeeper

`git show 645c690 -- app/main.js app/bilibiliService.js` 证实修改的是应用已运行后的秘密存储访问频次：

- `app/main.js`：新增 `machineTranslationSecureStorageAvailable=null`；`getPublicMachineTranslationConfig()` 返回缓存状态，移除其无条件 `safeStorage.isEncryptionAvailable()`；`encryptMachineTranslationApiKey` / `decryptMachineTranslationApiKey` 仍调用实际检查。当前对应 269–327 行。
- `app/bilibiliService.js`：构造器设置 availability=null；`getPublicAuthState()` 仅返回状态，不再为了展示登录信息主动检查 Keychain；读取真正 refresh token 时仍检查。当前对应 343、465–517 行。登录刷新本身如需使用真实秘密仍可能触发实际存储路径。
- `3b10b88` 所带任务记录 106–112 行明确撤回“strict 签名失败就不能安装”的过度结论，记录旧 v1 与恢复样本主程序相同，并明确真正 SafeStorage ACL 识别/UAT 未覆盖。固定身份方案的 `.planning/quick/261012-gtx-persistent-macos-signing/SUMMARY.md` 状态为 cancelled，明确其包未发布。

这条历史有助于辨别“更新后反复 Keychain 授权”的旧问题；不能把它当成清除当前浏览器下载隔离或绕过首次 Gatekeeper 检查的代码。当前源码已保留 lazy 修复，没有发现本次需要重新补入的遗漏。

## 核查后的规范补齐

用户随后确认所指“Skill”应该就是 2026-10-21 的《macOS 直接安装与签名约定》。该原文已同步到主项目文档入口；当前工作树在保持上述早期目标、DMG 布局和命令基础上，补回约定要求的 `build.mac.identity: null`，继续保留 `CSC_IDENTITY_AUTO_DISCOVERY=false`。本报告矩阵中的当前 HEAD 是调查快照，不代表此后的补齐字段仍然省略。7 项相关测试通过；本次没有重新构建或替换 Release，也没有证明该配置能消除用户截图中的 Gatekeeper 拦截。

## 检索范围、Skill 指针与未知

- 主库按真实 tag/commit 读取 package、package-lock、workflow、build tree、README 与 10/11–12 删除历史。`git grep` 在 mac/v2.34.0/v2.35.0/v2.35.1 的 package/build/scripts/.github/README 范围未发现 xattr/quarantine/codesign/afterPack/afterSign/notarize/chmod/ditto/cp -R 的产品处理入口。早期 build tree 仅图标/背景素材。不能把这个限定范围的无命中扩大成机器上从未执行过外部手工步骤。
- 补充全 tracked 树检索（仅排除三个依赖 lock 文件）：mac/v2.34.0/v2.35.0/v2.35.1 对 `xattr|com.apple.quarantine|macosSign|setupMacSigning|afterPack|afterSign|codesign --sign|codesign -s` 均为 0 命中。此检查覆盖应用源码和其他 tracked 路径，仍不覆盖外部手工命令或未纳入 Git 的文件。
- 旧版只读副本（`listen1_desktop_release_v235`，HEAD `59af268`）：提供上游 v2.33.0 tag 和旧 workflow；相关配置路径无未提交差异。原混合桌面库（HEAD `8d24a2a`）：只读核对相关历史及原安装约定；相关 package/build/workflow 无未提交差异。两处均未写入。
- 仓库 tracked 历史 `*SKILL.md` / `*skill*` 路径未发现专用 Mac Skill 文件。已见的历史操作指针是 `build-shared-understanding`、`gsd-debug`、`gsd-quick`、`run-local-ci` 等通用工作流名，以及项目文档 `doc/2026-10-21/macOS直接安装与签名约定.md`。独立全局/隐藏 Skill 目录调查由另一 Agent 负责，本报告没有全盘搜索，也不声称证明不存在用户记忆中的其他 Skill。
- GitHub 只读元数据来源：`gh release list --repo dazzlingwuming/listen2 --limit 30 --json tagName,publishedAt,isDraft,isPrerelease`；`gh release view mac`（资产名/大小/时间/空 body）；`gh release view v2.34.0`（已公开三架构）。没有下载早期包，因此尚未新增 v2.33/mac、v2.34.0 实际 Mach-O/属性/安装验收证据。
- 最早 mac tag workflow 使用未固定提交的 `samuelmeuli/action-electron-builder@v1`；本次只检查仓库内调用配置，未取远端 action 历史。该 workflow 的发布条件只接受 v 开头 tag，因此其本身不能解释 mac tag 附件是怎样上传的。未授权新增下载或执行时不补造这一步。

来源可复现：`git show <表内SHA>:package.json`、`:package-lock.json`、`:.github/workflows/release.yml`；`git show 4da4cf3:build/macosSign.js`；`git show d698b1e:build/macosSign.js`；`git show 3b10b88 -- package.json README.md build app/test/macosSigning.test.js`；`git show 645c690 -- app/main.js app/bilibiliService.js`。所有报告结论区分源码事实、历史记录与未验证的真实安装行为。
