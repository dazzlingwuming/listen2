# Phase 01 API-35 evidence

The non-substitutable live gate is:

```sh
ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools \
GRADLE_BIN=/tmp/listen2-ci.CBSD9n/gradle-8.10.2/bin/gradle \
ANDROID_SERIAL=emulator-5554 \
bash android/scripts/phase01-api35-smoke.sh --run \
  --evidence .planning/phases/01-verified-bilibili-startup-slice/01-API35-EVIDENCE.md
```

`--prepare` verifies one selected API-35 emulator and WebView provider. `--wave0-verify`, unit tests, instrumentation, APK assembly, and signature verification are deterministic/host checks, not proof of live Bilibili playback. `--self-test` rejects bad device selection and redaction canaries. `--verify-evidence PATH` recomputes current Git/APK/device identity and rejects incomplete or substituted pass records.

Allowed evidence is limited to timestamp/timezone, Git/APK SHA-256, package/variant, API/ABI/WebView/network labels, selected public BVID/CID/part, approved timings/terminal markers, and screenshot names. It never stores provider bodies, URL query values, signed candidates, headers, cookies, credentials, storage, raw exceptions, or personal paths. The CDP client serializes only fixed state/timing/geometry/bounded-ID fields.

If an AVD, provider, CDN, codec, or network prerequisite fails, preserve `BLOCKED / not verified`; the verifier exits nonzero. Restore the prerequisite and rerun from `--prepare`. The runner removes its ADB forward and restores temporary font/rotation settings on exit. Delete `android/app/build/` to remove generated build reports.
