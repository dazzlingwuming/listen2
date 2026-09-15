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
  - The authoritative candidate was rebuilt from its actual HEAD 54bc100 after the invalid-hook startup repair; the earlier 7b163a4 and 4c1f893 candidates are explicitly superseded and are not acceptance candidates.
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
        ref: evidence/phase08-20260915T192628Z-54bc100b79cf/08-build.json
        status: pass
    human_judgment: true
    rationale: API 35 install, upgrade, and journey evidence remain owned by Plan 08-02.
duration: 27min
completed: 2026-09-15
status: complete
---

# Phase 08 Plan 01: Release-Like Candidate Foundation Summary

**A 67,106,970-byte R8-minified, development-signed release-like APK was rebuilt from 54bc100 after the invalid-hook startup repair and sealed with signing-block-aware reproducibility, signing, alignment, manifest, R8, inventory, and secret-scan evidence.**

## Performance

- **Duration:** 1h 28min across the original harness work and candidate refresh
- **Started:** 2026-09-15T17:18:29Z
- **Completed:** 2026-09-15T19:36:00Z
- **Tasks:** 2/2
- **Files modified:** 14 source files; local run evidence retained separately

## Accomplishments

- Added the locked, fail-closed release-like build/evidence harness, toolchain and prerequisite checks, closed untracked-path validation, releaseLike configuration, APK verifier, and evidence schema/writer.
- Hardened reproducibility after audit: the gate parses the EOCD and APK Signing Block fail-closed, then requires byte-identical raw payload outside that complete block in addition to canonical ZIP metadata, entry payloads, `apksigner` verification, signing schemes, certificate SHA-256, and public-key SHA-256 identity. Its negative self-tests cover content, signer, local-header/compressed-byte/alignment, and malformed-signing-block mutations.
- Rebuilt the sole current candidate pair from `54bc100b79cff1a52c40dd823fd077f4ad0476c6`, which includes the invalid-hook startup repair (`0915d50`). The retained releaseLike APK is `b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b`; its clean repeat is `c176feb21b1f9ea486c342f0ff396b97de732b502c2b09571e120dcdd22d4ca2`.
- Classified the byte difference as `AGP_SDK_DEPENDENCY_METADATA_RANDOMIZED`: both releaseLike APKs have identical signing-block-stripped raw payload SHA-256 `4982a050d09f6b21370f48c12acfc3a77e7e54a1f8fe646465f8bde7f646f9bf`, canonical ZIP metadata, entry payloads, and signer identity.

## Candidate Evidence

- **Authoritative run:** `.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence/phase08-20260915T192628Z-54bc100b79cf/`
- **Build HEAD:** `54bc100b79cff1a52c40dd823fd077f4ad0476c6` (including invalid-hook startup repair `0915d50`).
- **ReleaseLike:** `artifacts/releaseLike.apk`; 67,106,970 bytes; SHA-256 `b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b`; v2 signing verified; signer identity SHA-256 `5841c1ac409f196a516cee13913818a866de0fa08ca243a5e0e133c48ccc61ad`.
- **ReleaseLike AndroidTest:** `artifacts/releaseLikeAndroidTest.apk`; 117,180 bytes; SHA-256 `b4472e73cf2750b2663069f6e664f53a3e73753889e933ea24a576f286c84845`.
- **Repeat releaseLike:** `reproducibility/releaseLike.apk`; SHA-256 `c176feb21b1f9ea486c342f0ff396b97de732b502c2b09571e120dcdd22d4ca2`; signing-block-stripped payload SHA-256 matches primary at `4982a050d09f6b21370f48c12acfc3a77e7e54a1f8fe646465f8bde7f646f9bf`; canonical ZIP metadata digest `385ba93af388411661d613881f77ad4e976d06f9de94ea30c72ec32e34c0a5da`; entry-content digest `f9f42b5a41b7b0c709d372c24ddbb8047093499b73c561e9998d327931e66feb`; classification `AGP_SDK_DEPENDENCY_METADATA_RANDOMIZED`.
- **APK checks:** Build Tools 37.0.0 `zipalign -c -P 16 4`, `apksigner verify`, manifest review, R8 mapping/usage/seeds, APK inventory and Phase 7 security scan all passed.
- **Evidence:** `08-prerequisites.json` and `08-build.json` validate under the closed redacted schema. APKs and diagnostics are deliberately local/untracked candidate evidence, not committed binaries. The prior `phase08-20260915T171829Z-7b163a471721` / `56ad…` and `phase08-20260915T183432Z-4c1f893dccb0` / `ca69…` runs are retained only as superseded historical evidence and must not be installed for acceptance.

## Local CI

Starting `2026-09-15T18:30:44Z` (Asia/Shanghai), in a clean worktree based on the startup-repaired product commit:

- `npm ci --prefix mobile`, Phase 8 prerequisite, untracked-manifest, containment, evidence-validation, and hardened reproducibility self-tests passed.
- `npm run mobile:test`: 52 suites / 263 tests passed.
- `npm run mobile:typecheck`, mobile ESLint, `git diff --check`, and `node mobile/scripts/verify-phase7-security.mjs` passed.
- `./gradlew --offline --no-daemon :app:testDebugUnitTest` passed. Existing AGP/KSP deprecation/version warnings remain external toolchain warnings; no source error occurred.
- The final documentation snapshot was re-gated at `2026-09-15T18:48:22Z`–`18:48:37Z`: the same 52 suites / 263 tests, typecheck, lint, diff check, Phase 7 scan, hardened self-test, and offline JVM gate passed.
- The invalid-hook candidate was fully re-gated from `2026-09-15T19:24:20Z`: locked `npm ci`, 53 suites / 264 tests, typecheck, lint, diff check, Phase 7 scan, hardened self-test, and offline JVM gate passed before the sole candidate pair was built.

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

Plan 08-02 can install the retained debug baseline and the authoritative `b3e0…` releaseLike candidate once on an API 35 emulator for the data-preserving upgrade and integrated journey. This plan did not launch an emulator, use real credentials, change formal release signing, merge, or deploy.

## Self-Check: PASSED

- Authoritative candidate evidence record, artifacts, diagnostics, and R8 mapping files exist under the current run root.
- Commits `be48296`, `c251aea`, `cfcf11e`, `439f8e3`, `ac3b78f`, and `4c1f893` exist and are pushed.
