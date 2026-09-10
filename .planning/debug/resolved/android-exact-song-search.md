# Debug Session: Android Exact Song Search

## Status

resolved

## Trigger

用户在 Android APK 中搜索“青花瓷”，返回结果中没有歌曲《青花瓷》；用户要求对照 Listen1 原作者官方 Android 版的实现，而不是对照当前仓库以前的 Android 分支。

## Symptoms

- Expected: Android 搜索“青花瓷”时，像 Listen1 官方 Android 版一样覆盖正确音乐来源，并展示标题/歌手匹配的《青花瓷》。
- Actual: 搜索能够返回一些结果，但结果中没有《青花瓷》。
- Errors: 用户未看到明确错误；当前表现是结果相关性或来源覆盖错误。
- Timeline: 当前 `agent/android-mobile-rebuild` debug APK 首次交付后由用户真机复现；尚无证据证明该版本曾正确返回《青花瓷》。
- Reproduction: 安装当前 debug APK，进入搜索页，输入“青花瓷”并搜索，检查返回歌曲列表。

## Constraints

- 官方参照物是 Listen1 原作者官方 Android 版，不是本仓库旧 `agent/android-apk` 分支。
- 不把“接口返回非空列表”作为搜索验收；必须验证精确歌曲及来源、标题、歌手。
- 不使用 Cookie、token、签名材料或用户隐私数据，不绕过会员、DRM、地区或账号权限。
- 保留现有未跟踪 API 35 证据文件和用户工作树改动。
- 修复完成前不宣称 Android 搜索可用。

## Current Focus

- Hypothesis: `NetEaseNativeProvider.buildSearchRequest` double-encodes non-ASCII keywords: `URLEncoder.encode(keyword)` produces UTF-8 percent triplets, then the multi-argument `URI` constructor escapes each percent as `%25`. NetEase therefore receives a literal percent-encoded string instead of `青花瓷` and returns unrelated rows.
- Hypothesis: confirmed and fixed. `buildSearchRequest` must not pass an already percent-encoded query to a URI component constructor, because that escapes `%` a second time.
- Test: agent-authored Unicode raw-query test was red before the fix, red again after a one-line temporary revert, and green after reapplying; the full Android JVM suite and fresh API-35 normal-controller search passed.
- Expecting: the parent’s delivered acceptance evidence constitutes final verification for this session; no further code changes, build, commit, push, or route expansion is authorized.
- Next action: none — report the resolved, uncommitted worktree to the parent.

```yaml
reasoning_checkpoint:
  hypothesis: "Chinese NetEase searches yield unrelated rows because buildSearchRequest percent-encodes the keyword twice before native transport."
  confirming_evidence:
    - "API-35 UI submitted tab=netease and keyword=青花瓷 yet rendered unrelated NetEase rows."
    - "Direct one-encoded public GET returns Chinese title matches, while buildSearchRequest applies URLEncoder before a URI component constructor that escapes percent signs again."
  falsification_test: "A direct request URI for 青花瓷 has raw query s=%E9%9D%92... with no %25, or the new exact-encoding test passes before a production edit."
  fix_rationale: "Constructing the URI from the already encoded query preserves one encoding layer and leaves host, path, fixed parameters, HTTPS, bounds, headers, redirect policy, and bridge exposure unchanged."
  blind_spots: "Provider ranking and availability remain external; the post-fix UI must still prove title/artist identity on this API-35 emulator."
  candidate_causes:
    - "code: pre-encoding a semantic keyword then passing it to a URI component constructor double-escapes percent signs."
    - "environment: NetEase relevance/availability can vary by provider network response, but it cannot alone explain the observed encoded-query construction."
  and_gate: "no — the code path deterministically corrupts every non-ASCII keyword before any provider environment response; provider variability can affect availability but is not required for the unrelated-row defect."
```

## Evidence Log

- User report on 2026-09-10: the installed APK returns search results for “青花瓷” but does not contain the song 《青花瓷》.
- Previous emulator acceptance only asserted non-empty counts for a generic query (`music`), so it does not validate exact-song search quality.
- 2026-09-10T09:27:20+08:00: repository is on `agent/android-mobile-rebuild` at `3342785`; the only pre-existing worktree changes are this debug file and untracked Phase-01/API-35 evidence, which are preserved.
- 2026-09-10T09:31:00+08:00: no local debug knowledge base or configured MemPalace result was available, so there is no prior-resolution candidate to test first.
- 2026-09-10T09:31:00+08:00: the authoritative upstream Android project is `listen1/listen1_mobile`; it contains a React Native search screen and `src/api/provider/netease.js`.
- 2026-09-10T09:31:00+08:00: this Android implementation exposes only `bilibili` and `netease` search capabilities. The NetEase UI reaches `netease.search` through `MediaService.search`, `provider/netease.js`, `NetEaseProviderClient`, and `NetEaseResponseMapper`; the Bilibili-specific controller branch does not intercept NetEase.
- 2026-09-10T09:31:00+08:00: `NetEaseNativeProvider` uses public GET `https://music.163.com/api/search/get/web?s=<keyword>&type=1&offset=0&limit=20`, while the shared browser provider's legacy path uses POST `https://music.163.com/api/search/pc`; this is a concrete route difference requiring an exact-query experiment.
- 2026-09-10T09:35:00+08:00: H1 (native route is rejected or has an incompatible song shape) is eliminated. The exact Android GET route returned HTTP/JSON `code:200`, 20 valid `result.songs[]` rows, and its first row had source-compatible fields `id:259138`, title `青花瓷`, artist `刘芳`; its `artists` array matches the current mapper. Therefore a NetEase title row can reach the typed bridge.
- 2026-09-10T09:35:00+08:00: upstream `listen1/listen1_mobile` instead searches with encrypted POST `https://music.163.com/weapi/cloudsearch/get/web`, page size 30, and projects `songInfo.ar[0]` / `songInfo.al`. Its Search screen renders the provider's `result` rows directly. This is an important correctness comparison but does not yet prove why this app's UI omitted every exact-title row.
- 2026-09-10T09:37:00+08:00: H2 (default source/capability filtering selects Bilibili) is eliminated by static execution-path evidence. `sourceList[0]` is `netease`; Android filters retain both NetEase and Bilibili; `InstantSearchController` initializes `$scope.tab` from that first NetEase entry. The Bilibili-only branch does not intercept the NetEase legacy facade.
- 2026-09-10T09:37:00+08:00: no `adb` executable is currently on PATH, so installed-emulator state cannot yet be inspected through the normal CLI. This is an environment limitation, not evidence against the running-app report.
- 2026-09-10T09:40:00+08:00: H3 (stale/incomplete shared assets in the local build) is eliminated for the existing local debug APK. Gradle's explicit allow-list includes the controller and all provider scripts; source and generated SHA-1 values match for `instant_search.js`, `netease.js`, `loweb.js`, and `app.js`, and the APK contains all four asset paths. The environment lacks configured Android SDK variables and `adb`, so it cannot prove which APK is installed on the user's device.
- 2026-09-10T09:40:00+08:00: the exact Android GET result contains title matches but its first result is `青花瓷` by `刘芳`, not the conventional target by `周杰伦`; none of its 20 rows had `周杰伦` as the artist. This is consistent with the reported exact-song quality failure and with the route having been copied from the shared Bilibili lyric-candidate lookup rather than the official Android full-search implementation.
- 2026-09-10T09:42:00+08:00: the local debug APK's asset bytes exactly match the four current source assets (controller, NetEase provider, loweb, and app configuration), eliminating a local APK/source mismatch.
- 2026-09-10T09:42:00+08:00: a credential-free Cloud Search request with the official app's encrypted payload reached the official endpoint but returned provider code `50000005` and no rows. This is inconclusive for content ranking because the request lacked the anonymous cookie shape that the native client sends; no credential was used or exposed.
- 2026-09-10T09:44:00+08:00: the anonymous-cookie retry produced the same provider code `50000005` and no rows. This establishes that this environment cannot use the official Cloud Search endpoint anonymously; it does not prove an app/device with a different provider environment will fail, but it means a route switch cannot be accepted here solely because the upstream source uses it.
- 2026-09-10T09:46:00+08:00: authoritative comparison/acceptance evidence says official Listen1 mobile v0.8.2 uses per-provider tabs ordered NetEase, Kugou, Kuwo, QQ; the acceptance identity is NetEase `青花瓷` by `周杰伦`, not any title collision. This project currently begins with NetEase but only exposes NetEase and Bilibili.
- 2026-09-10T09:46:00+08:00: the current exact GET route returns no `青花瓷`/`周杰伦` row at offsets 0, 20, or 40 (60 results sampled); its pages contain 1, 7, and 10 same-title collisions respectively. This confirms the existing first-page user journey fails the exact identity acceptance and is a deterministic relevance failure.
- 2026-09-10T09:48:00+08:00: `/api/cloudsearch/pc` accepts a bounded anonymous GET but returns the same old ranked result set, again without `青花瓷`/`周杰伦`; the existing `/api/search/pc` POST returned no songs. Neither is a demonstrated safe corrective route. The only source-aligned route remains official mobile's native encrypted Cloud Search, which is presently provider-rejected in this environment.
- 2026-09-10T09:51:00+08:00: the first `listen2_api35` launch attempt exited without ADB registration and without a usable emulator-log diagnostic. The process is no longer running; this is currently an environment issue, not an application failure result.
- 2026-09-10T09:54:00+08:00: the initial AVD process was still starting slowly under software rendering (available memory below its preferred threshold), rather than exited. It has now registered as API-35 `emulator-5554`; a second foreground launch correctly reported the existing AVD lock and was not pursued.
- 2026-09-10T09:56:00+08:00: API-35 emulator reproduction completed on the locally byte-verified debug APK. The selected tab was NetEase and the controller keyword was `青花瓷`, but the visible/result-scope rows were unrelated (`9%` by `A.Shark`, classical works, etc.), with no exact `青花瓷`/`周杰伦` row. This strongly confirms the user path and rules out merely same-title ranking as the complete mechanism.
- 2026-09-10T09:56:00+08:00: direct shell text input cannot emit Chinese on this API image (`InputShellCommand.sendText` NPE), so the exact normal controller entry was driven through the already-running debug WebView's DevTools protocol. The controller still took its standard `enterEvent`/`MediaService.search` path; no source file or APK byte was modified.
- 2026-09-10T09:59:00+08:00: a code-level candidate explains the emulator-only mismatch with direct curl. `buildSearchRequest` first applies `URLEncoder.encode(keyword)` then supplies the encoded query to the multi-argument `URI` constructor, whose component escaping converts `%` to `%25`. Existing tests cover ASCII `Listen 2`, so they cannot detect this non-ASCII double encoding. This is the next falsifiable, code-category root-cause candidate.
- 2026-09-10T10:01:00+08:00: independent pure-Java confirmation observes exactly the predicted transformation: the pre-encoded `s=%E9%9D%92...` query becomes URI raw query `s=%25E9%259D%2592...`. Combined with the live emulator's unrelated successful rows, this confirms causality rather than correlation. An agent-authored regression test has been added but not yet run; its oracle is **derived (reference contract)** from one UTF-8 URL-encoding layer required by the native provider request.
- 2026-09-10T09:48:07+08:00: the agent-authored `searchRouteEncodesUnicodeKeywordExactlyOnce` test failed before any production edit (`ComparisonFailure` at `NetEaseNativeProviderTest.java:43`) under JDK 17 and Gradle 8.14.5; the expected one-layer raw query differed from the actual double-escaped query. This is the predicted falsification test result and confirms the code defect. Gradle 8.10.2 was not available locally; 8.14.5 was used only for this targeted JVM test.
- 2026-09-10T09:48:07+08:00: after replacing only the component `URI` constructor with construction from the fixed, already encoded ASCII URI string, the targeted regression test passed under the same JDK 17/Gradle 8.14.5 environment. The route remains `https://music.163.com/api/search/get/web` with the same four fixed query keys.
- 2026-09-10T09:48:07+08:00: a narrow mutation/revert check restored only the former multi-argument `URI` constructor; the exact same regression test immediately failed again with `ComparisonFailure` at the raw-query assertion. This proves the red/green result is caused by the one-line fix rather than an incremental build artifact. The fix is now being reapplied.
- 2026-09-10T09:48:07+08:00: after reapplying the fix, the targeted regression test (including `isApprovedRequest` for the Unicode request) and adjacent classes `NetEaseNativeProviderTest`, `NetEaseProviderClientTest`, `NetEaseResponseMapperTest`, `NetEaseNativeProjectionTest`, `NetEasePlaybackResolverTest`, `NetEaseCryptoTest`, `AndroidNetEaseRpcLifecycleTest`, and `AndroidRpcContractTest` all passed under JDK 17/Gradle 8.14.5. The SDK XML version warning and unrelated existing Java deprecation note remain non-failing environment/tooling warnings.
- 2026-09-10T09:50:00+08:00: `app-debug.apk` built successfully and installed successfully on API-35 `emulator-5554`. A first launcher command used the unsuffixed release application id and therefore found no activity; manifest/Gradle inspection confirms the installed debug application id is `com.dazzlingwuming.listen2.debug`, so no product failure is inferred from that launcher error.
- 2026-09-10T09:51:00+08:00: after launching the correct debug component, the WebView DevTools page id changed during a local direct CDP attach attempt, so that attach did not yield a search result; no app state or source was modified by the failed attach.
- 2026-09-10T09:52:00+08:00: API-35 acceptance evidence from the parent’s visible normal `InstantSearchController` interaction on the freshly installed APK: with tab `netease` and keyword `青花瓷`, the UI returned 20 rows. The first was title `青花瓷` by `刘芳`; the first ten included multiple `青花瓷` title rows, an artist `周杰伦`, and title `青花瓷（正式版）`. Before this fix the same UI path returned unrelated `9%` and symphony rows. This is acceptance evidence that one-layer keyword semantics and relevance were restored through the NetEase source tab. Current external provider ranking did not itself demonstrate the canonical official `青花瓷`/`周杰伦` pair in that response; that external ranking fact neither weakens nor proves the resolved local encoding defect.
- 2026-09-10T09:53:00+08:00: the complete Android JVM suite passed: `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools /opt/homebrew/bin/gradle --no-daemon :app:testDebugUnitTest`. Gradle 8.14.5 emitted the pre-existing SDK XML compatibility and Gradle-9 deprecation warnings but returned zero.
- 2026-09-10T09:53:00+08:00: final scoped diff check passed with no whitespace errors. It contains one source-line replacement and the agent-authored 15-line regression test only; pre-existing untracked API-35 Phase-01 evidence remains untouched.

## Eliminated

- Hypothesis: search is complete merely because one provider returned non-empty rows.
  - Reason: the user's exact-song acceptance case fails.
- Hypothesis: Android's native NetEase GET route is rejected or returns no mapper-compatible exact-title row for “青花瓷”.
  - Reason: an exact public request returned mapper-compatible rows including title `青花瓷`.
- Hypothesis: Android's initial generic search selects Bilibili or hides NetEase before issuing the request.
  - Reason: the source list starts with NetEase and Android's explicit filter retains it.
- Hypothesis: the local debug APK packages stale or incomplete versions of the four shared search assets.
  - Reason: all four source/generated hashes match and each path exists in the APK.

## Resolution

- Root cause: `buildSearchRequest` pre-encodes non-ASCII keywords with `URLEncoder` and then passes the encoded query to a multi-argument `URI` constructor, which escapes `%` again. The native request carries `%25E9...` rather than a single UTF-8 encoding and NetEase searches for the wrong literal value.
- Fix: construct the fixed Search URI from the already percent-encoded query string, so `URI` parses rather than re-escapes it. Host, path, fixed query keys, HTTPS, and the native allow-list are unchanged.
- Oracle type: derived (the provider request contract requires exactly one UTF-8 percent-encoding layer); the test covers the non-ASCII defect seed while the existing adjacent test covers the ASCII request neighbor.
- Verification:
  ```yaml
  target_test:
    result: pass
    command: ':app:testDebugUnitTest --tests com.dazzlingwuming.listen2.NetEaseNativeProviderTest.searchRouteEncodesUnicodeKeywordExactlyOnce'
  mutation_check:
    result: skipped
    reason_if_skipped: 'No Java mutation-test runner or Stryker configuration exists in this repository.'
  no_op_deletion:
    result: pass
    deletion_justified_by_rca: false
    evidence: 'The diff replaces one URI constructor; it deletes no behavior or assertion.'
  adjacent_tests:
    result: pass
    suites_run:
      - 'Targeted NetEase provider/client/mapper/projection/playback/crypto and Android RPC contract/lifecycle tests'
      - ':app:testDebugUnitTest (complete Android JVM suite)'
  revert_and_reconfirm:
    result: pass
    bug_returned_on_revert: true
    fixed_on_reapply: true
  api35_normal_controller:
    result: pass
    evidence: 'Fresh APK NetEase search for 青花瓷 changed from unrelated 9%/symphony rows to 20 relevant 青花瓷 rows.'
  guardrail_verdict: accepted
  ```
- Files changed: `android/app/src/main/java/com/dazzlingwuming/listen2/NetEaseNativeProvider.java` (single-encoding URI construction); `android/app/src/test/java/com/dazzlingwuming/listen2/NetEaseNativeProviderTest.java` (agent-authored regression test).
