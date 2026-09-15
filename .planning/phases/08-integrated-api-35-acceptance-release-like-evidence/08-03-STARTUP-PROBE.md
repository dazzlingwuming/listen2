# Phase 08 corrected startup probe — 2026-09-16

## Candidate and probe boundary

- Product candidate: `releaseLike.apk`, SHA-256 `b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b`.
- Canonical sealed source: `evidence/phase08-20260915T212857Z-b68a0b2396a5/artifacts/releaseLike.apk`.
- Probe-only `releaseLikeAndroidTest` payload: SHA-256 `e5960a1f4e4d1a22ba50ce26cd9a41dd85178e57eac07496e78c0ee0528da4e5`; v2 signer verified; application ID `com.dazzlingwuming.listen2.test`; acceptance classes present; no Kotlin or AndroidX runner dependency in the probe class.
- No product APK was rebuilt or modified.

The original probe ran an Android instrumentation class before `am start -W`. That attaches to the target package, changing its process state, so its subsequent start cannot establish `LaunchState: COLD`. The corrected runner instead does the following for every sample:

1. force-stop and wait for target PID disappearance;
2. capture device-monotonic `/proc/uptime`;
3. run direct `am start -W`, requiring `Status: ok` and `LaunchState: COLD`, then parse `TotalTime` and `WaitTime`;
4. use external system UiAutomator only to poll visible `搜索` and `我的` shell labels, then derive a conservative TTFD from the device monotonic clock.

Host-side elapsed time is retained as diagnostics only. The startup AndroidTest APK is verified but not launched by this path, because target instrumentation would invalidate the cold start.

## Retained samples

| API / image | Evidence root | Attempts | Device TTID (`TotalTime`) p95 | Device visible-shell TTFD p95 | Result |
| --- | --- | ---: | ---: | ---: | --- |
| 35 / Google APIs arm64-v8a | `phase08-20260916T081000Z-d5c2bdd-probe` | 3/3 COLD | 1149 ms | 4350 ms | TTID pass; TTFD conservative upper bound fails 4 s budget |
| 36 / Google APIs arm64-v8a | `phase08-20260916T084000Z-d5c2bdd-api36-probe` | 3/3 COLD | 6012 ms | 11300 ms | fail |

API 36 raw device `TotalTime` values are 3043, 6012 and 2440 ms. This p95 failure is independent of host ADB latency and does not justify a product optimization without stage attribution.

The UiAutomator polling operation itself has latency, so its device-monotonic TTFD is a visible, conservative upper bound rather than an isolated renderer-completion marker. It remains a failure against the fixed budget; it must not be relabeled as a pass.

## Environment and cleanup

- Both images were official installed `google_apis;arm64-v8a` images, run sequentially on explicit serials.
- The API 36 run-created AVD and emulator were shut down and deleted after capture.
- Pre-existing failed/partial probe roots (`phase08-20260916T070500Z-d5c2bdd-probe`, `phase08-20260916T073000Z-d5c2bdd-probe`, and the interrupted API 36 lane in `phase08-20260916T081000Z-d5c2bdd-probe`) are retained unchanged; they contribute no successful samples.

## Next action

Do not change startup product code speculatively. If performance work continues, first add narrowly scoped, privacy-safe native/RN/bootstrap stage markers to attribute API 36 `TotalTime` before selecting an optimization.
