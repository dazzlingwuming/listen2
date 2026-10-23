#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ANDROID_ROOT="$ROOT/android"
SDK_ROOT=${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}
ADB="$SDK_ROOT/platform-tools/adb"
GRADLE=${LISTEN2_GRADLE:-/tmp/listen2-ci.CBSD9n/gradle-8.10.2/bin/gradle}
PACKAGE=com.dazzlingwuming.listen2.debug
# Debug applicationId has a suffix, while the compiled Activity class remains
# in the production namespace; the relative form would resolve a non-existent
# com.dazzlingwuming.listen2.debug.MainActivity.
COMPONENT="$PACKAGE/com.dazzlingwuming.listen2.MainActivity"
TEST_CLASS=com.dazzlingwuming.listen2.PlaybackRecoveryInstrumentationTest
TEST_PACKAGE="$PACKAGE.test"
TEST_RUNNER=androidx.test.runner.AndroidJUnitRunner

[[ ${1:-} == --verify ]] || { echo "usage: $0 --verify" >&2; exit 64; }
[[ -x "$ADB" ]] || { echo "missing adb at $ADB" >&2; exit 69; }
[[ -x "$GRADLE" ]] || { echo "missing pinned Gradle at $GRADLE" >&2; exit 69; }
"$ADB" get-state | grep -qx device || { echo "API-35 emulator unavailable" >&2; exit 69; }

run_stage() {
  local method=$1
  "$ADB" shell am instrument -w -r -e class "$TEST_CLASS#$method" \
    "$TEST_PACKAGE/$TEST_RUNNER" | grep -q 'OK (1 test)'
}

(
  cd "$ANDROID_ROOT"
  "$GRADLE" --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest
)
"$ADB" install -r "$ANDROID_ROOT/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
"$ADB" install -r "$ANDROID_ROOT/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" >/dev/null
run_stage stageASeedsCommittedCheckpointAndDetachesRendererWithoutStoppingOwner
"$ADB" shell am force-stop "$PACKAGE"
for _ in $(seq 1 25); do
  [[ -z $("$ADB" shell pidof "$PACKAGE" | tr -d '\r') ]] && break
  sleep 0.2
done
[[ -z $("$ADB" shell pidof "$PACKAGE" | tr -d '\r') ]] || { echo "process survived force-stop" >&2; exit 70; }
"$ADB" shell am start -W -S -n "$COMPONENT" >/dev/null
"$ADB" shell pidof "$PACKAGE" | tr -d '\r' | grep -Eq '^[0-9]+( [0-9]+)*$' \
  || { echo "relaunch did not create application process" >&2; exit 71; }
run_stage stageBRestoresPausedExactSemanticCheckpointWithoutTransport
echo "PASS: Stage A/B process recovery restored only bounded playback semantics"
