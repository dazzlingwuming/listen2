---
phase: 07-offline-advanced-playback
plan: 05
subsystem: security
tags: [android-backup, entitlement, offline-cache, jest, kotlin, security-scanner]
requires:
  - phase: 07-02
    provides: Owner-aware native offline cache and player resolver
  - phase: 07-03
    provides: Optional native audio-effects bridge
provides:
  - Fail-closed cross-provider stale-account entitlement coverage
  - Backup exclusions and redacting source/artifact scanner
  - Deterministic Phase 7 source and JVM acceptance evidence
affects: [08-integrated-api-35-acceptance-release-like-evidence]
actuals:
  tokens: 34577
  tasks: 2
  commits: 2
tech-stack:
  added: [dependency-free Node security scanner]
  patterns: [redacted canary findings, semantic-only native cache adapter]
key-files:
  created:
    - mobile/scripts/verify-phase7-security.mjs
    - mobile/android/app/src/main/res/xml/backup_rules.xml
    - mobile/android/app/src/main/res/xml/data_extraction_rules.xml
  modified:
    - mobile/android/app/src/main/AndroidManifest.xml
    - mobile/src/offline/offlineAudio.ts
    - mobile/android/app/src/test/java/com/listen2mobile/security/Phase7EntitlementMatrixTest.kt
key-decisions:
  - "System backup remains disabled and explicit legacy plus Android 12+ exclusion resources defend private cache, database, preference, and file state."
  - "The scanner reports only stable classification and relative path; it never prints a matching canary or secret value."
  - "APK extraction, runtime logs, and device backup behavior are Phase 8 evidence, not inferred from source or JVM tests."
patterns-established:
  - "Privileged media fixtures use current account generation and assert zero downstream transport calls after denial."
  - "JS cache adapters use only semantic native methods and normalize legacy transfer status to transferring."
requirements-completed: [PLAY-002, CACHE-001, CACHE-002, CACHE-003, CACHE-004, FX-001, FX-002, FX-003, AI-001, AI-002, AI-003, SEC-004]
coverage:
  - id: D1
    description: Cross-provider stale-account media access is denied before transport.
    requirement: SEC-004
    verification:
      - kind: unit
        ref: mobile/android/app/src/test/java/com/listen2mobile/security/Phase7EntitlementMatrixTest.kt
        status: pass
    human_judgment: false
  - id: D2
    description: Backup policy and source/artifact canaries are redacted and reject unsafe contracts.
    requirement: SEC-004
    verification:
      - kind: integration
        ref: cd mobile && npm run verify:phase7-security
        status: pass
      - kind: unit
        ref: mobile/src/security/__tests__/phase7Security.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Device backup extraction, unpacked APK, and runtime logs contain no sensitive material.
    requirement: SEC-004
    verification: []
    human_judgment: true
    rationale: Phase 8 must inspect an actual API 35 device/emulator and unpacked release-like artifact.
duration: 90min
completed: 2026-09-15
status: complete
---

# Phase 7 Plan 05: Security Closure Summary

**Fail-closed entitlement coverage, private Android backup policy, and a redacting canary scanner close Phase 7's deterministic SEC-004 boundary.**

## Performance

- **Duration:** 90 min
- **Completed:** 2026-09-15
- **Tasks:** 2/2
- **Files modified:** 17 product/test files plus this summary

## Accomplishments

- Added stale-account entitlement denial coverage across Bilibili, NetEase, Kugou, QQ, and Kuwo; denied leases never reach transport.
- Disabled backup defensively with explicit legacy and Android 12+ backup/data-extraction exclusions for all private app state.
- Added a dependency-free scanner for source, copied assets, test/log snapshots, and an optional Phase 8 unpacked-artifact path. Canary findings are category/path-only.
- Repaired cache-first playback, optional audio-effect module access, native contract fixtures, and retired download-slice test wiring exposed by the full integration gate.

## Task Commits

1. **Task 1: Deny one stale-account cached rendition across every privileged path** — `b78e07f` (test)
2. **Task 2: Enforce backup/artifact/log secrecy and run the complete fast gate** — `89cde32` (feat)

## Verification

Passed on `agent/android-mobile-rebuild` at `89cde32` with Node 24.15.0, OpenJDK 17, and the locally cached Android SDK:

```text
cd mobile && npm run verify:phase7-security && npm test -- --runInBand && ./node_modules/.bin/tsc --noEmit && npm run lint && cd .. && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH ./mobile/android/gradlew --offline --no-daemon -p mobile/android :app:testDebugUnitTest
```

Result: security scan passed; Jest 52 suites/258 tests passed; TypeScript passed; ESLint exited 0 with 76 pre-existing warnings; JVM suite passed. No APK assembly, emulator/device, live provider, credentials, signing, or deployment was used.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added Android 12+ data-extraction resource alongside the legacy full-backup resource.**
- **Found during:** Task 2
- **Issue:** One XML schema cannot validly serve both `fullBackupContent` and `dataExtractionRules` on every supported Android version.
- **Fix:** Added separate schema-valid `data_extraction_rules.xml` and wired both manifest attributes while preserving `allowBackup=false`.
- **Committed in:** `89cde32`

**2. [Rule 1 - Integration] Repaired stale JavaScript cache/effects/test contracts found by the full gate.**
- **Found during:** Task 2
- **Issue:** Old download-slice test imports, `resolveVerified` versus `resolveReady`, missing optional `NativeModules` handling, transfer status vocabulary, and DeepSeek fixture assertions no longer matched the native semantic surface.
- **Fix:** Replaced the retired Redux test path, restored semantic invalidation, made optional modules null-safe, and aligned fixtures with the current descriptor/prompt contracts.
- **Committed in:** `89cde32`

## Known Stubs

None.

## Next Phase Readiness

Phase 8 must inspect a real API 35 emulator/device, runtime logs, backup extraction, and a release-like unpacked APK using the scanner's optional artifact-path argument. Those checks remain not verified here by design.

## Self-Check: PASSED

- Task commits `b78e07f` and `89cde32` exist locally and on the tracked remote branch.
- Backup rules, scanner, security test, and entitlement matrix files exist.
