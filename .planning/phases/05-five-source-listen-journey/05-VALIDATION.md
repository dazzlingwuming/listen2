---
phase: 05
slug: five-source-listen-journey
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-10
---

# Phase 05 — Validation Strategy

> Focused JVM/Node contracts drive implementation. Full CI, APK assembly and signature verification run only at coherent plan/review/commit gates. Exact-SHA live/provider/device evidence remains Phase 8.

## Completion posture

- Bilibili and NetEase fixtures prove the two current production-capable paths.
- QQ/Kugou/Kuwo A-class clients are implemented as fixed native request factories, injected transports and bounded mappers so Phase 8 can probe the same code directly. Fixture success does **not** enable a production capability.
- `ProviderCapabilityFacade.production()` keeps every QQ/Kugou/Kuwo field false until exact-SHA Phase-8 live/provider/device evidence and a subsequent reviewed activation.
- A successful build or fixture suite cannot satisfy the original five-live-journey goal. `COVERAGE.md` remains the verifier's hard stop.

## Cadence

- During a task, run only its focused `<automated>` command. Do not assemble/install an APK after a provider operation or UI behavior.
- At a completed plan boundary, run affected frontend/JVM suites once.
- Before commit/push, invoke `$run-local-ci` for the exact worktree. Full local CI and APK/signature checks run once at that coherent gate and again only if relevant SHA/worktree content changes.
- Phase 8 owns live routes, API-35 WebView/IME/rotation, codec, notification/lock-screen/audio-focus/headset/Bluetooth, renderer/process recovery, TalkBack, performance and final APK evidence.

## Focused Test Ownership

| Plan | New/extended gate | Required proof |
|---|---|---|
| 05-01 | `PlaybackResolverFactoryTest` | Unknown/QQ/Kugou/Kuwo never select Bilibili/NetEase; unavailable settles once |
| 05-02 | `BilibiliPhase5JourneyContractTest`, `android_bilibili_phase5_journey.test.js` | Exact BVID/CID/media/queue/lyric journey; `netease-primary-for-bilibili` visibly fallback/degraded; stale/mislabel rejected |
| 05-03 | `NetEasePhase5JourneyContractTest`, `android_netease_phase5_journey.test.js` | Numeric identity/rendition/primary lyric; one active selected-source lifecycle and cached restoration |
| 05-04 | `QqNativeProviderTest`, `android_qq_typed_provider.test.js` | QQ four A operations, injectable production transport, full route/schema/cancel/bounds table; all production fields false/no page call |
| 05-05 | `KugouNativeProviderTest`, `android_kugou_typed_provider.test.js` | Kugou A operations, strict data-only JSONP, injectable transport; cleartext/media denial; all production fields false |
| 05-06 | `ProviderAdapterContractTest`, `android_kuwo_typed_provider.test.js`, `android_provider_capability_matrix.test.js` | Kuwo fixed lyric client; all QQ/Kugou/Kuwo production fields false; B/C and resolver denial |
| 05-07 | `android_five_source_journey_contract.test.js` | One active selected-source surface, per-source cache, no fan-out, unavailable no-call, paging/detail/mobile UI |
| 05-08 | `android_mixed_provider_queue_snapshot.test.js` plus queue JVM tests | Mixed source/occurrence/revision semantics and sole-Media3 player/queue projection |
| 05-09 | `android_mixed_provider_lyric_ui.test.js` plus lyric JVM tests | Exact Bilibili fallback label/provenance, stale rejection, manual/offset/translation, external providers unavailable |

All new Node tests must be reachable from `npm --prefix app/listen1_chrome_extension test` before their owning plan closes.

## Per-Plan Commands

| Plan | Focused commands | Completion-sensitive assertion |
|---|---|---|
| 05-01 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*PlaybackResolverFactoryTest' --tests '*PlaybackBridgePolicyTest'` | Default is unavailable, never Bilibili |
| 05-02 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*BilibiliPhase5JourneyContractTest' && node ../app/listen1_chrome_extension/test/android_bilibili_phase5_journey.test.js` | Exact fallback provenance and stale/mislabel negative cases |
| 05-03 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*NetEasePhase5JourneyContractTest' && node ../app/listen1_chrome_extension/test/android_netease_phase5_journey.test.js` | NetEase closed fixture plus one selected-source request |
| 05-04 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*QqNativeProviderTest' --tests '*AndroidRpcContractTest' && node ../app/listen1_chrome_extension/test/android_qq_typed_provider.test.js` | Native client direct fixtures pass; production QQ remains all false/no-call |
| 05-05 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*KugouNativeProviderTest' --tests '*AndroidRpcContractTest' && node ../app/listen1_chrome_extension/test/android_kugou_typed_provider.test.js` | Native client direct fixtures pass; production Kugou remains all false/no-call |
| 05-06 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*ProviderAdapterContractTest' --tests '*PlaybackResolverFactoryTest' --tests '*HttpBridgePolicyTest' && node ../app/listen1_chrome_extension/test/android_provider_capability_matrix.test.js` | Kuwo probe seam exists; all three external providers remain all false |
| 05-07 | `node app/listen1_chrome_extension/test/android_five_source_journey_contract.test.js` | Exactly one active surface/request; tab presence causes zero calls |
| 05-08 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*PlaybackQueueEngineTest' --tests '*PlaybackServiceQueueIdentityTest' && node ../app/listen1_chrome_extension/test/android_mixed_provider_queue_snapshot.test.js` | Unsupported media retains occurrence; one snapshot revision |
| 05-09 | `cd android && gradle --no-daemon :app:testDebugUnitTest --tests '*PlaybackServiceLyricContractTest' --tests '*LyricClockProjectionTest' --tests '*BilibiliLyricProviderTest' && node ../app/listen1_chrome_extension/test/android_mixed_provider_lyric_ui.test.js` | Exact fallback/degraded copy and no stale/unsupported overwrite |

## Mandatory Fixture Dimensions

Every native operation independently covers exact HTTPS method/host/path and generated query/body; bounded/malformed/missing/extra input; success/empty/provider error/wrong schema; request/response/row/text/line limits; timeout/cancel/page epoch/stale/late/duplicate terminal; redirect denial; and recursive exclusion of URL/header/cookie/token/candidate/raw error/native object. Failure of one operation cannot affect another provider or capability.

For QQ/Kugou/Kuwo, add two distinct assertions:

1. Direct native client tests can inject fixtures and a Phase-8 live-probe transport into the same production request factory/mapper path.
2. Packaged-page dispatch under `ProviderCapabilityFacade.production()` returns source-specific unavailable before transport, and passing (1) never changes (2).

## Complete Local CI Gate

Run through `$run-local-ci` using current repository documentation; the current commands are:

1. `npm run test:bilibili`
2. `npm run test:desktop-cache`
3. `npm run test:loudness`
4. `npm run test:desktop-lyric`
5. `npm run test:machine-translation`
6. `npm run test:listening-history`
7. `npm --prefix app/listen1_chrome_extension test`
8. `cd android && env JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug`
9. `env JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home /opt/homebrew/share/android-commandlinetools/build-tools/35.0.0/apksigner verify --verbose android/app/build/outputs/apk/debug/app-debug.apk`

Record repository/branch, HEAD SHA, worktree, commands, timestamps/timezone, results and uncovered evidence. Partial/failed/stale CI is `blocked`/`not verified`, never green.

## External Evidence Gates

| Evidence | Affected requirements | Current state |
|---|---|---|
| Live Bilibili/NetEase search/detail/media/lyrics on exact API-35 APK/SHA | NET-003/004, SRCH, PLAY, LYR | `not verified` |
| Live QQ/Kugou/Kuwo A-class direct-native probe with authorization/schema/rate/entitlement evidence | NET-004, SRCH, LYR | `not verified`; production fields remain false |
| Approved QQ/Kugou/Kuwo playable media contract: fixed stream hosts/routes, MIME/container/codec/duration/expiry/entitlement/recovery | Original goal, PLAY-003 | `blocked — absent` |
| Notification/lock-screen/headset/Bluetooth/audio focus/process recovery | PLAY-004/005/006 | `not verified` |
| 320dp/200%/TalkBack reading order/current lyric/fallback announcements | SRCH-003, LYR-003 | `not verified` |

## Stop Conditions

Stop the affected operation and keep its production capability false if it needs cleartext, redirect, arbitrary/caller URL/path/header/cookie/body, Referer/CORS workaround, cookie-derived Secret/signature, unapproved credentials, dynamic media host without full resolver contract, unbounded/unclassifiable schema, or cannot guarantee one terminal. Stop verification if UI fans out to non-selected providers, fallback provenance is lost, a failure consumes the queue, timestamps are fabricated, or full CI/device evidence is absent.

## Sign-Off

- [ ] All focused tests exist and are in standard suites.
- [ ] Every A client passes direct native fixture gates and remains production-false/no-call.
- [ ] Every B/C field and false/unknown resolver stays denied.
- [ ] Selected-source no-fan-out/cache restoration tests pass.
- [ ] Bilibili fallback exact label and stale/mislabel tests pass in native and UI suites.
- [ ] Full local CI and exact-SHA Phase-8 evidence are attached.
- [ ] `nyquist_compliant`/`wave_0_complete` change only after listed automated gates pass.
- [ ] Phase 5 remains unpassed while any `COVERAGE.md` completion blocker remains.

**Approval:** pending implementation and external evidence
