#!/usr/bin/env bash
set -euo pipefail

RUN_DIR=""; API=""; START=false; STOP=false
while [[ "$#" -gt 0 ]]; do case "$1" in --run-dir) RUN_DIR="$2"; shift 2;; --api) API="$2"; shift 2;; --start) START=true; shift;; --stop) STOP=true; shift;; *) echo "usage: avd-manager.sh --run-dir DIR --api 26|35|36 --start|--stop" >&2; exit 2;; esac; done
[[ -n "$RUN_DIR" && -n "$API" ]] || { echo "run directory and API are required" >&2; exit 2; }
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"; [[ -n "$SDK" ]] || { echo "BLOCKED: set ANDROID_SDK_ROOT" >&2; exit 3; }
case "$(uname -m)" in arm64|aarch64) ABI=arm64-v8a;; x86_64|amd64) ABI=x86_64;; *) echo "BLOCKED: unsupported host ABI" >&2; exit 3;; esac
IMAGE="system-images;android-${API};google_apis;${ABI}"; IMAGE_DIR="$SDK/system-images/android-${API}/google_apis/${ABI}"
if [[ ! -f "$IMAGE_DIR/package.xml" ]]; then echo "BLOCKED: missing $IMAGE; install with: sdkmanager --install '$IMAGE'" >&2; exit 3; fi
ADB="$SDK/platform-tools/adb"; [[ -x "$ADB" ]] || ADB="$(command -v adb)"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"; [[ -x "$AVDMANAGER" ]] || AVDMANAGER="$(command -v avdmanager)"
EMULATOR="$SDK/emulator/emulator"; [[ -x "$EMULATOR" ]] || EMULATOR="$(command -v emulator)"
NAME="listen2-phase08-api${API}-$(basename "$RUN_DIR" | tr -cd 'a-zA-Z0-9' | tail -c 12)"; PID_FILE="$RUN_DIR/.avd-api${API}.pid"; MARKER="$RUN_DIR/.avd-api${API}.created"
if $STOP; then [[ -f "$PID_FILE" ]] && kill "$(cat "$PID_FILE")" 2>/dev/null || true; [[ -f "$MARKER" ]] && "$AVDMANAGER" delete avd -n "$NAME" >/dev/null 2>&1 || true; exit 0; fi
CONFIG="$HOME/.android/avd/${NAME}.avd/config.ini"
if [[ -d "${CONFIG%/config.ini}" ]]; then grep -Fqx "image.sysdir.1=system-images/android-${API}/google_apis/${ABI}/" "$CONFIG" || { echo "BLOCKED: existing AVD image/ABI mismatch" >&2; exit 3; }; else printf 'no\n' | "$AVDMANAGER" create avd -n "$NAME" -k "$IMAGE" --force >/dev/null; touch "$MARKER"; fi
$START || exit 0
"$EMULATOR" -avd "$NAME" -no-snapshot -no-boot-anim -no-audio -netdelay none -netspeed full >/dev/null 2>&1 & echo $! > "$PID_FILE"
deadline=$((SECONDS + 120)); SERIAL=""
while (( SECONDS < deadline )); do SERIAL="$($ADB devices | awk 'NR>1 && $2=="device" {print $1; exit}')"; [[ -n "$SERIAL" ]] && [[ "$($ADB -s "$SERIAL" shell getprop sys.boot_completed | tr -d '\r')" == 1 ]] && break; sleep 2; done
[[ -n "$SERIAL" ]] || { echo "BLOCKED: emulator did not boot" >&2; exit 3; }
[[ "$($ADB -s "$SERIAL" shell getprop ro.boot.qemu.avd_name | tr -d '\r')" == "$NAME" ]] || { echo "BLOCKED: emulator serial is not the launched AVD" >&2; exit 3; }
[[ "$($ADB -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == "$API" ]] || { echo "BLOCKED: API mismatch" >&2; exit 3; }
echo "$SERIAL"
