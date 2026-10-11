#!/usr/bin/env bash
set -euo pipefail

# One-run Phase 8 performance ledger.  It refuses replacement samples and never
# rebuilds the product APK: only an explicitly supplied, separately sealed test
# payload may be installed alongside the immutable releaseLike product.

PACKAGE='com.dazzlingwuming.listen2'
TEST_PACKAGE='com.dazzlingwuming.listen2.test'
RUN_DIR=''; BUILD_EVIDENCE=''; SERIAL=''; TEST_APK=''; MODE=''; ATTEMPTS=''; RECOVERY_CYCLES=0; SOAK_SECONDS=0; FILTER=''; API_VALUES=()

usage() { echo 'usage: run-performance-recovery.sh --run-dir DIR --build-evidence FILE --serial SERIAL --test-apk FILE (--api35-full|--compatibility-only|--startup-probe) --attempts COUNT --test-filter CLASS#METHOD [options]' >&2; }
sha_file() { shasum -a 256 "$1" | awk '{print $1}'; }
fail() { echo "BLOCKED: $*" >&2; exit 3; }

if [[ "${1:-}" == '--self-test' ]]; then
  [[ $# == 1 ]] || fail 'self-test accepts no extra arguments'
  grep -Fq 'phase08Attempts' "$0" && grep -Fq 'immutable' "$0" && grep -Fq 'PerformanceRecoveryTest#api35Full' "$0" && grep -Fq 'a11y-phone-shell-tabs-ready' mobile/scripts/acceptance/summarize-performance.mjs || exit 1
  echo 'Performance runner self-test passed.'; exit 0
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir) RUN_DIR="$2"; shift 2;; --build-evidence) BUILD_EVIDENCE="$2"; shift 2;; --serial) SERIAL="$2"; shift 2;; --test-apk) TEST_APK="$2"; shift 2;;
    --api35-full) MODE='api35'; shift;; --compatibility-only) MODE='compatibility'; shift;; --startup-probe) MODE='startup-probe'; shift;; --api) API_VALUES+=("$2"); shift 2;;
    --attempts) ATTEMPTS="$2"; shift 2;; --recovery-cycles) RECOVERY_CYCLES="$2"; shift 2;; --soak-seconds) SOAK_SECONDS="$2"; shift 2;; --test-filter) FILTER="$2"; shift 2;;
    *) usage; exit 2;;
  esac
done
[[ -n "$RUN_DIR" && -n "$BUILD_EVIDENCE" && -n "$SERIAL" && -n "$TEST_APK" && -n "$ATTEMPTS" && -n "$MODE" && -n "$FILTER" ]] || { usage; exit 2; }
[[ -d "$RUN_DIR" && -f "$BUILD_EVIDENCE" && -f "$TEST_APK" ]] || fail 'run/build/test payload is unavailable'
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"; [[ -n "$SDK" ]] || fail 'ANDROID_SDK_ROOT is required'
ADB="$SDK/platform-tools/adb"; [[ -x "$ADB" ]] || fail 'adb is unavailable'
APKSIGNER="$SDK/build-tools/37.0.0/apksigner"; [[ -x "$APKSIGNER" ]] || fail 'apksigner 37.0.0 is unavailable'
APKANALYZER="$SDK/cmdline-tools/latest/bin/apkanalyzer"; [[ -x "$APKANALYZER" ]] || fail 'apkanalyzer is unavailable'
[[ "$("$ADB" -s "$SERIAL" get-state 2>/dev/null)" == device ]] || fail 'explicit serial is unavailable'
[[ "$("$ADB" -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" =~ ^(26|35|36)$ ]] || fail 'device API is unsupported'

[[ "$(cd "$(dirname "$BUILD_EVIDENCE")" && pwd)/$(basename "$BUILD_EVIDENCE")" == "$(cd "$RUN_DIR" && pwd)/08-build.json" ]] || fail 'build evidence must belong to this run'
CANDIDATE_OUTPUT="$(node mobile/scripts/acceptance/candidate.mjs --verify --run-dir "$RUN_DIR" --apksigner "$APKSIGNER" --test-apk "$TEST_APK")" || fail 'sealed candidate validation failed'
BUILD_INFO=(); while IFS= read -r field; do BUILD_INFO+=("$field"); done <<< "$CANDIDATE_OUTPUT"
[[ ${#BUILD_INFO[@]} == 6 ]] || fail 'candidate output is malformed'
RELEASE_APK="${BUILD_INFO[0]}"; RELEASE_SHA="${BUILD_INFO[1]}"; BUILD_HEAD="${BUILD_INFO[4]}"; TEST_APK="${BUILD_INFO[5]}"
"$APKANALYZER" dex packages "$TEST_APK" | grep -Fq 'com.listen2mobile.acceptance.PerformanceRecoveryTest' || fail 'test payload lacks PerformanceRecoveryTest'
for forbidden in kotlin androidx.test.runner InstrumentationRegistry ActivityScenario; do ! "$APKANALYZER" dex code --class com.listen2mobile.acceptance.PerformanceRecoveryTest "$TEST_APK" | grep -Fqi "$forbidden" || fail 'test payload contains forbidden runtime dependency'; done

ORIGINAL_WIFI="$($ADB -s "$SERIAL" shell settings get global wifi_on | tr -d '\r')"
DEVICE_API="$("$ADB" -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')"; STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; TEST_SHA="$(sha_file "$TEST_APK")"; FIXTURE_SHA='generated-in-performance-lane'
mkdir -p "$RUN_DIR/performance"; chmod 700 "$RUN_DIR/performance"
cleanup() { if [[ "$ORIGINAL_WIFI" == 0 ]]; then wifi_action=disable; else wifi_action=enable; fi; "$ADB" -s "$SERIAL" shell svc wifi "$wifi_action" >/dev/null 2>&1 || true; "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
now_ms() { node -p 'Date.now()'; }
instrument() {
  local class="$1" out="$2" command_status=0 sanitize_status=0 raw
  local lifecycle_flag=''
  [[ "${4:-}" != --no-restart ]] || lifecycle_flag=--no-restart
  raw="$(mktemp "${TMPDIR:-/tmp}/listen2-performance-instrumentation.XXXXXX")"
  "$ADB" -s "$SERIAL" shell am instrument ${lifecycle_flag:+"$lifecycle_flag"} -w -r -e class "$class" -e phase08Api "$DEVICE_API" -e phase08Attempts 20 ${3:-} "$TEST_PACKAGE/com.listen2mobile.acceptance.Phase08Instrumentation" > "$raw" 2>&1 || command_status=$?
  node --input-type=module - "$raw" "$out" "$command_status" <<'NODE' || sanitize_status=$?
import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizePerformanceInstrumentation } from './mobile/scripts/acceptance/performance-evidence.mjs';
writeFileSync(process.argv[3], sanitizePerformanceInstrumentation(readFileSync(process.argv[2], 'utf8'), Number(process.argv[4])), { flag: 'wx', mode: 0o600 });
NODE
  rm -f "$raw"
  [[ "$sanitize_status" == 0 && "$command_status" == 0 ]] && ! grep -Eq 'INSTRUMENTATION_STATUS_CODE: -1|failureType=' "$out" && grep -Eq '^INSTRUMENTATION_CODE: (-1|0)[[:space:]]*$' "$out"
}


# Only the generated-local lane must keep its process alive after finish().
# Cold/search instrumentation retains its original process-start semantics.
instrument_local_retained() {
  local class="$1" out="$2" extra='' anchor="${4:-}" before='' after='' deadline lifecycle='PASS-same-process' result=0
  [[ ! -e "$out" ]] || return 1
  if [[ "${3:-}" != existing ]] && ! "$ADB" -s "$SERIAL" shell am start -W -n "$PACKAGE/com.listen2mobile.MainActivity" >/dev/null 2>&1; then
    lifecycle='FAIL-launch'
  else
    deadline=$(( $(date +%s) + 5 ))
    while [[ $(date +%s) -le $deadline ]]; do
      before="$("$ADB" -s "$SERIAL" shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r\n')"
      [[ "$before" =~ ^[1-9][0-9]*$ ]] && break
      sleep 0.1
    done
    [[ "$before" =~ ^[1-9][0-9]*$ ]] || lifecycle='FAIL-process-unavailable'
  fi
  if [[ "$lifecycle" == PASS-same-process ]]; then
    if [[ "$anchor" =~ ^[0-9]{1,9}$ ]]; then extra="-e phase08ResumeAnchorMs $anchor"; fi
    instrument "$class" "$out" "$extra" --no-restart || result=$?
    # A short bounded observation catches termination queued after finish.
    for observation in 1 2 3; do
      after="$("$ADB" -s "$SERIAL" shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r\n')"
      if [[ "$after" != "$before" ]]; then lifecycle='FAIL-process-changed'; break; fi
      sleep 0.1
    done
  else
    [[ ! -e "$out" ]] || return 1
    ( set -o noclobber; printf 'performanceCommandExitCode=125\n' > "$out" ) || return 1
  fi
  printf 'performanceLifecycle=%s\n' "$lifecycle" >> "$out"
  [[ "$result" == 0 && "$lifecycle" == PASS-same-process ]]
}

# The startup probe is deliberately separate from the fixed 20-attempt acceptance paths below.
# It keeps host ADB transport time only as diagnostics; primary TTID/TTFD are emitted by the
# AndroidTest from device Activity Manager output and visible accessibility readiness.
wait_for_pid_absence() {
  local deadline=$(( $(date +%s) + 5 ))
  while [[ $(date +%s) -le $deadline ]]; do
    local pid
    pid="$("$ADB" -s "$SERIAL" shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r\n')"
    if [[ -z "$pid" ]]; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

safe_probe_scalar() {
  tr -cd '[:alnum:]._:= -' | cut -c1-160
}

capture_startup_probe_environment() {
  local file="$RUN_DIR/performance/api${DEVICE_API}-startup-probe-environment.txt"
  local boot animationWindow animationTransition animationAnimator artProfile io deviceCores
  local deadline consecutive=0 sample=0 now top aggregateCpu load thermal battery stable=false
  boot="$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | safe_probe_scalar)"
  [[ "$boot" == 1 ]] || fail 'startup probe requires a boot-complete emulator'
  # The runner observes settings but never changes animation/thermal/profile state. It waits for
  # system_server and GMS aggregate CPU to remain below the recorded threshold for three samples,
  # rather than measuring immediately after boot completion.
  animationWindow="$("$ADB" -s "$SERIAL" shell settings get global window_animation_scale 2>/dev/null | safe_probe_scalar)"
  animationTransition="$("$ADB" -s "$SERIAL" shell settings get global transition_animation_scale 2>/dev/null | safe_probe_scalar)"
  animationAnimator="$("$ADB" -s "$SERIAL" shell settings get global animator_duration_scale 2>/dev/null | safe_probe_scalar)"
  artProfile="$("$ADB" -s "$SERIAL" shell "dumpsys package $PACKAGE | grep -E -m 1 'Dexopt|compiler-filter|profile'" 2>/dev/null | safe_probe_scalar || true)"; artProfile="${artProfile:-unavailable}"
  io="$("$ADB" -s "$SERIAL" shell 'head -n 3 /proc/diskstats | tail -n 1' 2>/dev/null | safe_probe_scalar)"
  deviceCores="$("$ADB" -s "$SERIAL" shell 'grep -c ^processor /proc/cpuinfo' 2>/dev/null | tr -d '\r')"; deviceCores="${deviceCores:-unknown}"
  printf 'capturedAt=%s\nbootCompleted=%s\nwindowAnimationScale=%s\ntransitionAnimationScale=%s\nanimatorDurationScale=%s\nartProfile=%s\nio=%s\ndeviceCores=%s\nstabilityContract=max90s;5sInterval;threeConsecutive;systemServerPlusGmsCpuPct<=40;load1<=deviceCores\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${boot:-unavailable}" "${animationWindow:-unavailable}" "${animationTransition:-unavailable}" "${animationAnimator:-unavailable}" "${artProfile}" "${io:-unavailable}" "${deviceCores}" > "$file"
  deadline=$(( $(date +%s) + 90 ))
  while [[ $(date +%s) -le $deadline ]]; do
    sample=$((sample + 1)); now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    top="$("$ADB" -s "$SERIAL" shell 'top -b -n 1 -o NAME,%CPU' 2>/dev/null || true)"
    aggregateCpu="$(printf '%s\n' "$top" | awk '/system_server|com.google.android.gms|gms\.persistent|gms\.unstable/ { value=$NF; gsub(/%/, "", value); sum += value } END { printf "%.1f", sum + 0 }')"
    load="$("$ADB" -s "$SERIAL" shell "awk '{ print \$1 }' /proc/loadavg" 2>/dev/null | tr -d '\r')"
    thermal="$("$ADB" -s "$SERIAL" shell cmd thermalservice get-current-status 2>/dev/null | safe_probe_scalar || true)"; thermal="${thermal:-unavailable}"
    battery="$("$ADB" -s "$SERIAL" shell dumpsys battery 2>/dev/null | rg 'AC powered|USB powered|Wireless powered|status:|level:|temperature:' | tr '\n' ';' | safe_probe_scalar)"; battery="${battery:-unavailable}"
    if [[ "$aggregateCpu" =~ ^[0-9]+([.][0-9]+)?$ && "$load" =~ ^[0-9]+([.][0-9]+)?$ ]] && awk "BEGIN { exit !($aggregateCpu <= 40 && $load <= $deviceCores) }"; then
      consecutive=$((consecutive + 1)); stable=true
    else
      consecutive=0; stable=false
    fi
    printf 'sample=%s;at=%s;systemServerPlusGmsCpuPct=%s;load1=%s;thermal=%s;battery=%s;consecutiveStable=%s;stable=%s\n' \
      "$sample" "$now" "$aggregateCpu" "$load" "$thermal" "$battery" "$consecutive" "$stable" >> "$file"
    [[ "$consecutive" -ge 3 ]] && break
    sleep 5
  done
  [[ "$consecutive" -ge 3 ]] || fail 'startup probe environment did not reach three stable system samples within 90 seconds'
  printf 'stabilityReachedAt=%s;sample=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sample" >> "$file"
  chmod 600 "$file"
}

device_elapsed_millis() {
  "$ADB" -s "$SERIAL" shell 'awk '\''{ printf "%.0f", $1 * 1000 }'\'' /proc/uptime' 2>/dev/null | tr -d '\r'
}

wait_for_phone_shell() {
  local launch_started_elapsed_ms="$1" deadline now window
  deadline=$(( $(date +%s) + 25 ))
  while [[ $(date +%s) -le $deadline ]]; do
    window="$("$ADB" -s "$SERIAL" shell 'uiautomator dump /sdcard/phase08-startup-probe.xml >/dev/null && cat /sdcard/phase08-startup-probe.xml' 2>/dev/null || true)"
    if [[ "$window" == *'我的'* && "$window" == *'搜索'* ]]; then
      now="$(device_elapsed_millis)"
      if [[ "$now" =~ ^[0-9]+$ && "$launch_started_elapsed_ms" =~ ^[0-9]+$ && "$now" -ge "$launch_started_elapsed_ms" ]]; then
        printf '%s\n' "$((now-launch_started_elapsed_ms))"
        return 0
      fi
      return 2
    fi
    sleep 0.25
  done
  return 1
}

sample_startup_probe() {
  local id="$1"
  local activity_raw="$RUN_DIR/performance/api${DEVICE_API}-startup-probe-${id}-am-start.txt"
  local pidAbsent=false status=FAIL reason='pid-not-gone' total='' wait='' a11y='' launchState='MISSING'
  local started ended hostElapsed launch_started_elapsed_ms activity_total activity_wait shell_ready
  started="$(now_ms)"
  "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE" >/dev/null 2>&1 || true
  if wait_for_pid_absence; then
    pidAbsent=true
    launch_started_elapsed_ms="$(device_elapsed_millis)"
    if [[ ! "$launch_started_elapsed_ms" =~ ^[0-9]+$ ]]; then
      reason='missing-device-monotonic-start'
    elif ! "$ADB" -s "$SERIAL" shell am start -W -n "$PACKAGE/com.listen2mobile.MainActivity" > "$activity_raw" 2>&1; then
      reason='activity-start-failed'
    elif ! grep -Eq '^Status:[[:space:]]*ok[[:space:]]*$' "$activity_raw" || ! grep -Eq '^LaunchState:[[:space:]]*COLD[[:space:]]*$' "$activity_raw"; then
      reason='activity-start-not-cold'
    else
      activity_total="$(sed -nE 's/^TotalTime:[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' "$activity_raw" | tail -n 1)"
      activity_wait="$(sed -nE 's/^WaitTime:[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' "$activity_raw" | tail -n 1)"
      if [[ ! "$activity_total" =~ ^[0-9]+$ || ! "$activity_wait" =~ ^[0-9]+$ ]]; then
        reason='missing-device-activity-timing'
      elif shell_ready="$(wait_for_phone_shell "$launch_started_elapsed_ms")"; then
        status=PASS; reason='none'; total="$activity_total"; wait="$activity_wait"; a11y="$shell_ready"; launchState=COLD
      else
        reason='phone-shell-not-ready'
      fi
    fi
  fi
  ended="$(now_ms)"; hostElapsed="$((ended-started))"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$id" "$status" "$pidAbsent" "$hostElapsed" "$total" "$wait" "$a11y" "$launchState" "$reason"
}

NATIVE_PROBE_COUNTER=0
snapshot_native() {
  local destination="$1" elapsed probe
  elapsed="$(device_elapsed_millis)"
  NATIVE_PROBE_COUNTER=$(( NATIVE_PROBE_COUNTER + 1 ))
  probe="$RUN_DIR/performance/native-probe-${NATIVE_PROBE_COUNTER}-instrumentation.txt"
  # Attach only to the current process. Never launch/wake/create a service in soak.
  if ! instrument_local_retained 'com.listen2mobile.acceptance.PerformanceRecoveryTest#nativeProbe' "$probe" existing; then
    echo 'Native position probe unavailable; retained non-pass evidence.' >&2
  fi
  "$ADB" -s "$SERIAL" shell dumpsys media_session | node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { nativeSnapshot, screenOffObservation } from "./mobile/scripts/acceptance/performance-evidence.mjs";
let power = "";
try { power = execFileSync(process.argv[4], ["-s", process.argv[5], "shell", "dumpsys", "power"], { encoding: "utf8", timeout: 3000, maxBuffer: 1048576, stdio: ["ignore", "pipe", "pipe"] }); } catch { /* Unavailable power observation remains unverified. */ }
const snapshot = { ...nativeSnapshot(readFileSync(0, "utf8"), Number(process.argv[2]), readFileSync(process.argv[3], "utf8")), ...screenOffObservation(power) };
writeFileSync(process.argv[1], JSON.stringify(snapshot, null, 2));
' "$destination" "$elapsed" "$probe" "$ADB" "$SERIAL"
}

if [[ "$MODE" == startup-probe ]]; then
  [[ "$DEVICE_API" =~ ^(35|36)$ && ( "$ATTEMPTS" == 3 || "$ATTEMPTS" == 5 ) && "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#startupProbe' && ${#API_VALUES[@]} == 0 && "$RECOVERY_CYCLES" == 0 && "$SOAK_SECONDS" == 0 ]] || fail 'startup probe requires one API35/API36 serial, 3 or 5 attempts, and only the startupProbe filter'
  mkdir "$RUN_DIR/.startup-probe-api${DEVICE_API}-once" || fail 'startup probe window already consumed'
  LEDGER="$RUN_DIR/performance/api${DEVICE_API}-startup-probe.tsv"
  [[ ! -e "$LEDGER" ]] || fail 'startup probe ledger already exists; immutable attempts cannot be replaced'
  "$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || fail 'releaseLike install failed'
  # The separately verified test payload is not launched: Android instrumentation attaches to
  # the target package and would change its process-cold state. UiAutomator is the external,
  # visible-only readiness observer for this startup-specific path.
  capture_startup_probe_environment
  : > "$LEDGER"
  for number in $(seq 1 "$ATTEMPTS"); do
    printf -v attempt_id '%02d' "$number"
    sample_startup_probe "$attempt_id" >> "$LEDGER"
  done
  node mobile/scripts/acceptance/summarize-performance.mjs --startup-probe-ledger "$LEDGER" > "$RUN_DIR/performance/api${DEVICE_API}-startup-probe.summary.json"
  chmod a-w "$LEDGER" "$RUN_DIR/performance/api${DEVICE_API}-startup-probe.summary.json"
  exit 0
fi

if [[ "$MODE" == api35 ]]; then
  [[ "$ATTEMPTS" == 20 && "$DEVICE_API" == 35 && "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#api35Full' && "$RECOVERY_CYCLES" == 5 && "$SOAK_SECONDS" == 600 ]] || fail 'API35 full mode arguments are exact and mandatory'
  mkdir "$RUN_DIR/.api35-performance-once" || fail 'API35 performance window already consumed'
  [[ ! -e "$RUN_DIR/08-api35-performance.json" ]] || fail 'API35 record already exists and is sealed'
  "$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || fail 'releaseLike install failed'
  "$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null || fail 'AndroidTest install failed'
  LIVE_STARTED_AT="$(now_ms)"
  if ! instrument "$FILTER" "$RUN_DIR/performance/api35-instrumentation.txt" '-e phase08RecoveryCycles 5 -e phase08SoakSeconds 600'; then echo 'Live instrumentation ended non-pass; retain every emitted attempt and mark missing slots NOT_VERIFIED.' >&2; fi
  LIVE_ENDED_AT="$(now_ms)"; LIVE_DURATION_MS="$(( LIVE_ENDED_AT - LIVE_STARTED_AT ))"
  COLD="$RUN_DIR/performance/api35-cold.tsv"; : > "$COLD"
  for number in $(seq 1 20); do printf -v id '%02d' "$number"; sample_startup_probe "$id" >> "$COLD"; done
  node --input-type=module - "$RUN_DIR" <<'NODE'
import { writeFileSync } from 'node:fs';
import { generateSignal } from './mobile/scripts/acceptance/performance-evidence.mjs';
const run = process.argv[2];
writeFileSync(`${run}/performance/synthetic-media.json`, JSON.stringify(generateSignal(`${run}/performance/listen2-performance-signal.flac`), null, 2));
NODE
  "$ADB" -s "$SERIAL" push "$RUN_DIR/performance/listen2-performance-signal.flac" /sdcard/Download/listen2-performance-signal.flac >/dev/null || fail 'could not place generated file in Downloads'
  LOCAL_READY=false
  if instrument_local_retained 'com.listen2mobile.acceptance.PerformanceRecoveryTest#prepareLocal' "$RUN_DIR/performance/local-saf-instrumentation.txt"; then LOCAL_READY=true; fi
  printf '[]' > "$RUN_DIR/performance/recovery.json"
  printf '[]' > "$RUN_DIR/performance/soak.json"
  printf '{}' > "$RUN_DIR/performance/network.json"
  if [[ "$LOCAL_READY" == true ]]; then
    for cycle in $(seq 1 5); do
      "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_MEDIA_PAUSE >/dev/null
      sleep 1
      snapshot_native "$RUN_DIR/performance/recovery-before.json"
      RESUME_ANCHOR="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; import {resumeAnchor} from "./mobile/scripts/acceptance/performance-evidence.mjs"; console.log(resumeAnchor(JSON.parse(readFileSync(process.argv[1], "utf8"))));' "$RUN_DIR/performance/recovery-before.json")"
      "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE" >/dev/null
      resumed=false
      if instrument_local_retained 'com.listen2mobile.acceptance.PerformanceRecoveryTest#resumeLocal' "$RUN_DIR/performance/recovery-${cycle}-instrumentation.txt" '' "$RESUME_ANCHOR"; then resumed=true; fi
      # Pause immediately after UI restoration to bound the measured recovery position error.
      "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_MEDIA_PAUSE >/dev/null
      snapshot_native "$RUN_DIR/performance/recovery-after.json"
      node --input-type=module - "$RUN_DIR" "$cycle" "$resumed" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [run, cycle, resumed] = process.argv.slice(2); const file = `${run}/performance/recovery.json`;
const rows = JSON.parse(readFileSync(file)); rows.push({ cycle: Number(cycle), resumeVerified: resumed === 'true', before: JSON.parse(readFileSync(`${run}/performance/recovery-before.json`)), after: JSON.parse(readFileSync(`${run}/performance/recovery-after.json`)) }); writeFileSync(file, JSON.stringify(rows, null, 2));
NODE
    done
    RESUME_ANCHOR="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; import {resumeAnchor} from "./mobile/scripts/acceptance/performance-evidence.mjs"; console.log(resumeAnchor(JSON.parse(readFileSync(process.argv[1], "utf8"))));' "$RUN_DIR/performance/recovery-after.json")"
    instrument_local_retained 'com.listen2mobile.acceptance.PerformanceRecoveryTest#resumeLocal' "$RUN_DIR/performance/network-resume-instrumentation.txt" '' "$RESUME_ANCHOR" || LOCAL_READY=false
    snapshot_native "$RUN_DIR/performance/network-before.json"
    "$ADB" -s "$SERIAL" shell svc wifi disable >/dev/null
    WIFI_DISABLED="$("$ADB" -s "$SERIAL" shell settings get global wifi_on | tr -d '\r')"
    sleep 4; snapshot_native "$RUN_DIR/performance/network-offline.json"
    "$ADB" -s "$SERIAL" shell svc wifi enable >/dev/null
    WIFI_ENABLED="$("$ADB" -s "$SERIAL" shell settings get global wifi_on | tr -d '\r')"
    sleep 4; snapshot_native "$RUN_DIR/performance/network-after.json"
    node --input-type=module - "$RUN_DIR" "$WIFI_DISABLED" "$WIFI_ENABLED" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'; const [run, disabled, enabled] = process.argv.slice(2);
const read = name => JSON.parse(readFileSync(`${run}/performance/network-${name}.json`));
writeFileSync(`${run}/performance/network.json`, JSON.stringify({ disabledConfirmed: disabled === '0', enabledConfirmed: enabled === '1', before: read('before'), offline: read('offline'), after: read('after'), lane: 'generated-local-continuity-only', providerNetworkRecovery: 'NOT_VERIFIED' }, null, 2));
NODE
    "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_SLEEP >/dev/null || fail 'could not enter screen-off playback window'
    # The bounded settle is outside the measured 600s window. Dozing is not Asleep.
    if node --input-type=module - "$RUN_DIR" "$ADB" "$SERIAL" <<'NODE'
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { waitForScreenOff } from './mobile/scripts/acceptance/performance-evidence.mjs';
const [run, adb, serial] = process.argv.slice(2);
const result = await waitForScreenOff(remainingMs => execFileSync(adb, ['-s', serial, 'shell', 'dumpsys', 'power'], { encoding: 'utf8', timeout: Math.min(1000, remainingMs), maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] }));
writeFileSync(`${run}/performance/soak-screen-off-preflight.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
process.exitCode = result.status === 'PASS' ? 0 : 1;
NODE
    then
    SOAK_START="$(device_elapsed_millis)"
    for sample in $(seq 0 60); do
      snapshot_native "$RUN_DIR/performance/soak-current.json"
      if [[ "$sample" == 0 ]]; then SOAK_START="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).elapsedMs" "$RUN_DIR/performance/soak-current.json")"; fi
      node --input-type=module - "$RUN_DIR" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'; const run = process.argv[2], file = `${run}/performance/soak.json`;
const rows = JSON.parse(readFileSync(file)); rows.push(JSON.parse(readFileSync(`${run}/performance/soak-current.json`))); writeFileSync(file, JSON.stringify(rows, null, 2));
NODE
      [[ "$sample" == 60 ]] && break
      # Device monotonic deadlines prevent host transport from shortening the playback window.
      deadline="$(( SOAK_START + (sample + 1) * 10000 ))"
      while [[ "$(device_elapsed_millis)" -lt "$deadline" ]]; do sleep 1; done
    done
    else
      echo 'Screen-off preflight unverified; no formal soak samples collected.' >&2
    fi
    "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null
  fi
  "$ADB" -s "$SERIAL" shell dumpsys meminfo "$PACKAGE" | node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { sanitizePerformanceMemory } from "./mobile/scripts/acceptance/performance-evidence.mjs";
writeFileSync(process.argv[1], JSON.stringify(sanitizePerformanceMemory(readFileSync(0, "utf8"))), { flag: "wx", mode: 0o600 });
' "$RUN_DIR/performance/resources-meminfo.txt"
  cleanup
  native_cleanup='restore-failed'; [[ "$("$ADB" -s "$SERIAL" shell settings get global wifi_on | tr -d '\r')" == "$ORIGINAL_WIFI" ]] && native_cleanup='restored'
  node --input-type=module - "$RUN_DIR" "$STARTED_AT" "$SERIAL" "$LIVE_DURATION_MS" "$native_cleanup" <<'NODE'
import { createHash } from 'node:crypto'; import { readFileSync, writeFileSync } from 'node:fs';
import { assessContinuity, writePerformanceRecord } from './mobile/scripts/acceptance/performance-evidence.mjs';
const [run, startedAt, serial, duration, cleanup] = process.argv.slice(2);
const status = assessContinuity(JSON.parse(readFileSync(`${run}/performance/soak.json`)));
writeFileSync(`${run}/performance/continuity-status.json`, JSON.stringify({ generatedPlaybackSoak: status, providerNetworkRecovery: 'NOT_VERIFIED', duplicateQueueHistoryMutation: 'NOT_VERIFIED', anrCrashMonitoring: 'NOT_VERIFIED' }, null, 2));
writePerformanceRecord(run, startedAt, createHash('sha256').update(serial).digest('hex'), duration, cleanup);
NODE
  node mobile/scripts/acceptance/evidence.mjs --run-dir "$RUN_DIR" --write --name 08-api35-performance.json --input "$RUN_DIR/.api35-performance.json"
  rm -f "$RUN_DIR/.api35-performance.json"
  chmod a-w "$RUN_DIR/08-api35-performance.json"
  echo 'Performance samples sealed; inspect each metric and continuity limitation before claiming any requirement.'
  OUTCOME="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).outcome" "$RUN_DIR/08-api35-performance.json")"
  [[ "$OUTCOME" == PASS ]] || { echo "CHECKPOINT: performance outcome $OUTCOME; no attempts were replaced." >&2; exit 4; }
  exit 0
fi

[[ "$MODE" == compatibility && "$ATTEMPTS" == 20 && ${#API_VALUES[@]} == 2 && " ${API_VALUES[*]} " == *' 26 '* && " ${API_VALUES[*]} " == *' 36 '* ]] || fail 'compatibility requires API 26 and API 36 only'
[[ "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#compatibilityColdStart' ]] || fail 'unexpected compatibility filter'
[[ -f "$RUN_DIR/08-api35-performance.json" && ! -e "$RUN_DIR/08-performance.json" ]] || fail 'sealed API35 input/final record state is invalid'
mkdir "$RUN_DIR/.compatibility-api${DEVICE_API}-once" || fail 'compatibility window already consumed'
API35_HASH="$(sha_file "$RUN_DIR/08-api35-performance.json")"
[[ "$DEVICE_API" == 26 || "$DEVICE_API" == 36 ]] || fail 'this explicit serial must be API26 or API36'
"$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || fail 'releaseLike install failed'; "$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null || fail 'AndroidTest install failed'; instrument "$FILTER" "$RUN_DIR/performance/api${DEVICE_API}-compatibility.txt" || fail 'compatibility instrumentation failed'
COLD="$RUN_DIR/performance/api${DEVICE_API}-cold.tsv"; : > "$COLD"; for number in $(seq 1 20); do printf -v id '%02d' "$number"; sample_startup_probe "$id" >> "$COLD"; done
[[ "$API35_HASH" == "$(sha_file "$RUN_DIR/08-api35-performance.json")" ]] || fail 'sealed API35 bytes changed'
if [[ -f "$RUN_DIR/performance/api26-cold.tsv" && -f "$RUN_DIR/performance/api36-cold.tsv" ]]; then
  node mobile/scripts/acceptance/performance-evidence.mjs --aggregate-compatibility --run-dir "$RUN_DIR"
else
  echo "compatibility lane ${DEVICE_API} retained; run only the other explicit compatibility serial before aggregation" >&2
fi
