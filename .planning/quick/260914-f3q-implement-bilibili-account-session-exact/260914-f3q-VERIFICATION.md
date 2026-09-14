---
phase: quick-260914-f3q-implement-bilibili-account-session-exact
verified: 2026-09-14T04:18:00Z
status: human_needed
score: 2/6 must-haves verified
behavior_unverified: 4
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 2/6
  gaps_closed:
    - "QR authentication now writes an owner-tagged provisional envelope, serializes generation validation/commit with cancellation, and promotes only the matching provisional envelope."
    - "Restore rejects and removes provisional envelopes rather than authenticating from them."
    - "Contract coverage now includes cancellation at the provisional-save boundary, restart rejection, committed restart restore, and newer-owner revocation safety."
    - "All SessionMaterial test fixtures retain Map<String, String> cookies and the FakeVault implements the revised Store API."
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "QR cancellation/persistence transition is correct at runtime."
    test: "Run BilibiliContractTest with JDK 17, including the named provisional-save cancellation and restart cases."
    expected: "Cancellation returns CANCELLED with no saved/restorable material; an un-cancelled session is committed and restores authenticated."
    why_human: "The focused tests are present and source-consistent, but this environment has no JDK and installation is out of scope."
  - truth: "The native fixed-route/WBI/refresh session path operates correctly against Android runtime services."
    test: "Run the named BilibiliContractTest class with JDK 17 and Android unit-test dependencies available."
    expected: "The class compiles and all policy/session tests pass."
    why_human: "Static source review cannot execute Kotlin/Android code."
  - truth: "Authenticated manifest selection and TrackPlayer handoff work on-device with account-entitled media."
    test: "On an emulator/device, log in with a permitted account, search a multipart Bilibili video, choose part 2, and play it."
    expected: "Only the exact CID is requested; a validated signed audio candidate is handed to TrackPlayer without cookies."
    why_human: "Requires an Android runtime, provider access, and user-supplied credentials; none were used."
  - truth: "QR cancellation disconnects active provider work and leaves no account after lifecycle interruption."
    test: "Begin a QR poll, cancel while provider work is in flight, force process recreation, then relaunch."
    expected: "The poll is disconnected, UI remains cancelled, and no provisional or committed cancelled session is restored."
    why_human: "Requires device lifecycle execution; no device/APK run was authorized."
human_verification:
  - test: "Compile and run mobile/android BilibiliContractTest with the project JDK."
    expected: "All existing and four new provisional/commit lifecycle cases pass."
    why_human: "JDK 17 is unavailable in this environment."
  - test: "Perform authenticated multipart playback and cancellation lifecycle on an Android emulator/device."
    expected: "Exact CID playback succeeds without credential headers; cancelled QR state cannot reappear after restart."
    why_human: "Requires prohibited APK/device/network/live credential evidence."
---

# Quick Task 260914-f3q Verification Report

**Task Goal:** Implement Bilibili account session, exact multipart selection, and authenticated audio manifest in the canonical React Native Android mobile app.
**Verified:** 2026-09-14T04:18:00Z
**Status:** human_needed
**Re-verification:** Yes — after `8ce07d1`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | QR account lifecycle is cancellable without persisting cancelled credentials or publishing authenticated state. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `BilibiliSession` now persists `provisional`, serializes cancel and promotion through `commitLock`, and `BilibiliVault.loadSession` rejects/removes provisional state. Focused boundary tests exist but could not run without JDK 17. |
| 2 | Search → explicitly selected second part uses the exact selected CID. | ✓ VERIFIED | The prior exact-CID provider/mobile wiring and explicit second-part test evidence are unchanged; `8ce07d1` only changes session/vault Kotlin files and their tests. |
| 3 | Native session restore and WBI signing use the fixed policy and fail closed. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The earlier encrypted vault/fixed-route/WBI/anonymous-nav/OAEP/Android-Base64 safeguards remain intact by targeted diff review; Kotlin execution is pending. |
| 4 | Audio handoff enforces signed deadline, approved host/path, MIME/codec/candidate constraints, TTL, and no credential headers. | ✓ VERIFIED | The prior validated source and JS contract evidence remain untouched by this commit. |
| 5 | Active provider cancellation disconnects poll work and logout/rollback do not leak session state. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Source retains active poll cancellation, owner-specific cleanup, and now makes uncommitted owned state non-restorable; device/lifecycle execution is pending. |
| 6 | Kotlin contract tests are type-consistent with `SessionMaterial.cookies: Map<String, String>` and the current Store API. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | All visible fixtures use `SESSION_COOKIES`/`mapOf`; all Store implementations/call sites use `saveProvisionalSession`, `commitProvisionalSession`, and `saveCommittedSession`. Compilation was not possible. |

**Score:** 2/6 truths verified (4 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliSession.kt` | Cancellable QR lifecycle and atomic promotion | ✓ SOURCE VERIFIED | `commitLock` orders cancellation against matching provisional promotion; state becomes public only after promotion. |
| `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliVault.kt` | Encrypted provisional/committed native storage | ✓ SOURCE VERIFIED | Envelopes carry a validated `state`; provisional requires an owner and `loadSession` removes/refuses it. |
| `mobile/android/app/src/test/java/com/listen2mobile/bilibili/BilibiliContractTest.kt` | Lifecycle boundary coverage | ⚠️ PRESENT | Contains save-boundary cancel/restart, provisional rejection, committed restore, newer-owner, and Map fixture cases; not executed. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `authenticatePollResult` | `BilibiliVault.saveProvisionalSession` | owned provisional write | WIRED | QR material is staged with its attempt owner before promotion. |
| `authenticatePollResult` | `BilibiliVault.commitProvisionalSession` | `commitLock` + active-generation check | WIRED | Only the matching, still-active owner may be promoted; cancellation participates in the same lock order. |
| `BilibiliVault.loadSession` | `BilibiliSession.restore` | envelope state gate | WIRED | Provisional material is cleared and returns `null`, yielding IDLE rather than authentication. |
| `BilibiliContractTest` | `BilibiliVault.SessionMaterial` / `Store` | current map/type and method contracts | PRESENT | `rg` found no obsolete `saveSession` calls or string cookie fixtures under `mobile/android`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Kotlin unit-test compilation/execution | Not run | JDK 17 unavailable; installation is prohibited. | SKIP |
| APK/emulator/session-provider flow | Not run | Build/device/network/credentials are out of scope. | SKIP |
| Targeted source integrity | `git diff --check def4d80..8ce07d1 -- <three target files>` | Exit 0. | PASS |
| Store/call-site migration | `rg 'saveSession|saveProvisionalSession|commitProvisionalSession|saveCommittedSession' mobile/android --glob '*.kt'` | No obsolete `saveSession` call; every visible Store implementation/call site uses the new API. | PASS |

### Data-Flow Trace

`poll()` captures one generation-bound attempt → `authenticatePollResult()` exports/validates account → `saveProvisionalSession(ownerId)` → `commitProvisionalSession(ownerId)` under the same cancellation ordering → public `AUTHENTICATED`. On process restart, `loadSession()` returns only `committed`; it erases a `provisional` envelope. A later owner replaces an older envelope, and `clearIfOwned(oldOwner)` compares the currently decoded owner before clearing.

### Prior Gap Closure Review

The previous source blocker is closed by the two-phase envelope protocol. The prior crash window now leaves only a provisional envelope; restart removes it rather than restoring credentials. The newly added contract cases directly model cancellation from the save hook, process restart, committed-session restart, and old-owner/new-owner ordering. Diff review confirms the remaining must-have source safeguards were not changed or regressed.

### Human Verification Required

### 1. Kotlin contract execution

**Test:** Run `BilibiliContractTest` in the project Android unit-test environment with JDK 17.

**Expected:** The new save-boundary cancellation, provisional rejection, committed restart, newer-owner, existing fixed-policy, and fixture cases compile and pass.

**Why human:** JDK 17 is unavailable and installing dependencies is prohibited.

### 2. Android QR and multipart playback lifecycle

**Test:** On an emulator/device with a permitted account, cancel QR during polling and process recreation; separately play an explicitly selected second Bilibili part.

**Expected:** Cancellation stays cancelled after relaunch with no restored account; exact CID audio plays through TrackPlayer without credential headers.

**Why human:** Requires APK/device execution, provider access, and live user credentials, all outside this verification scope.

### Gaps Summary

No remaining source-code gaps were found in the targeted re-verification. The overall result is `human_needed`, not `passed`, because Kotlin compilation and Android/device/live-provider behavior remain unexecuted.

_Verified: 2026-09-14T04:18:00Z_
_Verifier: gsd-verifier_
