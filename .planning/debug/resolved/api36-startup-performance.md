# Debug Session: API 36 startup performance

## Status

resolved

## Trigger

Phase 08 measured API 36 cold-start host elapsed p95 at 4567 ms, exceeding the TTID and TTFD budgets, but the harness recorded the same host-wrapped `am start -W` elapsed for both metrics and lacked a real interactive UI marker.

## Symptoms

- Expected: target/API 36 process-cold startup meets TTID <= 3000 ms and TTFD <= 4000 ms under a reproducible measurement contract.
- Actual: 20 API 36 host elapsed samples have p50 2947 ms and p95 4567 ms; device `TotalTime` p95 is 3696 ms and `WaitTime` p95 is 3907 ms.
- Comparison: API 35 host p95 1895 ms; API 26 host p95 263 ms (suspiciously low and lacking LaunchState).
- Candidate: releaseLike SHA-256 `b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b`.
- Evidence: Phase 08 run `phase08-20260915T215408Z-8ef8b015ceff` and Luna audit.

## Constraints

- Do not relax thresholds, discard failures, or call host elapsed a true TTID/TTFD.
- Progressively measure 3-5 API 35 controls and API 36 samples before any product optimization.
- Confirm force-stop PID disappearance and record animation, boot idle, thermal, CPU/I/O and ART/profile state.
- Record device `TotalTime`/`WaitTime` separately and a real phone-shell interactive accessibility marker.
- Add stage markers or product changes only if the small sample identifies a concrete bottleneck; any product change requires a new Phase 08 candidate later.
- Preserve the sealed candidate and all prior evidence; no credential use.

## Current Focus

- Hypothesis: API 36 slowdown is a mixture of host ADB overhead and a product/platform startup path dominated by React bundle evaluation, native package initialization, or the pre-navigation LibraryBootGate.
- Test: build a corrected measurement probe around the existing candidate, run 3-5 API 35 and API 36 process-cold samples, and attribute time with existing logs/accessibility before adding minimal markers.
- Expecting: distinguish harness inflation from a specific product stage; either identify an optimization target or prove the remaining variance is platform/environment.
- Next action: Phase 08 must create the test-only payload for `d5c2bdd` and collect API35/API36 three-attempt controls before any product-stage attribution.

## Evidence Log

- timestamp: 2026-09-16 Asia/Shanghai — 20-sample API 36 host p95 4567 ms; device TotalTime p95 3696 ms; device WaitTime p95 3907 ms.
- timestamp: 2026-09-16 Asia/Shanghai — Existing Phase 08 labels TTID and TTFD from the same host elapsed and lacks a real interactive marker.
- timestamp: 2026-09-16 Asia/Shanghai — `d5c2bdd` adds a test-only three/five-attempt startup probe: host force-stop plus PID absence, Activity Manager `TotalTime`/`WaitTime`, and phone-shell accessibility readiness are distinct bounded fields.
- timestamp: 2026-09-16 Asia/Shanghai — static runner/summary checks, 53 Jest suites (268 tests), TypeScript, ESLint, Phase 7 security scan, and `:app:compileReleaseLikeAndroidTestJavaWithJavac` passed; no APK was assembled or installed in this debug session.

## Resolution

- Root cause: the Phase 08 runner treated host-side wall time around `adb shell am start -W` as both TTID and TTFD, while device `TotalTime`/`WaitTime` stayed only in raw files and the accessibility-shell check happened outside individual cold samples.
- Fix: `d5c2bdd` preserves the immutable 20-attempt paths and adds an isolated startup-probe path. Each retained API 35/36 probe row requires a force-stop PID absence, `LaunchState: COLD`, device `TotalTime` for TTID, device-monotonic visible `搜索`/`我的` readiness for TTFD, and diagnostic-only host elapsed time. It records boot settle, animation scales, thermal, ART/profile, CPU, and I/O snapshots.
- Verification: compile and source-level checks passed. Runtime evidence remains pending: a Phase 08 controlled run must create a fresh AndroidTest-only payload for this commit, then execute API 35 and API 36 sequentially with three retained samples each against the unchanged `b3e06e…629865b` product candidate. No product bottleneck or product optimization is established by this session.
