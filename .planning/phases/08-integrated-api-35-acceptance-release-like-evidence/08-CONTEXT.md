# Phase 8 Context: Integrated API 35 Acceptance & Release-Like Evidence

## Phase Boundary

Phase 8 does not add another product-feature batch. It consumes the completed `mobile/` implementation from Phases 4–7, produces one installable integrated candidate, runs the complete device journey, measures the result, and issues an evidence-backed parity decision. Fast Jest/JVM checks remain prerequisites, but APK assembly and emulator acceptance happen here once, after functional implementation, rather than after every small feature.

## Decisions

- **D-01 — One integrated acceptance stage:** Build and device validation occur only after all Phase 4–7 functional plans and their deterministic gates are complete. Executors must not reintroduce a per-feature APK/build/emulator loop.

- **D-02 — Canonical Android product:** Only `mobile/` is built and installed. Legacy `android/`, Electron, and `app/listen1_chrome_extension/` are read-only historical references and cannot contribute packaged code or assets to the candidate.

- **D-03 — Two honest build variants:** Produce a normal debug APK for diagnostic/instrumentation coverage and a non-debuggable, R8-minified, resource-shrunk `releaseLike` APK signed only with the repository's standard development/debug key. The release-like artifact must be visibly named as development-signed and must not be described as a formally signed store release.

- **D-04 — Device matrix:** The complete integrated user journey runs exactly once on a recorded API 35 AVD. The current Gradle contract is validated as min API 24 / target API 36, and PERF-001 runs cold-start/interactive-shell lanes on API 26, API 35, and API 36. The official image is `system-images;android-<api>;google_apis;<abi>`, where `<abi>` is exactly `arm64-v8a` on an arm64 host and `x86_64` on an x86_64 host. A missing image is `BLOCKED` with its exact `sdkmanager` recovery command; the harness does not install it implicitly. AVD creation, image/ABI verification, serial binding, shutdown, and deletion of only run-created AVDs are recorded.

- **D-05 — Production routes remain production routes:** The API 35 journey uses the real packaged application and its bounded provider/native contracts. A fixed, sanitized fixture manifest supplies queries, expected semantic shapes, local synthetic audio/LRC, and recovery actions; it must not install a hidden mock provider, arbitrary URL bridge, caller header/cookie path, or release-only bypass.

- **D-06 — External truth is separate from deterministic proof:** Anonymous/public provider paths are exercised live with fixed queries and safe semantic assertions. The autonomous runner has no credential intake through command arguments, environment variables, files, clipboard, `adb input`, test extras, or fixtures. User-owned Bilibili/DeepSeek credentials may be entered only through the visible application UI into native secure storage, outside CLI automation and outside retained evidence. With no such authorized interaction, the fixed result is `NOT_VERIFIED`. `DEGRADED` is reserved for a live attempt that reached the external service/device and returned an actionable membership, region, provider, CDN, or codec limitation while the app remained usable. Neither status satisfies the affected requirement or `PARITY_READY`; deterministic fixtures never promote either to pass.

- **D-07 — One uninterrupted API 35 journey:** The recorded journey covers mobile layout; five-source search and truthful capability state; NetEase and Bilibili detail/play/lyrics; queue, library, history, local SAF/LRC, backup, cache/offline, MV/PiP, effects/loudness, DeepSeek consent/state, notification/background, rotation, network loss/recovery, process recovery, and safe external navigation. The only package-data reset occurs after installing debug and before `UpgradeSeedTest`; its result is recorded. After seeding, there is no second clear/reset/uninstall, candidate hash change, or release-like journey rerun.

- **D-08 — Performance sampling:** Use exactly 20 total attempts per required TTID/TTFD lane and exactly 20 total API 35 attempts for first-search and first-audio. Attempt IDs are immutable `01`–`20`; failure and timeout consume their slot and are never discarded, replaced, or retried to improve the denominator. Every attempt records a terminal duration/outcome; any non-pass attempt makes that metric family non-pass even when its nearest-rank p95 is within budget. Record TTID, TTFD, bridge dispatch, provider/network, and Media3-to-audible stages separately. The API 35 samples/recovery/ten-minute soak are sealed once; resumed work may consume their immutable hash but may run only the API 26/API 36 compatibility lanes.

- **D-09 — Exact evidence contract:** Every command result is written through one versioned, machine-validated evidence schema inside exactly one canonical `.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence/<runId>/` directory. Each record contains run/build/device/network/fixture/command/outcome/requirement/metric/artifact/uncovered/recovery fields, sanitized arguments and logs, timestamps with timezone, and hashes for every retained artifact. The writer resolves real paths and rejects absolute paths, `..`, symlinks, cross-run references, or any artifact outside the run root; only the final hash-verified APK/checksum handoff may be copied to ignored `dist/android/`. `PASS`, `FAIL`, `BLOCKED`, `DEGRADED`, and `NOT_VERIFIED` have the fixed meanings in `08-VALIDATION.md`.

- **D-10 — Final handoff and authority limit:** The final handoff includes the development-signed release-like APK, SHA-256, certificate digest, install command, evidence index, known gaps, and rollback/recovery instructions. Phase 8 does not configure or consume formal release credentials, merge, deploy, publish, create a GitHub release, or claim store readiness.

## The Agent's Discretion

- Exact AVD names, shell helper decomposition, and screenshot filenames, provided all recorded device settings are restored or cleanup instructions are retained.
- Exact implementation of the dependency-free evidence writer and p95 calculator, provided invalid/missing/duplicate records fail closed.
- Exact fixed public queries and semantic match rules, provided the fixture manifest is sanitized, versioned, deterministic within the run, and cannot weaken provider security policy.
- Exact synthetic audio waveform and LRC text, provided they are generated locally, contain no copyrighted media, have recorded hashes, and exercise at least ten minutes of playback.

## Deferred Ideas

None. Formal signing, merge, deployment, publication, and store submission are excluded by the project authorization boundary rather than deferred Phase 8 work.
