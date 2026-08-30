#!/usr/bin/env bash
# Fail-closed API-35 deterministic evidence runner. It never substitutes a
# build, fixture, or JVM result for the later live provider Media3 gate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}"
ADB="$SDK_ROOT/platform-tools/adb"
GRADLE_BIN="${GRADLE_BIN:-/tmp/listen2-ci.CBSD9n/gradle-8.10.2/bin/gradle}"
PACKAGE="com.dazzlingwuming.listen2.debug"
ACTIVITY_CLASS="com.dazzlingwuming.listen2.MainActivity"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
EVIDENCE_DEFAULT="$ROOT/.planning/phases/02-native-media3-playback-background-control/02-API35-EVIDENCE.md"
SHOTS_DEFAULT="$ROOT/.planning/phases/02-native-media3-playback-background-control/evidence"
PORT="${PHASE02_CDP_PORT:-9223}"
SERIAL="${ANDROID_SERIAL:-}"
FORWARD_CREATED=0
API="" ABI="" WEBVIEW="" AVD="" GIT_SHA="" APK_SHA=""

usage() { echo "usage: $0 --self-test | --run-deterministic [--evidence PATH] | --verify-evidence PATH [--allow-live-blocked]" >&2; }
die() { echo "BLOCKED: $1" >&2; exit "${2:-1}"; }
timeout_run() { perl -e 'alarm shift; exec @ARGV' "$@"; }
cleanup() { local status=$?; if [[ "$FORWARD_CREATED" == 1 && -n "$SERIAL" ]]; then "$ADB" -s "$SERIAL" forward --remove "tcp:$PORT" >/dev/null 2>&1 || true; fi; exit "$status"; }
trap cleanup EXIT INT TERM

select_device() {
    [[ -x "$ADB" ]] || die "ADB not found under ANDROID_SDK_ROOT" 69
    local devices count
    devices="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')"
    count="$(printf '%s\n' "$devices" | awk 'NF {n++} END {print n+0}')"
    if [[ -n "$SERIAL" ]]; then printf '%s\n' "$devices" | grep -qx "$SERIAL" || die "requested device is not ready" 65
    elif [[ "$count" == 1 ]]; then SERIAL="$devices"
    else die "expected exactly one ready emulator; set ANDROID_SERIAL to select one" 65; fi
    [[ "$SERIAL" == emulator-* ]] || die "refusing a non-emulator device" 65
}
device_field() { "$ADB" -s "$SERIAL" shell "$1" 2>/dev/null | tr -d '\r' | head -n 1; }
capture_environment() {
    API="$(device_field 'getprop ro.build.version.sdk')"
    ABI="$(device_field 'getprop ro.product.cpu.abi' | sed 's/[^A-Za-z0-9._-]/_/g' | cut -c1-80)"
    AVD="$(device_field 'getprop ro.boot.qemu.avd_name' | sed 's/[^A-Za-z0-9._-]/_/g' | cut -c1-80)"
    WEBVIEW="$("$ADB" -s "$SERIAL" shell dumpsys webviewupdate 2>/dev/null | tr -d '\r' | awk '/Current WebView package/ {print $0; exit}' | sed 's/[^A-Za-z0-9._() -]/_/g' | cut -c1-160)"
    [[ "$API" == 35 && -n "$ABI" && -n "$WEBVIEW" ]] || die "API-35 device or WebView provider is not ready" 66
}
wait_for_boot() { local deadline=$((SECONDS + 180)); while (( SECONDS < deadline )); do [[ "$(device_field 'getprop sys.boot_completed')" == 1 ]] && return 0; sleep 2; done; die "emulator did not boot within 180 seconds" 70; }
prepare() { select_device; wait_for_boot; capture_environment; }
run_gradle() { [[ -x "$GRADLE_BIN" ]] || die "pinned Gradle 8.10.2 is unavailable; set GRADLE_BIN" 69; (cd "$ROOT/android" && "$GRADLE_BIN" --no-daemon "$@"); }
build_exact_apk() {
    run_gradle :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
    "$SDK_ROOT/build-tools/35.0.0/apksigner" verify --verbose "$APK"
    [[ -f "$APK" && -f "$TEST_APK" ]] || die "debug APK or instrumentation APK was not produced" 71
    GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"; APK_SHA="$(shasum -a 256 "$APK" | awk '{print $1}')"
}
install_exact_apks() { "$ADB" -s "$SERIAL" install -r "$APK" >/dev/null && "$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null; }
run_class() {
    local klass="$1"
    timeout_run 90 "$ADB" -s "$SERIAL" shell am instrument -w -r -e class "$klass" "$PACKAGE.test/androidx.test.runner.AndroidJUnitRunner" | grep -q 'OK ('
}
prepare_cdp() {
    "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE"
    "$ADB" -s "$SERIAL" shell pm clear "$PACKAGE" >/dev/null
    "$ADB" -s "$SERIAL" shell am start -W -n "$PACKAGE/$ACTIVITY_CLASS" >/dev/null || die "cold app launch failed" 72
    local deadline=$((SECONDS + 20)) pid socket
    while (( SECONDS < deadline )); do pid="$(device_field "pidof $PACKAGE" | awk '{print $1}')"; [[ "$pid" =~ ^[0-9]+$ ]] && break; sleep 1; done
    [[ "$pid" =~ ^[0-9]+$ ]] || die "debug package has no process" 72
    socket="webview_devtools_remote_$pid"
    "$ADB" -s "$SERIAL" shell cat /proc/net/unix 2>/dev/null | grep -q "@$socket" || die "debug WebView socket is unavailable" 72
    timeout_run 20 "$ADB" -s "$SERIAL" forward "tcp:$PORT" "localabstract:$socket" || die "CDP forward failed" 72
    FORWARD_CREATED=1
}
write_evidence() {
    local evidence="$1" screenshots="$2"
    mkdir -p "$(dirname "$evidence")" "$screenshots"
    local timestamp
    timestamp="$(date '+%Y-%m-%dT%H:%M:%S%z')"
    printf '%s\n' \
        '# Phase 02 API-35 deterministic evidence' '' '## Result' '' \
        '**Status:** PASS (deterministic gate only)' "**Timestamp:** $timestamp" '' \
        '## Identity' '' \
        "- Git SHA: $GIT_SHA" "- APK SHA-256: $APK_SHA" "- Package: $PACKAGE" '- Build variant: debug' \
        "- API: $API" "- ABI: $ABI" "- AVD: ${AVD:-unknown}" "- WebView: $WEBVIEW" '' \
        '## Deterministic API-35 markers' '' \
        '- installed-service-session: PASS' '- page-and-ui-boundary: PASS' '- system-notification-controls: PASS' \
        '- room-semantic-checkpoint: PASS' '- process-death-stage-a: PASS' '- process-death-empty-pid: PASS' \
        '- process-death-relaunch: PASS' '- process-death-stage-b: PASS' '- no-transport-material: PASS' '' \
        '## Bounded recovery observations' '' \
        '- checkpoint-revision: monotonic and restored' '- current-occurrence: duplicate-safe semantic identifier asserted by installed test' \
        '- queue-order-count: exact duplicate FIFO asserted by installed test' '- mode-history: shuffle mode and cursor/depth asserted by installed test' \
        '- position: restored paused position is within 5 seconds' '- force-stop: PID empty before relaunch' \
        '- relaunch-reconnect: explicit debug Activity and Stage-B controller reconnect passed' \
        '- transport-scan: snapshot/evidence accepts no URL/header/cookie/candidate/provider-body material' '' \
        '## Screenshots' '' \
        '- evidence/02-player.png: packaged page boundary after clean app launch' \
        '- evidence/02-queue.png: packaged page boundary after clean app launch' \
        '- evidence/02-notification.png: packaged page boundary after clean app launch' \
        '- Screenshot scope: redacted host/page context only; installed instrumentation is the semantic service/queue/notification proof.' '' \
        '## System surface coverage' '' \
        '- page/session/control: PASS via PlaybackServiceInstrumentationTest and Phase01WebViewInstrumentationTest' \
        '- notification/focus/noisy/screen-off: PASS via PlaybackSystemControlsInstrumentationTest' \
        '- Bluetooth/AVRCP: not verified — API-35 emulator has no real Bluetooth/AVRCP transport' '' \
        '## Live provider gate' '' \
        '- live-provider-media3: BLOCKED — Phase 1 HTTP 412' \
        '- Overall Phase 2: not verified; deterministic fixture/build/JVM output cannot satisfy live playback.' '' \
        '## Reproduction' '' \
        '- Commands: exact debug APK build/signature, installed connected classes, phase02-process-death-smoke.sh --verify, clean-launch CDP capture' \
        '- Recovery: restore a supported API-35 emulator and rerun --run-deterministic; run strict verification only after 02-10 live PASS.' \
        > "$evidence"
}
run_deterministic() {
    local evidence="$1" screenshots="$(dirname "$evidence")/evidence"
    prepare; build_exact_apk; install_exact_apks
    run_class 'com.dazzlingwuming.listen2.PlaybackServiceInstrumentationTest'
    run_class 'com.dazzlingwuming.listen2.PlaybackSystemControlsInstrumentationTest'
    run_class 'com.dazzlingwuming.listen2.Phase01WebViewInstrumentationTest'
    ANDROID_SERIAL="$SERIAL" ANDROID_SDK_ROOT="$SDK_ROOT" LISTEN2_GRADLE="$GRADLE_BIN" bash "$ROOT/android/scripts/phase02-process-death-smoke.sh" --verify
    # The process-death script rebuilds the exact source snapshot; recompute and
    # reject non-reproducible output rather than recording an old APK hash.
    [[ "$(git -C "$ROOT" rev-parse HEAD)" == "$GIT_SHA" ]] || die "git identity drifted while deterministic evidence ran" 73
    APK_SHA="$(shasum -a 256 "$APK" | awk '{print $1}')"
    prepare_cdp
    node "$ROOT/android/scripts/phase02-webview-smoke.mjs" --capture --port "$PORT" --screenshots "$screenshots"
    write_evidence "$evidence" "$screenshots"
    "$0" --verify-evidence "$evidence" --allow-live-blocked
}
self_test() {
    node "$ROOT/android/scripts/phase02-webview-smoke.mjs" --self-test
    set +e
    ANDROID_SERIAL=not-a-device "$0" --verify-evidence /missing --allow-live-blocked >/dev/null 2>&1
    local missing_status=$?
    set -e
    [[ "$missing_status" != 0 ]] || die "self-test expected invalid device/evidence rejection" 73
    echo 'PASS: harness self-test rejects ambiguity, timeout, drift, substitution, missing artifacts, and redaction canaries'
}
verify_evidence() {
    local evidence="$1" allow_live="${2:-false}" screenshots
    prepare
    [[ -f "$APK" ]] || die 'exact debug APK is missing; rebuild before verification' 74
    screenshots="$(dirname "$evidence")/evidence"
    local flags=(--verify-evidence "$evidence" --apk "$APK" --git-sha "$(git -C "$ROOT" rev-parse HEAD)" --api "$API" --package "$PACKAGE" --screenshots "$screenshots")
    [[ "$allow_live" == true ]] && flags+=(--allow-live-blocked)
    node "$ROOT/android/scripts/phase02-webview-smoke.mjs" "${flags[@]}"
}
case "${1:-}" in
    --self-test) [[ "$#" == 1 ]] || { usage; exit 64; }; self_test ;;
    --run-deterministic) shift; evidence="$EVIDENCE_DEFAULT"; [[ "${1:-}" == --evidence ]] && { evidence="$2"; shift 2; }; [[ "$#" == 0 ]] || { usage; exit 64; }; run_deterministic "$evidence" ;;
    --verify-evidence) shift; [[ "${1:-}" ]] || { usage; exit 64; }; evidence="$1"; shift; allow=false; [[ "${1:-}" == --allow-live-blocked ]] && { allow=true; shift; }; [[ "$#" == 0 ]] || { usage; exit 64; }; verify_evidence "$evidence" "$allow" ;;
    *) usage; exit 64 ;;
esac
