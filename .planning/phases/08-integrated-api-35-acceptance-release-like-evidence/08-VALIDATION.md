# Phase 8 Validation Strategy

## Sequence

Phase 8 is deliberately serial: after a fail-closed Phase 4–7 prerequisite check, the candidate artifact is built once, that exact hash is exercised by the API 35 journey, performance/recovery consumes the same hash, and only then may the evidence finalizer issue a verdict. All four plans resolve the same current-HEAD run directory; no plan writes a second candidate or top-level evidence file.

| Plan | Gate | Requirements |
|---|---|---|
| 08-01 | Truthful Phase 4–7 prerequisite gate; portable lock/cache/toolchain preflight; reproducible debug + minified release-like app and AndroidTest APKs; R8/manifest/alignment/signature/hash/secret gates | REL-001, REL-002, TEST-004 |
| 08-02 | One recorded API 35 install/upgrade and integrated UI/native/system journey using production routes plus sanitized fixture data | TEST-002, TEST-003, TEST-004, REL-002 |
| 08-03 | API 26/API 35/API 36 cold-start matrix, API 35 search/audio p95, low-memory/network/process recovery, resource report and ten-minute soak | PERF-001, PERF-002, PERF-003, TEST-004 |
| 08-04 | Schema validation, 58-requirement evidence reachability, final status, artifact handoff and rollback instructions | REL-003, TEST-004 |

## Machine-Readable Evidence Schema

Plan 08-01 creates `mobile/scripts/acceptance/evidence-schema.json`. It creates one `evidence/<runId>/` root after prerequisite validation and writes `08-prerequisites.json`, `08-build.json`, `08-journey.json`, `08-api35-performance.json`, `08-performance.json`, and `08-evidence-index.json` only inside that root. Every retained JSON record is an object with `additionalProperties: false` and these required fields:

| Field | Exact shape |
|---|---|
| `schemaVersion` | Literal `1` |
| `runId` | `phase08-YYYYMMDDTHHMMSSZ-<12 hex git prefix>` |
| `recordId` | Unique bounded ASCII identifier |
| `recordedAt` | RFC 3339 timestamp with offset |
| `git` | `{branch, sha, trackedClean, allowedUntracked[]}`; no diff contents |
| `toolchain` | `{os, arch, node, npm, java, gradle, agp, kotlin, androidHomeHash, buildTools, compileSdk, targetSdk, minSdk, ndk}` |
| `build` | `{variant, applicationId, versionCode, versionName, apkRelativePath, bytes, sha256, signerSha256, zipAligned16KiB, minified, debuggable}` |
| `device` | `{serialHash, avdName, image, apiLevel, abi, ramMiB, cores, resolution, density, locale, fontScale, navigationMode}` |
| `network` | `{mode, transport, offlineWindows[], proxyConfigured}`; no SSID/IP/provider URL |
| `fixture` | `{id, revision, manifestSha256, queryIds[], generatedMediaSha256, accountLane}` |
| `command` | `{id, argvRedacted[], startedAt, endedAt, timezone, exitCode}` |
| `outcome` | One of `PASS`, `FAIL`, `BLOCKED`, `DEGRADED`, `NOT_VERIFIED` |
| `requirements` | Non-empty unique array of exact requirement IDs |
| `metrics` | Array of `{name, unit, samples, p50, p95, max, budget, status}`; non-performance records use `[]` |
| `artifacts` | Array of `{kind, relativePath, sha256, bytes, sanitized}`; `relativePath` is run-root-relative, canonical, contains no `..`, and resolves under the same run root without traversing a symlink |
| `uncovered` | Array of `{requirement, reasonCode, safeDetail, ownerAction}` |
| `recovery` | `{cleanupStatus, deviceStateRestored, rollbackArtifactSha256, steps[]}` |

The writer canonicalizes the phase evidence root and run root with `realpath`, rejects a run ID not matching the schema, and opens retained artifacts only after verifying each path component is not a symlink and the final canonical path remains contained by that run root. It rejects secrets in field values, absolute paths, `..`, cross-run paths, raw URLs/query strings, cookies/headers/tokens, provider response bodies, QR images, full lyric/model payloads, unknown keys, unknown requirement IDs, duplicate IDs, missing hashes, end-before-start timestamps, and `PASS` metrics over budget. The final ignored `dist/android` APK/checksum are copy-by-hash handoff outputs and are indexed by digest, never treated as evidence-root members.

## Performance Budgets

| Metric | Sample rule | Passing budget |
|---|---|---|
| API 26, API 35 and API 36 TTID | Exactly 20 total cold-launch attempts per API | p95 ≤ 3000 ms and all 20 attempts `PASS` |
| API 26, API 35 and API 36 TTFD | Exactly 20 total cold-launch attempts per API | p95 ≤ 4000 ms and all 20 attempts `PASS` |
| API 35 first matching search result | Exactly 20 total fixed-query attempts | p95 ≤ 5000 ms and all 20 attempts `PASS` |
| API 35 first advancing audio | Exactly 20 total fixed semantic-selection attempts | p95 ≤ 6000 ms and all 20 attempts `PASS` |
| Process recovery position | At least 5 kills at measured positions | absolute error ≤ 3000 ms each |
| Soak | One continuous ten-minute fixture playback | zero ANR/crash; no duplicate request/history/queue mutation |

Attempt IDs are exactly `01` through `20`. A failure or timeout consumes its numbered attempt, records the observed terminal/timeout duration, remains in the 20-attempt denominator, is not replaced, and makes the family non-pass. Nearest-rank p95 is still computed from the 20 durations so the raw distribution remains auditable. Bridge/network/Media3 sub-stages are always recorded even when only the end-to-end budget is normative. Memory, CPU, battery estimate and UID traffic samples are reported without inventing pass thresholds not defined by requirements.

## Required Command Families

- Prerequisite gate: verify Phase 4–7 plan/SUMMARY counts, truthful ROADMAP/checkmarks, assigned requirement-ID inventory, current-HEAD commit/path reachability, clean reviews, passed/complete verification, and no Phase 7 gap. The final 58-row evidence reducer, not Markdown checkbox state, owns requirement completion.
- Worktree/toolchain/input gate: literal `git diff --quiet` and `git diff --cached --quiet` before npm and before Gradle; every untracked row must match the closed, containment-validated Phase 8 planning/evidence manifest; portable JDK 17 and Android SDK resolution; required SDK/Build Tools program/version checks; `npm cache verify`; `npm ci --prefix mobile`; unchanged `mobile/package-lock.json`/patches; offline Gradle dependency resolution. Any tracked difference, unlisted untracked path, or missing tool/cache/image is `BLOCKED` with a safe recovery action.
- Source/build gate: `npm run mobile:test`, `npm run mobile:typecheck`, `npm --prefix mobile run lint -- --quiet`, `git diff --check`, Phase 7 scanner, JVM tests, `:app:compileReleaseLikeAndroidTestKotlin`, `:app:assembleDebug`, `:app:assembleReleaseLike`, and `:app:assembleReleaseLikeAndroidTest`; then repeat app assembly for candidate reproducibility.
- Runtime gate: the host runner requires an explicit API 35 serial, verifies API/AVD/ABI, installs debug, performs and records the sole package-data reset, installs the black-box releaseLike AndroidTest APK, runs only `UpgradeSeedTest`, executes `adb -s <serial> install -r <same-releaseLike.apk>`, verifies the same test APK remains installed, and runs only `com.listen2mobile.acceptance.IntegratedJourneyTest` with `com.dazzlingwuming.listen2.test/androidx.test.runner.AndroidJUnitRunner`. No later clear/uninstall/hash change, implicit device, Gradle connected task, or second journey is permitted.
- Compatibility gate: require installed `system-images;android-{26,35,36};google_apis;<host-abi>` images, create/verify uniquely named AVDs, read and re-hash both releaseLike app and releaseLikeAndroidTest from same-run build evidence, install both on each explicit API 26/API 36 serial, invoke only `PerformanceRecoveryTest#compatibilityColdStart`, restore state, stop launched emulator PIDs, and delete only run-created AVDs.
- Final gate: consume `08-REQUIREMENT-EVIDENCE-MAP.md`, validate all 58 current-HEAD implementation/evidence-kind links, recheck artifact hash/signature, validate install dry-run, and generate the human-readable report.

## Failure and Recovery Rules

- `PASS`: the claimed behavior and every required evidence kind completed successfully on the current HEAD/candidate.
- `FAIL`: the app, build, test, security, budget, cleanup, or evidence contract was exercised and violated; deterministic failures stop later device work.
- `BLOCKED`: an execution prerequisite outside the tested behavior is absent (for example a required SDK tool/cache/system image/device); it records the exact safe recovery action and is never converted to source-test pass.
- `NOT_VERIFIED`: a required credential-controlled/external behavior was not exercised because secure user-owned credential input or other required authority was absent. It cannot satisfy the requirement or parity.
- `DEGRADED`: a live attempt reached the provider/device and returned an actionable entitlement, membership, region, provider, CDN, or codec limitation while the app preserved its supported fallback. It cannot satisfy a requirement that promises the unavailable behavior or parity.
- Provider outage before a reliable service response is `DEGRADED` only when the app surfaced an actionable external-availability state; otherwise a broken app error contract is `FAIL`. No credential may enter via CLI, environment, fixture, file, clipboard, `adb input`, or test extra.
- Device/SDK/tool absence is `BLOCKED`, with the exact safe recovery action. It is not converted to a pass by source tests.
- Every script restores network, animation/font/rotation/TalkBack settings and screen state through an installed trap. If cleanup fails, the run outcome cannot be `PASS` until the recovery steps are executed and recorded.

## Resume Contract

`08-api35-performance.json` is finalized atomically after exactly one API 35 metrics/recovery/soak execution and stores its own SHA-256 in the run manifest. Resume validates schema, current HEAD, run ID, candidate/fixture hash, exact attempt IDs, and file hash, then opens it read-only. The only allowed resumed command is `--compatibility-only --api 26 --api 36`; it cannot start an API 35 AVD, add/replace API 35 samples, rerun recovery/soak, rebuild, or reinstall a different APK.

## Multi-Source Coverage Audit

| Source | ID | Feature/requirement | Plan | Status |
|---|---|---|---|---|
| GOAL | — | Install one integrated build, reproduce complete journeys, inspect measured performance/release-like gates, decide parity honestly | 08-01–08-04 | COVERED |
| REQ | PERF-001 | API 26/current-target cold start TTID/TTFD | 08-03 | COVERED |
| REQ | PERF-002 | Search/audio p95 plus stage/resource measurements | 08-03 | COVERED |
| REQ | PERF-003 | Low-memory recovery and ten-minute no-ANR run | 08-03 | COVERED |
| REQ | TEST-002 | Integrated native/storage/media instrumentation | 08-02 | COVERED |
| REQ | TEST-003 | API 35 complete emulator E2E | 08-02 | COVERED |
| REQ | TEST-004 | Reproducible, accessible, redacted evidence | 08-01–08-04 | COVERED |
| REQ | REL-001 | Reproducible debug/minified release-like build | 08-01 | COVERED |
| REQ | REL-002 | Manifest/network/version/alignment/signature/hash/secret gates | 08-01 | COVERED |
| REQ | REL-003 | All-58 evidence-backed parity decision | 08-04 | COVERED |
| RESEARCH | R-01 | Development-signed release-like variant; formal release stays unsigned | 08-01 | COVERED |
| RESEARCH | R-02 | Production-route fixture plus secure visible in-app credential boundary and truthful absence | 08-02 | COVERED |
| RESEARCH | R-03 | Black-box system/performance measurement | 08-03 | COVERED |
| RESEARCH | R-04 | Fail-closed evidence finalizer and cleanup/rollback | 08-04 | COVERED |
| CONTEXT | D-01 | Single post-feature acceptance stage | 08-01 | COVERED |
| CONTEXT | D-02 | Canonical `mobile/` only | 08-01, 08-04 | COVERED |
| CONTEXT | D-03 | Debug plus honest minified release-like candidate | 08-01 | COVERED |
| CONTEXT | D-04 | API 35 full journey plus explicit API 26/API 36 compatibility | 08-02, 08-03 | COVERED |
| CONTEXT | D-05 | No hidden provider or security bypass | 08-02 | COVERED |
| CONTEXT | D-06 | External outcomes remain truthful | 08-02, 08-04 | COVERED |
| CONTEXT | D-07 | One uninterrupted integrated journey | 08-02 | COVERED |
| CONTEXT | D-08 | Fixed p95 and soak sampling | 08-03 | COVERED |
| CONTEXT | D-09 | Exact machine-readable evidence contract | 08-01, 08-04 | COVERED |
| CONTEXT | D-10 | Artifact/hash/install/rollback handoff; no release action | 08-04 | COVERED |

No source item is unplanned.
