# Debug Session: Android All Provider Search

## Status

investigating

## Trigger

The user reports that the delivered Android APK has systemic search failures across the app, not only the previously repaired Bilibili path, and rejects the prior APK as unqualified.

## Symptoms

- Expected: on an API 35 Android emulator, entering a representative Chinese song query and selecting each primary source (NetEase, Kugou, Kuwo, QQ, Bilibili) produces visible, relevant search results or a truthful provider-specific terminal error when an upstream service is genuinely unavailable.
- Actual: the user observes that overall search is unusable across multiple sources; the prior agent validated only Bilibili and incorrectly reported the APK as passed.
- Errors: exact per-provider messages are not yet independently reproduced; earlier reports included security-policy blocking.
- Timeline: observed in the APK delivered from commit `1796bf2` on 2026-09-16.
- Reproduction: install the current release-like APK, open Search, enter the same representative query, and exercise every primary provider through the visible phone UI.

## Constraints

- Validate the user-visible search flow for all five primary providers; provider-unit tests or raw HTTP success alone do not count.
- Do not claim overall acceptance from one provider.
- Preserve bounded native capabilities: no arbitrary URL/header/cookie bridge and no bypass of membership, DRM, region, or account restrictions.
- Preserve unrelated `.planning` changes and evidence.
- Do not build or deliver a new APK until all five search lanes have explicit emulator evidence.
- The root agent owns final CI, commit, push, APK publication, and user-facing completion claims.

## Current Focus

- Hypothesis: the remaining Bilibili journey failure is an external anonymous-request security gate, not a broad Android search-policy failure; the MV primary/backup selection bug is fixed but cannot be re-exercised while that gate is active.
- Test: matching release-like product and AndroidTest artifacts on API 35, with a visible five-source matrix and Bilibili video-result -> part -> audio-progress -> MV-progress journey.
- Expecting: Kugou, Kuwo and QQ show relevant results; NetEase and a Bilibili 412 show their exact, source-specific terminal copy; Bilibili audio/MV either progress for a visible B result or remain explicitly not verified behind the external gate.
- Next action: retain the current API-35 evidence and, only when Bilibili again permits the original anonymous search route (or a user-owned authorized session is available), rerun the Bilibili audio/MV journey against the already-built release-like product.

## Evidence Log

- The prior final report cited only a Bilibili live smoke and QR-login check while claiming the APK was complete.
- The project state itself says the five-source journey and integrated runtime acceptance remain incomplete.
- User explicitly reports that overall search remains unusable in the delivered APK.
- timestamp: 2026-09-16 17:38:26 +0800; direct anonymous NetEase search returns HTTP 200 with provider code -462, and the mobile UI maps it to the exact visible upstream restriction “网易云要求完成验证 / 当前匿名搜索被来源拦截，请先选择其他音乐来源。” No bypass, caller headers, or credentials were added.
- timestamp: 2026-09-16 17:38:26 +0800; QQ's prior request omitted its adapter-owned profile. A fixed Origin/Referer/User-Agent profile returns 20 relevant rows for the representative query; the values remain controlled constants rather than caller input.
- timestamp: 2026-09-16 17:38:26 +0800; the prior Bilibili journey reached search result and part selection but failed before playback with visible safe error “音源返回的媒体信息无效，请稍后重试。” and sanitized native code INVALID_RESPONSE. The policy now filters unsupported sibling renditions individually and retains only a separately validated primary MP4/AAC handoff.
- timestamp: 2026-09-16 17:38:26 +0800; an isolated non-incremental/in-process releaseLike build completed successfully. The pre-existing androidTest APK is older than the product APK and crashes in its own AndroidX startup process before the scenario begins, so it is invalid acceptance evidence and requires a matching test-artifact rebuild.
- timestamp: 2026-09-16 19:39:00 +0800; emulator-5554 initially had no usable default route/DNS, producing the sanitized native marker `gateway-request-failed-stage=response-kind=dns`. Restoring the emulator's normal network speed/delay state restored DNS and external connectivity; this was test-environment state, not a product policy bypass.
- timestamp: 2026-09-16 19:46:49 +0800; a real API-35 Bilibili journey reached native `audio-resolved-descriptor`, opened the app-owned lease stream, and the Android MediaSession reached `PLAYING(3)` with 3562 ms buffered. The old acceptance probe incorrectly treated its initial visible 0:00 placeholder as progress; it now waits for non-zero audio/MV progress and keeps the journey alive through the bounded native request budget.
- timestamp: 2026-09-16 19:45:00 +0800; matching release-like product plus aligned AndroidTest matrix completed through the visible UI: NetEase showed the exact anonymous verification restriction; Kugou, Kuwo, QQ, and Bilibili each displayed 3 visible relevant 青花瓷 results. This is emulator UI evidence, not raw HTTP evidence.
- timestamp: 2026-09-16 19:47:00 +0800; Bilibili MV’s prior UNSAFE failure was narrowed to optional backup CDN URLs invalidating a separately valid primary MP4 rendition. The selector now retains only a validated primary and filters each backup before the native surface sees it; focused Bilibili policy tests pass. A fresh MV surface/progress run remains blocked by the later upstream Bilibili gate.
- timestamp: 2026-09-16 19:49:00 +0800; the original anonymous Bilibili direct-search route reproducibly returned HTTP 412 under both fixed mobile and browser user-agent profiles. The native gateway now maps that fixed status to non-retryable PROVIDER_ERROR and emits only `gateway-request-status=security-policy`; the visible app copy is “来源安全策略拒绝了请求 / 请选择其他来源，或稍后再试。”, not the misleading “网络不可用”. A subsequent API-35 Bilibili journey observed exactly that marker and cannot truthfully claim audio/MV completion while search is upstream-blocked.

## Resolution

- Root cause: systemic five-provider failure claim was not reproduced after restoring the emulator network and using aligned artifacts; Bilibili has two separate issues: optional backup CDN validation rejected an otherwise valid MV primary, and the upstream anonymous search endpoint intermittently returns HTTP 412 security policy.
- Fix: filter unapproved MV backups without admitting them to the native surface; map Bilibili HTTP 412 to terminal provider security-policy copy; correct the five-source and Bilibili acceptance probes so they require real progress rather than placeholder UI state.
- Verification: five-provider visible API-35 matrix completed; B audio reached native PLAYING in one live run. Current B audio/MV revalidation is specifically blocked by the verified upstream 412 anonymous-request gate.
