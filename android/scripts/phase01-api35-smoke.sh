#!/usr/bin/env bash
# Fail-closed Phase-01 API-35 evidence runner. Build output is never accepted
# as proof of a public provider/audio journey.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}"
ADB="$SDK_ROOT/platform-tools/adb"
EMULATOR_BIN="${ANDROID_EMULATOR:-$SDK_ROOT/emulator/emulator}"
AVDMANAGER_BIN="${AVDMANAGER:-$(command -v avdmanager || true)}"
SDKMANAGER_BIN="${SDKMANAGER:-$(command -v sdkmanager || true)}"
GRADLE_BIN="${GRADLE_BIN:-/tmp/listen2-ci.CBSD9n/gradle-8.10.2/bin/gradle}"
PACKAGE="com.dazzlingwuming.listen2.debug"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
EVIDENCE_DEFAULT="$ROOT/.planning/phases/01-verified-bilibili-startup-slice/01-API35-EVIDENCE.md"
EVIDENCE_DIR="$ROOT/.planning/phases/01-verified-bilibili-startup-slice/evidence"
PORT="${PHASE01_CDP_PORT:-9222}"
SERIAL="${ANDROID_SERIAL:-}"
FORWARD_CREATED=0
ORIGINAL_FONT_SCALE=""
ORIGINAL_ROTATION=""

usage() { echo "usage: $0 --self-test | --prepare | --run [--evidence PATH] | --verify-evidence PATH | --wave0-verify" >&2; }
die() { echo "BLOCKED: $1" >&2; exit "${2:-1}"; }
require_tool() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1" 69; }
timeout_run() { perl -e 'alarm shift; exec @ARGV' "$@"; }

cleanup() {
  local status=$?
  if [[ -n "$SERIAL" && "$FORWARD_CREATED" == "1" ]]; then "$ADB" -s "$SERIAL" forward --remove "tcp:$PORT" >/dev/null 2>&1 || true; fi
  if [[ -n "$SERIAL" && -n "$ORIGINAL_FONT_SCALE" ]]; then "$ADB" -s "$SERIAL" shell settings put system font_scale "$ORIGINAL_FONT_SCALE" >/dev/null 2>&1 || true; fi
  if [[ -n "$SERIAL" && -n "$ORIGINAL_ROTATION" ]]; then "$ADB" -s "$SERIAL" shell settings put system accelerometer_rotation "$ORIGINAL_ROTATION" >/dev/null 2>&1 || true; fi
  exit "$status"
}
trap cleanup EXIT INT TERM

select_device() {
  [[ -x "$ADB" ]] || die "ADB not found under ANDROID_SDK_ROOT" 69
  local devices count
  devices="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')"
  count="$(printf '%s\n' "$devices" | awk 'NF {n++} END {print n+0}')"
  if [[ -n "$SERIAL" ]]; then printf '%s\n' "$devices" | grep -qx "$SERIAL" || die "requested device is not ready" 65
  elif [[ "$count" == "1" ]]; then SERIAL="$devices"
  elif [[ "$count" == "0" ]]; then start_repository_avd; SERIAL="emulator-5554"
  else die "expected exactly one ready emulator; set ANDROID_SERIAL to select one" 65; fi
  [[ "$SERIAL" == emulator-* ]] || die "refusing a non-emulator device" 65
}
start_repository_avd() {
  [[ -x "$EMULATOR_BIN" && -n "$AVDMANAGER_BIN" && -n "$SDKMANAGER_BIN" ]] || die "no ready emulator and Android AVD tooling is unavailable" 65
  if ! "$EMULATOR_BIN" -list-avds | grep -qx "listen2_api35"; then
    yes | "$SDKMANAGER_BIN" "system-images;android-35;google_apis;arm64-v8a" >/dev/null
    echo no | "$AVDMANAGER_BIN" create avd -n listen2_api35 -k "system-images;android-35;google_apis;arm64-v8a" --force >/dev/null
  fi
  "$EMULATOR_BIN" -avd listen2_api35 -no-snapshot -no-audio -no-boot-anim >/dev/null 2>&1 &
  local pid=$!
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do "$ADB" devices | awk 'NR>1 && $1=="emulator-5554" && $2=="device" {found=1} END {exit !found}' && return 0; sleep 2; done
  kill "$pid" >/dev/null 2>&1 || true
  die "repository API-35 AVD did not become ready" 70
}
device_field() { "$ADB" -s "$SERIAL" shell "$1" 2>/dev/null | tr -d '\r' | head -n 1; }
capture_environment() {
  API="$(device_field 'getprop ro.build.version.sdk')"
  ABI="$(device_field 'getprop ro.product.cpu.abi')"
  WEBVIEW="$("$ADB" -s "$SERIAL" shell dumpsys webviewupdate 2>/dev/null | tr -d '\r' | awk '/Current WebView package/ {print $0; exit}' | sed 's/[^A-Za-z0-9._() -]/_/g' | cut -c1-160)"
  NETWORK="$(device_field 'getprop gsm.network.type' | sed 's/[^A-Za-z0-9,_ -]/_/g' | cut -c1-80)"
  [[ "$API" == "35" && -n "$ABI" && -n "$WEBVIEW" ]] || die "API-35 device or WebView provider is not ready" 66
}
wait_for_boot() {
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do [[ "$(device_field 'getprop sys.boot_completed')" == "1" ]] && return 0; sleep 2; done
  die "emulator did not boot within 180 seconds" 70
}
prepare() { select_device; wait_for_boot; capture_environment; echo "PASS: API=$API ABI=$ABI WebView=$WEBVIEW network=${NETWORK:-unknown}"; }
run_gradle() { [[ -x "$GRADLE_BIN" ]] || die "pinned Gradle 8.10.2 is unavailable; set GRADLE_BIN" 69; (cd "$ROOT/android" && "$GRADLE_BIN" --no-daemon "$@"); }
build_exact_apk() {
  run_gradle :app:testDebugUnitTest :app:connectedDebugAndroidTest :app:assembleDebug
  "$SDK_ROOT/build-tools/35.0.0/apksigner" verify --verbose "$APK"
  [[ -f "$APK" ]] || die "debug APK was not produced" 71
  GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"; APK_SHA="$(shasum -a 256 "$APK" | awk '{print $1}')"
}
prepare_cdp() {
  "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE"; "$ADB" -s "$SERIAL" shell pm clear "$PACKAGE" >/dev/null
  "$ADB" -s "$SERIAL" shell monkey -p "$PACKAGE" 1 >/dev/null
  timeout_run 20 "$ADB" -s "$SERIAL" forward "tcp:$PORT" localabstract:webview_devtools_remote || die "CDP forward failed" 72
  FORWARD_CREATED=1
}
write_blocked_evidence() {
  local evidence="$1" reason="$2"; mkdir -p "$(dirname "$evidence")"
  cat >"$evidence" <<EOF
# Phase 01 API-35 live evidence

## Result

**Status:** BLOCKED / not verified
**Timestamp:** $(date '+%Y-%m-%dT%H:%M:%S%z')
**Reason:** ${reason//[^A-Za-z0-9 .:_-]/_}

## Identity

- Git SHA: ${GIT_SHA:-not-built}
- APK SHA-256: ${APK_SHA:-not-built}
- Package: $PACKAGE
- Build variant: debug
- API: ${API:-unknown}
- ABI: ${ABI:-unknown}
- WebView: ${WEBVIEW:-unknown}
- Network: ${NETWORK:-unknown}

## Required live markers

- provider-search: BLOCKED
- exact-part: BLOCKED
- active-audio-and-progress: BLOCKED
- pause-resume: BLOCKED
- lyric-terminal: BLOCKED
- cancellation-retry-navigation-layout: BLOCKED
EOF
}
run_live() {
  local evidence="$1"; prepare; build_exact_apk
  "$ADB" -s "$SERIAL" install -r "$APK" >/dev/null
  ORIGINAL_FONT_SCALE="$(device_field 'settings get system font_scale')"; ORIGINAL_ROTATION="$(device_field 'settings get system accelerometer_rotation')"
  prepare_cdp; mkdir -p "$EVIDENCE_DIR"
  set +e
  PHASE01_GIT_SHA="$GIT_SHA" PHASE01_APK_SHA="$APK_SHA" PHASE01_SERIAL="$SERIAL" PHASE01_API="$API" PHASE01_ABI="$ABI" PHASE01_WEBVIEW="$WEBVIEW" PHASE01_NETWORK="$NETWORK" \
    node "$ROOT/android/scripts/phase01-webview-smoke.mjs" --run --port "$PORT" --screenshots "$EVIDENCE_DIR" --evidence "$evidence"
  local result=$?; set -e
  if [[ "$result" != "0" ]]; then [[ -f "$evidence" ]] || write_blocked_evidence "$evidence" "live CDP journey failed or provider was unavailable"; echo "BLOCKED: live provider/device journey was not verified" >&2; return "$result"; fi
  "$0" --verify-evidence "$evidence"
}
self_test() {
  require_tool node; node "$ROOT/android/scripts/phase01-webview-smoke.mjs" --self-test
  set +e; ANDROID_SERIAL=missing-device "$0" --prepare >/dev/null 2>&1; local missing_device=$?; set -e
  [[ "$missing_device" != "0" ]] || die "self-test expected missing device rejection" 73
  echo "PASS: harness self-test rejects bad device selection and redaction canaries"
}
wave0_verify() {
  prepare; build_exact_apk; mkdir -p "$ROOT/android/app/build/reports/phase01"
  printf '{"mode":"deterministic-runtime-tracer","liveProviderVerified":false,"gitSha":"%s","apkSha256":"%s","api":%s,"abi":"%s"}\n' "$GIT_SHA" "$APK_SHA" "$API" "$ABI" > "$ROOT/android/app/build/reports/phase01/wave0-identity.json"
  echo "PASS: deterministic tracer/build evidence only; live provider/audio remains not verified."
}
case "${1:-}" in
  --self-test) self_test ;;
  --prepare) prepare ;;
  --wave0-verify) wave0_verify ;;
  --run) shift; evidence="$EVIDENCE_DEFAULT"; [[ "${1:-}" == "--evidence" ]] && { evidence="$2"; shift 2; }; [[ "$#" == 0 ]] || { usage; exit 64; }; run_live "$evidence" ;;
  --verify-evidence) [[ "$#" == 2 ]] || { usage; exit 64; }; select_device; capture_environment; node "$ROOT/android/scripts/phase01-webview-smoke.mjs" --verify-evidence "$2" --apk "$APK" --git-sha "$(git -C "$ROOT" rev-parse HEAD)" --api "$API" --package "$PACKAGE" ;;
  *) usage; exit 64 ;;
esac
