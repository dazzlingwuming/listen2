---
phase: 08-integrated-api-35-acceptance-release-like-evidence
plan: 03
subsystem: android-performance-validation
tags: [android, api26, api35, api36, instrumentation, recovery, performance, evidence]
requires:
  - phase: 08-02
    provides: sealed release-like candidate and API 35 journey baseline
provides:
  - self-contained Java AndroidTest performance/recovery runner and exact-sample summarizer
  - retained API 26/API 35/API 36 timing and recovery evidence bound to one sealed product APK
  - explicit non-pass record for unavailable live-provider/media and unproven playback soak
affects: [08-04-requirement-evidence-map, android-release-handoff]
actuals:
  tokens: 5435
  tasks: 2
  commits: 6
tech-stack:
  added: []
  patterns: [fixed-attempt performance distributions, fail-closed instrumentation parsing, sealed-evidence resume, serial-scoped AVD cleanup]
key-files:
  created:
    - mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/PerformanceRecoveryTest.java
    - mobile/scripts/acceptance/run-performance-recovery.sh
    - mobile/scripts/acceptance/summarize-performance.mjs
  modified:
    - mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/Phase08Instrumentation.java
key-decisions:
  - The API 35 measurement record is immutable; the interrupted window is retained as OPERATOR_INTERRUPTED and is excluded from all metrics.
  - A provider/media failure consumes its attempt and remains a non-pass; shell startup timings cannot stand in for live search or audio evidence.
  - A screen-off duration without active MediaSession, PlaybackState, and monotonic position proof is NOT_VERIFIED, not a playback-soak pass.
requirements-completed: []
coverage:
  - id: D1
    description: Exact 20-attempt cold-start distributions across API 26, API 35, and API 36.
    requirement: PERF-001
    verification:
      - kind: integration
        ref: evidence/phase08-20260915T215408Z-8ef8b015ceff/08-performance.json
        status: fail
    human_judgment: true
    rationale: API 36 p95 exceeds both cold-start budgets, so this cannot auto-pass.
  - id: D2
    description: API 35 first-search, first-audio, recovery, and ten-minute playback evidence.
    requirement: PERF-002
    verification:
      - kind: integration
        ref: evidence/phase08-20260915T215408Z-8ef8b015ceff/08-api35-performance.json
        status: fail
    human_judgment: true
    rationale: No authorized live provider/media sample was available and the soak has no MediaSession or advancing-position evidence.
  - id: D3
    description: Release-like candidate is preserved across explicit API 26/API 35/API 36 device runs.
    requirement: TEST-004
    verification:
      - kind: other
        ref: evidence/phase08-20260915T215408Z-8ef8b015ceff/08-performance.json
        status: pass
    human_judgment: false
duration: 1h 35m
completed: 2026-09-16
status: partial
---

# Phase 08 Plan 03: Performance and Recovery Summary

**A self-contained Java performance runner recorded fixed 20-attempt API 26/API 35/API 36 distributions against the unchanged sealed release-like APK, while retaining the genuine provider/audio and playback-soak gaps as NOT_VERIFIED.**

## Evidence Outcome

- Canonical performance run: `evidence/phase08-20260915T215408Z-8ef8b015ceff/`.
- Product was not rebuilt: `artifacts/releaseLike.apk` remains SHA-256 `b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b`.
- Sealed API 35 record: `08-api35-performance.json`, SHA-256 `68baee61de633496f71a91f090e956761062e295b542df4a18f8a208411a7e67`.
- Composed record: `08-performance.json`, SHA-256 `e4858cca1b1c4e91c2a31cbeed9b847fcb9c429a75c16226bf00ba1c5b132da9`; it passes the evidence schema and deliberately reports `NOT_VERIFIED`.
- The prior `phase08-20260915T214657Z-ebac48978787/` window is retained as `OPERATOR_INTERRUPTED.md` after an operator interruption during soak. Its partial records are immutable failure evidence and are not included in the results below.

## API Matrix

| Lane | Attempts | TTID p50 / p95 | TTFD p50 / p95 | Result |
| --- | ---: | --- | --- | --- |
| API 26 Google APIs arm64-v8a | 20/20 | 190 / 263 ms | 190 / 263 ms | PASS vs 3 s / 4 s budgets |
| API 35 Google APIs | 20/20 | 1341 / 1895 ms | 1341 / 1895 ms | PASS vs 3 s / 4 s budgets |
| API 36 Google APIs arm64-v8a | 20/20 | 2947 / 4567 ms | 2947 / 4567 ms | FAIL: p95 exceeds both budgets |

Both missing official system images were installed from the official SDK packages (`system-images;android-26;google_apis;arm64-v8a` and `system-images;android-36;google_apis;arm64-v8a`). Each lane used a unique run-owned AVD, explicit serial, exact product/test hashes, and cleanup record; no run-owned API 26/API 35/API 36 AVD remains.

## What the Evidence Does and Does Not Prove

- The runner preserves all 20 IDs and non-pass statuses, validates the product/test APK paths and hashes before device mutation, parses terminal instrumentation results fail-closed, captures process and network recovery diagnostics, and validates the evidence JSON.
- API 35 first-search and first-audio each retain 20 `FAIL` rows with `LIVE_PROVIDER_AND_MEDIA_NOT_AUTHORIZED`; no shell display timing was relabeled as a provider or audio success.
- Five API 35 process recovery cycles plus a network disable/restore cycle completed with captured resource/cleanup records.
- The API 35 screen-off interval naturally ran for 600 seconds, but no active MediaSession, PlaybackState, monotonic playback position, or post-interruption media recovery evidence exists. It is therefore `NOT_VERIFIED`, not a successful ten-minute playback soak.
- API 35 TTID and TTFD currently share the activity-start timing observation; they are not independent proof of interactive rendering completion. This limits the apparent passing timing rows.

## Local CI

The final source snapshot (before documentation only) passed:

- `npm run mobile:test` — 53 suites / 268 tests.
- `npm run mobile:typecheck`.
- `npm --prefix mobile run lint -- --quiet`.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools mobile/android/gradlew --offline --no-daemon -p mobile/android :app:testReleaseLikeUnitTest :app:assembleReleaseLikeAndroidTest`.
- `node mobile/scripts/acceptance/summarize-performance.mjs --self-test-exact-20`, `bash -n mobile/scripts/acceptance/run-performance-recovery.sh`, evidence-schema validation, and `git diff --check`.

## Task Commits

1. **Task 1: API 35 runner and self-contained Java scenario** — `e2fe64c`, `ba4e5a5`, `1db0bdd`, `35139c5`, `ebac489`, `8ef8b01`.
2. **Task 2: API 26/API 36 compatibility-only evidence** — no source commit; retained under the untracked canonical evidence root by design.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] Non-pass provider/audio rows could have inherited startup timings.**
   - **Fix:** Preserve the terminal non-pass status for those metric families and require all 20 rows to pass before a family can pass.
   - **Committed in:** `ba4e5a5`.

2. **[Rule 3 - Blocking] macOS Bash and instrumentation extras broke the portable runner.**
   - **Fix:** Removed Bash 4-only preflight use, deferred bounded sample expansion, accepted Android `Bundle` numeric strings, and used portable elapsed milliseconds.
   - **Committed in:** `1db0bdd`, `35139c5`, `ebac489`.

3. **[Rule 1 - Bug] An interrupted soak could be mistaken for completion.**
   - **Fix:** Persist runner/deadline metadata and require a live device through the full interval; the interrupted window is explicitly marked failed before the replacement window.
   - **Committed in:** `8ef8b01`.

### Evidence Limitations

- The plan’s live first-search/audio and generated-media playback proof did not become available without authorized provider/media access. These are recorded as failures or `NOT_VERIFIED`, not retried or fabricated.
- API 36 misses both cold-start p95 budgets. This is an observed failure, not a release-quality pass.
- The evidence schema carries its required candidate cleanliness field, but the shared worktree also has an unrelated user-owned `.planning/config.json` modification; no claim is made that the entire shared worktree was clean.

## Next Phase Readiness

The phase has reproducible tooling and schema-valid retained evidence, but it is not ready to claim performance/lifecycle parity or ship. A future authenticated, authorized-media run must prove real search/audio stages and MediaSession/position-based playback recovery; API 36 startup must be diagnosed and brought under budget before release acceptance.

## Self-Check: PASSED

- `08-performance.json` and `08-api35-performance.json` exist and validate under the evidence schema.
- The sealed product SHA matches before and after the three API lanes.
- Commits `e2fe64c`, `ba4e5a5`, `1db0bdd`, `35139c5`, `ebac489`, and `8ef8b01` exist on `agent/android-mobile-rebuild`.
