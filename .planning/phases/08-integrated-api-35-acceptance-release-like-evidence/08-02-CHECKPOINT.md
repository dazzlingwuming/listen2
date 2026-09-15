# Phase 08 Plan 02 — Failed Candidate Checkpoint

**Status: TWO FAILED CANDIDATES — stop before any additional install, package-data reset, seed, or integrated journey.**

## Replacement candidate failure: `ca69cfa1…d1cfe24`

The RNTP-fixed replacement run is `phase08-20260915T183432Z-4c1f893dccb0`. Its sealed `artifacts/releaseLike.apk` is exactly 67,106,878 bytes, SHA-256 `ca69cfa161ca8622641f047e6e6fffc08f1db6b5b3f129c5181266926d1cfe24`, built at `4c1f893dccb0d19dff1daf56aa7e6a395ba781d9`.

Its AndroidTest-only payload is separately sealed at SHA-256 `2ef74e87b76b2f485c4bf6a20d4376ea25abb17190e0a74e62e2c6e65289d17c`, test-source HEAD `3d1efa0`, signer certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. `apkanalyzer` confirmed `UpgradeSeedTest`, `IntegratedJourneyTest`, and the foreground-capture driver; its target package/version is `com.dazzlingwuming.listen2` / `1000001`.

On `sdk_gphone64_arm64` API 35 / `arm64-v8a`, the retained debug baseline was installed, the one permitted `pm clear com.dazzlingwuming.listen2` returned `Success`, and `UpgradeSeedTest` was invoked once. The Android instrumentation process returned zero even though `TestRunner` reported `AssertionError`; this false-positive is now fixed in the runner but was not rerun for this candidate.

The exact replacement product was then installed in place (installed metadata: version code `1000001`, version name `2.34.0-android`). The mandatory pre-instrumentation launch smoke failed: the app reached `Running "Listen2Mobile"`, then React reported `Invalid hook call. Hooks can only be called inside of the body of a function component`, followed by `JavascriptException`, `FATAL EXCEPTION: mqt_v_native`, and forced finishing of `MainActivity`. The foreground returned to Launcher. `IntegratedJourneyTest` was never launched.

Retained failure evidence under that run root: `reset.txt`, `journey-events.txt`, generated fixture hashes, `journey-test-payload.json`, `installed-releaseLike-package.txt`, `installed-releaseLike-path.txt`, full sanitized `release-ui-smoke-logcat.txt`, and `release-ui-smoke-window.xml` / `release-ui-smoke-phone.png`. The latter screenshot and window dump are invalid failure evidence (Launcher), not a mobile UI pass. Animation/font/rotation cleanup ran when the runner exited. No later clear, uninstall, candidate substitution, or journey was performed.

This candidate is **SUPERSEDED / FAIL**. A future candidate needs both a product fix for the invalid hook-call crash and a fresh sealed product hash; it must then use the corrected host instrumentation parser for one new API 35 sequence.

## Exact tested product

- Run: `phase08-20260915T171829Z-7b163a471721`
- Product: `artifacts/releaseLike.apk`
- Bytes: `67,106,878`
- SHA-256: `56ad3418e5df6379d523724ed3cbf66c28e4d21e6ce9fc366f44e332382a4c4b`
- Installed API 35 package: `com.dazzlingwuming.listen2`, version code `1000001`, version name `2.34.0-android`.
- Device: `sdk_gphone64_arm64`, API 35, arm64-v8a.

## What ran exactly once

1. Installed the retained debug baseline.
2. Ran the sole `pm clear com.dazzlingwuming.listen2`; `reset.txt` records success.
3. Installed the sealed AndroidTest-only payload (`9cbf8673aefbb5d6fcc3b043d5739903641be9baf86f7ce62096b395317c097f`) after confirming `UpgradeSeedTest` and `IntegratedJourneyTest` in DEX.
4. Ran `UpgradeSeedTest` once.
5. Installed the exact retained releaseLike product APK in place.
6. Ran `IntegratedJourneyTest` once.

No later clear, uninstall, releaseLike rebuild, or second integrated journey was performed. Device animation, font-scale, and rotation settings were restored.

## Why this candidate fails

The two instrumentation commands returned exit code 0, but that result is a false-positive acceptance signal: it did not establish that the releaseLike product remained runnable after the test activity lifecycle ended.

An authorized non-mutating recovery probe then used only `am force-stop` and explicit launcher start. The app immediately crashed and the foreground window returned to Launcher. The retained `recovery-window.xml` reports the Launcher package; `journey-recovery-phone.png` is intentionally retained as invalid failure evidence, not as a UI pass screenshot.

Relevant sanitized logcat failure:

```text
JavascriptException: [runtime not ready]: Error: Exception in HostObject::get for prop 'TrackPlayerModule'
TurboModuleInteropUtils$ParsingException: Unable to parse @ReactMethod annotations from native module: TrackPlayerModule.
TurboModule system assumes returnType == void iff the method is synchronous.
ActivityTaskManager: Force finishing activity com.dazzlingwuming.listen2/com.listen2mobile.MainActivity
ActivityManager: Process com.dazzlingwuming.listen2 has died
```

This is a releaseLike React Native / TrackPlayer native-module compatibility defect, not an external provider or credential limitation.

## Preserved evidence

- `08-journey.json` — schema-valid original journey record; its `NOT_VERIFIED` credential outcome is superseded by this stronger runtime `FAIL` checkpoint.
- `reset.txt`, `journey-events.txt`, `fixture.json`, generated WAV/LRC hashes, separate AndroidTest payload metadata and hash.
- `journey-phone.png` — invalid launcher screenshot after test completion.
- `journey-recovery-phone.png` and `recovery-window.xml` — failure evidence showing the app did not become foreground after direct launch.

## Required next action

Fix the TrackPlayer TurboModule compatibility issue in product source, create a replacement releaseLike product candidate with a new hash, then conduct one new final API 35 acceptance journey against that replacement. Do not reuse this candidate as `PARITY_READY`.
