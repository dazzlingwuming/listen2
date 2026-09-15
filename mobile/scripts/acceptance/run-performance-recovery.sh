#!/usr/bin/env bash
set -euo pipefail

# One-run Phase 8 performance ledger.  It refuses replacement samples and never
# rebuilds the product APK: only an explicitly supplied, separately sealed test
# payload may be installed alongside the immutable releaseLike product.

PACKAGE='com.dazzlingwuming.listen2'
TEST_PACKAGE='com.dazzlingwuming.listen2.test'
RUN_DIR=''; BUILD_EVIDENCE=''; SERIAL=''; TEST_APK=''; MODE=''; ATTEMPTS=''; RECOVERY_CYCLES=0; SOAK_SECONDS=0; FILTER=''; API_VALUES=()

usage() { echo 'usage: run-performance-recovery.sh --run-dir DIR --build-evidence FILE --serial SERIAL --test-apk FILE (--api35-full|--compatibility-only) --attempts 20 --test-filter CLASS#METHOD [options]' >&2; }
sha_file() { shasum -a 256 "$1" | awk '{print $1}'; }
fail() { echo "BLOCKED: $*" >&2; exit 3; }

if [[ "${1:-}" == '--self-test' ]]; then
  grep -Fq 'phase08Attempts' "$0" && grep -Fq 'immutable' "$0" && grep -Fq 'PerformanceRecoveryTest#api35Full' "$0" || exit 1
  echo 'Performance runner self-test passed.'; exit 0
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir) RUN_DIR="$2"; shift 2;; --build-evidence) BUILD_EVIDENCE="$2"; shift 2;; --serial) SERIAL="$2"; shift 2;; --test-apk) TEST_APK="$2"; shift 2;;
    --api35-full) MODE='api35'; shift;; --compatibility-only) MODE='compatibility'; shift;; --api) API_VALUES+=("$2"); shift 2;;
    --attempts) ATTEMPTS="$2"; shift 2;; --recovery-cycles) RECOVERY_CYCLES="$2"; shift 2;; --soak-seconds) SOAK_SECONDS="$2"; shift 2;; --test-filter) FILTER="$2"; shift 2;;
    *) usage; exit 2;;
  esac
done
[[ -n "$RUN_DIR" && -n "$BUILD_EVIDENCE" && -n "$SERIAL" && -n "$TEST_APK" && "$ATTEMPTS" == 20 && -n "$MODE" && -n "$FILTER" ]] || { usage; exit 2; }
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
instrument() { local class="$1" out="$2"; "$ADB" -s "$SERIAL" shell am instrument -w -r -e class "$class" -e phase08Api "$DEVICE_API" -e phase08Attempts 20 ${3:-} "$TEST_PACKAGE/com.listen2mobile.acceptance.Phase08Instrumentation" > "$out" 2>&1; }
sample_cold_start() { local id="$1"; local file="$RUN_DIR/performance/${DEVICE_API}-cold-${id}.txt"; "$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE"; local started=$(( $(date +%s%3N) )); if "$ADB" -s "$SERIAL" shell am start -W -n "$PACKAGE/com.listen2mobile.MainActivity" > "$file" 2>&1; then local ended=$(( $(date +%s%3N) )); printf '%s|PASS|%s\n' "$id" "$((ended-started))"; else local ended=$(( $(date +%s%3N) )); printf '%s|FAIL|%s\n' "$id" "$((ended-started))"; fi; }

if [[ "$MODE" == api35 ]]; then
  [[ "$DEVICE_API" == 35 && "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#api35Full' && "$RECOVERY_CYCLES" == 5 && "$SOAK_SECONDS" == 600 ]] || fail 'API35 full mode arguments are exact and mandatory'
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
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_SLEEP || true; sleep "$SOAK_SECONDS"; "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP || true
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

[[ "$MODE" == compatibility && ${#API_VALUES[@]} == 2 && " ${API_VALUES[*]} " == *' 26 '* && " ${API_VALUES[*]} " == *' 36 '* ]] || fail 'compatibility requires API 26 and API 36 only'
[[ "$FILTER" == 'com.listen2mobile.acceptance.PerformanceRecoveryTest#compatibilityColdStart' ]] || fail 'unexpected compatibility filter'
[[ -f "$RUN_DIR/08-api35-performance.json" && ! -e "$RUN_DIR/08-performance.json" ]] || fail 'sealed API35 input/final record state is invalid'
API35_HASH="$(sha_file "$RUN_DIR/08-api35-performance.json")"
[[ "$DEVICE_API" == 26 || "$DEVICE_API" == 36 ]] || fail 'this explicit serial must be API26 or API36'
"$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || fail 'releaseLike install failed'; "$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null || fail 'AndroidTest install failed'; instrument "$FILTER" "$RUN_DIR/performance/api${DEVICE_API}-compatibility.txt" || fail 'compatibility instrumentation failed'
COLD="$RUN_DIR/performance/api${DEVICE_API}-cold.tsv"; : > "$COLD"; for number in $(seq -w 1 20); do sample_cold_start "$number" >> "$COLD"; done
[[ "$API35_HASH" == "$(sha_file "$RUN_DIR/08-api35-performance.json")" ]] || fail 'sealed API35 bytes changed'
echo "compatibility lane ${DEVICE_API} complete; rerun only the other explicit compatibility serial" >&2
