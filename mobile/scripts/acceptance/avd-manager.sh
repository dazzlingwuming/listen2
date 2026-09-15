#!/usr/bin/env bash
set -euo pipefail

port_has_listener() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

adb_serial_present() {
  "$ADB" devices | awk 'NR > 1 { print $1 }' | grep -Fxq "$1"
}

choose_emulator_port() {
  local port serial
  for port in $(seq 5554 2 5680); do
    serial="emulator-${port}"
    if ! port_has_listener "$port" && ! port_has_listener "$((port + 1))" && ! adb_serial_present "$serial"; then
      printf '%s\n' "$port"
      return 0
    fi
  done
  return 1
}

assert_self_test() {
  ADB=/bin/true
  port_has_listener() { [[ "$1" == 5556 ]]; }
  adb_serial_present() { [[ "$1" == emulator-5554 ]]; }
  [[ "$(choose_emulator_port)" == 5558 ]] || { echo 'self-test failed: existing serial/listening port was selected' >&2; exit 1; }
  port_has_listener() { return 1; }
  adb_serial_present() { return 1; }
  [[ "$(choose_emulator_port)" == 5554 ]] || { echo 'self-test failed: first free even port was not selected' >&2; exit 1; }
  grep -Fq 'kill -0 "$EMULATOR_PID"' "$0" || { echo 'self-test failed: early process exit is not checked' >&2; exit 1; }
  grep -Fq '"$ADB" -s "$SERIAL"' "$0" || { echo 'self-test failed: adb calls are not serial-bound' >&2; exit 1; }
  grep -Fq '"$ADB" -s "$recorded_serial" emu kill' "$0" || { echo 'self-test failed: cleanup is not serial-bound' >&2; exit 1; }
  echo 'API 35 AVD manager self-test passed.'
}

if [[ "${1:-}" == '--self-test' ]]; then
  assert_self_test
  exit 0
fi

RUN_DIR=""; API=""; START=false; STOP=false
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-dir) RUN_DIR="$2"; shift 2;;
    --api) API="$2"; shift 2;;
    --start) START=true; shift;;
    --stop) STOP=true; shift;;
    *) echo "usage: avd-manager.sh --run-dir DIR --api 26|35|36 --start|--stop" >&2; exit 2;;
  esac
done
[[ -n "$RUN_DIR" && -n "$API" ]] || { echo "run directory and API are required" >&2; exit 2; }
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"; [[ -n "$SDK" ]] || { echo "BLOCKED: set ANDROID_SDK_ROOT" >&2; exit 3; }
case "$(uname -m)" in arm64|aarch64) ABI=arm64-v8a;; x86_64|amd64) ABI=x86_64;; *) echo "BLOCKED: unsupported host ABI" >&2; exit 3;; esac
IMAGE="system-images;android-${API};google_apis;${ABI}"; IMAGE_DIR="$SDK/system-images/android-${API}/google_apis/${ABI}"
if [[ ! -f "$IMAGE_DIR/package.xml" ]]; then echo "BLOCKED: missing $IMAGE; install with: sdkmanager --install '$IMAGE'" >&2; exit 3; fi
ADB="$SDK/platform-tools/adb"; [[ -x "$ADB" ]] || ADB="$(command -v adb)"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"; [[ -x "$AVDMANAGER" ]] || AVDMANAGER="$(command -v avdmanager)"
EMULATOR="$SDK/emulator/emulator"; [[ -x "$EMULATOR" ]] || EMULATOR="$(command -v emulator)"
NAME="listen2-phase08-api${API}-$(basename "$RUN_DIR" | tr -cd 'a-zA-Z0-9' | tail -c 12)"
PID_FILE="$RUN_DIR/.avd-api${API}.pid"; SERIAL_FILE="$RUN_DIR/.avd-api${API}.serial"; COMMAND_FILE="$RUN_DIR/.avd-api${API}.command"; LOG_FILE="$RUN_DIR/.avd-api${API}.log"; MARKER="$RUN_DIR/.avd-api${API}.created"

stop_recorded_avd() {
  local recorded_pid="" recorded_serial="" deadline
  [[ -f "$PID_FILE" ]] && recorded_pid="$(cat "$PID_FILE")"
  [[ -f "$SERIAL_FILE" ]] && recorded_serial="$(cat "$SERIAL_FILE")"
  if [[ "$recorded_serial" =~ ^emulator-[0-9]+$ ]] && "$ADB" -s "$recorded_serial" get-state >/dev/null 2>&1; then
    "$ADB" -s "$recorded_serial" emu kill >/dev/null 2>&1 || true
  fi
  if [[ "$recorded_pid" =~ ^[0-9]+$ ]] && kill -0 "$recorded_pid" >/dev/null 2>&1; then
    kill "$recorded_pid" >/dev/null 2>&1 || true
  fi
  deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    local pid_alive=false serial_alive=false
    [[ "$recorded_pid" =~ ^[0-9]+$ ]] && kill -0 "$recorded_pid" >/dev/null 2>&1 && pid_alive=true
    [[ "$recorded_serial" =~ ^emulator-[0-9]+$ ]] && "$ADB" -s "$recorded_serial" get-state >/dev/null 2>&1 && serial_alive=true
    ! $pid_alive && ! $serial_alive && break
    sleep 1
  done
  if [[ "$recorded_serial" =~ ^emulator-[0-9]+$ ]] && "$ADB" -s "$recorded_serial" get-state >/dev/null 2>&1; then
    echo "BLOCKED: recorded emulator serial did not go offline: $recorded_serial" >&2
    return 1
  fi
}

if $STOP; then
  stop_recorded_avd
  [[ -f "$MARKER" ]] && "$AVDMANAGER" delete avd -n "$NAME" >/dev/null 2>&1 || true
  exit 0
fi

CONFIG="$HOME/.android/avd/${NAME}.avd/config.ini"
if [[ -d "${CONFIG%/config.ini}" ]]; then
  grep -Fqx "image.sysdir.1=system-images/android-${API}/google_apis/${ABI}/" "$CONFIG" || { echo "BLOCKED: existing AVD image/ABI mismatch" >&2; exit 3; }
else
  printf 'no\n' | "$AVDMANAGER" create avd -n "$NAME" -k "$IMAGE" --force >/dev/null
  touch "$MARKER"
fi
$START || exit 0

PORT="$(choose_emulator_port)" || { echo 'BLOCKED: no free emulator port in bounded range 5554-5680' >&2; exit 3; }
SERIAL="emulator-${PORT}"
printf '%s\n' "$SERIAL" > "$SERIAL_FILE"
printf '%q ' "$EMULATOR" -avd "$NAME" -port "$PORT" -no-snapshot -no-boot-anim -no-audio -netdelay none -netspeed full > "$COMMAND_FILE"
printf '\n' >> "$COMMAND_FILE"
# A controlled port and explicit serial prevent a residual AVD from becoming
# this run's device. The log is retained for an early-exit diagnosis.
nohup "$EMULATOR" -avd "$NAME" -port "$PORT" -no-snapshot -no-boot-anim -no-audio -netdelay none -netspeed full > "$LOG_FILE" 2>&1 &
EMULATOR_PID="$!"
printf '%s\n' "$EMULATOR_PID" > "$PID_FILE"

deadline=$((SECONDS + 120)); BOOTED=false
while (( SECONDS < deadline )); do
  if ! kill -0 "$EMULATOR_PID" >/dev/null 2>&1; then
    echo "BLOCKED: emulator process exited before boot; see $(basename "$LOG_FILE")" >&2
    exit 3
  fi
  if [[ "$("$ADB" -s "$SERIAL" get-state 2>/dev/null || true)" == device ]] &&
      [[ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then
    BOOTED=true
    break
  fi
  sleep 2
done
$BOOTED || { echo "BLOCKED: emulator did not boot on recorded serial $SERIAL; see $(basename "$LOG_FILE")" >&2; exit 3; }
[[ "$("$ADB" -s "$SERIAL" shell getprop ro.boot.qemu.avd_name | tr -d '\r')" == "$NAME" ]] || { echo "BLOCKED: recorded serial does not name the launched AVD" >&2; exit 3; }
[[ "$("$ADB" -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == "$API" ]] || { echo "BLOCKED: API mismatch" >&2; exit 3; }
sleep 3
kill -0 "$EMULATOR_PID" >/dev/null 2>&1 || { echo "BLOCKED: emulator process exited after boot; see $(basename "$LOG_FILE")" >&2; exit 3; }
[[ "$("$ADB" -s "$SERIAL" get-state 2>/dev/null || true)" == device ]] || { echo "BLOCKED: recorded serial disappeared after boot" >&2; exit 3; }
echo "$SERIAL"
