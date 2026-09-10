---
phase: 04-official-mobile-shell-unified-provider-registry
reviewed: 2026-09-10T09:41:15Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - app/listen1_chrome_extension/js/mobile_provider_registry.js
  - app/listen1_chrome_extension/js/app.js
  - app/listen1_chrome_extension/js/loweb.js
  - app/listen1_chrome_extension/listen1.html
  - app/listen1_chrome_extension/js/controller/instant_search.js
  - app/listen1_chrome_extension/js/controller/navigation.js
  - app/listen1_chrome_extension/css/redesign.css
  - app/listen1_chrome_extension/test/mobile_provider_registry.test.js
  - app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js
  - app/listen1_chrome_extension/test/mobile_ui_contract.test.js
  - app/listen1_chrome_extension/package.json
  - android/app/build.gradle
  - android/app/src/test/java/com/dazzlingwuming/listen2/ProviderAdvancedCapabilityFacadeTest.java
findings:
  critical: 8
  warning: 4
  info: 1
  total: 13
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-09-10T09:41:15Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

本次审查覆盖注册表、经典脚本装载、Android 搜索与 Back 协调、移动 CSS 和对应 Node/JVM 契约。脚本顺序和 APK allow-list 已将注册表置于消费者之前；变更中未发现 Phase 5 的新增 live provider/通用网络通道，也未发现 Media3 所有权被页面代码接管。仍有八个会破坏 fail-closed 身份、取消、层级 Back 或平台隔离契约的阻断问题。

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Semantic lifecycle permits unregistered and registry-only sources

**File:** `app/listen1_chrome_extension/js/mobile_provider_registry.js:103-115,351-401`
**Severity:** BLOCKER
**Issue:** `SOURCE_BY_ID` 是普通对象，`descriptorFor('__proto__')` 或 `descriptorFor('constructor')` 会取到继承属性。`start()` 只要求 descriptor truthy，因而会调用 executor。即使是实际 descriptor，校验也没有要求 `primary === true`，所以调用者传入 `migu`/`taihe` 和 `{ search: true }` 也会被派发。这绕过了“只有五个 primary source、registry-only source 必须 unavailable”的 fail-closed 边界。
**Fix:** 用无原型映射并做 own-property 检查；在 `start()` 缓存 descriptor，且只接受 `source && source.primary === true`。所有其他 source 必须同步返回 `OPERATION_UNAVAILABLE`，不调用 executor。

### CR-02: Lifecycle accepts transport-shaped and cross-source track identities

**File:** `app/listen1_chrome_extension/js/mobile_provider_registry.js:249-307,411-447`
**Severity:** BLOCKER
**Issue:** `media`/`lyric` 仅检查 `itemId` 是有长度上限的字符串，`https://evil.example` 等非 opaque ID 仍可被派发；搜索 reply 也不要求 `row.sourceId === request.sourceId` 或 item ID 属于该 source。这样绕开了统一 source-prefix identity 契约，并把不受 registry 验证的值交给后续 provider/native executor。
**Fix:** 对 media/lyric 使用 `toTrackIdentity(sourceId, itemId, variant)`；对搜索 rows 强制 source 等于 request source 并以 `sourceForItemId` 验证 ID。验证失败应产生 `INVALID_REQUEST` 或 `INVALID_RESPONSE` terminal，且不派发 executor。

### CR-03: Deadline settles without cancelling the underlying operation, allowing stale work to mutate pagination

**File:** `app/listen1_chrome_extension/js/mobile_provider_registry.js:404-461`; `app/listen1_chrome_extension/js/controller/instant_search.js:354-397`
**Severity:** BLOCKER
**Issue:** timeout timer 直接 `settle(timeout)`，不会调用 executor 返回的 cancellation function；已复现 deadline 后 cancellation 调用次数仍为 0。底层操作可继续运行。更糟的是，搜索 success callback 在 late reply 被 lifecycle 忽略之后仍无条件调用 `updateTotalPage()`（386 行），因此已取消/超时的旧搜索可以覆盖当前 tab 的总页数。
**Fix:** 将 executor cancellation 保存为单独的 best-effort abort，timeout/destroy/cancel 都先调用它，再通过唯一 settlement 完成 terminal；在 controller 任何 `displayRows`、`updateTotalPage` 或 scope 写入前先验证 `currentSearch(...)`，并为超时后 late success 不能改变当前分页添加回归测试。

### CR-04: Fixed translation confirmation is not recognized as the nearest Back layer

**File:** `app/listen1_chrome_extension/js/controller/navigation.js:807-813`
**Severity:** BLOCKER
**Issue:** 可见的 translation confirmation 是 fixed overlay；fixed-position element 通常 `offsetParent === null`。代码把 `offsetParent !== null` 当成可见判断，导致检测失败后 Back 继续关闭 player/search/route，而确认层仍留在页面上，直接违反最近可见层优先的契约。
**Fix:** 不要以 `offsetParent` 判断 fixed overlay；使用明确的 controller state、`aria-hidden` 或计算样式。补一个 `offsetParent === null` 的 visible fixed overlay 回归测试。

### CR-05: Rapid Android Back presses can cascade through multiple layers

**File:** `app/listen1_chrome_extension/js/controller/navigation.js:799-855`; `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:599-608`
**Severity:** BLOCKER
**Issue:** 每次系统 Back 都异步 `evaluateJavascript`，而 handler 对 dialog/full-player/product/route 的状态变更又以 `$applyAsync` 延后。第一下 Back 返回 handled 前并未同步改变可见层；快速第二下会再次观察到同一层，排入第二个 `closeDialog()`/`popWindow()`。两个 deferred callback 随后执行时可越过一个层并关闭其父 route，违反“最近层一次、不得 cascading”的 Back 契约。
**Fix:** 在 JS 侧加一个同步的 `backTransitionPending` latch，在 `$applyAsync` 完成后释放；或将同一层的状态切换在 handler 内以受控的同步 Angular apply 完成。回归测试必须让 `$applyAsync` 延迟，并连续调用 handler 两次，验证只关闭一个层。

### CR-06: Product-layer closing bypasses cancellation and epoch invalidation

**File:** `app/listen1_chrome_extension/js/controller/navigation.js:771-793`; `app/listen1_chrome_extension/listen1.html:4793,4918`
**Severity:** BLOCKER
**Issue:** Back 专用 `closeMobileProductLayer()` 至少会推进 epoch，但它的 `android:mobile-layer-back` 在仓库中没有消费者，也没有保留/调用 `localDataRequest` handle 的 `cancel()`。更严重的是 sheet 的两个普通“返回”入口直接调用 `closeMobileProductPage()`，完全绕过 Back 路径的 epoch invalidation。关闭后 native/provider 回复仍可在隐藏层写入陈旧状态。
**Fix:** 把所有关闭入口统一到一个 layer-aware close wrapper；该 wrapper 应按 layer/epoch 保留并取消 query handles，再失效 epoch。若确认后的写命令语义上不可取消，必须显式区分该状态，而不能把它包装成已取消。

### CR-07: Stale local command completion can reopen an old product page

**File:** `app/listen1_chrome_extension/js/controller/navigation.js:271-306`
**Severity:** BLOCKER
**Issue:** `settleMobileLocal()` 对过期 epoch 会拒绝 UI 写入，但 command promise 的后续 `if (refreshPage) loadMobileLocalPage(refreshPage)` 在 305 行无条件执行。用户 Back/切页后旧 command reply 仍会重新加载旧 page、递增 epoch，并使当前页面的有效请求变成 stale。
**Fix:** 只在 `epoch === mobileLocalEpoch` 且 command 成功时刷新；把 refresh 放进当前 epoch 的 settlement 分支，并测试 Back/换页后 late command completion 不改变当前 page/epoch。

### CR-08: Mobile-shell CSS is not isolated from narrow Electron windows

**File:** `app/listen1_chrome_extension/css/redesign.css:9968-10014`
**Severity:** BLOCKER
**Issue:** 手机 shell 仅以 `max-width: 760px` 触发，未以 Android root marker 限定；窄于 760px 的 Electron 桌面窗口会应用本阶段的 64px dock/tabbar 规则并隐藏 desktop sidebar。该变更破坏了桌面与 Android 的行为隔离。
**Fix:** 在 Android WebView 根节点设置明确的 platform class/data attribute，并将所有 phone-shell selectors 限定到该 attribute；增加 600–760px Electron regression，断言 sidebar/desktop navigation 不被 mobile rules 替换。

## Warnings

### WR-01: Bilibili's normal base video ID is incompatible with the registry identity rule

**File:** `app/listen1_chrome_extension/js/mobile_provider_registry.js:24-31`
**Severity:** WARNING
**Issue:** registry 只接受包含 CID 的 `bitrack_v_BV...-cid`，且把 BVID 固定为 10 位；Android Bilibili provider 会产生无 CID 的 `bitrack_v_${bvid}`，其 native validation 允许 6–32 位 BVID。该常见结果不能通过 `sourceForItemId()`/`toTrackIdentity()`，统一身份与实际 provider 路由不一致。
**Fix:** 接受无 CID 的 video identity，并让 registry 与 native BVID 长度规则共享或严格对齐；补 base-video、带 CID 和 6–32 位边界的测试。

### WR-02: Android playlist search remains a legacy song-search fallback

**File:** `app/listen1_chrome_extension/js/controller/instant_search.js:600-605`; `app/listen1_chrome_extension/listen1.html:1168-1183`
**Severity:** WARNING
**Issue:** Android 仍显示“歌单”类型控制，但点击后调用 `legacySearch()`。NetEase typed adapter 只支持 `type=0`，会给出错误 facade；Bilibili 则可能忽略 type 并展示歌曲。切换该类型也没有取消/推进 typed search epoch，因此旧 reply 可以覆盖状态。
**Fix:** Android 隐藏/禁用该类型，或引入有 capability gate 的 directory lifecycle；任何类型切换都必须 cancel active handle、递增 epoch、清空旧结果。

### WR-03: Contracts largely assert source text and mask the required races/layout behavior

**File:** `app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js:121-148,217-222`; `app/listen1_chrome_extension/test/mobile_ui_contract.test.js:79-98,202-415`; `app/listen1_chrome_extension/test/mobile_provider_registry.test.js:201-262`
**Severity:** WARNING
**Issue:** 多数 shell/CSS assertions 仅检查字符串或正则；导航 harness 的 `$applyAsync` 同步执行，因此无法暴露真实 WebView 的双 Back deferred race。lifecycle timeout test 的 executor 未返回 cancel hook，且没有测试 `migu`/`taihe`、原型键、URL/cross-source ID，故上述 fail-closed 和 cancellation 缺陷均可通过。
**Fix:** 以 deferred mock 建立真实状态机测试：连续 Back、timeout 后 late success、source/query switch 后 late success、product close cancel；对 registry 加入非法 source/non-primary/URL/cross-source/base-Bilibili identity 的 dispatch-negative tests。CSS 至少用浏览器/DOM computed-style 测试覆盖 320px、landscape、200% text 和 fixed-surface clearance。

### WR-04: Landscape queue reserves space for controls that full-player mode hides

**File:** `app/listen1_chrome_extension/css/redesign.css:11342-11359`
**Severity:** WARNING
**Issue:** landscape `.android-queue-sheet` 始终预留 tabbar+dock 高度，但 full-player 打开时 tabbar 已隐藏且 mini-player 位于 detail 下方。队列 panel 因此留下多余的底部空白、压缩可见队列高度。
**Fix:** 队列 layer 只按实际可见固定层或 `safe-area-inset-bottom` 预留空间；在 full-player landscape 状态测试其可用高度和内部滚动。

## Info

### IN-01: Settled terminal result is only shallow-frozen

**File:** `app/listen1_chrome_extension/js/mobile_provider_registry.js:428-434`
**Severity:** INFO
**Issue:** `Object.freeze({ ...reply.result })` 不冻结 `rows` 数组及 row objects；调用方仍可在 settlement 后修改 terminal 的嵌套内容，和 immutable DTO 的声明不一致。
**Fix:** 验证后重新构建并冻结 rows 及每个 row，或使用受限的 deep-freeze helper。

---

_Reviewed: 2026-09-10T09:41:15Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
