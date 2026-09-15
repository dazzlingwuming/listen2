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
  - signing-block-aware semantic and raw-payload reproducibility gate
affects: [08-02 API 35 journey, 08-04 release handoff]
actuals:
  tokens: 16572
  tasks: 2
  commits: 6
tech-stack:
  added: []
  patterns: [canonical ZIP content comparison, signing-block-stripped raw payload comparison, signer-identity equivalence, contained redacted evidence]
key-files:
  created:
    - mobile/scripts/acceptance/reproducibility-gate.sh
    - mobile/scripts/acceptance/reproducibility-gate-fixture-apksigner.sh
  modified:
    - mobile/scripts/acceptance/build-release-like.sh
    - mobile/scripts/acceptance/verify-apk.sh
    - mobile/scripts/acceptance/evidence.mjs
key-decisions:
  - Raw APK SHA-256 differences are diagnostic only when parsed signing-block-stripped raw payload, canonical ZIP metadata, entry content, verified signing schemes, signer certificate digest, and public-key digest all match.
  - The authoritative candidate was rebuilt from its actual HEAD 4c1f893 after the RNTP startup repair; the earlier 7b163a4 candidate is explicitly superseded and is not an acceptance candidate.
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
        ref: evidence/phase08-20260915T183432Z-4c1f893dccb0/08-build.json
        status: pass
    human_judgment: true
    rationale: API 35 install, upgrade, and journey evidence remain owned by Plan 08-02.
duration: 27min
completed: 2026-09-15
status: complete
---

# Phase 08 Plan 01: Release-Like Candidate Foundation Summary

**A 67,106,878-byte R8-minified, development-signed release-like APK was rebuilt from 4c1f893 after the RNTP startup repair and sealed with signing-block-aware reproducibility, signing, alignment, manifest, R8, inventory, and secret-scan evidence.**

## Performance

- **Duration:** 1h 28min across the original harness work and candidate refresh
- **Started:** 2026-09-15T17:18:29Z
- **Completed:** 2026-09-15T18:45:27Z
- **Tasks:** 2/2
- **Files modified:** 14 source files; local run evidence retained separately

## Accomplishments

- Added the locked, fail-closed release-like build/evidence harness, toolchain and prerequisite checks, closed untracked-path validation, releaseLike configuration, APK verifier, and evidence schema/writer.
- Hardened reproducibility after audit: the gate parses the EOCD and APK Signing Block fail-closed, then requires byte-identical raw payload outside that complete block in addition to canonical ZIP metadata, entry payloads, `apksigner` verification, signing schemes, certificate SHA-256, and public-key SHA-256 identity. Its negative self-tests cover content, signer, local-header/compressed-byte/alignment, and malformed-signing-block mutations.
- Rebuilt the sole current candidate pair from `4c1f893dccb0d19dff1daf56aa7e6a395ba781d9`, which includes the RNTP startup repair (`43b17fb`). The retained releaseLike APK is `ca69cfa161ca8622641f047e6e6fffc08f1db6b5b3f129c5181266926d1cfe24`; its clean repeat is `2c10bf18cf28394ea73972c9e60e4f18da35ec43208e53d033cd2bae5f1d7d66`.
- Classified the byte difference as `AGP_SDK_DEPENDENCY_METADATA_RANDOMIZED`: both releaseLike APKs have identical signing-block-stripped raw payload SHA-256 `6ec6254272fb79f2a9dfc4a1237b93c5fef0dc71f3799b9205e896a67f591162`, canonical ZIP metadata, entry payloads, and signer identity.

## Candidate Evidence

- **Authoritative run:** `.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence/phase08-20260915T183432Z-4c1f893dccb0/`
- **Build HEAD:** `4c1f893dccb0d19dff1daf56aa7e6a395ba781d9` (including RNTP startup repair `43b17fb`).
- **ReleaseLike:** `artifacts/releaseLike.apk`; 67,106,878 bytes; SHA-256 `ca69cfa161ca8622641f047e6e6fffc08f1db6b5b3f129c5181266926d1cfe24`; v2 signing verified; signer identity SHA-256 `5841c1ac409f196a516cee13913818a866de0fa08ca243a5e0e133c48ccc61ad`.
- **Repeat releaseLike:** `reproducibility/releaseLike.apk`; SHA-256 `2c10bf18cf28394ea73972c9e60e4f18da35ec43208e53d033cd2bae5f1d7d66`; signing-block-stripped payload SHA-256 matches primary at `6ec6254272fb79f2a9dfc4a1237b93c5fef0dc71f3799b9205e896a67f591162`; classification `AGP_SDK_DEPENDENCY_METADATA_RANDOMIZED`.
- **APK checks:** Build Tools 37.0.0 `zipalign -c -P 16 4`, `apksigner verify`, manifest review, R8 mapping/usage/seeds, APK inventory and Phase 7 security scan all passed.
- **Evidence:** `08-prerequisites.json` and `08-build.json` validate under the closed redacted schema. APKs and diagnostics are deliberately local/untracked candidate evidence, not committed binaries. The prior `phase08-20260915T171829Z-7b163a471721` / `56ad…` run is retained only as superseded historical evidence and must not be installed for acceptance.

## Local CI

Starting `2026-09-15T18:30:44Z` (Asia/Shanghai), in a clean worktree based on the startup-repaired product commit:

- `npm ci --prefix mobile`, Phase 8 prerequisite, untracked-manifest, containment, evidence-validation, and hardened reproducibility self-tests passed.
- `npm run mobile:test`: 52 suites / 263 tests passed.
- `npm run mobile:typecheck`, mobile ESLint, `git diff --check`, and `node mobile/scripts/verify-phase7-security.mjs` passed.
- `./gradlew --offline --no-daemon :app:testDebugUnitTest` passed. Existing AGP/KSP deprecation/version warnings remain external toolchain warnings; no source error occurred.
- The final documentation snapshot was re-gated at `2026-09-15T18:48:22Z`–`18:48:37Z`: the same 52 suites / 263 tests, typecheck, lint, diff check, Phase 7 scan, hardened self-test, and offline JVM gate passed.

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

2. **[Rule 1 - Bug] Semantic ZIP comparison did not detect local-header or alignment byte drift outside the signing block**
- **Found during:** Task 2 audit follow-up.
- **Fix:** Parse and remove only a structurally valid complete APK Signing Block, compare all remaining raw bytes, and fail closed for malformed EOCD/Zip64/signing-block structures. Both comparison APKs now receive the full artifact verifier before equivalence is accepted.
- **Verification:** Hardened self-tests reject payload, signer, local-header, alignment, and malformed-block changes; the newly rebuilt pair passes with an identical stripped digest.
- **Committed in:** `4c1f893`.

3. **[Rule 1 - Bug] Evidence validation ignored `--validate FILE` values**
- **Found during:** Task 2 evidence sealing.
- **Fix:** Read the value-bearing argument correctly; the retained `08-build.json` now validates.
- **Committed in:** `439f8e3`.

4. **[Rule 1 - Bug] Retained APK verification was blocked by duplicate ZIP entries and implicit manifest defaults**
- **Found during:** Task 2 artifact re-validation.
- **Fix:** Use non-interactive overwrite extraction, reject only explicit `debuggable=true`, and permit an explicit retained R8 mapping directory.
- **Verification:** Full retained-artifact verifier passed.
- **Committed in:** `ac3b78f`.

**Total deviations:** 4 Rule 1 fixes. All were harness correctness fixes; no product source, signing authority, merge, or deployment was introduced. One integrated replacement candidate pair was authorized and built only because the product startup repair changed the binary.

## Next Phase Readiness

Plan 08-02 can install the retained debug baseline and the authoritative `ca69…` releaseLike candidate once on an API 35 emulator for the data-preserving upgrade and integrated journey. This plan did not launch an emulator, use real credentials, change formal release signing, merge, or deploy.

## Self-Check: PASSED

- Authoritative candidate evidence record, artifacts, diagnostics, and R8 mapping files exist under the current run root.
- Commits `be48296`, `c251aea`, `cfcf11e`, `439f8e3`, `ac3b78f`, and `4c1f893` exist and are pushed.
