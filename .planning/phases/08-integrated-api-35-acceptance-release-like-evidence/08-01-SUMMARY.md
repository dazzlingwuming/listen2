---
phase: 08-integrated-api-35-acceptance-release-like-evidence
plan: 01
subsystem: release-validation
tags: [android, gradle, r8, apk, signing, evidence]
requires:
  - phase: 07-offline-advanced-playback
    provides: deterministic mobile source and JVM security gates
provides:
  - fail-closed release-like candidate and evidence harness
  - retained development-signed debug, release-like, and AndroidTest APK evidence
  - semantic reproducibility gate for APK Signature Scheme v2 nondeterminism
affects: [08-02 API 35 journey, 08-04 release handoff]
actuals:
  tokens: 14281
  tasks: 2
  commits: 5
tech-stack:
  added: []
  patterns: [canonical ZIP content comparison, signer-identity equivalence, contained redacted evidence]
key-files:
  created:
    - mobile/scripts/acceptance/reproducibility-gate.sh
    - mobile/scripts/acceptance/reproducibility-gate-fixture-apksigner.sh
  modified:
    - mobile/scripts/acceptance/build-release-like.sh
    - mobile/scripts/acceptance/verify-apk.sh
    - mobile/scripts/acceptance/evidence.mjs
key-decisions:
  - Raw APK SHA-256 differences inside the v2 signing block are diagnostic only when canonical ZIP metadata, entry content, verified signing schemes, signer certificate digest, and public-key digest all match.
  - The candidate record retains its actual build HEAD 7b163a4 rather than misrepresenting it as a later harness-only commit.
requirements-completed: []
coverage:
  - id: D1
    description: Development-signed minified release-like candidate passes artifact validation and semantic reproducibility checks.
    requirement: REL-002
    verification:
      - kind: integration
        ref: mobile/scripts/acceptance/reproducibility-gate.sh --self-test; verify-apk.sh retained APK
        status: pass
    human_judgment: false
  - id: D2
    description: The exact candidate, hashes, R8 mapping, and redacted build record are retained for the single API 35 journey.
    requirement: TEST-004
    verification:
      - kind: other
        ref: evidence/phase08-20260915T171829Z-7b163a471721/08-build.json
        status: pass
    human_judgment: true
    rationale: API 35 install, upgrade, and journey evidence remain owned by Plan 08-02.
duration: 27min
completed: 2026-09-15
status: complete
---

# Phase 08 Plan 01: Release-Like Candidate Foundation Summary

**A 67,106,878-byte R8-minified, development-signed release-like APK was built from 7b163a4 and sealed with semantic reproducibility, signing, alignment, manifest, R8, inventory, and secret-scan evidence.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-09-15T17:18:29Z
- **Completed:** 2026-09-15T17:45:00Z
- **Tasks:** 2/2
- **Files modified:** 13 source files; local run evidence retained separately

## Accomplishments

- Added the locked, fail-closed release-like build/evidence harness, toolchain and prerequisite checks, closed untracked-path validation, releaseLike configuration, APK verifier, and evidence schema/writer.
- Replaced raw-byte-only reproducibility failure with a stricter semantic gate: canonical ZIP metadata and each entry payload must match; `apksigner` must verify and signing scheme, certificate SHA-256, and public-key SHA-256 identities must match. Raw SHA differences remain recorded diagnostics.
- Sealed the one existing candidate run without rebuilding: debug APK `78cc1aafa7a5226ebb316fc744f3aaf278289982bb62528f443b89feb61484ff`, releaseLike APK `56ad3418e5df6379d523724ed3cbf66c28e4d21e6ce9fc366f44e332382a4c4b`, and releaseLikeAndroidTest APK `514f9c6ef293e3b09ebfcb494cf34c9607027f2bab86cdfb5f93395e213a5f03`.
- Verified the second releaseLike APK (`459b64f40088f4b8e659a72ca4708ec2b774eeb7e91fdeb8bef693a9509ec29c`) has matching canonical ZIP metadata/content and signer identity. Its only binary difference is the v2 signing block.

## Candidate Evidence

- **Run:** `.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence/phase08-20260915T171829Z-7b163a471721/`
- **Build HEAD:** `7b163a4717210412443828c1ebf1607bf5dc36ff` (the artifact-producing commit; later commits change only the harness).
- **ReleaseLike:** 67,106,878 bytes; v2 signing verified; certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; public key SHA-256 `06104aa0b28fac286bae06b08313ac69c37c35a6462853db32d2ec5fa7b1ed0e`.
- **APK checks:** Build Tools 37.0.0 `zipalign -c -P 16 4`, `apksigner verify`, manifest review, R8 mapping/usage/seeds, APK inventory and Phase 7 security scan all passed.
- **Evidence:** `08-prerequisites.json` and `08-build.json` validate under the closed redacted schema. APKs and diagnostics are deliberately local/untracked candidate evidence, not committed binaries.

## Local CI

At `2026-09-15T17:43:11Z`–`17:43:26Z` (Asia/Shanghai), on branch `agent/android-mobile-rebuild` at `439f8e3` before the final verifier correction commit:

- Phase 8 prerequisite, untracked-manifest, containment, evidence-validation, and reproducibility self-tests passed.
- `npm run mobile:test`: 52 suites / 263 tests passed.
- `npm run mobile:typecheck`, mobile ESLint, `git diff --check`, and `node mobile/scripts/verify-phase7-security.mjs` passed.
- `./gradlew --offline --no-daemon :app:testDebugUnitTest` passed. Existing AGP/KSP deprecation/version warnings remain external toolchain warnings; no source error occurred.

## Task Commits

1. **Task 1: Clean-tree acceptance harness** - `be48296`, `c251aea` (feature/fix)
2. **Task 2: Candidate build and provenance sealing** - `cfcf11e`, `439f8e3`, `ac3b78f` (fixes)

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] APK v2 signing makes raw bytes nondeterministic**
- **Found during:** Task 2.
- **Fix:** Added canonical ZIP metadata/content and signer-identity gate plus self-tests for content mutation, signing-block-only mutation, and signer mutation.
- **Verification:** Both retained releaseLike APKs pass the semantic gate; the two mutation cases fail.
- **Committed in:** `cfcf11e`.

2. **[Rule 1 - Bug] Evidence validation ignored `--validate FILE` values**
- **Found during:** Task 2 evidence sealing.
- **Fix:** Read the value-bearing argument correctly; the retained `08-build.json` now validates.
- **Committed in:** `439f8e3`.

3. **[Rule 1 - Bug] Retained APK verification was blocked by duplicate ZIP entries and implicit manifest defaults**
- **Found during:** Task 2 artifact re-validation.
- **Fix:** Use non-interactive overwrite extraction, reject only explicit `debuggable=true`, and permit an explicit retained R8 mapping directory.
- **Verification:** Full retained-artifact verifier passed.
- **Committed in:** `ac3b78f`.

**Total deviations:** 3 Rule 1 fixes. All were harness correctness fixes; no product source, signing authority, merge, deployment, or additional APK build was introduced.

## Next Phase Readiness

Plan 08-02 can install the retained debug baseline and releaseLike candidate once on an API 35 emulator for the data-preserving upgrade and integrated journey. This plan did not launch an emulator, use real credentials, change formal release signing, merge, or deploy.

## Self-Check: PASSED

- Candidate evidence record, artifacts, diagnostics, and R8 mapping files exist under the run root.
- Commits `be48296`, `c251aea`, `cfcf11e`, `439f8e3`, and `ac3b78f` exist and are pushed.
