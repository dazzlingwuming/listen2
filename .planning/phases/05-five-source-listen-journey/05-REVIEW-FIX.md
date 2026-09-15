---
phase: 05-five-source-listen-journey
fixed_at: 2026-09-15T14:19:12+08:00
review_path: .planning/phases/05-five-source-listen-journey/05-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
verification_environment: current checkout at c495c55
---

# Phase 05: Code Review Fix Report

**Fixed:** 2026-09-15
**Source review:** `.planning/phases/05-five-source-listen-journey/05-REVIEW.md`
**Source verification:** `.planning/phases/05-five-source-listen-journey/05-VERIFICATION.md`
**Status:** `all_fixed`

## Summary

The latest Phase-05 re-review is **CLEAN**, and all four findings in its scope
are fixed. No finding was skipped. The fixes are recorded in commits
`326e545`, `76831a4`, and `c495c55`.

## Findings and fixes

### CR-07 — superseded `playTracks` selection could reach RNTP first

- **Finding:** A later `playTracks` selection could be queued behind an earlier
  native resolution, allowing the superseded selection to reset, add, or play
  in RNTP first.
- **Fix:** `PlayerController.playTracks` now calls `beginTransition` before
  entering the serialized native-mutation queue and passes the captured
  `AbortSignal` into the queued operation. A newer selection therefore aborts
  the stale resolution before it can mutate RNTP.
- **Tests:** `playerController.test.ts` proves Bilibili part A is aborted and
  only part B reaches RNTP; `bilibiliFlow.test.tsx` covers the rendered
  two-button detail flow and the same stale-selection guarantee.
- **Commit:** `326e545` — `fix(05): abort superseded multi-track playback`

### WR-01 — fractional native contract versions were truncated

- **Finding:** Parsing bridge versions with `.toInt()` could accept fractional
  values such as `1.5` as contract version `1`.
- **Fix:** QQ and Kuwo now use exact `Double` equality through
  `isContractVersion` in both `resolveAudio` and `cancel` request parsing.
- **Tests:** `QqPlaybackContractTest` and `KuwoPlaybackContractTest` accept
  `1.0` and reject `1.5`, `1.999`, and `NaN` before resolver transport starts.
- **Commit:** `76831a4` — `fix(05): reject fractional native playback versions`

### WR-02 — rejected native cancel could be unhandled

- **Finding:** A rejected native `cancel` promise on the abort path could
  become an unhandled rejection even though the local operation was already
  cancelled.
- **Fix:** The abort path now consumes a failed native cancellation promise
  while preserving the local typed `CANCELLED` result immediately.
- **Tests:** `client.test.ts` uses a cancellation bridge that rejects and
  verifies the caller still receives `CANCELLED`, with the correlated cancel
  request issued once.
- **Commit:** `c495c55` — `fix(05): harden native resolver cancellation and readiness`

### WR-03 — readiness accepted a broadened host set

- **Finding:** The JavaScript readiness gate accepted extra, duplicate, or
  provider-swapped native hosts, broadening the endpoint contract.
- **Fix:** Native readiness now requires the exact duplicate-free expected host
  set for each provider before QQ or Kuwo playback is exposed.
- **Tests:** `client.test.ts` rejects QQ extra/duplicate hosts, Kuwo
  extra/duplicate hosts, and swapped QQ/Kuwo host lists.
- **Commit:** `c495c55` — `fix(05): harden native resolver cancellation and readiness`

## Verification evidence

- `npm run mobile:test` — **PASS**, 34 Jest suites / 226 tests.
- `npm run mobile:typecheck` — **PASS**.
- `npm --prefix mobile run lint -- --quiet` — **PASS**.
- Offline JVM full suite — **PASS**, `:app:testDebugUnitTest` completed
  successfully with 151 actionable Gradle tasks.
- `git diff --check 636407b..c495c55 -- mobile` — **PASS**.
- This report: `git diff --check -- .planning/phases/05-five-source-listen-journey/05-REVIEW-FIX.md` — **PASS**.

## Phase 8 acceptance boundary

The deterministic code and contract gates above do not verify the following,
which remain Phase-08 work:

- APK assembly/installation, Android API-35 behavior, or emulator acceptance;
- live provider routes, CDN reachability/redirects, codecs, account login,
  entitlement, DRM, or region behavior;
- audible media playback and the real notification, background, audio-focus,
  headset/Bluetooth, and process-recovery runtime.

The clean review and 5/5 deterministic verification therefore close the
Phase-05 findings without making a live-provider or device-parity claim.

---

_Fix record: the agent_
_Status: all_fixed_
