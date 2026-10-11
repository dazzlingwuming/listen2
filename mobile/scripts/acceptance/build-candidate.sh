#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/toolchain-preflight.sh"
SEAL_EXISTING=false; BUILD_HEAD=''; WITH_DEBUG_SEED=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-debug-seed) WITH_DEBUG_SEED=true; shift;;
    --seal-existing) SEAL_EXISTING=true; shift;;
    --build-head) [[ $# -ge 2 && "$2" != --* ]] || exit 2; BUILD_HEAD="$2"; shift 2;;
    *) echo 'usage: build-candidate.sh [--seal-existing --build-head FULL_SHA] [--with-debug-seed]' >&2; exit 2;;
  esac
done
cd "$REPO_ROOT"
git diff --quiet && git diff --cached --quiet || { echo 'BLOCKED: commit reviewed source before candidate build/seal' >&2; exit 3; }
HEAD_BEFORE="$(git rev-parse HEAD)"
if [[ "$SEAL_EXISTING" == true ]]; then
  [[ "$BUILD_HEAD" == "$HEAD_BEFORE" ]] || { echo 'BLOCKED: existing outputs require exact build HEAD attestation' >&2; exit 3; }
else
  [[ -z "$BUILD_HEAD" ]] || { echo 'BLOCKED: --build-head is only used with --seal-existing' >&2; exit 3; }
fi
phase8_preflight
if [[ "$SEAL_EXISTING" == false ]]; then
  bash "$SCRIPT_DIR/run-android-source-checks.sh"
  (cd "$ANDROID_ROOT" && ./gradlew --offline --no-daemon :app:testReleaseLikeUnitTest --tests com.listen2mobile.offline.OfflineRecoveryContractTest --tests com.listen2mobile.offline.BilibiliOfflineContractTest --tests com.listen2mobile.local.LocalAudioPolicyTest --tests com.listen2mobile.local.LocalMetadataReaderTest
    ./gradlew --offline --no-daemon :app:assembleReleaseLike :app:assembleReleaseLikeAndroidTest)
fi
PRODUCT="$ANDROID_ROOT/app/build/outputs/apk/releaseLike/app-releaseLike.apk"
TEST="$ANDROID_ROOT/app/build/outputs/apk/androidTest/releaseLike/app-releaseLike-androidTest.apk"
bash "$SCRIPT_DIR/verify-apk.sh" --apk "$PRODUCT" --variant releaseLike
[[ "$(git rev-parse HEAD)" == "$HEAD_BEFORE" ]] && git diff --quiet && git diff --cached --quiet || { echo 'BLOCKED: source changed during build' >&2; exit 3; }
DEBUG_ARGS=()
if [[ "$WITH_DEBUG_SEED" == true ]]; then
  DEBUG_SEED="$ANDROID_ROOT/app/build/outputs/acceptance/debug-seed.apk"
  bash "$SCRIPT_DIR/build-debug-seed.sh" --output "$DEBUG_SEED" --lineage-apk "$PRODUCT"
  DEBUG_ARGS=(--debug-apk "$DEBUG_SEED")
fi
[[ "$(git rev-parse HEAD)" == "$HEAD_BEFORE" ]] && git diff --quiet && git diff --cached --quiet || { echo 'BLOCKED: source changed during debug seed build' >&2; exit 3; }
RUN_DIR="$(node "$SCRIPT_DIR/evidence.mjs" --ensure-current-run --head "$HEAD_BEFORE")"
node "$SCRIPT_DIR/candidate.mjs" --seal --run-dir "$RUN_DIR" --apksigner "$ANDROID_SDK_ROOT/build-tools/37.0.0/apksigner" --product-apk "$PRODUCT" --test-apk "$TEST" --build-head "$HEAD_BEFORE" "${DEBUG_ARGS[@]}"
printf 'Candidate sealed: %s\nReproducibility and product acceptance remain NOT_VERIFIED.\n' "$RUN_DIR"
