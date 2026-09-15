#!/usr/bin/env bash
set -euo pipefail

# This is a one-window, fixture-free supplement. It compiles only the
# AndroidTest payload and installs an already sealed releaseLike product APK.
PACKAGE='com.dazzlingwuming.listen2'
TEST_PACKAGE='com.dazzlingwuming.listen2.test'
RUNNER='com.listen2mobile.acceptance.Phase08Instrumentation'
SCENARIO='com.listen2mobile.acceptance.LiveProviderSmokeTest'
EXPECTED_PRODUCT_SHA='b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b'
EXPECTED_PRODUCT_BYTES='67106970'

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
  [[ "$EXPECTED_PRODUCT_SHA" =~ ^[a-f0-9]{64}$ ]] || exit 1
  [[ "$EXPECTED_PRODUCT_BYTES" == '67106970' ]] || exit 1
  grep -Fq 'assembleReleaseLikeAndroidTest' "$0" || exit 1
  ! grep -Fq 'generate-fixtures' "$0" || exit 1
  grep -Fq 'LiveProviderSmokeTest' "$0" || exit 1
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

RUN_DIR=''; SERIAL=''; PRODUCT_APK=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-dir) RUN_DIR="$2"; shift 2;;
    --serial) SERIAL="$2"; shift 2;;
    --product-apk) PRODUCT_APK="$2"; shift 2;;
    *key*|*Key*|*token*|*Token*|*secret*|*Secret*|*cookie*|*Cookie*|*password*|*Password*) fail 'credential-like arguments are forbidden';;
    *) fail "unknown argument: $1";;
  esac
done
[[ -n "$RUN_DIR" && -n "$SERIAL" && -n "$PRODUCT_APK" ]] || fail 'run directory, explicit serial, and exact product APK are required'
[[ "$PRODUCT_APK" == /* && -f "$PRODUCT_APK" ]] || fail 'product APK must be an existing absolute path'
[[ "$(sha256 "$PRODUCT_APK")" == "$EXPECTED_PRODUCT_SHA" ]] || fail 'product APK SHA-256 differs from sealed b3e06e candidate'
[[ "$(wc -c < "$PRODUCT_APK" | tr -d ' ')" == "$EXPECTED_PRODUCT_BYTES" ]] || fail 'product APK byte count differs from sealed b3e06e candidate'
git diff --quiet && git diff --cached --quiet || fail 'tracked worktree is not clean; use a clean worktree'

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"; [[ -n "$SDK" ]] || fail 'set ANDROID_SDK_ROOT'
ADB="$SDK/platform-tools/adb"; [[ -x "$ADB" ]] || ADB="$(command -v adb)"
[[ "$($ADB -s "$SERIAL" get-state)" == device ]] || fail 'explicit serial is unavailable'
[[ "$($ADB -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == 35 ]] || fail 'explicit serial is not API 35'
APKSIGNER="$SDK/build-tools/37.0.0/apksigner"; [[ -x "$APKSIGNER" ]] || fail 'Build Tools 37.0.0 apksigner is unavailable'
APKANALYZER="$SDK/cmdline-tools/latest/bin/apkanalyzer"; [[ -x "$APKANALYZER" ]] || APKANALYZER="$(command -v apkanalyzer)"

# The only Gradle invocation emits an AndroidTest APK; product APK input is never rebuilt.
(
  cd mobile/android
  ./gradlew --no-daemon :app:assembleReleaseLikeAndroidTest
)
TEST_APK="$(pwd)/mobile/android/app/build/outputs/apk/androidTest/releaseLike/app-releaseLike-androidTest.apk"
[[ -f "$TEST_APK" ]] || fail 'releaseLike AndroidTest APK was not produced'
TEST_SHA="$(sha256 "$TEST_APK")"
"$APKANALYZER" dex packages "$TEST_APK" | grep -Fq "$SCENARIO" || fail 'test APK lacks LiveProviderSmokeTest'
for class in "$RUNNER" com.listen2mobile.acceptance.AccessibilityDriver "$SCENARIO"; do
  code="$($APKANALYZER dex code --class "$class" "$TEST_APK")" || fail "cannot inspect $class"
  ! grep -Eqi '(^|[./])kotlin([./]|$)|androidx\.test\.runner|InstrumentationRegistry|ActivityScenario' <<< "$code" || fail "forbidden test runtime dependency in $class"
done
manifest="$($SDK/build-tools/37.0.0/aapt dump xmltree "$TEST_APK" AndroidManifest.xml)"
grep -Fq "$RUNNER" <<< "$manifest" || fail 'AndroidTest manifest does not name self-contained runner'
product_signer="$($APKSIGNER verify --verbose --print-certs "$PRODUCT_APK" | awk -F': ' '/(Signer #1|V[0-9.]+ Signer): certificate SHA-256 digest/ {print $NF; exit}')"
test_signer="$($APKSIGNER verify --verbose --print-certs "$TEST_APK" | awk -F': ' '/(Signer #1|V[0-9.]+ Signer): certificate SHA-256 digest/ {print $NF; exit}')"
[[ "$product_signer" =~ ^[a-f0-9]{64}$ && "$product_signer" == "$test_signer" ]] || fail 'product and test signer lineage differs'

mkdir -p "$RUN_DIR/artifacts" "$RUN_DIR/diagnostics"
umask 077
cp "$TEST_APK" "$RUN_DIR/artifacts/releaseLikeAndroidTest-live-provider.apk"
printf '%s\n' "product=$EXPECTED_PRODUCT_SHA" "test=$TEST_SHA" "scenario=$SCENARIO" > "$RUN_DIR/live-provider-payload.txt"
STATE="$RUN_DIR/live-provider-device-state.sh"
bash mobile/scripts/acceptance/device-state.sh snapshot --serial "$SERIAL" --file "$STATE"
cleanup_status='pending'
cleanup() { bash mobile/scripts/acceptance/device-state.sh restore --serial "$SERIAL" --file "$STATE" >/dev/null 2>&1 && cleanup_status='restored' || cleanup_status='restore-failed'; }
trap cleanup EXIT

"$ADB" -s "$SERIAL" shell pm clear "$PACKAGE" > "$RUN_DIR/live-provider-reset.txt"
"$ADB" -s "$SERIAL" install -r "$PRODUCT_APK" > "$RUN_DIR/live-provider-product-install.txt"
"$ADB" -s "$SERIAL" install -r "$TEST_APK" > "$RUN_DIR/live-provider-test-install.txt"
"$ADB" -s "$SERIAL" shell logcat -c > "$RUN_DIR/diagnostics/live-provider-logcat-clear.txt" 2>&1 || true
"$ADB" -s "$SERIAL" logcat -v threadtime ReactNativeJS:V ReactNative:V AndroidRuntime:E ActivityManager:I '*:S' > "$RUN_DIR/diagnostics/live-provider-logcat-raw.txt" 2>&1 &
logcat_pid="$!"
set +e
"$ADB" -s "$SERIAL" shell am instrument -w -r -e class "$SCENARIO" "$TEST_PACKAGE/$RUNNER" > "$RUN_DIR/live-provider-instrumentation.txt" 2>&1
instrument_status="$?"
set -e
kill "$logcat_pid" >/dev/null 2>&1 || true
wait "$logcat_pid" 2>/dev/null || true
sanitize_log "$RUN_DIR/diagnostics/live-provider-logcat-raw.txt" "$RUN_DIR/diagnostics/live-provider-logcat-sanitized.txt"
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
node --input-type=module - "$RUN_DIR" "$TEST_SHA" "$outcome" "$classification" "$http_status" "$cleanup_status" <<'NODE' > "$RUN_DIR/.live-provider.json"
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
const [run, testSha, outcome, classification, httpStatus, cleanup] = process.argv.slice(2);
const files = ['live-provider-instrumentation.txt', 'live-provider-window.xml', 'live-provider-phone.png', 'live-provider-results.txt', 'live-provider-failure-window.xml', 'live-provider-postrun.png', 'live-provider-payload.txt', 'diagnostics/live-provider-logcat-sanitized.txt'].filter(file => existsSync(`${run}/${file}`));
const hash = file => createHash('sha256').update(readFileSync(`${run}/${file}`)).digest('hex');
const results = existsSync(`${run}/live-provider-results.txt`) ? readFileSync(`${run}/live-provider-results.txt`, 'utf8').trim().split('\n').filter(Boolean) : [];
console.log(JSON.stringify({ schemaVersion: 1, recordId: 'phase8-live-provider-smoke', recordedAt: new Date().toISOString(), fixtureFree: true,
  build: { productSha256: 'b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b', productBytes: 67106970, productRebuilt: false, androidTestSha256: testSha, runner: 'com.listen2mobile.acceptance.Phase08Instrumentation', scenario: 'com.listen2mobile.acceptance.LiveProviderSmokeTest' },
  query: '青花瓷', providers: ['网易云音乐', '哔哩哔哩'], visibleResultTitles: results, outcome, providerError: { classification, httpStatus },
  playback: outcome === 'PASS' ? 'See sanitized instrumentation result: PASS or NOT_VERIFIED only.' : 'NOT_VERIFIED due to failed live search.', recovery: { cleanupStatus: cleanup, productHashStable: true },
  artifacts: files.map(file => ({ kind: basename(file), relativePath: file, sha256: hash(file), bytes: statSync(`${run}/${file}`).size, sanitized: true }))
}, null, 2));
NODE
node mobile/scripts/acceptance/evidence.mjs --run-dir "$RUN_DIR" --write --name 08-live-provider.json --input "$RUN_DIR/.live-provider.json"
rm -f "$RUN_DIR/.live-provider.json"
[[ "$outcome" == PASS ]] || { printf 'CHECKPOINT: live search failed (%s, %s); no retry was attempted.\n' "$classification" "$http_status" >&2; exit 4; }
trap - EXIT
cleanup
