---
status: resolved
trigger: GitHub 下载 Listen1 后 Apple 无法验证恶意软件；要求修复、生成包并更新 Release
created: 2026-10-11
updated: 2026-10-11
---

## Symptoms

expected: 下载 macOS 包后安装并打开。
actual: Apple 无法验证 Listen1 是否含恶意软件，阻止打开。
timeline: 新电脑构建上传 GitHub 后出现，之前可以打开。
reproduction: GitHub 下载并安装；已安装 app 严格签名验证及 Gatekeeper 检查均失败。

## Current Focus

bug_class: bohrbug (deterministic Gatekeeper policy failure)
hypothesis: 已发布 DMG 内的 Electron app 含无效且不完整的 ad-hoc 签名；严格验证的资源封印和 Info.plist 绑定均失败，因此 Gatekeeper 拒绝该 app。即使重新构建为正确的未签名/ad-hoc app，没有 Apple Developer Program 的 Developer ID Application 证书（含私钥）和公证服务凭据，也不能得到可被 Gatekeeper 验证的公开分发制品。
test: 已只读对比发布 SHA-256、检查装载 app 的严格 codesign 结果与 spctl 评估、本机可用签名身份，以及 CI/README 的签名、公证声明。
expecting: 发布字节匹配且 app 内的签名验证失败会排除下载损坏；身份为零、CI 显式关闭身份发现且文档声明无 Developer ID/公证，将支持“签名制品缺陷 + 缺失 Apple 外部前置条件”的结论。
candidate_causes:
  - code: Electron app 的已签名内容未完整封印，导致 resources/Info.plist 验证失败。
  - config: release workflow 的 CSC_IDENTITY_AUTO_DISCOVERY=false，且没有 Developer ID/notarization 配置。
  - environment: 本机 security find-identity 找不到有效 codesigning identity；用户没有 Apple Developer Program 账户。
  - data: 损坏或错误的下载资产；已由发布 SHA-256 匹配排除。
and_gate: "对已观察到的 Gatekeeper 拒绝：否，无效 app 签名已足以导致拒绝。对交付可由 Gatekeeper 验证的公开分发制品：是，Developer ID 签名和 Apple 公证服务资格都不可缺失。"
next_action: Approved free-route delivery complete; user installs refreshed v2.35.2 and confirms first-launch permission. Developer ID/notarization remains outside approved scope.

## Evidence

- 2026-10-11: /Applications/Listen1.app codesign verify fails; spctl rejected source=no usable signature.
- 2026-10-11: security find-identity reports zero valid signing identities.
- 2026-10-11: latest release dazzlingwuming/listen2 v2.35.2; current branch is unrelated Android work.
- 2026-10-11: v2.35.2 arm64 下载的 SHA-256 与发布摘要一致，排除传输损坏或错误资产作为该样本的原因。
- 2026-10-11: 装载 DMG 中的 app 严格 codesign 报 `code has no resources but signature indicates they must be present`；其 identifier 是 `Electron`，Info.plist 未绑定且没有 sealed resources。这直接证明发布 app bundle 的签名无效/不完整。
- 2026-10-11: 根 `.github/workflows/release.yml` 对构建与发布均设置 `CSC_IDENTITY_AUTO_DISCOVERY: "false"`；README 明确说明 macOS 构建没有 Apple Developer ID 签名或公证。

## Resolution

root_cause: v2.35.2 arm64 DMG 内的 Electron app 带有无效、不完整的 ad-hoc 签名（资源封印缺失且 Info.plist 未绑定），严格 codesign 与 Gatekeeper 均会拒绝它。该签名制品缺陷足以造成报告的阻止打开。另一个交付限制是本机没有有效 codesigning identity，且用户没有 Apple Developer Program 资格：免费/未签名或 ad-hoc 重打包无法变成可通过 Gatekeeper 验证的公开 macOS 发布物。
fix: 用户批准免费路线。4da4cf385514eaf38f425fcd89cb1ae463cbcc7c 增加完整嵌套 ad-hoc signing hook，Universal 合并后签名，再生成 DMG/元数据；README 与 Release 明确无 Developer ID/公证和首次“仍要打开”。三架构安装包与元数据已更新至 dazzlingwuming/listen2 v2.35.2。未声称 Gatekeeper 信任通过。
verification: 三个只读挂载 DMG codesign --verify --deep --strict PASS，版本/架构/哈希 PASS，篡改测试按预期失败，3 个定向测试 PASS。arm64 与 Universal UI 启动已核验，Universal 使用测试钥匙串避免个人钥匙串授权。线上8附件摘要匹配且 arm64 重新下载一致。用户实际首次允许、真实钥匙串授权、Intel 硬件运行未验证。
files_changed: build/macosSign.js, app/test/macosSigning.test.js, package.json, README.md, task/debug records. Main task record: doc/2026-10-11/macOS安装包验证修复-2026-10-11至2026-10-11.md.
