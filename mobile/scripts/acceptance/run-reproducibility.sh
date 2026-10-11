#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RUN_DIR=''
[[ $# == 2 && "$1" == --run-dir && -n "$2" ]] || { echo 'usage: run-reproducibility.sh --run-dir DIR' >&2; exit 2; }
RUN_DIR="$2"
fail() { echo "BLOCKED: $*" >&2; exit 3; }
[[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" && -n "${ANDROID_SDK_ROOT:-}" ]] || fail 'inherit explicit JAVA_HOME and ANDROID_SDK_ROOT'
REPRO_ABIS="${PHASE8_REPRO_ABIS:-${ORG_GRADLE_PROJECT_reactNativeArchitectures:-}}"
[[ "$REPRO_ABIS" =~ ^(arm64-v8a|armeabi-v7a|x86|x86_64)(,(arm64-v8a|armeabi-v7a|x86|x86_64))*$ ]] || fail 'set PHASE8_REPRO_ABIS to the sealed APK ABI list'
java_version="$("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1)"
[[ "$java_version" == *'17.'* ]] || fail 'JDK 17 is required for candidate reproduction'
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
cd "$REPO_ROOT"
APKSIGNER="$ANDROID_SDK_ROOT/build-tools/37.0.0/apksigner"
CANDIDATE_OUTPUT="$(node "$SCRIPT_DIR/candidate.mjs" --verify --run-dir "$RUN_DIR" --apksigner "$APKSIGNER")" || fail 'sealed current-HEAD candidate validation failed'
SEALED_APK="$(printf '%s\n' "$CANDIDATE_OUTPUT" | head -n 1)"
ACTUAL_ABIS="$(unzip -Z1 "$SEALED_APK" | awk -F/ '$1 == "lib" && NF >= 3 { print $2 }' | sort -u | paste -sd, -)"
REQUESTED_ABIS="$(printf '%s' "$REPRO_ABIS" | tr , '\n' | sort -u | paste -sd, -)"
[[ "$ACTUAL_ABIS" == "$REQUESTED_ABIS" ]] || fail 'explicit reproduction ABI list differs from sealed APK'
[[ ! -e "$RUN_DIR/08-reproducibility.json" && ! -e "$RUN_DIR/reproducibility" ]] || fail 'reproduction window already exists; retain it unchanged'
mkdir "$RUN_DIR/reproducibility"
BUILD_RECORD_HASH="$(shasum -a 256 "$RUN_DIR/08-build.json" | awk '{print $1}')"
BUILD_SEAL_HASH="$(shasum -a 256 "$RUN_DIR/08-build.sha256" | awk '{print $1}')"
HEAD_BEFORE="$(git rev-parse HEAD)"
TMP_REPRO="$(mktemp -d "${TMPDIR:-/tmp}/listen2-reproduction.XXXXXX")"
trap 'rm -rf "$TMP_REPRO"' EXIT
source "$SCRIPT_DIR/reproducibility-gate.sh"
for label in one two; do
  destination="$RUN_DIR/reproducibility/build-$label"; mkdir "$destination"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; build_exit=0; compare_exit=3; mapping_status=missing
  (cd mobile/android && ./gradlew --offline --no-daemon "-PreactNativeArchitectures=$REPRO_ABIS" clean :app:assembleReleaseLike) > "$TMP_REPRO/build-$label.raw.log" 2>&1 || build_exit=$?
  node "$SCRIPT_DIR/write-reproducibility.mjs" --safe-log "$TMP_REPRO/build-$label.raw.log" --output "$destination/build.log"
  apk='mobile/android/app/build/outputs/apk/releaseLike/app-releaseLike.apk'
  if [[ "$build_exit" == 0 && -f "$apk" ]]; then
    cp "$apk" "$destination/releaseLike.apk"
    mapping_status=retained; mkdir "$destination/mapping"
    for mapping in mapping.txt usage.txt seeds.txt; do
      source_mapping="mobile/android/app/build/outputs/mapping/releaseLike/$mapping"
      if [[ -f "$source_mapping" ]]; then
        if LC_ALL=C rg -qi '/Users/|/home/|C:\\Users\\|-----BEGIN.*PRIVATE|[?&](sig|token|key)=|https?://' "$source_mapping"; then
          mapping_status=unsafe-output-withheld
        else cp "$source_mapping" "$destination/mapping/$mapping"; fi
      else mapping_status=missing; fi
    done
    compare_exit=0
    phase8_compare_apks "$SEALED_APK" "$destination/releaseLike.apk" "$APKSIGNER" "repro-build-$label" > "$TMP_REPRO/compare-$label.raw.log" 2>&1 || compare_exit=$?
    node "$SCRIPT_DIR/write-reproducibility.mjs" --safe-log "$TMP_REPRO/compare-$label.raw.log" --output "$destination/compare.log"
  fi
  node --input-type=module - "$destination/result.json" "$started" "$build_exit" "$compare_exit" "$mapping_status" "$REPRO_ABIS" <<'NODE'
import { writeFileSync } from 'node:fs';
const [file, startedAt, buildExit, compareExit, mappingStatus, abi] = process.argv.slice(2);
writeFileSync(file, JSON.stringify({ startedAt, endedAt: new Date().toISOString(), buildExit: Number(buildExit), compareExit: Number(compareExit), mappingStatus, abi }, null, 2), { flag: 'wx', mode: 0o600 });
NODE
done
[[ "$(git rev-parse HEAD)" == "$HEAD_BEFORE" ]] && git diff --quiet && git diff --cached --quiet || fail 'source changed during reproduction; keep outputs as non-verified diagnostics'
[[ "$(shasum -a 256 "$RUN_DIR/08-build.json" | awk '{print $1}')" == "$BUILD_RECORD_HASH" && "$(shasum -a 256 "$RUN_DIR/08-build.sha256" | awk '{print $1}')" == "$BUILD_SEAL_HASH" ]] || fail 'original build record or seal changed'
node "$SCRIPT_DIR/write-reproducibility.mjs" --run-dir "$RUN_DIR" --apksigner "$APKSIGNER"
