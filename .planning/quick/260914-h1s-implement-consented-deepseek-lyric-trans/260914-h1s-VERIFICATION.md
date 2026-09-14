---
phase: quick-260914-h1s-deepseek-lyric-translation
verified: 2026-09-14T05:20:05Z
status: human_needed
score: 1/7 must-haves verified
behavior_unverified: 6
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 0/7
  gaps_closed:
    - "Connection-test exception results now preserve operation: test."
    - "Private-cache validation now binds title and artist as prompt inputs."
    - "Mounted PlayerScreen tests now cover explicit no-auto-call, cache hit, consent-gated miss/force, cancellation, stale track change, and source restoration."
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "The native Kotlin contract compiles, is registered, and preserves the reviewed source behavior."
    test: "Run the focused Gradle DeepSeekContractTest with JDK 17."
    expected: "Kotlin compiles and the contract suite passes, including CR/LF handling, exact response parsing, operation-specific errors, cache identity, eviction, and cancellation."
    why_human: "JDK/Gradle execution is explicitly out of scope and was not run."
  - truth: "AndroidKeyStore custody and the protected native key-entry Activity keep plaintext outside JavaScript and runtime artifacts."
    test: "On an Android emulator/device, configure, test, clear, restart, and inspect permitted app surfaces and artifacts with a user-owned key."
    expected: "The non-exported FLAG_SECURE Activity is used; only safe status crosses RN; no key appears in RN inspector, Redux, AsyncStorage, backup, logcat, or APK/runtime artifacts."
    why_human: "Requires APK/device, a user key, and runtime inspection, all excluded here."
  - truth: "NetEase and QQ translate through the fixed native transport while Bilibili remains unavailable, and private cache behavior holds across real process/device boundaries."
    test: "Use timed NetEase and QQ lyrics, then Bilibili, exercising offline hit, miss, confirmation, force refresh, cancellation, track switch, and source restore."
    expected: "Only explicit NetEase/QQ requests translate; hit is offline; miss/refresh require confirmation; stale/cancelled work cannot apply; Bilibili shows unavailable and sends no DeepSeek request."
    why_human: "No emulator/device, live provider, or user key/network request was authorized."
  - truth: "A supplied wrong trackHash is rejected even when the request epoch has not changed."
    test: "Add or perform a focused controlled result test that returns a different trackHash before any track/epoch change."
    expected: "The UI leaves the current lyric/source translation untouched."
    why_human: "The passing Player test proves the track-change/epoch stale path, but its late result also changes epoch, so it does not independently execute the same-epoch hash-comparison branch."
human_verification:
  - test: "Run the focused Kotlin contract/build command under JDK 17."
    expected: "The reviewed native source compiles and DeepSeekContractTest passes."
    why_human: "This verification was prohibited from installing or running the unavailable JDK/Gradle environment."
  - test: "Perform the native key and provider acceptance flow on an emulator/device with a user-supplied key."
    expected: "Keystore/key-Activity confidentiality, fixed transport, NetEase/QQ behavior, cache, cancellation, and truthful Bilibili unavailability all hold at runtime without leakage."
    why_human: "APK, device, live key, live network, and log inspection were outside scope."
  - test: "Exercise a controlled same-epoch mismatched-result case."
    expected: "A result bearing another trackHash cannot replace the displayed lyric."
    why_human: "The current Player behavior suite covers stale work after track-change epoch invalidation, not this predicate independently."
---

# Quick 260914-h1s: Consented DeepSeek Lyric Translation Final Re-verification

**Goal:** Provide native-custodied, consented DeepSeek translation for timed NetEase/QQ lyrics while keeping Bilibili truthful and unavailable.

**Verified:** 2026-09-14T05:20:05Z
**Status:** human_needed
**Re-verification:** Yes — after `60ab03f` and `0c0f42d`

## Verdict

No remaining **source-code gap** was found. The two prior blockers are closed: `DeepSeekClient.test()` now carries `operation: "test"` through its exception mappings, and cache entries now persist and validate title/artist in addition to the model/version/fingerprint/target identity.

The Android/JDK/device claims cannot be promoted to verified without the excluded Kotlin and device paths. The Player component behavior is exercised in Jest, but the same-epoch wrong-hash branch is not independently executed; it remains an explicit human/test follow-up rather than a code blocker.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Native-only API-key custody and no JS/portable persistence | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `DeepSeekKeyActivity` is non-exported and sets `FLAG_SECURE`; `configure()` has no key argument; vault use is native; manifest disables backup; strict adapter/backup tests pass. Keystore/runtime leakage needs device evidence. |
| 2 | Narrow native-only fixed transport and semantic bridge | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Module allow-lists status/configure/test/delete/translate/cancel; policy fixes endpoint/model/prompt/four headers/bounds; no caller transport fields. Kotlin compilation/registration is unrun. |
| 3 | Six-consent explicit-only spend, cache hit, force refresh, cancellation, stale rejection, source restore | ✓ VERIFIED | Passing mounted `PlayerScreen` suite proves no render/play/hydration call; cache lookup is `allowNetwork:false`; six controls gate miss and force refresh; cancel fires on track change/unmount; source translation restores. |
| 4 | Bounded CR/LF timed LRC and exact safe aligned response | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Module permits only CR/LF controls for lyrics; policy validates bounds and exact ordered unique JSON line IDs with safe one-line output. Kotlin test is present but unrun. |
| 5 | Atomic private cache-first, full prompt identity, retention, and stale isolation | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Cache uses app-private `lyric-cache-v1`, fsync/rename, 64-entry/2-MiB eviction, version/model/prompt/target/title/artist checks, trackHash-bound filename/key. Native execution is unrun. |
| 6 | NetEase/QQ eligible; Bilibili/unsupported truthful unavailable | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Player eligibility is exactly NetEase/QQ + timed lyrics; provider contract test passes for QQ lyric route and Bilibili `LYRIC_UNAVAILABLE`. No real native/provider/device flow ran. |
| 7 | Stable, redacted native/JS test and error contract | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | JS adapter test passes for successful `test` and TIMEOUT/CANCELLED/PROVIDER_ERROR/MISSING_KEY/INVALID_KEY/RATE_LIMITED `operation:test` errors. Native exception mappings were source-reviewed but Kotlin was not run. |

**Score:** 1/7 truths verified; 6 present but behavior-unverified.

## Prior Blocker Closure

| Prior blocker | Final result |
| --- | --- |
| Test error DTO was emitted as `operation: translate` | **Closed.** `DeepSeekClient.test()` passes `"test"` into `execute`, and every exception result uses the supplied operation. Adapter tests accept the test DTO/error codes. |
| Cache identity omitted title/artist prompt inputs | **Closed.** Cache `Entry`, serialized payload, lookup, and `valid()` compare title and artist; the Kotlin contract source includes a changed-title miss assertion. |
| Player behavior was only claimed, not mounted/tested | **Closed for the listed Player flows.** `playerTranslationBehavior.test.tsx` mounts `PlayerScreen` and is executed by the passing full Jest suite. |

## Required Artifacts and Key Links

| Item | Status | Evidence |
| --- | --- | --- |
| `DeepSeekKeyActivity` and manifest | ⚠️ PRESENT | Password input is native, activity is non-exported and screenshot-protected, app backup remains disabled; device verification pending. |
| `DeepSeekModule` → `DeepSeekClient` | ⚠️ PRESENT | Exact `DeepSeekPolicy.Input` construction and declared client call are guarded by source-wiring Jest; Kotlin compiler evidence pending. |
| `DeepSeekPolicy` → fixed request/response contract | ⚠️ PRESENT | Fixed endpoint/model/prompt/four headers; CR/LF-only input and strict JSON response parser are substantive source. |
| `DeepSeekClient` → vault/cache | ⚠️ PRESENT | `withApiKey` is native-only; cache-first read/validated atomic write and operation-correct error paths are present. |
| Settings → strict TypeScript adapter | ✓ VERIFIED | Settings uses status/configure/test/delete safe projections only; adapter tests/typecheck pass. |
| Player → consent/client/state | ✓ VERIFIED | Actual mounted Player flow invokes the strict adapter only from explicit actions and verifies key UI state transitions. |
| Provider → lyric capabilities | ✓ VERIFIED | Existing API tests cover fixed NetEase/QQ lyric routes and Bilibili `LYRIC_UNAVAILABLE`; real Android transport remains human evidence. |

## Player Test Truthfulness

`mobile/src/screens/__tests__/playerTranslationBehavior.test.tsx` is not a helper-only test: it mounts the production `PlayerScreen` with mocked external boundaries. Its six passing tests cover:

- no DeepSeek call on render, playback, or lyric hydration;
- cache-only request with `allowNetwork:false`/`forceRefresh:false`, no consent modal, and source restore;
- cache miss followed by all six disclosures before network work;
- explicit retranslation followed by all six disclosures and `forceRefresh:true`;
- cancellation plus ignored late result after a track change; and
- cancellation on unmount.

The stale test is accurate for the epoch/cancel path. It does **not** independently prove the `expectedTrackHash === resultTrackHash` comparison because the test changes track/epoch before resolving the old-hash result. Source implementation has that comparison; the separate branch is retained as human/test evidence, not silently credited.

## Behavioral Checks Run

| Command | Result |
| --- | --- |
| `npm --prefix mobile test -- --runInBand` | PASS — 19 suites, 117 tests, including `playerTranslationBehavior.test.tsx`. |
| `npm run mobile:typecheck` | PASS. |
| Scoped `eslint` over DeepSeek/UI/test files | PASS — 0 errors; 4 existing Settings warnings. |
| Scoped `prettier --check` | PASS. |
| `git diff --check e40b477..HEAD` | PASS. |

Not run by instruction: JDK/Gradle Kotlin test, APK assembly, Metro/device/emulator, AndroidKeyStore/key Activity runtime, live key/provider/network, or log/artifact inspection.

## Anti-Patterns and Scope

No new `TBD`/`FIXME`/`XXX`, generic URL/header bridge, JavaScript plaintext-key input, DeepSeek Redux/AsyncStorage persistence, backup inclusion, or product edits outside `mobile/` were found in the reviewed quick-task commits. The workspace has pre-existing/unrelated planning artifacts and is otherwise preserved.

## Human Verification Required

### 1. Kotlin contract/build

**Test:** Run `cd mobile/android && ./gradlew --offline --no-daemon :app:testDebugUnitTest --tests 'com.listen2mobile.deepseek.DeepSeekContractTest'` under a usable JDK 17.

**Expected:** Native sources compile and the focused policy/vault/cache/client contract passes.

**Why human:** This verification was not authorized to install or run the unavailable JDK/Gradle environment.

### 2. Android confidential-key and provider acceptance

**Test:** With a user-owned key on an emulator/device, configure/test/clear/restart; run NetEase/QQ cache hit/miss/force/cancel/track-switch/restore flows; open Bilibili lyrics; inspect allowed diagnostics/storage artifacts.

**Expected:** No credential leaks; only explicit NetEase/QQ requests reach native transport; cache remains private/offline-first; Bilibili is unavailable without a call.

**Why human:** Requires prohibited APK/device/live key/network/logcat/artifact evidence.

### 3. Same-epoch mismatched hash

**Test:** Feed a completed translation result with another valid trackHash before changing the player track/epoch.

**Expected:** Translation is ignored and the existing source lyric remains visible.

**Why human:** The current passing Player test reaches stale rejection only after epoch invalidation, so it does not independently run the hash-only predicate.

---

_Verified: 2026-09-14T05:20:05Z_
_Verifier: gsd-verifier_
