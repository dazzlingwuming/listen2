#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--wave0-verify" ]]; then
  echo "usage: $0 --wave0-verify" >&2
  exit 64
fi

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:?ANDROID_SDK_ROOT is required}"
ADB="$ANDROID_SDK_ROOT/platform-tools/adb"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORT_DIR="$ROOT/android/app/build/reports/phase01"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
mkdir -p "$REPORT_DIR"

DEVICES="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')"
DEVICE_COUNT="$(printf '%s\n' "$DEVICES" | awk 'NF {count += 1} END {print count + 0}')"
if [[ "$DEVICE_COUNT" -ne 1 ]]; then
  echo "expected exactly one connected API-35 emulator, found $DEVICE_COUNT" >&2
  exit 65
fi
SERIAL="$DEVICES"
API="$($ADB -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')"
ABI="$($ADB -s "$SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')"
WEBVIEW="$($ADB -s "$SERIAL" shell dumpsys webviewupdate | tr -d '\r' | grep -E 'Current WebView package|Current WebView' | head -1 || true)"
if [[ "$API" != "35" || -z "$ABI" || -z "$WEBVIEW" || ! -f "$APK" ]]; then
  echo "device/API/WebView/APK identity is incomplete" >&2
  exit 66
fi

GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
APK_SHA="$(shasum -a 256 "$APK" | awk '{print $1}')"
START="$(date '+%Y-%m-%dT%H:%M:%S%z')"
set +e
GRADLE_BIN="${GRADLE_BIN:-gradle}"
(cd "$ROOT/android" && "$GRADLE_BIN" --no-daemon :app:connectedDebugAndroidTest) >"$REPORT_DIR/instrumentation.out" 2>&1
RESULT=$?
set -e
if [[ "$RESULT" -ne 0 ]]; then
  rm -f "$REPORT_DIR/instrumentation.out"
  echo "instrumentation failed; no evidence was recorded" >&2
  exit "$RESULT"
fi
cat >"$REPORT_DIR/wave0-identity.json" <<EOF
{"timestamp":"$START","serial":"$SERIAL","api":$API,"abi":"$ABI","webview":"${WEBVIEW//\"/}","gitSha":"$GIT_SHA","apkSha256":"$APK_SHA","mode":"deterministic-runtime-tracer","liveProviderVerified":false}
EOF
rm -f "$REPORT_DIR/instrumentation.out"
echo "Wave-0 deterministic runtime tracer passed; live provider/audio remains unverified."
