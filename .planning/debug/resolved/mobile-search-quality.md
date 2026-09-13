---
status: resolved
trigger: "React Native Android 搜索《青花瓷》时结果里没有正确的《青花瓷》，并且 Bilibili 搜不到歌曲。"
created: 2026-09-13T13:32:00+08:00
updated: 2026-09-13T14:02:40+08:00
---

# Debug Session: Mobile Search Quality

## Symptoms

- Expected: 在新版 `mobile/` 搜索“青花瓷”时，支持该曲目的来源应返回并优先展示标题/歌手高度匹配的结果，Bilibili 应返回可选择的相关视频歌曲；单个 provider 失败应显示可诊断状态，不能伪装成空结果。
- Actual: 用户此前安装的 Android 版本搜索“青花瓷”时，结果中没有正确歌曲，并反馈 Bilibili 搜不到歌曲。
- Errors: 用户未报告明确错误码；需要区分 provider 空结果、映射丢失、查询编码、分页/排序以及 UI 合并问题。
- Timeline: Android 重建期间出现；当前 standalone React Native 分支已多次更新，但尚未针对该真实查询完成固定回归与集成验收。
- Reproduction: 在 `mobile/` 搜索页输入“青花瓷”，分别检查 NetEase、Kugou、QQ、Kuwo、Bilibili 的响应、投影、排序和 UI 行；确认周杰伦原曲或高度匹配项是否存在并靠前。

## Constraints

- Canonical target is `mobile/`; do not modify legacy `android/` or WebView frontend.
- Preserve fixed provider-owned network policy; UI/caller cannot provide arbitrary URL, header, cookie or token.
- Do not fake success with fixtures or hard-code “青花瓷”; use fixtures only for regression after establishing the real response shape.
- External provider drift must produce bounded diagnostic errors rather than empty success.
- No repository-wide CI, APK loop, emulator, merge or deploy in this debug pass. Use focused TypeScript/Jest/lint/Prettier/Metro checks and bounded live anonymous probes where safe.
- Preserve unrelated tracked and untracked files.

## Current Focus

- resolution: "The source-level fix in commit 249b4dc is accepted for this checkpoint: its regression suite and focused mobile checks passed at that committed SHA."
  runtime_acceptance: "Deferred and not verified: no APK, emulator, or physical-device Bilibili search was run for this feature-level checkpoint."
  scope_boundary: "The deferred integrated-device result must not be represented as a passed Bilibili-search acceptance test."
  next_action: "Commit and push only this resolved session and its knowledge-base entry; do not run tests, builds, APK assembly, emulator, or device acceptance."

## Evidence

- timestamp: 2026-09-13T14:05:00+08:00
  checked: initial session state, repository history, mobile README, and configured agent/project skills
  found: mobile/ is the canonical React Native target; the debug file is the only current debug artifact and no debugger-specific project skill is configured.
  implication: investigation is scoped to the standalone provider/client/SearchScreen flow, without modifying legacy Android/WebView code.

- timestamp: 2026-09-13T14:10:00+08:00
  checked: MemPalace semantic recall and .planning/debug/knowledge-base.md
  found: MemPalace is unavailable and no durable knowledge base exists.
  implication: no known-pattern candidate is available; investigation proceeds from direct provider and UI evidence.

- timestamp: 2026-09-13T14:17:00+08:00
  checked: complete mobile provider/client/SearchScreen implementation and existing provider-client tests
  found: SearchScreen calls exactly one selected provider and preserves adapter ordering; it catches every provider error but only renders a generic error state. The existing Bilibili contract uses a synthetic code:0/data.result fixture, so it proves only the historical mapping shape.
  implication: search quality needs live evidence before attributing the symptom to UI merging or mapping.

- timestamp: 2026-09-13T14:19:00+08:00
  checked: focused provider-client fixture suite
  found: mobile/src/api/__tests__/client.test.ts passed all 16 tests. There is no currently failing test or per-test coverage spectrum.
  implication: SBFL is skipped (no failing tests); fixture correctness does not establish live provider behavior.

- timestamp: 2026-09-13T14:23:00+08:00
  checked: one 10-second anonymous Bilibili search probe with the exact fixed route and app-owned Referer/Android User-Agent
  found: HTTP 412 with a 3,400-byte non-JSON response; no result container was available. The current requestJson implementation therefore throws typed PROVIDER_ERROR, rather than returning a false empty page.
  implication: the synthetic Bilibili success fixture does not cover the live anonymous denial. The current route cannot deliver Bilibili rows from this egress under its present request profile.

- timestamp: 2026-09-13T14:27:00+08:00
  checked: bounded NetEase probe and an immediate Bilibili profile comparison
  found: NetEase returned HTTP 200 JSON with 20/20 mappable rows and at least one exact-title row, ruling out shared Chinese-query encoding or SearchScreen deletion. An immediate repeat of the exact Bilibili profile returned HTTP 200/code:0/data.result; adding only standard public Accept/Origin/Accept-Language headers did not change success.
  implication: Bilibili availability is transient on this egress, and the app’s profile is not demonstrably missing a controllable static header. The no-retry request path is now the leading controllable cause for Bilibili failure.

- timestamp: 2026-09-13T14:32:00+08:00
  checked: React Native Android NetworkingModule source and repeated Bilibili probes
  found: NetworkingModule extracts JavaScript headers into OkHttp Headers and only adds a default User-Agent when none is supplied, so the app-owned Bilibili User-Agent is not silently overwritten. Repeated no-cookie Bilibili probes alternated between HTTP 412/non-JSON and HTTP 200/code:0/data.result.
  implication: a permanent missing-header hypothesis is eliminated. The upstream is intermittently rejecting anonymous search; a cancellation-aware, one-time retry is a controllable mitigation, while its failure must remain a typed provider error.

- timestamp: 2026-09-13T14:37:00+08:00
  checked: sanitized NetEase exact-title rank for the first page and SearchScreen result handling
  found: the first 20-row NetEase page contained three exact-title rows, with the first at index 0; SearchScreen renders the returned page in order without dropping rows.
  implication: the current code does not reproduce a client-side title-order loss for the reported query. A query-only client cannot infer a specific artist without special-casing the reported song, so no ranking rewrite is justified by this evidence.

- timestamp: 2026-09-13T14:45:00+08:00
  checked: agent-authored provider-client regression test after the retry implementation
  found: all 18 tests pass, including a 412 followed by code:0 success on the same fixed route and the two-412 bounded-failure neighbor.
  implication: the fix handles the confirmed transient class while preserving a typed diagnostic after its single retry.

- timestamp: 2026-09-13T14:49:00+08:00
  checked: revert-and-reconfirm guardrail using the minimal agent-owned http.ts hunk
  found: removing the retry caused the 412-then-success test to reject after one request and left a repeated 412 non-retryable; reapplying the same hunk restored the focused suite to 18/18.
  implication: the behavior is caused by the minimal retry change, not a coincident environment change.

- timestamp: 2026-09-13T14:54:00+08:00
  checked: formatted retry diff, TypeScript, ESLint, and adjacent mobile test suite
  found: Prettier and git diff --check passed; npm run mobile:typecheck passed; npm --prefix mobile run lint -- --quiet passed; all 10 mobile Jest suites and 62 tests passed.
  implication: the focused regression and its mobile import-graph neighbors are green on the re-applied implementation.

- timestamp: 2026-09-13T13:52:56+08:00
  checked: focused mobile local-CI gate and mutation-tool availability
  found: README-defined mobile typecheck, full mobile Jest suite (10 suites/62 tests), and lint all passed from HEAD 3764e8a; Docker 29.5.2 is available. No Stryker executable or mutation configuration exists under mobile/. The reviewed diff only adds retry behavior/assertions and moves the pre-existing request body inside its retry loop.
  implication: local CI is current for the source diff; the mutation signal is explicitly skipped, while the remaining acceptance signals pass.

- timestamp: 2026-09-13T13:53:20+08:00
  checked: source-only commit and push
  found: committed mobile/src/api/http.ts and mobile/src/api/__tests__/client.test.ts as 249b4dc and pushed it to origin/agent/android-mobile-rebuild. The debug session and unrelated planning evidence remain untracked and unstaged.
  implication: the code fix is remotely available; local CI must be re-run against the new committed SHA before self-verification is final.

- timestamp: 2026-09-13T13:55:06+08:00
  checked: post-commit focused mobile local-CI gate
  found: at committed HEAD 249b4dc, npm run mobile:typecheck, npm --prefix mobile test -- --runInBand (10 suites/62 tests), and npm --prefix mobile run lint -- --quiet all passed. The only untracked files are this debug session and pre-existing unrelated planning evidence.
  implication: the verified source commit is ready for human device confirmation; emulator/APK acceptance remains intentionally not verified by this scoped pass.

- timestamp: 2026-09-13T14:02:23+08:00
  checked: approved human-verification checkpoint response
  found: the user accepted source-level debugging for this checkpoint and explicitly deferred APK, emulator, and physical-device acceptance until the broader mobile feature set is complete.
  implication: the source-level resolution can be closed, but integrated Android Bilibili search remains deferred and not verified rather than passed.

## Eliminated

- hypothesis: SearchScreen or provider mapping places a lower-ranked exact NetEase title behind unrelated rows for the reported query.
  evidence: The live page's first exact-title result is index 0, all 20 rows satisfy the current mapper's required fields, and SearchScreen renders response.results without filtering the first page.
  timestamp: 2026-09-13T14:37:00+08:00

## Resolution

- root_cause: "AND-gated: Bilibili intermittently rejects anonymous search with HTTP 412, and mobile requestJson stops after the first failed attempt even though an identical immediate request can succeed."
- fix: "Added one immediate retry for retryable Bilibili search failures only; HTTP 412 is retryable, but repeated failure remains a typed PROVIDER_ERROR."
- verification:
    target_test: { result: pass, suite: "mobile/src/api/__tests__/client.test.ts (18 tests)" }
    mutation_check: { result: skipped, reason: "no Stryker executable or configuration is present under mobile/" }
    no_op_deletion: { result: pass, detail: "diff adds a bounded retry and assertions; removed lines are only the original request body moved inside the retry loop" }
    adjacent_tests: { result: pass, suites_run: ["npm run mobile:typecheck", "npm --prefix mobile test -- --runInBand (10 suites/62 tests)", "npm --prefix mobile run lint -- --quiet"] }
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    local_ci: { result: pass, snapshot: "2026-09-13T13:55:02+08:00 to 2026-09-13T13:55:06+08:00; HEAD 249b4dc; documented focused mobile typecheck/test/lint" }
    source_level_acceptance: { result: accepted, evidence: "User approved source-level completion at the human-verification checkpoint." }
    integrated_device_bilibili_search: { result: deferred_not_verified, reason: "User explicitly deferred APK/emulator/device acceptance until the broader mobile feature set is complete." }
    guardrail_verdict: accepted
- oracle_type: "derived (the fixed provider contract: a transient anonymous denial followed by a valid response must preserve the same request and map a track; two denials must stop after one retry)."
- files_changed:
  - mobile/src/api/http.ts
  - mobile/src/api/__tests__/client.test.ts

## Prevention

- causal_branches:
  - code: requestJson previously turned a transient HTTP 412 on an otherwise fixed Bilibili search route into an immediate terminal provider error.
  - environment: anonymous Bilibili availability intermittently alternated between HTTP 412 and a valid result envelope for the same owned request profile.
  - and_gate: both conditions were required for the reported failure; a first-attempt success or the bounded retry avoids it.
- why_not_caught: no pre-existing provider-client regression test modeled a transient HTTP 412 followed by a valid response; type checking and linting cannot exercise that runtime error sequence.
- recurrence_guard: `mobile/src/api/__tests__/client.test.ts` covers a retryable Bilibili 412 followed by success and the repeated-412 terminal-error neighbor, preserving the one-retry bound and typed failure contract.
