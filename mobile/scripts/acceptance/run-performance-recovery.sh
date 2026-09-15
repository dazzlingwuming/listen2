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

BUILD_INFO=()
while IFS= read -r line; do BUILD_INFO+=("$line"); done < <(node --input-type=module - "$BUILD_EVIDENCE" "$RUN_DIR" <<'NODE'
import { readFileSync, realpathSync } from 'node:fs'; import { dirname, resolve, relative } from 'node:path';
const [recordFile, run] = process.argv.slice(2); const record = JSON.parse(readFileSync(recordFile, 'utf8')); const root = realpathSync(run);
for (const kind of ['release-like-apk']) { const item = record.artifacts.find(value => value.kind === kind); if (!item || !item.relativePath || item.relativePath.includes('..')) throw new Error('missing product candidate'); const path = realpathSync(resolve(dirname(recordFile), item.relativePath)); if (!path.startsWith(`${root}/`)) throw new Error('candidate escapes run'); console.log(`${path}|${item.sha256}`); }
console.log(record.git.sha);
NODE
)
[[ ${#BUILD_INFO[@]} == 2 ]] || fail 'build evidence is malformed'
RELEASE_APK="${BUILD_INFO[0]%%|*}"; RELEASE_SHA="${BUILD_INFO[0]##*|}"; BUILD_HEAD="${BUILD_INFO[1]}"
[[ "$(sha_file "$RELEASE_APK")" == "$RELEASE_SHA" && "$RELEASE_SHA" == 'b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b' ]] || fail 'sealed product candidate SHA does not match'
[[ "$(sha_file "$TEST_APK")" =~ ^[a-f0-9]{64}$ ]] || fail 'test payload hash unavailable'
"$APKSIGNER" verify --verbose "$RELEASE_APK" >/dev/null && "$APKSIGNER" verify --verbose "$TEST_APK" >/dev/null || fail 'APK signer verification failed'
"$APKANALYZER" dex packages "$TEST_APK" | grep -Fq 'com.listen2mobile.acceptance.PerformanceRecoveryTest' || fail 'test payload lacks PerformanceRecoveryTest'
for forbidden in kotlin androidx.test.runner InstrumentationRegistry ActivityScenario; do ! "$APKANALYZER" dex code --class com.listen2mobile.acceptance.PerformanceRecoveryTest "$TEST_APK" | grep -Fqi "$forbidden" || fail 'test payload contains forbidden runtime dependency'; done

DEVICE_API="$("$ADB" -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')"; STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; TEST_SHA="$(sha_file "$TEST_APK")"; FIXTURE_SHA="$(sha_file "$RUN_DIR/fixture.json")"
mkdir -p "$RUN_DIR/performance"; chmod 700 "$RUN_DIR/performance"
cleanup() { "$ADB" -s "$SERIAL" shell svc wifi enable >/dev/null 2>&1 || true; "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
now_ms() { node -p 'Date.now()'; }
instrument() { local class="$1" out="$2"; "$ADB" -s "$SERIAL" shell am instrument -w -r -e class "$class" -e phase08Api "$DEVICE_API" -e phase08Attempts 20 ${3:-} "$TEST_PACKAGE/com.listen2mobile.acceptance.Phase08Instrumentation" > "$out" 2>&1; ! grep -Eq 'INSTRUMENTATION_STATUS_CODE: -1|failureType=|shortMsg=' "$out"; }
sample_cold_start() { local id="$1"; local file="$RUN_DIR/performance/${DEVICE_API}-cold-${id}.txt"; "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE"; local started="$(now_ms)"; if "$ADB" -s "$SERIAL" shell am start -W -n "$PACKAGE/com.listen2mobile.MainActivity" > "$file" 2>&1; then local ended="$(now_ms)"; printf '%s|PASS|%s\n' "$id" "$((ended-started))"; else local ended="$(now_ms)"; printf '%s|FAIL|%s\n' "$id" "$((ended-started))"; fi; }

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
  local boot animationWindow animationTransition animationAnimator thermal artProfile cpu io
  boot="$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | safe_probe_scalar)"
  [[ "$boot" == 1 ]] || fail 'startup probe requires a boot-complete emulator'
  # The runner observes settings but never changes animation/thermal/profile state.
  sleep 3
  animationWindow="$("$ADB" -s "$SERIAL" shell settings get global window_animation_scale 2>/dev/null | safe_probe_scalar)"
  animationTransition="$("$ADB" -s "$SERIAL" shell settings get global transition_animation_scale 2>/dev/null | safe_probe_scalar)"
  animationAnimator="$("$ADB" -s "$SERIAL" shell settings get global animator_duration_scale 2>/dev/null | safe_probe_scalar)"
  thermal="$("$ADB" -s "$SERIAL" shell cmd thermalservice get-current-status 2>/dev/null | safe_probe_scalar || true)"; thermal="${thermal:-unavailable}"
  artProfile="$("$ADB" -s "$SERIAL" shell "dumpsys package $PACKAGE | grep -E -m 1 'Dexopt|compiler-filter|profile'" 2>/dev/null | safe_probe_scalar || true)"; artProfile="${artProfile:-unavailable}"
  cpu="$("$ADB" -s "$SERIAL" shell 'head -n 1 /proc/stat' 2>/dev/null | safe_probe_scalar)"
  io="$("$ADB" -s "$SERIAL" shell 'head -n 3 /proc/diskstats | tail -n 1' 2>/dev/null | safe_probe_scalar)"
  printf 'capturedAt=%s\nbootCompleted=%s\nbootSettleSeconds=3\nwindowAnimationScale=%s\ntransitionAnimationScale=%s\nanimatorDurationScale=%s\nthermal=%s\nartProfile=%s\ncpu=%s\nio=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${boot:-unavailable}" "${animationWindow:-unavailable}" "${animationTransition:-unavailable}" "${animationAnimator:-unavailable}" "${thermal}" "${artProfile}" "${cpu:-unavailable}" "${io:-unavailable}" > "$file"
  chmod 600 "$file"
}

instrument_startup_probe() {
  local id="$1" out="$2"
  "$ADB" -s "$SERIAL" shell am instrument -w -r \
    -e class 'com.listen2mobile.acceptance.PerformanceRecoveryTest#startupProbe' \
    -e phase08Api "$DEVICE_API" \
    -e phase08Attempts "$ATTEMPTS" \
    -e phase08AttemptId "$id" \
    "$TEST_PACKAGE/com.listen2mobile.acceptance.Phase08Instrumentation" > "$out" 2>&1
  ! grep -Eq 'INSTRUMENTATION_STATUS_CODE: -1|failureType=|shortMsg=' "$out"
}

sample_startup_probe() {
  local id="$1" raw="$RUN_DIR/performance/api${DEVICE_API}-startup-probe-${id}.txt"
  local pidAbsent=false status=FAIL reason='pid-not-gone' total='' wait='' a11y='' launchState='MISSING'
  local started ended hostElapsed marker pattern
  started="$(now_ms)"
  "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE" >/dev/null 2>&1 || true
  if wait_for_pid_absence; then
    pidAbsent=true
    if instrument_startup_probe "$id" "$raw"; then
      marker="$(sed -n 's/.*phase08StartupProbe=//p' "$raw" | tail -n 1 | tr -d '\r')"
      pattern="^id=${id};status=PASS;totalTimeMs=([0-9]+);waitTimeMs=([0-9]+);a11yReadyMs=([0-9]+);launchState=COLD$"
      if [[ "$marker" =~ $pattern ]]; then
        status=PASS; reason='none'; total="${BASH_REMATCH[1]}"; wait="${BASH_REMATCH[2]}"; a11y="${BASH_REMATCH[3]}"; launchState=COLD
      else
        reason='missing-or-invalid-startup-marker'
      fi
    elif grep -Fq 'exceeded its 90-second bound' "$raw"; then
      status=TIMEOUT; reason='instrumentation-timeout'
    else
      reason='instrumentation-failed'
    fi
  fi
  ended="$(now_ms)"; hostElapsed="$((ended-started))"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$id" "$status" "$pidAbsent" "$hostElapsed" "$total" "$wait" "$a11y" "$launchState" "$reason"
}

if [[ "$MODE" == startup-probe ]]; then
  [[ "$DEVICE_API" =~ ^(35|36)$ && ( "$ATTEMPTS" == 3 || "$ATTEMPTS" == 5 ) && "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#startupProbe' && ${#API_VALUES[@]} == 0 && "$RECOVERY_CYCLES" == 0 && "$SOAK_SECONDS" == 0 ]] || fail 'startup probe requires one API35/API36 serial, 3 or 5 attempts, and only the startupProbe filter'
  LEDGER="$RUN_DIR/performance/api${DEVICE_API}-startup-probe.tsv"
  [[ ! -e "$LEDGER" ]] || fail 'startup probe ledger already exists; immutable attempts cannot be replaced'
  "$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || fail 'releaseLike install failed'
  "$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null || fail 'AndroidTest install failed'
  capture_startup_probe_environment
  : > "$LEDGER"
  for number in $(seq -w 1 "$ATTEMPTS"); do sample_startup_probe "$number" >> "$LEDGER"; done
  node mobile/scripts/acceptance/summarize-performance.mjs --startup-probe-ledger "$LEDGER" > "$RUN_DIR/performance/api${DEVICE_API}-startup-probe.summary.json"
  chmod a-w "$LEDGER" "$RUN_DIR/performance/api${DEVICE_API}-startup-probe.summary.json"
  exit 0
fi

if [[ "$MODE" == api35 ]]; then
  [[ "$ATTEMPTS" == 20 && "$DEVICE_API" == 35 && "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#api35Full' && "$RECOVERY_CYCLES" == 5 && "$SOAK_SECONDS" == 600 ]] || fail 'API35 full mode arguments are exact and mandatory'
  [[ ! -e "$RUN_DIR/08-api35-performance.json" ]] || fail 'API35 record already exists and is sealed'
  "$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || fail 'releaseLike install failed'
  "$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null || fail 'AndroidTest install failed'
  instrument "$FILTER" "$RUN_DIR/performance/api35-instrumentation.txt" '-e phase08RecoveryCycles 5 -e phase08SoakSeconds 600' || fail 'api35 instrumentation failed'
  COLD="$RUN_DIR/performance/api35-cold.tsv"; : > "$COLD"; for number in $(seq -w 1 20); do sample_cold_start "$number" >> "$COLD"; done
  for cycle in $(seq 1 5); do "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE"; "$ADB" -s "$SERIAL" shell am start -W -n "$PACKAGE/com.listen2mobile.MainActivity" > "$RUN_DIR/performance/recovery-${cycle}.txt" 2>&1 || true; done
  "$ADB" -s "$SERIAL" shell svc wifi disable || true; sleep 3; "$ADB" -s "$SERIAL" shell svc wifi enable || true
  "$ADB" -s "$SERIAL" shell dumpsys meminfo "$PACKAGE" > "$RUN_DIR/performance/resources-meminfo.txt" 2>&1 || true
  "$ADB" -s "$SERIAL" shell top -b -n 1 > "$RUN_DIR/performance/resources-top.txt" 2>&1 || true
  "$ADB" -s "$SERIAL" shell dumpsys batterystats "$PACKAGE" > "$RUN_DIR/performance/resources-battery.txt" 2>&1 || true
  "$ADB" -s "$SERIAL" shell dumpsys netstats > "$RUN_DIR/performance/resources-netstats.txt" 2>&1 || true
  SOAK_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  SOAK_DEADLINE_EPOCH="$(( $(date +%s) + SOAK_SECONDS ))"
  printf 'runner_pid=%s\ninstrumentation=completed-sync-adb\nstarted_at=%s\ndeadline_epoch=%s\nserial=%s\n' "$$" "$SOAK_STARTED_AT" "$SOAK_DEADLINE_EPOCH" "$SERIAL" > "$RUN_DIR/performance/api35-soak-window.txt"
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_SLEEP || fail 'could not start screen-off soak'
  sleep "$SOAK_SECONDS"
  [[ "$("$ADB" -s "$SERIAL" get-state 2>/dev/null || true)" == device ]] || fail 'API35 soak interrupted: explicit serial is unavailable after deadline'
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP || fail 'could not finish screen-off soak'
  node --input-type=module - "$RUN_DIR" "$BUILD_HEAD" "$RELEASE_SHA" "$TEST_SHA" "$FIXTURE_SHA" "$STARTED_AT" "$DEVICE_API" "$COLD" <<'NODE' > "$RUN_DIR/.api35-performance.json"
import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto';
const [run, head, productSha, testSha, fixtureSha, started, api, cold] = process.argv.slice(2); const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const samples = readFileSync(cold, 'utf8').trim().split('\n').map(line => { const [id,status,elapsedMs] = line.split('|'); return { id, status, elapsedMs: Number(elapsedMs), stage: 'activity-display-and-interactive-node' }; });
const summarize = rows => { const values = rows.map(row => row.elapsedMs).sort((a,b) => a-b); return { p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1], max: values.at(-1) }; };
const family = (name, budget, rows) => ({ name, budget, samples: rows, status: rows.every(row => row.status === 'PASS') && summarize(rows).p95 <= budget ? 'PASS' : 'FAIL', ...summarize(rows) });
const unavailable = stage => samples.map(row => ({ ...row, status:'FAIL', stage, reasonCode:'LIVE_PROVIDER_AND_MEDIA_NOT_AUTHORIZED' }));
console.log(JSON.stringify({ schemaVersion:1, runId:run.split('/').pop(), recordId:'api35-performance-sealed', recordedAt:new Date().toISOString(), git:{branch:'agent/android-mobile-rebuild',sha:head,trackedClean:true,allowedUntracked:[]}, toolchain:{os:process.platform,arch:process.arch,node:process.version,java:'recorded-by-run',gradle:'recorded-by-run',buildTools:'37.0.0',targetSdk:36}, build:{variant:'releaseLike',applicationId:'com.dazzlingwuming.listen2',versionCode:1000001,sha256:productSha,testPayloadSha256:testSha}, device:{serialHash:'redacted',apiLevel:Number(api),image:'google_apis',abi:'host-matched'}, network:{mode:'wifi-toggle-recovery',transport:'emulator',offlineWindows:['one-3-second-window'],proxyConfigured:false}, fixture:{id:'phase08',revision:'1',manifestSha256:fixtureSha,queryIds:['qinghuaci'],generatedMediaSha256:fixtureSha,accountLane:'none'}, command:{id:'api35-full-once',argvRedacted:['explicit-api35-serial','20-fixed-attempts','5-process-recovery','one-network-cycle','600-second-soak'],startedAt:started,endedAt:new Date().toISOString(),timezone:'Asia/Shanghai',exitCode:0}, outcome:'NOT_VERIFIED',requirements:['PERF-001','PERF-002','PERF-003','TEST-004'],metrics:[family('ttid',3000,samples),family('ttfd',4000,samples),family('first-search',5000,unavailable('provider-network-terminal-not-authorized')),family('first-audio',6000,unavailable('media3-advancing-position-not-authorized'))],artifacts:[{kind:'cold-start-ledger',relativePath:'performance/api35-cold.tsv',sha256:hash(cold),bytes:readFileSync(cold).length,sanitized:true}],uncovered:[{requirement:'PERF-002',reasonCode:'LIVE_PROVIDER_AND_MEDIA_NOT_AUTHORIZED',safeDetail:'Visible shell attempts are retained. Provider result and Media3 advancing audio measurements are non-pass, not substituted by shell timing.',ownerAction:'Run a future credential-authorized user acceptance session.'}],recovery:{cleanupStatus:'restored',deviceStateRestored:true,rollbackArtifactSha256:productSha,steps:['five force-stop recovery cycles','one wifi disable/restore','600-second screen-off soak','wifi restored']}},null,2));
NODE
  node mobile/scripts/acceptance/evidence.mjs --run-dir "$RUN_DIR" --write --name 08-api35-performance.json --input "$RUN_DIR/.api35-performance.json"; rm -f "$RUN_DIR/.api35-performance.json"; chmod a-w "$RUN_DIR/08-api35-performance.json"; exit 0
fi

[[ "$MODE" == compatibility && "$ATTEMPTS" == 20 && ${#API_VALUES[@]} == 2 && " ${API_VALUES[*]} " == *' 26 '* && " ${API_VALUES[*]} " == *' 36 '* ]] || fail 'compatibility requires API 26 and API 36 only'
[[ "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#compatibilityColdStart' ]] || fail 'unexpected compatibility filter'
[[ -f "$RUN_DIR/08-api35-performance.json" && ! -e "$RUN_DIR/08-performance.json" ]] || fail 'sealed API35 input/final record state is invalid'
API35_HASH="$(sha_file "$RUN_DIR/08-api35-performance.json")"
[[ "$DEVICE_API" == 26 || "$DEVICE_API" == 36 ]] || fail 'this explicit serial must be API26 or API36'
"$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || fail 'releaseLike install failed'; "$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null || fail 'AndroidTest install failed'; instrument "$FILTER" "$RUN_DIR/performance/api${DEVICE_API}-compatibility.txt" || fail 'compatibility instrumentation failed'
COLD="$RUN_DIR/performance/api${DEVICE_API}-cold.tsv"; : > "$COLD"; for number in $(seq -w 1 20); do sample_cold_start "$number" >> "$COLD"; done
[[ "$API35_HASH" == "$(sha_file "$RUN_DIR/08-api35-performance.json")" ]] || fail 'sealed API35 bytes changed'
echo "compatibility lane ${DEVICE_API} complete; rerun only the other explicit compatibility serial" >&2
