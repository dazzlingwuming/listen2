---
phase: quick-260913-g8n-production-offline-download
verified: 2026-09-13T05:23:46Z
status: human_needed
score: 1/6 must-haves verified
behavior_unverified: 5
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 1/6
  gaps_closed:
    - "Transport now permits the original request plus only two validated redirects, restricts Kugou media to exact sharefs.kugou.com, and carries one monotonic 15-minute deadline through bootstrap, redirects, and stream reads."
    - "Quota accounting now checks every received chunk against aggregate committed plus reserved bytes and rejects a body that exceeds a positive declared Content-Length before ready publication."
    - "Player controller now maps all rejected media/player errors to an allow-listed product code before Redux, including cache-failure one-fallback handling."
    - "Settings now maps stable download error codes to fixed actionable Chinese copy rather than rendering native failure text."
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "Explicit NetEase/Kugou download only; no passive/Bilibili cache path."
    test: "On Android, trigger eligible NetEase and Kugou downloads, test two redirects and rejected third/cross-provider redirects, then verify Bilibili has no download action or native request."
    expected: "Only explicit eligible actions start downloads; rejected hops fail safely and Bilibili never enters the catalog."
    why_human: "The deterministic Kotlin transport tests cannot compile or run here because no Java runtime/JDK is installed."
  - truth: "Only complete, SHA-256-verified app-private media becomes playable."
    test: "Exercise success, cancellation, over-size, underreported Content-Length, restart repair, and corrupt-file resolution on Android."
    expected: "Partial/corrupt/over-limit files are removed or unavailable and never open through the provider."
    why_human: "Native filesystem, provider, atomic-rename and digest behavior require the focused JVM/device runtime."
  - truth: "Two active/eight queued admission, terminal cancellation, de-duplication, and hard quotas hold at runtime."
    test: "Submit duplicates and eleven unique eligible downloads; cancel/remove during transfer and observe the catalog after completion."
    expected: "Duplicates converge, the eleventh is QUEUE_FULL, stale work cannot publish ready, and capacity failures are CAPACITY_EXCEEDED."
    why_human: "The meaningful Kotlin fake-executor tests are present but unexecuted without JDK 17."
  - truth: "SAF → verified cache → one provider fallback preserves the playback transaction."
    test: "On an emulator/device, play a valid cached item, then force a cache-load failure and a provider failure."
    expected: "A cache hit avoids bootstrap; failed cache invalidates then attempts exactly one online bootstrap; second failure leaves queue/current/history unchanged and exposes fixed copy only."
    why_human: "Jest proves controller transitions with mocks, not TrackPlayer plus the Android content provider."
  - truth: "The Settings screen provides safe actionable download management."
    test: "Use TalkBack/touch to cancel, retry, remove and clear failed/cancelled/ready entries, including capacity/provider failures."
    expected: "Storage/status update from events and only fixed Chinese recovery text is visible; no URL, content URI, path, header, credential, or raw exception appears."
    why_human: "Source mapping and adapter tests cannot prove rendered React Native accessibility or native event delivery."
human_verification:
  - test: "Install JDK 17 and run the plan's exact focused OfflineAudioContractTest command."
    expected: "Kotlin compiles and all deterministic route, redirect, deadline, quota, cancellation, persistence, repair and content-provider tests pass."
    why_human: "The only allowed Gradle/JVM check cannot start in this environment: Java Runtime is unavailable."
  - test: "Perform the authorized Android emulator/device end-to-end offline journey for NetEase and Kugou."
    expected: "Verified content-provider playback, restart/corruption repair, event progress, Settings actions and cache-failure one-fallback behavior work without leaking sensitive locations."
    why_human: "Requires real Android, TrackPlayer and provider integration; APK/emulator execution was outside this verification task."
---

# Quick 260913-g8n: Production Offline Download Final Re-verification Report

**Goal:** Deliver the first production offline-download slice in the standalone React Native Android app: explicit NetEase and Kugou downloads, bounded app-private verified media, cache-first playback with one safe online fallback, and a usable management surface.

**Verified:** 2026-09-13T05:23:46Z
**Status:** human_needed
**Re-verification:** Yes — final review after `5ae3984`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Explicit NetEase/Kugou download only; no passive/Bilibili cache path | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Source/ID gates are wired from `SearchScreen` through `offlineAudio` to native policy; `OfflineCore.kt:89-108` bounds requests to original + two redirects, revalidates each hop, and `KUGOU_MEDIA` is exact `sharefs.kugou.com`. Kotlin regression source is substantive but cannot run without Java. |
| 2 | Only atomically verified complete app-private media becomes playable; failures/corruption are safe | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `OfflineCore.kt:274-304` checks deadline, per-file limit, declared-length overrun, aggregate reservation, signature and SHA-256 before same-directory commit; `354-403` atomically persists/reconciles catalog copies and invalidates corruption. Native execution remains unverified. |
| 3 | 2 active/8 queued with terminal cancellation, de-dup, hard quotas and stable status | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `ThreadOfflineExecutor` is fixed at 2 workers + `ArrayBlockingQueue(8)`; active-work identity tombstones cancellation/removal. `stream()` recomputes reservation and capacity on every chunk regardless of Content-Length. Deterministic source tests exist but cannot execute. |
| 4 | SAF → verified cache → provider, with one safe fallback | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `playerController.ts:100-112,192-242` resolves SAF, then `resolveVerified`, then provider; cache-origin failure invalidates and performs one non-recursive fallback before activation. Focused Jest executes cache hit/miss/corrupt, fallback, second failure and queue-preservation cases, but not native TrackPlayer/provider integration. |
| 5 | Sanitized, functional management surface supports status/cancel/retry/remove/clear | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Coordinator observer → module projection → validated `offlineAudio` → volatile reducer → Settings is wired. `offlineErrorCopy.ts` and `SettingsScreen.tsx:210-267` render fixed actionable copy and actions only; UI/native event delivery needs device verification. |
| 6 | Only canonical `mobile/` changed; no downloader/filesystem package or automatic/Bilibili cache | ✓ VERIFIED | `git diff --name-only 7597dc0 5ae3984` contains only nine intended `mobile/` source/test files. No manifest/lockfile or downloader package changed; eligibility is NetEase/Kugou-only. |

**Score:** 1/6 truths verified (5 present, behavior-unverified)

### Prior Blocker Closure

| Prior blocker | Result | Code-level evidence |
| --- | --- | --- |
| More than two redirects / broad Kugou host / no absolute deadline | ✓ CLOSED | `OfflineCore.kt:89-124`: `repeat(3)`, exact media host, route check before each connection and after every redirect, remaining-time-bounded connection/read timeouts, deadline-wrapped input, deadline checks in bootstrap/stream. `OfflineAudioContractTest.kt:37-73` covers two redirects, third rejection and cross-provider rejection. |
| Aggregate quota bypass on positive underreported Content-Length | ✓ CLOSED | `OfflineCore.kt:279-288` rejects `downloaded > length` and calculates aggregate capacity from `maxOf(reservation, downloaded)` for known and unknown lengths. `OfflineAudioContractTest.kt:119-132` asserts failed `PROVIDER_REJECTED` and no resolvable item. |
| Raw exception/URI/provider location reaches Redux/UI | ✓ CLOSED | Every `player/setError` path in `playerController.ts` uses `safePlayerError`; only four typed codes are admitted. `PlayerScreen` calls `playerErrorCopy`, whose unknown-code fallback is fixed. Jest injects `https://…` and `content://…` errors and proves state retains only `playback-unavailable`. |
| Settings lacks stable actionable failure mapping | ✓ CLOSED | `offlineErrorCopy.ts` maps queue/capacity/file/cancel/network/provider/corruption codes to fixed Chinese text; `SettingsScreen.tsx:210-240` renders that mapping, never `errorCode` itself. Jest covers known mappings and an URL-shaped unknown value. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineCore.kt` | Bounded transport, atomic verified store and coordinator | ✓ SUBSTANTIVE, runtime unverified | 410-line implementation owns routes, redirects, deadline, quota, digest, catalog recovery/reconciliation and tombstone races. No façade remains. |
| `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineAudioModule.kt` | Semantic native surface/read-only provider | ✓ WIRED, runtime unverified | Registered package plus non-exported manifest provider; bridge maps only sanitized catalog fields and content URI is transient. |
| `mobile/android/app/src/test/java/com/listen2mobile/offline/OfflineAudioContractTest.kt` | Deterministic native contract tests | ✓ SUBSTANTIVE, NOT RUN | Eleven behavior tests use fake transport/executor/clock and fake redirecting `HttpURLConnection`; they test outcomes rather than token presence. JDK absence prevents execution. |
| `mobile/src/offline/offlineAudio.ts` + `downloadSlice.ts` | Validated volatile semantic adapter/catalog | ✓ VERIFIED (static) | Adapter rejects malformed catalog entries and strips extras; store receives one subscription and does not persist downloads. |
| `mobile/src/player/playerController.ts` | Transactional cache-first resolver | ✓ VERIFIED (JS behavior) | 17 focused Jest tests pass, including exact one-fallback and raw-location redaction paths. Native integration remains human verification. |
| `mobile/src/screens/SettingsScreen.tsx` | Sanitized actionable management UI | ✓ WIRED, visual/runtime unverified | Uses volatile snapshot, status/progress, fixed error copy and all four management actions. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| SearchScreen | downloadSlice | Eligible TrackRow action → `requestDownload` | ✓ WIRED | `SearchScreen.tsx:369-376` only supplies `onDownload` when semantic eligibility passes. |
| downloadSlice/store | offlineAudio | Semantic thunks + catalog subscription | ✓ WIRED | `downloadSlice.ts:16-55`; `store/index.ts:52-54` forwards validated snapshots to the volatile reducer. |
| offlineAudio | OfflineAudioModule/Core | `Listen2OfflineAudio` methods + `catalogChanged` | ✓ WIRED (static) | Exact public methods and sanitized event bridge align; native compile awaits JDK. |
| playerController | offlineAudio | Cache lookup/invalidate before provider bootstrap | ✓ WIRED | Cache hit short-circuits bootstrap; cache failure invalidates then executes one online attempt. Focused Jest passes. |
| OfflineAudioModule | AndroidManifest | Non-exported read-only content provider | ✓ WIRED (static) | Authority is `${applicationId}.offline-cache`; provider accepts only `r` and a validated semantic key. |
| SettingsScreen | downloadSlice | Catalog status/actions to UI | ✓ WIRED | Cancel, retry, remove and clear dispatch real thunks; error text comes only from stable mapping. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Focused player/offline Jest | `cd mobile && npx --no-install jest --runInBand src/player/__tests__/playerController.test.ts src/offline/__tests__/offlineUi.test.tsx` | 2 suites, 17 tests passed | ✓ PASS |
| TypeScript | `cd mobile && npx --no-install tsc --noEmit` | Exit 0 | ✓ PASS |
| Scoped ESLint | `cd mobile && npx --no-install eslint [changed TS/TSX] --quiet` | Exit 0 | ✓ PASS |
| Scoped Prettier | `cd mobile && npx --no-install prettier --check [changed TS/TSX]` | Exit 0 | ✓ PASS |
| Diff whitespace | `git diff --check 7597dc0 5ae3984` | Exit 0 | ✓ PASS |
| Native offline contract | `cd mobile/android && ./gradlew --offline --no-daemon :app:testDebugUnitTest --tests 'com.listen2mobile.offline.OfflineAudioContractTest'` | Not run: environment has no Java Runtime/JDK. | ? NOT VERIFIED |

Prettier has no Kotlin parser, so Kotlin files were excluded from the formatter verdict; `git diff --check` found no patch whitespace errors. Metro and APK/emulator checks were intentionally not run.

### Data-Flow and Privacy Trace

| Flow | Source | Boundary | Result | Status |
| --- | --- | --- | --- | --- |
| Catalog events | Coordinator observer | Module projection → adapter validation → volatile Redux | Only operation/semantic/status/size/time fields flow; extra URL/path fields are dropped | ✓ FLOWING |
| Error presentation | Native stable code / player safe code | Fixed copy helpers → Settings/Player UI | No raw `error.message`, URI, URL, path, header or credential is rendered | ✓ FLOWING (JS/static) |
| Playback media | SAF/cache/provider | Local function variable → TrackPlayer | URI is not dispatched or persisted; controller performs at most one cache-failure online fallback | ✓ FLOWING (JS behavior) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- |
| QUICK-OFFLINE-001 | 260913-g8n-PLAN.md | First production offline-download slice | ? NEEDS HUMAN | Code-level blockers are closed and scoped JS checks pass. JDK compilation and Android/TrackPlayer/provider runtime remain required. |

### Anti-Patterns Found

No blocking debt markers, empty implementations, raw-error dispatches, raw error rendering, or unintended changed paths were found in `5ae3984`. `OfflineCore.kt` is substantive rather than a thin façade; expanded Kotlin/Jest tests exercise deterministic controls and failure outcomes.

### Human Verification Required

1. **Focused Kotlin/JVM contract**

   **Test:** Install JDK 17 and run the exact named Gradle test in the table above.

   **Expected:** Kotlin compilation and all route, quota, persistence, repair, cancellation, deadline and provider contract tests pass.

   **Why human:** This host has no Java runtime; no APK or emulator action was used as a substitute.

2. **Android integration journey**

   **Test:** On an authorized emulator/device, download NetEase and Kugou, restart, play offline, corrupt/remove/cancel/retry entries, force a cache failure, and inspect Settings with touch/accessibility.

   **Expected:** Only verified cache files play; failure paths keep the queue transaction intact, use fixed recovery copy, and reveal no sensitive transport/location data.

   **Why human:** TrackPlayer, content-provider, provider-network and rendered accessibility behavior cannot be proven by source checks or Jest mocks.

### Gaps Summary

There are **no remaining code-level blockers** from the prior report. The final hardening commit substantively closes all four: redirect/host/deadline bounds, underreported-length quota enforcement, player error redaction, and Settings recovery mapping. The phase cannot be marked passed because the native Kotlin contract cannot run without JDK 17 and Android integration was intentionally outside the allowed verification commands.

---

_Verified: 2026-09-13T05:23:46Z_
_Verifier: the agent (gsd-verifier)_
