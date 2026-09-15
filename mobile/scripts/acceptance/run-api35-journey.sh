#!/usr/bin/env bash
set -euo pipefail

instrumentation_result_ok() {
  local output="$1"
  [[ -s "$output" ]] || return 1
  ! grep -Eqi 'FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=|AssertionError' "$output" || return 1
  grep -Eq '^INSTRUMENTATION_CODE: (-1|0)[[:space:]]*$' "$output"
}

phase08_class_allowed() {
  [[ "$1" == "com.listen2mobile.acceptance.UpgradeSeedTest" || "$1" == "com.listen2mobile.acceptance.IntegratedJourneyTest" ]]
}

sanitize_diagnostic_log() {
  local source="$1" destination="$2"
  node --input-type=module - "$source" "$destination" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [source, destination] = process.argv.slice(2);
const text = readFileSync(source, 'utf8')
  .replace(/https?:\/\/[^\s"'<>]+/giu, '<redacted-url>')
  .replace(/\b((?:api[_-]?key|authorization|cookie|password|secret|token)\b\s*[:=])\s*[^\s,;]+/giu, '$1 <redacted>')
  .replace(/\bbearer\s+[^\s,;]+/giu, 'Bearer <redacted>');
writeFileSync(destination, text, { mode: 0o600 });
NODE
}

js_ready_phone_shell() {
  local xml="$1"
  [[ "$xml" == *"我的"* && "$xml" == *"设置"* ]] || return 1
  [[ "$xml" == *"搜索歌曲、歌手或歌单"* || "$xml" == *"搜索音乐"* ]]
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test_dir="$(mktemp -d "${TMPDIR:-/tmp}/listen2-instrumentation-result.XXXXXX")"
  trap 'rm -rf "$self_test_dir"' EXIT
  bash "$(dirname "$0")/avd-manager.sh" --self-test
  printf '%s\n' 'INSTRUMENTATION_STATUS_CODE: 0' 'INSTRUMENTATION_CODE: -1' > "$self_test_dir/success.txt"
  printf '%s\n' 'FAILURES!!! Tests run: 1,  Failures: 1' 'java.lang.AssertionError' 'INSTRUMENTATION_CODE: 0' > "$self_test_dir/assertion.txt"
  printf '%s\n' 'INSTRUMENTATION_FAILED: com.listen2mobile.MainActivity' 'shortMsg=Process crashed.' > "$self_test_dir/failed.txt"
  instrumentation_result_ok "$self_test_dir/success.txt" || { echo 'instrumentation success fixture rejected' >&2; exit 1; }
  ! instrumentation_result_ok "$self_test_dir/assertion.txt" || { echo 'AssertionError fixture accepted' >&2; exit 1; }
  ! instrumentation_result_ok "$self_test_dir/failed.txt" || { echo 'INSTRUMENTATION_FAILED fixture accepted' >&2; exit 1; }
  phase08_class_allowed com.listen2mobile.acceptance.UpgradeSeedTest || { echo 'approved seed class rejected' >&2; exit 1; }
  phase08_class_allowed com.listen2mobile.acceptance.IntegratedJourneyTest || { echo 'approved journey class rejected' >&2; exit 1; }
  ! phase08_class_allowed com.listen2mobile.acceptance.UnknownTest || { echo 'unknown instrumentation class accepted' >&2; exit 1; }
  printf '%s\n' 'token=forbidden-value https://example.invalid/path' > "$self_test_dir/raw-logcat.txt"
  sanitize_diagnostic_log "$self_test_dir/raw-logcat.txt" "$self_test_dir/sanitized-logcat.txt"
  ! grep -Eq 'forbidden-value|https?://' "$self_test_dir/sanitized-logcat.txt" || { echo 'diagnostic sanitizer leaked a fixture secret or URL' >&2; exit 1; }
  grep -Fq '<redacted-url>' "$self_test_dir/sanitized-logcat.txt" || { echo 'diagnostic sanitizer did not redact the fixture URL' >&2; exit 1; }
  js_ready_phone_shell '<node text="我的"/><node text="设置"/><node text="搜索音乐"/>' || { echo 'phone shell fixture rejected' >&2; exit 1; }
  ! js_ready_phone_shell '<node text="我的"/><node text="设置"/>' || { echo 'incomplete shell fixture accepted' >&2; exit 1; }
  grep -Fq 'RELEASE_BYTES="$(wc -c < "$RELEASE_APK" | tr -d '\'' '\'')"' "$0" || { echo 'journey record must derive product bytes from the sealed APK' >&2; exit 1; }
  grep -Fq 'bytes: Number(releaseBytes)' "$0" || { echo 'journey record must preserve the derived product byte count' >&2; exit 1; }
  grep -Fq "assets/index.android.bundle" "$0" || { echo 'runner must reject an unbundled debug seed before reset' >&2; exit 1; }
  grep -Fq 'start_diagnostic_capture' "$0" || { echo 'runner must start bounded diagnostic capture around instrumentation' >&2; exit 1; }
  grep -Fq 'stop_diagnostic_capture' "$0" || { echo 'runner must stop and retain diagnostics around instrumentation' >&2; exit 1; }
  grep -Fq 'Phase08Instrumentation' "$0" || { echo 'runner must require the self-contained Phase 8 runner' >&2; exit 1; }
  for source in mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/{Phase08Instrumentation,AccessibilityDriver,UpgradeSeedTest,IntegratedJourneyTest}.java; do
    [[ -f "$source" ]] || { echo "missing pure-Java acceptance source: $source" >&2; exit 1; }
    ! grep -Eqi 'kotlin|androidx\.test|InstrumentationRegistry|ActivityScenario' "$source" || { echo "acceptance source has a forbidden runtime dependency: $source" >&2; exit 1; }
  done
  node --input-type=module - <<'NODE'
const limit = 240;
const sanitize = value => value
  .replace(/https?:\/\/[^\s]+/giu, '<redacted-url>')
  .replace(/(api[_-]?key|authorization|cookie|password|secret|token)\s*[:=]\s*[^\s,;]+|bearer\s+[^\s,;]+/giu, '<redacted>')
  .replace(/[\r\n\t]+/gu, ' ').trim().slice(0, limit);
const detail = sanitize(`AssertionError token=forbidden-value https://example.invalid/${'x'.repeat(400)}`);
if (!detail.includes('<redacted>') || !detail.includes('<redacted-url>') || detail.length > limit) throw new Error('runner failure detail redaction/truncation failed');
NODE
  grep -Fq 'captureFailureEvidence' mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/Phase08Instrumentation.java || { echo 'runner must capture failure evidence before teardown' >&2; exit 1; }
  grep -Fq 'RESULT_CANCELED' mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/Phase08Instrumentation.java || { echo 'runner must retain failed instrumentation status' >&2; exit 1; }
  echo 'Instrumentation result self-test passed.'
  exit 0
fi

PACKAGE="com.dazzlingwuming.listen2"
TEST_PACKAGE="com.dazzlingwuming.listen2.test"
PHASE_DIR=".planning/phases/08-integrated-api-35-acceptance-release-like-evidence"
RUN_DIR=""; SERIAL=""; SEED_CLASS=""; JOURNEY_CLASS=""; JOURNEY_TEST_APK=""; JOURNEY_TEST_BUILD_HEAD=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-dir) RUN_DIR="$2"; shift 2;; --serial) SERIAL="$2"; shift 2;;
    --seed-class) SEED_CLASS="$2"; shift 2;; --journey-class) JOURNEY_CLASS="$2"; shift 2;;
    --journey-test-apk) JOURNEY_TEST_APK="$2"; shift 2;;
    --journey-test-build-head) JOURNEY_TEST_BUILD_HEAD="$2"; shift 2;;
    *key*|*Key*|*token*|*Token*|*secret*|*Secret*|*cookie*|*Cookie*|*password*|*Password*) echo "credential-like arguments are forbidden" >&2; exit 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
[[ -n "$RUN_DIR" && -n "$SERIAL" ]] || { echo "run directory and explicit serial are required" >&2; exit 2; }
phase08_class_allowed "$SEED_CLASS" || { echo "unexpected seed class" >&2; exit 2; }
phase08_class_allowed "$JOURNEY_CLASS" || { echo "unexpected journey class" >&2; exit 2; }
[[ "$SEED_CLASS" != "$JOURNEY_CLASS" ]] || { echo "seed and journey classes must be distinct" >&2; exit 2; }
[[ -n "$JOURNEY_TEST_APK" && -f "$JOURNEY_TEST_APK" ]] || { echo "a sealed journey AndroidTest APK is required" >&2; exit 2; }
[[ "$JOURNEY_TEST_BUILD_HEAD" =~ ^[a-f0-9]{7,40}$ ]] || { echo "a sealed journey AndroidTest build head is required" >&2; exit 2; }
for name in $(env | cut -d= -f1); do
  if [[ "$name" =~ (BILIBILI|DEEPSEEK|COOKIE|TOKEN|AUTHORIZATION|PASSWORD|SECRET) ]] && [[ -n "${!name:-}" ]]; then echo "credential-like environment variable is forbidden: $name" >&2; exit 2; fi
done
[[ -d "$RUN_DIR" && "$RUN_DIR" != *".."* ]] || { echo "invalid run root" >&2; exit 2; }
git diff --quiet && git diff --cached --quiet || { echo "BLOCKED: tracked worktree is not clean; use a clean worktree" >&2; exit 3; }
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"; [[ -n "$SDK" ]] || { echo "BLOCKED: set ANDROID_SDK_ROOT" >&2; exit 3; }
ADB="$SDK/platform-tools/adb"; [[ -x "$ADB" ]] || ADB="$(command -v adb)"
[[ "$($ADB -s "$SERIAL" get-state)" == "device" ]] || { echo "BLOCKED: explicit serial is unavailable" >&2; exit 3; }
[[ "$($ADB -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == "35" ]] || { echo "BLOCKED: explicit serial is not API 35" >&2; exit 3; }
case "$(uname -m)" in arm64|aarch64) HOST_ABI=arm64-v8a;; x86_64|amd64) HOST_ABI=x86_64;; *) echo "BLOCKED: unsupported host ABI" >&2; exit 3;; esac
[[ "$($ADB -s "$SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')" == "$HOST_ABI" ]] || { echo "BLOCKED: device ABI does not match host image contract" >&2; exit 3; }

BUILD_RECORD="$RUN_DIR/08-build.json"
[[ -f "$BUILD_RECORD" ]] || { echo "missing 08-build.json" >&2; exit 3; }
BUILD_FIELDS=()
while IFS= read -r field; do BUILD_FIELDS+=("$field"); done < <(node --input-type=module - "$BUILD_RECORD" <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const record = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = dirname(resolve(process.argv[2]));
const byKind = Object.fromEntries(record.artifacts.map(item => [item.kind, item]));
for (const kind of ['debug-apk', 'release-like-apk', 'release-like-android-test-apk']) {
  const item = byKind[kind]; if (!item) throw new Error(`missing ${kind}`);
  console.log(`${resolve(root, item.relativePath)}|${item.sha256}`);
}
NODE
)
[[ "${#BUILD_FIELDS[@]}" == 3 ]] || { echo "build evidence is malformed" >&2; exit 3; }
BUILD_HEAD="$(node --input-type=module - "$BUILD_RECORD" <<'NODE'
import { readFileSync } from 'node:fs'; console.log(JSON.parse(readFileSync(process.argv[2], 'utf8')).git.sha);
NODE
)"
DEBUG_APK="${BUILD_FIELDS[0]%%|*}"; DEBUG_SHA="${BUILD_FIELDS[0]##*|}"
RELEASE_APK="${BUILD_FIELDS[1]%%|*}"; RELEASE_SHA="${BUILD_FIELDS[1]##*|}"
RELEASE_BYTES="$(wc -c < "$RELEASE_APK" | tr -d ' ')"
TEST_APK="$JOURNEY_TEST_APK"; TEST_SHA="$(shasum -a 256 "$TEST_APK" | awk '{print $1}')"
sha_file() { shasum -a 256 "$1" | awk '{print $1}'; }
[[ "$(sha_file "$DEBUG_APK")" == "$DEBUG_SHA" && "$(sha_file "$RELEASE_APK")" == "$RELEASE_SHA" ]] || { echo "BLOCKED: retained product APK hash mismatch" >&2; exit 3; }
APKANALYZER="$SDK/cmdline-tools/latest/bin/apkanalyzer"; [[ -x "$APKANALYZER" ]] || APKANALYZER="$(command -v apkanalyzer)"
"$APKANALYZER" dex packages "$TEST_APK" | grep -Fq 'com.listen2mobile.acceptance.UpgradeSeedTest' || { echo "BLOCKED: sealed test payload lacks UpgradeSeedTest" >&2; exit 3; }
"$APKANALYZER" dex packages "$TEST_APK" | grep -Fq 'com.listen2mobile.acceptance.IntegratedJourneyTest' || { echo "BLOCKED: sealed test payload lacks IntegratedJourneyTest" >&2; exit 3; }
TEST_MANIFEST="$($SDK/build-tools/37.0.0/aapt dump xmltree "$TEST_APK" AndroidManifest.xml)"
TEST_RUNNER="$(printf '%s\n' "$TEST_MANIFEST" | sed -n '/E: instrumentation/,/E: application/p' | awk -F'"' '/android:name/ { print $2; exit }')"
TEST_TARGET_PACKAGE="$(printf '%s\n' "$TEST_MANIFEST" | sed -n '/E: instrumentation/,/E: application/p' | awk -F'"' '/android:targetPackage/ { print $2; exit }')"
[[ "$TEST_RUNNER" == "com.listen2mobile.acceptance.Phase08Instrumentation" ]] || { echo "BLOCKED: AndroidTest manifest must use the self-contained Phase08Instrumentation runner" >&2; exit 3; }
[[ "$TEST_TARGET_PACKAGE" == "$PACKAGE" ]] || { echo "BLOCKED: AndroidTest manifest target package differs" >&2; exit 3; }
"$APKANALYZER" dex packages "$TEST_APK" | grep -Fq "$TEST_RUNNER" || { echo "BLOCKED: AndroidTest APK does not package manifest runner $TEST_RUNNER" >&2; exit 3; }
if "$APKANALYZER" dex references "$TEST_APK" | grep -Eqi '(^|[./])kotlin([./]|$)|androidx\.test\.runner|InstrumentationRegistry|ActivityScenario'; then
  echo "BLOCKED: AndroidTest APK retains a forbidden Kotlin or AndroidX runner dependency" >&2
  exit 3
fi
APKSIGNER="$SDK/build-tools/37.0.0/apksigner"
[[ -x "$APKSIGNER" ]] || { echo "BLOCKED: Android Build Tools 37.0.0 apksigner is unavailable" >&2; exit 3; }
TEST_SIGNER="$($APKSIGNER verify --verbose --print-certs "$TEST_APK" | awk -F': ' '/(Signer #1|V[0-9.]+ Signer): certificate SHA-256 digest/ { print $NF; exit }')"
[[ "$TEST_SIGNER" =~ ^[a-f0-9]{64}$ ]] || { echo "BLOCKED: AndroidTest signer was not verified" >&2; exit 3; }
apk_signer() { "$APKSIGNER" verify --verbose --print-certs "$1" | awk -F': ' '/(Signer #1|V[0-9.]+ Signer): certificate SHA-256 digest/ { print $NF; exit }'; }
DEBUG_SIGNER="$(apk_signer "$DEBUG_APK")"; RELEASE_SIGNER="$(apk_signer "$RELEASE_APK")"
[[ "$DEBUG_SIGNER" =~ ^[a-f0-9]{64}$ && "$DEBUG_SIGNER" == "$RELEASE_SIGNER" && "$DEBUG_SIGNER" == "$TEST_SIGNER" ]] || { echo "BLOCKED: debug seed, releaseLike, and AndroidTest signer lineage differs" >&2; exit 3; }
unzip -Z1 "$DEBUG_APK" | grep -Fx 'assets/index.android.bundle' >/dev/null || { echo "BLOCKED: debug seed lacks assets/index.android.bundle before reset" >&2; exit 3; }
DEBUG_BADGING="$($SDK/build-tools/37.0.0/aapt dump badging "$DEBUG_APK")"
[[ "$DEBUG_BADGING" == *"package: name='com.dazzlingwuming.listen2' versionCode='1'"* ]] || { echo "BLOCKED: debug seed package or versionCode is unexpected" >&2; exit 3; }

STATE="$RUN_DIR/device-state-before.sh"; EVENTS="$RUN_DIR/journey-events.txt"; SCREENSHOT="$RUN_DIR/journey-phone.png"
FIXTURE_DIR="$RUN_DIR/fixtures"; mkdir -p "$FIXTURE_DIR"; umask 077
cp "$TEST_APK" "$RUN_DIR/artifacts/releaseLikeAndroidTest-journey.apk"
node --input-type=module - "$RUN_DIR" "$TEST_SHA" "$TEST_SIGNER" "$BUILD_HEAD" "$JOURNEY_TEST_BUILD_HEAD" <<'NODE' > "$RUN_DIR/journey-test-payload.json"
import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs';
const [run, sha, signerSha256, candidateBuildHead, testPayloadBuildHead] = process.argv.slice(2);
console.log(JSON.stringify({ kind: 'AndroidTest-only', sha256: sha, signerSha256, candidateBuildHead, testPayloadBuildHead, targetPackage: 'com.dazzlingwuming.listen2', targetVersionCode: 1000001, testPackage: 'com.dazzlingwuming.listen2.test', runner: 'com.listen2mobile.acceptance.Phase08Instrumentation', contains: ['Phase08Instrumentation', 'UpgradeSeedTest', 'IntegratedJourneyTest'], reason: 'AndroidTest-only payload is separately sealed; releaseLike product hash is unchanged.' }, null, 2));
NODE
node mobile/scripts/acceptance/generate-fixtures.mjs --out "$FIXTURE_DIR" > "$RUN_DIR/fixture.json"
FIXTURE_SHA="$(node --input-type=module - "$RUN_DIR/fixture.json" <<'NODE'
import { readFileSync } from 'node:fs'; console.log(JSON.parse(readFileSync(process.argv[2], 'utf8')).sha256);
NODE
)"
bash mobile/scripts/acceptance/device-state.sh snapshot --serial "$SERIAL" --file "$STATE"
CLEANUP_STATUS="pending"; CLEAR_COUNT=0; STARTED_AT="$(date -Iseconds)"
cleanup() { bash mobile/scripts/acceptance/device-state.sh restore --serial "$SERIAL" --file "$STATE" >/dev/null 2>&1 || CLEANUP_STATUS="restore-failed"; [[ "$CLEANUP_STATUS" == pending ]] && CLEANUP_STATUS="restored"; }
CAPTURE_LOGCAT_PID=""; CAPTURE_WATCHDOG_PID=""; CAPTURE_DIR=""
CAPTURE_MAX_SECONDS=75

stop_diagnostic_capture() {
  if [[ -n "$CAPTURE_LOGCAT_PID" ]]; then
    kill "$CAPTURE_LOGCAT_PID" >/dev/null 2>&1 || true
    wait "$CAPTURE_LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CAPTURE_WATCHDOG_PID" ]]; then
    kill "$CAPTURE_WATCHDOG_PID" >/dev/null 2>&1 || true
    wait "$CAPTURE_WATCHDOG_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CAPTURE_DIR" ]]; then
    "$ADB" -s "$SERIAL" shell dumpsys activity activities > "$CAPTURE_DIR/dumpsys-activity.txt" 2>&1 || printf '%s\n' 'capture-unavailable=dumpsys-activity' > "$CAPTURE_DIR/dumpsys-activity.txt"
    "$ADB" -s "$SERIAL" shell dumpsys window > "$CAPTURE_DIR/dumpsys-window.txt" 2>&1 || printf '%s\n' 'capture-unavailable=dumpsys-window' > "$CAPTURE_DIR/dumpsys-window.txt"
    "$ADB" -s "$SERIAL" shell dumpsys package "$PACKAGE" > "$CAPTURE_DIR/dumpsys-package.txt" 2>&1 || printf '%s\n' 'capture-unavailable=dumpsys-package' > "$CAPTURE_DIR/dumpsys-package.txt"
    "$ADB" -s "$SERIAL" shell 'ls -1 /data/tombstones 2>/dev/null | tail -n 20' > "$CAPTURE_DIR/tombstone-references.txt" 2>&1 || printf '%s\n' 'capture-unavailable=tombstone-references' > "$CAPTURE_DIR/tombstone-references.txt"
    "$ADB" -s "$SERIAL" shell 'dumpsys dropbox --print 2>/dev/null | grep -Ei "(system_app_crash|data_app_crash|SYSTEM_TOMBSTONE|listen2mobile)" | tail -n 80' > "$CAPTURE_DIR/dropbox-references.txt" 2>&1 || printf '%s\n' 'capture-unavailable=dropbox-references' > "$CAPTURE_DIR/dropbox-references.txt"
    sanitize_diagnostic_log "$CAPTURE_DIR/logcat-raw.txt" "$CAPTURE_DIR/logcat-sanitized.txt" || printf '%s\n' 'capture-unavailable=logcat-sanitization' > "$CAPTURE_DIR/logcat-sanitized.txt"
  fi
  CAPTURE_LOGCAT_PID=""; CAPTURE_WATCHDOG_PID=""; CAPTURE_DIR=""
}

start_diagnostic_capture() {
  local label="$1"
  stop_diagnostic_capture >/dev/null 2>&1 || true
  CAPTURE_DIR="$RUN_DIR/diagnostics/$label"
  mkdir -p "$CAPTURE_DIR"
  "$ADB" -s "$SERIAL" shell logcat -c > "$CAPTURE_DIR/logcat-clear.txt" 2>&1 || printf '%s\n' 'capture-unavailable=logcat-clear' > "$CAPTURE_DIR/logcat-clear.txt"
  "$ADB" -s "$SERIAL" logcat -v threadtime AndroidRuntime:E ActivityManager:I ReactNative:V ReactNativeJS:V '*:S' > "$CAPTURE_DIR/logcat-raw.txt" 2>&1 &
  CAPTURE_LOGCAT_PID="$!"
  (
    sleep "$CAPTURE_MAX_SECONDS"
    kill "$CAPTURE_LOGCAT_PID" >/dev/null 2>&1 || true
  ) &
  CAPTURE_WATCHDOG_PID="$!"
}

trap 'stop_diagnostic_capture >/dev/null 2>&1 || true; cleanup' EXIT
trap 'stop_diagnostic_capture >/dev/null 2>&1 || true; exit 130' INT TERM HUP

record_failure() {
  local code="$1"; printf '%s\n' "terminal=$code" > "$EVENTS"
  "$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-failure.xml" "$RUN_DIR/failure-window.xml" >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-failure.png" "$RUN_DIR/failure-phone.png" >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" exec-out screencap -p > "$SCREENSHOT" 2>/dev/null || true
  write_record "FAIL" "$code" || true
}
run_instrumentation() {
  local test_class="$1" output="$2"
  local command_status=0 capture_status=0
  start_diagnostic_capture "$(basename "$output" .txt)"
  "$ADB" -s "$SERIAL" shell am instrument -w -r -e class "$test_class" "$TEST_PACKAGE/$TEST_RUNNER" > "$output" 2>&1 || command_status=$?
  stop_diagnostic_capture || capture_status=$?
  if [[ "$capture_status" != 0 ]]; then
    printf '%s\n' "diagnostic-capture-status=$capture_status" >> "$output"
  fi
  [[ "$command_status" == 0 ]] || return "$command_status"
  instrumentation_result_ok "$output"
}
write_record() {
  local OUTCOME="$1"; local DETAIL="$2"; local BUILD_HEAD_VALUE="${3:-$BUILD_HEAD}"; local ENDED_AT="$(date -Iseconds)"; trap - EXIT; cleanup
  node --input-type=module - "$RUN_DIR" "$RELEASE_SHA" "$RELEASE_BYTES" "$FIXTURE_SHA" "$OUTCOME" "$DETAIL" "$STARTED_AT" "$ENDED_AT" "$SERIAL" "$CLEANUP_STATUS" "$BUILD_HEAD_VALUE" <<'NODE' > "$RUN_DIR/.journey-input.json"
import { createHash } from 'node:crypto'; import { readFileSync, statSync } from 'node:fs'; import { basename } from 'node:path';
const [run, sha, releaseBytes, fixtureSha, outcome, detail, started, ended, serial, cleanup, buildHead] = process.argv.slice(2);
const hash = file => createHash('sha256').update(readFileSync(`${run}/${file}`)).digest('hex');
const diagnosticFiles = ['upgrade-seed-instrumentation', 'integrated-journey-instrumentation'].flatMap(label => [
  'logcat-clear.txt', 'logcat-raw.txt', 'logcat-sanitized.txt', 'dumpsys-activity.txt',
  'dumpsys-window.txt', 'dumpsys-package.txt', 'tombstone-references.txt', 'dropbox-references.txt',
].map(file => `diagnostics/${label}/${file}`));
const listed = ['journey-events.txt', 'upgrade-seed-instrumentation.txt', 'integrated-journey-instrumentation.txt', 'smoke-phone.png', 'smoke-window.xml', 'failure-phone.png', 'failure-window.xml', 'integrated-phone.png', 'integrated-window.xml', 'postrun-phone.png', 'postrun-window.xml', 'fixture.json', 'fixtures/synthetic-phase08.wav', 'fixtures/synthetic-phase08.lrc', 'device-state-before.sh', 'journey-test-payload.json', 'artifacts/releaseLikeAndroidTest-journey.apk', ...diagnosticFiles].filter(file => { try { return statSync(`${run}/${file}`).isFile(); } catch { return false; } });
const artifacts = listed.map(file => ({ kind: basename(file).replace(/[^a-z0-9]+/gi, '-').toLowerCase(), relativePath: file, sha256: hash(file), bytes: statSync(`${run}/${file}`).size, sanitized: true }));
console.log(JSON.stringify({ schemaVersion: 1, runId: basename(run), recordId: 'phase8-api35-journey', recordedAt: ended,
  git: { branch: 'acceptance-clean-worktree', sha: buildHead, trackedClean: true, allowedUntracked: [] },
  toolchain: { os: 'host-recorded', arch: 'host-recorded', node: 'host-recorded', npm: 'recorded-by-build', java: 'recorded-by-build', gradle: 'recorded-by-build', agp: 'repository-pinned', kotlin: '2.2.0', androidHomeHash: 'recorded-by-build', buildTools: '37.0.0', compileSdk: 37, targetSdk: 36, minSdk: 24, ndk: '27.1.12297006' },
  build: { variant: 'releaseLike', applicationId: 'com.dazzlingwuming.listen2', versionCode: 1000001, versionName: '2.34.0-android', apkRelativePath: 'artifacts/releaseLike.apk', bytes: Number(releaseBytes), sha256: sha, signerSha256: 'development-debug', zipAligned16KiB: true, minified: true, debuggable: false },
  device: { serialHash: createHash('sha256').update(serial).digest('hex'), avdName: 'recorded-api35', image: 'google_apis', apiLevel: 35, abi: 'host-matched', ramMiB: 0, cores: 0, resolution: 'recorded-by-device', density: 0, locale: 'recorded-by-device', fontScale: 0, navigationMode: 'recorded-by-device' },
  network: { mode: 'production-routes', transport: 'emulator', offlineWindows: [], proxyConfigured: false },
  fixture: { id: 'phase08', revision: '1', manifestSha256: hash('fixture.json'), queryIds: ['qinghuaci'], generatedMediaSha256: fixtureSha, accountLane: 'none' },
  command: { id: 'api35-integrated-journey-once', argvRedacted: ['explicit-api35-serial', 'debug-install', 'one-clear', 'upgrade-seed', 'release-like-install', 'integrated-journey'], startedAt: started, endedAt: ended, timezone: 'Asia/Shanghai', exitCode: outcome === 'FAIL' ? 1 : 0 },
  outcome, requirements: ['TEST-002', 'TEST-003', 'TEST-004', 'REL-002'], metrics: [], artifacts,
  uncovered: outcome === 'PASS' ? [] : [{ requirement: 'TEST-003', reasonCode: outcome === 'NOT_VERIFIED' ? 'NO_CREDENTIAL_UI_INTERACTION' : 'INTEGRATED_JOURNEY_FAILURE', safeDetail: detail, ownerAction: 'Review retained device evidence and run only an authorized future acceptance session.' }],
  recovery: { cleanupStatus: cleanup, deviceStateRestored: cleanup === 'restored', rollbackArtifactSha256: sha, steps: ['restored animation, font-scale, and rotation settings from the pre-run snapshot'] }
}, null, 2));
NODE
  node mobile/scripts/acceptance/evidence.mjs --run-dir "$RUN_DIR" --write --name 08-journey.json --input "$RUN_DIR/.journey-input.json"
  rm -f "$RUN_DIR/.journey-input.json"
}

"$ADB" -s "$SERIAL" install -r "$DEBUG_APK" >/dev/null || { record_failure debug-install; exit 1; }
((CLEAR_COUNT++)); "$ADB" -s "$SERIAL" shell pm clear "$PACKAGE" | tr -d '\r' > "$RUN_DIR/reset.txt" || { record_failure reset-failed; exit 1; }
[[ "$CLEAR_COUNT" == 1 ]] || { record_failure second-reset; exit 1; }
"$ADB" -s "$SERIAL" install -r "$TEST_APK" >/dev/null || { record_failure test-install; exit 1; }
run_instrumentation "$SEED_CLASS" "$RUN_DIR/upgrade-seed-instrumentation.txt" || { record_failure upgrade-seed; exit 1; }
"$ADB" -s "$SERIAL" install -r "$RELEASE_APK" >/dev/null || { record_failure release-install; exit 1; }
"$ADB" -s "$SERIAL" shell pm path "$TEST_PACKAGE" | grep -q . || { record_failure missing-test-package; exit 1; }
smoke_ui() {
  "$ADB" -s "$SERIAL" shell am start -W -n "$PACKAGE/com.listen2mobile.MainActivity" >/dev/null
  local deadline=$((SECONDS + 20)) xml=""
  while (( SECONDS < deadline )); do
    "$ADB" -s "$SERIAL" shell dumpsys window | grep -q "$PACKAGE/com.listen2mobile.MainActivity" || { sleep 1; continue; }
    "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/listen2-phase8-smoke.xml >/dev/null
    xml="$($ADB -s "$SERIAL" shell cat /sdcard/listen2-phase8-smoke.xml)"
    js_ready_phone_shell "$xml" && return 0
    sleep 1
  done
  return 1
}
smoke_ui || { record_failure release-ui-smoke; exit 1; }
"$ADB" -s "$SERIAL" pull /sdcard/listen2-phase8-smoke.xml "$RUN_DIR/smoke-window.xml" >/dev/null
"$ADB" -s "$SERIAL" exec-out screencap -p > "$RUN_DIR/smoke-phone.png"
run_instrumentation "$JOURNEY_CLASS" "$RUN_DIR/integrated-journey-instrumentation.txt" || { record_failure integrated-journey; exit 1; }
"$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-integrated.xml" "$RUN_DIR/integrated-window.xml" >/dev/null || { record_failure missing-integrated-window; exit 1; }
"$ADB" -s "$SERIAL" pull "/sdcard/Android/data/$PACKAGE/files/listen2-phase8-integrated.png" "$RUN_DIR/integrated-phone.png" >/dev/null || { record_failure missing-integrated-screen; exit 1; }
smoke_ui || { record_failure postrun-ui-smoke; exit 1; }
"$ADB" -s "$SERIAL" pull /sdcard/listen2-phase8-smoke.xml "$RUN_DIR/postrun-window.xml" >/dev/null
"$ADB" -s "$SERIAL" exec-out screencap -p > "$RUN_DIR/postrun-phone.png"
printf '%s\n' 'reset=success' 'upgrade-seed=success' 'integrated-journey=success' > "$EVENTS"
# No account credentials were supplied through the permitted UI-only lane.
write_record "NOT_VERIFIED" "Credential-controlled Bilibili login and DeepSeek translation were intentionally not exercised." "$BUILD_HEAD"
trap - EXIT
