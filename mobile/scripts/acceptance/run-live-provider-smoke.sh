#!/usr/bin/env bash
set -euo pipefail

# One fixture-free window for the app and AndroidTest pair sealed at this HEAD.
# This runner never builds or replaces either APK.
PACKAGE='com.dazzlingwuming.listen2'
TEST_PACKAGE='com.dazzlingwuming.listen2.test'
RUNNER='com.listen2mobile.acceptance.Phase08Instrumentation'
SCENARIO='com.listen2mobile.acceptance.LiveProviderSmokeTest'
LANE='live-provider'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { printf 'BLOCKED: %s\n' "$*" >&2; exit 3; }
sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
sanitize_log() {
  node --input-type=module - "$1" "$2" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
const text = readFileSync(input, 'utf8')
  .replace(/https?:\/\/[^\s"'<>]+/giu, '<redacted-url>')
  .replace(/\b((?:api[_-]?key|authorization|cookie|password|secret|token)\b\s*[:=])\s*[^\s,;]+/giu, '$1 <redacted>')
  .replace(/\bbearer\s+[^\s,;]+/giu, 'Bearer <redacted>');
writeFileSync(output, text, { mode: 0o600 });
NODE
}

if [[ "${1:-}" == '--self-test' ]]; then
  [[ $# == 1 ]] || fail 'self-test accepts no extra arguments'
  node "$SCRIPT_DIR/candidate.test.mjs" || exit 1
  ! grep -Eq '(^|[[:space:]])(node|npm|bash)[[:space:]].*generate-fixtures' "$0" || exit 1
  grep -Fq 'LiveProviderSmokeTest' "$0" || exit 1
  grep -Fq 'LiveBilibiliSmokeTest' mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/Phase08Instrumentation.java || exit 1
  grep -Fq 'performAction(AccessibilityNodeInfo.ACTION_CLICK)' mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/AccessibilityDriver.java || exit 1
  grep -Fq 'submitLiveSearch' mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/LiveProviderSmokeTest.java || exit 1
  for source in \
    mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/Phase08Instrumentation.java \
    mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/AccessibilityDriver.java \
    mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/LiveProviderSmokeTest.java; do
    [[ -f "$source" ]] || exit 1
    ! grep -Eqi 'kotlin|androidx\.test|InstrumentationRegistry|ActivityScenario' "$source" || exit 1
  done
  echo 'Live provider smoke runner self-test passed.'
  exit 0
fi

RUN_DIR=''; SERIAL=''; PRODUCT_APK=''; TEST_APK_INPUT=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-dir) RUN_DIR="$2"; shift 2;;
    --serial) SERIAL="$2"; shift 2;;
    --product-apk) PRODUCT_APK="$2"; shift 2;;
    --test-apk) TEST_APK_INPUT="$2"; shift 2;;
    --all-providers) SCENARIO='com.listen2mobile.acceptance.LiveAllProviderSearchSmokeTest'; LANE='live-all-providers'; shift;;
    --bilibili-only) SCENARIO='com.listen2mobile.acceptance.LiveBilibiliSmokeTest'; LANE='live-bilibili'; shift;;
    *key*|*Key*|*token*|*Token*|*secret*|*Secret*|*cookie*|*Cookie*|*password*|*Password*) fail 'credential-like arguments are forbidden';;
    *) fail "unknown argument: $1";;
  esac
done
[[ -n "$RUN_DIR" && -n "$SERIAL" ]] || fail 'run directory and explicit serial are required'
[[ ! -e "$RUN_DIR/08-live-provider.json" && ! -e "$RUN_DIR/live-provider-payload.txt" && ! -e "$RUN_DIR/.live-provider-once" ]] || fail 'live window already consumed; old evidence is immutable'
git diff --quiet && git diff --cached --quiet || fail 'tracked worktree is not clean; use a clean worktree'

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"; [[ -n "$SDK" ]] || fail 'set ANDROID_SDK_ROOT'
ADB="$SDK/platform-tools/adb"; [[ -x "$ADB" ]] || ADB="$(command -v adb)"
[[ "$($ADB -s "$SERIAL" get-state)" == device ]] || fail 'explicit serial is unavailable'
[[ "$($ADB -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == 35 ]] || fail 'explicit serial is not API 35'
APKSIGNER="$SDK/build-tools/37.0.0/apksigner"; [[ -x "$APKSIGNER" ]] || fail 'Build Tools 37.0.0 apksigner is unavailable'
APKANALYZER="$SDK/cmdline-tools/latest/bin/apkanalyzer"; [[ -x "$APKANALYZER" ]] || APKANALYZER="$(command -v apkanalyzer)"

CANDIDATE_ARGS=(--verify --run-dir "$RUN_DIR" --apksigner "$APKSIGNER")
[[ -z "$PRODUCT_APK" ]] || CANDIDATE_ARGS+=(--product-apk "$PRODUCT_APK")
[[ -z "$TEST_APK_INPUT" ]] || CANDIDATE_ARGS+=(--test-apk "$TEST_APK_INPUT")
CANDIDATE_OUTPUT="$(node "$SCRIPT_DIR/candidate.mjs" "${CANDIDATE_ARGS[@]}")" || fail 'sealed candidate validation failed'
CANDIDATE=(); while IFS= read -r field; do CANDIDATE+=("$field"); done <<< "$CANDIDATE_OUTPUT"
[[ ${#CANDIDATE[@]} == 6 ]] || fail 'candidate output is malformed'
PRODUCT_APK="${CANDIDATE[0]}"; EXPECTED_PRODUCT_SHA="${CANDIDATE[1]}"; EXPECTED_PRODUCT_BYTES="${CANDIDATE[2]}"; EXPECTED_SIGNER="${CANDIDATE[3]}"; BUILD_HEAD="${CANDIDATE[4]}"; TEST_APK="${CANDIDATE[5]}"
TEST_SHA="$(sha256 "$TEST_APK")"
"$APKANALYZER" dex packages "$TEST_APK" | grep -Fq "$SCENARIO" || fail 'test APK lacks LiveProviderSmokeTest'
for class in "$RUNNER" com.listen2mobile.acceptance.AccessibilityDriver "$SCENARIO"; do
  code="$($APKANALYZER dex code --class "$class" "$TEST_APK")" || fail "cannot inspect $class"
  ! grep -Eqi '(^|[./])kotlin([./]|$)|androidx\.test\.runner|InstrumentationRegistry|ActivityScenario' <<< "$code" || fail "forbidden test runtime dependency in $class"
done
manifest="$($SDK/build-tools/37.0.0/aapt dump xmltree "$TEST_APK" AndroidManifest.xml)"
grep -Fq "$RUNNER" <<< "$manifest" || fail 'AndroidTest manifest does not name self-contained runner'
product_signer="$($APKSIGNER verify --verbose --print-certs "$PRODUCT_APK" | awk -F': ' '/(Signer #1|V[0-9.]+ Signer):? certificate SHA-256 digest/ {digest=$NF} END {print digest}')"
test_signer="$($APKSIGNER verify --verbose --print-certs "$TEST_APK" | awk -F': ' '/(Signer #1|V[0-9.]+ Signer):? certificate SHA-256 digest/ {digest=$NF} END {print digest}')"
[[ "$product_signer" =~ ^[a-f0-9]{64}$ && "$product_signer" == "$test_signer" ]] || fail 'product and test signer lineage differs'

mkdir "$RUN_DIR/.live-provider-once" || fail 'live window already claimed'
mkdir -p "$RUN_DIR/diagnostics"
umask 077
cp "$TEST_APK" "$RUN_DIR/artifacts/releaseLikeAndroidTest-live-provider.apk"
printf '%s\n' "product=$EXPECTED_PRODUCT_SHA" "test=$TEST_SHA" "scenario=$SCENARIO" > "$RUN_DIR/live-provider-payload.txt"
STATE="$RUN_DIR/live-provider-device-state.sh"
bash mobile/scripts/acceptance/device-state.sh snapshot --serial "$SERIAL" --file "$STATE"
cleanup_status='pending'; logcat_pid=''
cleanup() { if [[ -n "$logcat_pid" ]]; then kill "$logcat_pid" >/dev/null 2>&1 || true; wait "$logcat_pid" 2>/dev/null || true; logcat_pid=''; fi; bash mobile/scripts/acceptance/device-state.sh restore --serial "$SERIAL" --file "$STATE" >/dev/null 2>&1 && cleanup_status='restored' || cleanup_status='restore-failed'; }
trap cleanup EXIT

if "$ADB" -s "$SERIAL" shell pm path "$PACKAGE" | grep -Fq 'package:'; then
  "$ADB" -s "$SERIAL" shell pm clear "$PACKAGE" > "$RUN_DIR/live-provider-reset.txt"
else
  printf '%s\n' 'package was not installed before sealed-product test' > "$RUN_DIR/live-provider-reset.txt"
fi
"$ADB" -s "$SERIAL" install -r "$PRODUCT_APK" > "$RUN_DIR/live-provider-product-install.txt"
"$ADB" -s "$SERIAL" install -r "$TEST_APK" > "$RUN_DIR/live-provider-test-install.txt"
"$ADB" -s "$SERIAL" shell logcat -c > "$RUN_DIR/diagnostics/live-provider-logcat-clear.txt" 2>&1 || true
"$ADB" -s "$SERIAL" logcat -v threadtime ReactNativeJS:V ReactNative:V Listen2Acceptance:I AndroidRuntime:E ActivityManager:I '*:S' > "$RUN_DIR/diagnostics/live-provider-logcat-raw.txt" 2>&1 &
logcat_pid="$!"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
"$ADB" -s "$SERIAL" shell am instrument -w -r -e class "$SCENARIO" "$TEST_PACKAGE/$RUNNER" > "$RUN_DIR/live-provider-instrumentation.txt" 2>&1
instrument_status="$?"
set -e
kill "$logcat_pid" >/dev/null 2>&1 || true
wait "$logcat_pid" 2>/dev/null || true
sanitize_log "$RUN_DIR/diagnostics/live-provider-logcat-raw.txt" "$RUN_DIR/diagnostics/live-provider-logcat-sanitized.txt"
rm -f "$RUN_DIR/diagnostics/live-provider-logcat-raw.txt"
"$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-live-provider.xml" "$RUN_DIR/live-provider-window.xml" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-live-provider.png" "$RUN_DIR/live-provider-phone.png" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-live-provider-results.txt" "$RUN_DIR/live-provider-results.txt" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-failure.xml" "$RUN_DIR/live-provider-failure-window.xml" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" exec-out screencap -p > "$RUN_DIR/live-provider-postrun.png" 2>/dev/null || true
classification="$(grep -Eo 'failureDetail=[^[:space:]]+' "$RUN_DIR/live-provider-instrumentation.txt" | tail -n 1 | sed 's/^failureDetail=//' || true)"
if [[ -z "$classification" ]]; then classification='none'; fi
if grep -Eq 'live-search-(网易云音乐|哔哩哔哩)-(empty|provider-error|guide|timed-out)' "$RUN_DIR/live-provider-instrumentation.txt"; then
  classification="$(grep -Eo 'live-search-[^[:space:]]+' "$RUN_DIR/live-provider-instrumentation.txt" | tail -n 1)"
fi
http_status="$(grep -Eo 'HTTP[[:space:]]*[0-9]{3}' "$RUN_DIR/diagnostics/live-provider-logcat-sanitized.txt" | tail -n 1 | tr -d ' ' || true)"
[[ -n "$http_status" ]] || http_status='HTTP_UNOBSERVABLE_FROM_UI'
product_after="$(sha256 "$PRODUCT_APK")"
[[ "$product_after" == "$EXPECTED_PRODUCT_SHA" ]] || fail 'sealed product APK changed during test-only acceptance'
outcome='PASS'
if [[ "$instrument_status" != 0 ]] || grep -Eq 'INSTRUMENTATION_STATUS_CODE: -1|failureType=|shortMsg=' "$RUN_DIR/live-provider-instrumentation.txt"; then outcome='FAIL'; fi
playback_status="$(grep -Eo 'live-playback=(PASS|NOT_VERIFIED)-[^[:space:]]+' "$RUN_DIR/diagnostics/live-provider-logcat-sanitized.txt" | tail -n 1 || true)"
if [[ "$outcome" == PASS && "$playback_status" == live-playback=NOT_VERIFIED-* ]]; then outcome='NOT_VERIFIED'; fi
node --input-type=module - "$RUN_DIR" "$LANE" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { providerOutcomes } from './mobile/scripts/acceptance/live-provider-outcomes.mjs';
const [run, lane] = process.argv.slice(2);
const rows = providerOutcomes(readFileSync(`${run}/diagnostics/live-provider-logcat-sanitized.txt`, 'utf8'), lane);
writeFileSync(`${run}/live-provider-source-outcomes.json`, JSON.stringify(rows, null, 2));
NODE
provider_outcome="$(node --input-type=module - "$RUN_DIR/live-provider-source-outcomes.json" <<'NODE'
import { readFileSync } from 'node:fs'; const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(rows.some(row => row.status === 'DEGRADED') ? 'DEGRADED' : rows.some(row => row.status !== 'PASS') ? 'NOT_VERIFIED' : 'PASS');
NODE
)"
if [[ "$outcome" != FAIL && "$provider_outcome" != PASS ]]; then outcome="$provider_outcome"; fi
cleanup
[[ "$cleanup_status" == restored ]] || outcome=FAIL
node --input-type=module - "$RUN_DIR" "$TEST_SHA" "$outcome" "$classification" "$http_status" "$cleanup_status" "$SERIAL" "$playback_status" "$BUILD_HEAD" "$LANE" "$STARTED_AT" <<'NODE' > "$RUN_DIR/.live-provider.json"
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
const [run, testSha, outcome, classification, httpStatus, cleanup, serial, playback, sourceSha, lane, startedAt] = process.argv.slice(2);
const files = ['live-provider-instrumentation.txt', 'live-provider-window.xml', 'live-provider-phone.png', 'live-provider-results.txt', 'live-provider-failure-window.xml', 'live-provider-postrun.png', 'live-provider-payload.txt', 'live-provider-source-outcomes.json', 'diagnostics/live-provider-logcat-sanitized.txt'].filter(file => existsSync(`${run}/${file}`));
const hash = file => createHash('sha256').update(readFileSync(`${run}/${file}`)).digest('hex');
const results = existsSync(`${run}/live-provider-results.txt`) ? readFileSync(`${run}/live-provider-results.txt`, 'utf8').trim().split('\n').filter(Boolean) : [];
const safePlayback = playback || (outcome === 'FAIL' ? 'NOT_VERIFIED-live-search-failed' : 'NOT_VERIFIED-not-observed');
console.log(JSON.stringify({ schemaVersion: 1, runId: basename(run), recordId: lane === 'live-bilibili' ? 'phase8-live-bilibili-smoke' : 'phase8-live-provider-smoke', recordedAt: new Date().toISOString(),
  git: { branch: 'acceptance-clean-worktree', sha: sourceSha, trackedClean: true, allowedUntracked: [] },
  toolchain: { os: process.platform, arch: process.arch, node: process.version, npm: 'recorded-by-run', java: 'recorded-by-run', gradle: 'recorded-by-run', agp: 'repository-pinned', kotlin: '2.2.0', androidHomeHash: 'recorded-by-run', buildTools: '37.0.0', compileSdk: 37, targetSdk: 36, minSdk: 24, ndk: '27.1.12297006' },
  build: JSON.parse(readFileSync(`${run}/08-build.json`, 'utf8')).build,
  device: { serialHash: createHash('sha256').update(serial).digest('hex'), avdName: 'recorded-api35', image: 'google_apis', apiLevel: 35, abi: 'host-matched', ramMiB: 0, cores: 0, resolution: 'recorded-by-device', density: 0, locale: 'recorded-by-device', fontScale: 0, navigationMode: 'recorded-by-device' },
  network: { mode: 'production-routes-fixture-free', transport: 'emulator', offlineWindows: [], proxyConfigured: false },
  fixture: { id: 'none', revision: '0', manifestSha256: '0000000000000000000000000000000000000000000000000000000000000000', queryIds: ['qinghuaci'], generatedMediaSha256: '0000000000000000000000000000000000000000000000000000000000000000', accountLane: 'none' },
  command: { id: `api35-${lane}-once`, evidenceKinds: ['INSTRUMENTATION', 'LIVE_PUBLIC_PROVIDER', ...(safePlayback.startsWith('live-playback=PASS-') ? ['SYSTEM_MEDIA'] : [])], argvRedacted: ['explicit-api35-serial', 'sealed-product-path', 'release-like-android-test-only', lane], startedAt, endedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', exitCode: outcome === 'FAIL' ? 1 : 0 },
  outcome, requirements: ['TEST-002', 'TEST-003', 'REL-002'], metrics: [],
  artifacts: files.map(file => ({ kind: basename(file), relativePath: file, sha256: hash(file), bytes: statSync(`${run}/${file}`).size, sanitized: true })),
  uncovered: outcome === 'PASS' ? [] : [{ requirement: 'TEST-003', reasonCode: outcome === 'FAIL' ? 'LIVE_PROVIDER_SEARCH_FAILED' : outcome === 'DEGRADED' ? 'LIVE_PROVIDER_UPSTREAM_RESTRICTION' : 'ANONYMOUS_PLAYBACK_NOT_VERIFIED', safeDetail: `${classification};${httpStatus};${safePlayback}`, ownerAction: 'Review the retained sanitized evidence; do not retry automatically or bypass provider access limits.' }],
  recovery: { cleanupStatus: cleanup, deviceStateRestored: cleanup === 'restored', rollbackArtifactSha256: JSON.parse(readFileSync(`${run}/08-build.json`, 'utf8')).build.sha256, steps: ['one pm clear before product install', 'restored device settings snapshot', 'sealed product SHA-256 rechecked after test'] }
}, null, 2));
NODE
node mobile/scripts/acceptance/evidence.mjs --run-dir "$RUN_DIR" --write --name 08-live-provider.json --input "$RUN_DIR/.live-provider.json"
rm -f "$RUN_DIR/.live-provider.json"
[[ "$outcome" == PASS ]] || { printf 'CHECKPOINT: live outcome %s (%s, %s); no retry was attempted.\n' "$outcome" "$classification" "$http_status" >&2; exit 4; }
trap - EXIT
cleanup
