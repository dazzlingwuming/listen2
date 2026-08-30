# Phase 02 API-35 deterministic evidence

Run the deterministic, installed-APK gate on one API-35 emulator:

```sh
ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools \
GRADLE_BIN=/tmp/listen2-ci.CBSD9n/gradle-8.10.2/bin/gradle \
ANDROID_SERIAL=emulator-5554 \
bash android/scripts/phase02-api35-smoke.sh --run-deterministic \
  --evidence .planning/phases/02-native-media3-playback-background-control/02-API35-EVIDENCE.md
```

The runner builds and signs the exact debug APK, executes the installed Media3
service/system-control classes, runs the Stage-A → force-stop/empty-PID →
relaunch → Stage-B recovery script, launches a cleared packaged WebView page,
and writes only allow-listed identity and bounded result fields.

`--verify-evidence PATH --allow-live-blocked` recomputes Git, APK, package, API
and emulator identity; it requires all deterministic markers and three PNG
screenshots. It rejects stale hashes, missing markers/screenshots, fixture/live
substitution, URLs/query values, candidates, headers, cookies, credentials,
provider bodies, raw exceptions, database rows and personal paths. Screenshot
PNG text chunks are rejected; screenshots are captured only after app-data clear
and document host/page context, while installed instrumentation proves the
native service, notification, queue and Room semantics.

The plain strict form (`--verify-evidence PATH`) intentionally exits nonzero
while `live-provider-media3` is blocked. The deterministic fixture cannot
complete Phase 2. The current live dependency is `BLOCKED — Phase 1 HTTP 412`;
only Plan 02-10 may replace that marker with exact authorized live evidence.

Bluetooth/AVRCP is not verified on the emulator. Restore one supported API-35
emulator and rerun the deterministic command for device failures. No merge,
release, signing credential, provider credential, or deployment operation is
performed by this gate.
