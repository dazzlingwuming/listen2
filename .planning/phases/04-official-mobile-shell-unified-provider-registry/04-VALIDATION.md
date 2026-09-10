---
phase: 04
slug: official-mobile-shell-unified-provider-registry
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-10
---

# Phase 04 — Validation Strategy

> Fast deterministic contracts validate the unified registry and phone shell during implementation. APK assembly and API 35 end-to-end acceptance remain the integrated Phase 8 gate.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `assert`/VM controller harness; JUnit 4.13.2 for Android policy boundaries |
| **Config file** | `app/listen1_chrome_extension/package.json`; `android/app/build.gradle` |
| **Quick run command** | `cd app/listen1_chrome_extension && node test/mobile_provider_registry.test.js && node test/android_mobile_shell_registry.test.js` — the first command owns the route-free five-operation lifecycle table; the second owns visible search/shell integration |
| **Full suite command** | `npm --prefix app/listen1_chrome_extension test && cd android && gradle --no-daemon :app:testDebugUnitTest` |
| **Estimated runtime** | ~15 seconds after dependencies are present |

---

## Sampling Rate

- **After every task commit:** Run the focused Node contract for the registry/semantic lifecycle, controller, markup, or CSS touched by that task; run a targeted JVM test only when Java policy changes.
- **After every plan wave:** Run `npm --prefix app/listen1_chrome_extension test` and `cd android && gradle --no-daemon :app:testDebugUnitTest`.
- **Before phase verification:** The repository-defined full local CI gate must pass for the exact worktree.
- **Max feedback latency:** 30 seconds for focused contracts; APK assembly is excluded from the inner loop.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-W0-01 | Wave 0 | 0 | UI-003, NET-002, SEC-003, TEST-001 | T-04-REGISTRY, T-04-LIFECYCLE | Projection contains semantic capabilities only; route-free search/directory/media/lyric/login requests and responses are exact-shape/bounded, missing routes terminate typed unavailable before dispatch, and deadline/cancel/page-destroy/stale/duplicate/late paths accept exactly one terminal | unit/state-machine | `node app/listen1_chrome_extension/test/mobile_provider_registry.test.js` | ❌ W0 | ⬜ pending |
| 04-W0-02 | Wave 0 | 0 | UI-001, UI-002, NET-002 | T-04-STALE | Visible search consumes the shared lifecycle; source/query/page/epoch changes settle once and stale replies cannot render while non-search operations remain route-free/typed unavailable | contract/DOM | `node app/listen1_chrome_extension/test/mobile_provider_registry.test.js && node app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js` | ❌ W0 | ⬜ pending |
| 04-BOUNDARY | implementation | 1+ | NET-001, SEC-001, SEC-002 | T-04-BRIDGE | Existing origin, frame, navigation, HTTPS, and typed-envelope restrictions are not broadened | Node + JVM regression | `node app/listen1_chrome_extension/test/android_rpc_contract.test.js && cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*HttpBridgePolicyTest' --tests '*AndroidRpcContractTest'` | ✅ | ⬜ pending |
| 04-FULL | integration | final | UI-001, UI-002, UI-003, NET-001, NET-002, SEC-001, SEC-002, SEC-003, TEST-001 | all Phase 4 threats | Complete shell and registry regression suite remains green | suite | `npm --prefix app/listen1_chrome_extension test && cd android && gradle --no-daemon :app:testDebugUnitTest` | ✅ + W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/listen1_chrome_extension/test/mobile_provider_registry.test.js` — exact five-source primary order; Migu/Taihe registry-only state; immutable safe projection; source-prefixed identity; route-free table for search/directory/media/lyric/login; exact bounded request/terminal shapes; typed unavailable; deadline/cancel/page-destroy/stale/duplicate/late exactly-once behavior; no URL/header/cookie/raw-error/native-object fields or live route fixture.
- [ ] `app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js` — four-tab shell, provider selector order/ARIA/copy, 320px and 200% text contracts, visible search consumption of the shared lifecycle, source/query/page/epoch switching, cancel/timeout/late reply, nearest-layer Back and safe-area reservations.
- [ ] Extend `app/listen1_chrome_extension/package.json` so both new tests execute in the standard frontend `npm test` command.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual hierarchy and touch comfort on a real rendered WebView | UI-001, UI-002 | Source/DOM contracts cannot prove perception, IME behavior, safe-area rendering, or actual touch geometry | Deferred to Phase 8 integrated API 35 pass: inspect four tabs, five-source selector, mini/full player, IME, rotation, 200% font and TalkBack on the exact final APK. |

---

## Validation Sign-Off

- [ ] All implementation tasks have focused automated verification or a Wave 0 dependency.
- [ ] Sampling continuity: no three consecutive implementation tasks lack an automated contract.
- [ ] Wave 0 tests exist, fail for the pre-change behavior where applicable, and pass after implementation.
- [x] No watch-mode flags.
- [x] Focused feedback target is under 30 seconds.
- [ ] `nyquist_compliant: true` and `wave_0_complete: true` are set only after the listed tests exist and pass.

**Approval:** pending implementation
