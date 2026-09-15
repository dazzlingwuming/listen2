#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'usage: device-state.sh snapshot|restore --serial SERIAL --file STATE_FILE\n' >&2
  exit 2
}

ACTION="${1:-}"
shift || true
SERIAL=""
STATE_FILE=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --serial) SERIAL="$2"; shift 2 ;;
    --file) STATE_FILE="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$ACTION" == "snapshot" || "$ACTION" == "restore" ]] && [[ -n "$SERIAL" && -n "$STATE_FILE" ]] || usage
ADB="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}/platform-tools/adb"
[[ -x "$ADB" ]] || ADB="$(command -v adb)"

read_setting() { "$ADB" -s "$SERIAL" shell settings get "$1" "$2" | tr -d '\r'; }
if [[ "$ACTION" == "snapshot" ]]; then
  umask 077
  {
    printf 'window_animation_scale=%q\n' "$(read_setting global window_animation_scale)"
    printf 'transition_animation_scale=%q\n' "$(read_setting global transition_animation_scale)"
    printf 'animator_duration_scale=%q\n' "$(read_setting global animator_duration_scale)"
    printf 'font_scale=%q\n' "$(read_setting system font_scale)"
    printf 'accelerometer_rotation=%q\n' "$(read_setting system accelerometer_rotation)"
  } > "$STATE_FILE"
  exit 0
fi

[[ -f "$STATE_FILE" ]] || { printf 'device state file is missing.\n' >&2; exit 1; }
source "$STATE_FILE"
"$ADB" -s "$SERIAL" shell settings put global window_animation_scale "$window_animation_scale"
"$ADB" -s "$SERIAL" shell settings put global transition_animation_scale "$transition_animation_scale"
"$ADB" -s "$SERIAL" shell settings put global animator_duration_scale "$animator_duration_scale"
"$ADB" -s "$SERIAL" shell settings put system font_scale "$font_scale"
"$ADB" -s "$SERIAL" shell settings put system accelerometer_rotation "$accelerometer_rotation"
