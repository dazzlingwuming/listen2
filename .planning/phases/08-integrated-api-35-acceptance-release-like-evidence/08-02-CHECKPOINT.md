# Phase 08 Plan 02 — Failed Candidate Checkpoint

**Status: FAILED CANDIDATE — stop before any second install, package-data reset, or integrated journey.**

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
