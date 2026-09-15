#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_ROOT/.." && pwd)"
ANDROID_ROOT="$MOBILE_ROOT/android"
PHASE_DIR=""
MANIFEST=""
REPEAT=""

usage() {
  printf 'usage: build-release-like.sh --phase-dir PHASE_DIR --untracked-manifest FILE --repeat-app-variants 2\n' >&2
  exit 2
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --phase-dir) PHASE_DIR="$2"; shift 2 ;;
    --untracked-manifest) MANIFEST="$2"; shift 2 ;;
    --repeat-app-variants) REPEAT="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$REPEAT" == "2" && -n "$PHASE_DIR" && -n "$MANIFEST" ]] || usage

PHASE_DIR="$(cd "$REPO_ROOT/$PHASE_DIR" && pwd)"
MANIFEST="$REPO_ROOT/$MANIFEST"

blocked() {
  printf 'Phase 8 candidate BLOCKED: %s\n' "$*" >&2
  exit 1
}

tracked_clean() {
  git -C "$REPO_ROOT" diff --quiet || blocked 'unstaged tracked changes are present.'
  git -C "$REPO_ROOT" diff --cached --quiet || blocked 'staged tracked changes are present.'
}

copy_unique_apk() {
  local directory="$1"
  local destination="$2"
  local matches=()
  while IFS= read -r entry; do matches+=("$entry"); done < <(find "$directory" -maxdepth 1 -type f -name '*.apk' -print | sort)
  [[ "${#matches[@]}" -eq 1 ]] || blocked "expected exactly one APK under ${directory#$REPO_ROOT/}."
  cp "${matches[0]}" "$destination"
}

hash_inputs() {
  {
    shasum -a 256 "$MOBILE_ROOT/package-lock.json"
    find "$MOBILE_ROOT/patches" -type f -name '*.patch' -print0 | sort -z | xargs -0 shasum -a 256
  } | shasum -a 256 | awk '{print $1}'
}

source "$SCRIPT_DIR/toolchain-preflight.sh"
tracked_clean
node "$SCRIPT_DIR/verify-phase8-prerequisites.mjs" --check --untracked-manifest "$MANIFEST"
RUN_DIR="$(node "$SCRIPT_DIR/evidence.mjs" --resolve-current-run --phase-dir "${PHASE_DIR#$REPO_ROOT/}" --head "$(git -C "$REPO_ROOT" rev-parse HEAD)")"
phase8_preflight

INPUT_HASH_BEFORE="$(hash_inputs)"
npm cache verify
npm ci --prefix "$MOBILE_ROOT"
[[ "$INPUT_HASH_BEFORE" == "$(hash_inputs)" ]] || blocked 'npm mutated mobile lockfile or patches.'

tracked_clean
node "$SCRIPT_DIR/verify-phase8-prerequisites.mjs" --check --untracked-manifest "$MANIFEST"

(
  cd "$ANDROID_ROOT"
  ./gradlew --offline --no-daemon :app:dependencies --configuration debugRuntimeClasspath :app:dependencies --configuration releaseLikeRuntimeClasspath
)

npm run mobile:test
npm run mobile:typecheck
npm --prefix "$MOBILE_ROOT" run lint -- --quiet
git -C "$REPO_ROOT" diff --check
node "$MOBILE_ROOT/scripts/verify-phase7-security.mjs"

tracked_clean
(
  cd "$ANDROID_ROOT"
  ./gradlew --offline --no-daemon :app:testDebugUnitTest :app:compileReleaseLikeAndroidTestKotlin :app:assembleDebug :app:assembleReleaseLike :app:assembleReleaseLikeAndroidTest
)

ARTIFACT_DIR="$RUN_DIR/artifacts"
[[ ! -e "$ARTIFACT_DIR" ]] || blocked 'current run already contains immutable build artifacts.'
mkdir -p "$ARTIFACT_DIR"
copy_unique_apk "$ANDROID_ROOT/app/build/outputs/apk/debug" "$ARTIFACT_DIR/debug.apk"
copy_unique_apk "$ANDROID_ROOT/app/build/outputs/apk/releaseLike" "$ARTIFACT_DIR/releaseLike.apk"
copy_unique_apk "$ANDROID_ROOT/app/build/outputs/apk/androidTest/releaseLike" "$ARTIFACT_DIR/releaseLikeAndroidTest.apk"

REPEAT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/listen2-phase8-repeat.XXXXXX")"
cleanup() { rm -rf "$REPEAT_DIR"; }
trap cleanup EXIT
(
  cd "$ANDROID_ROOT"
  ./gradlew --offline --no-daemon clean :app:assembleDebug :app:assembleReleaseLike
)
copy_unique_apk "$ANDROID_ROOT/app/build/outputs/apk/debug" "$REPEAT_DIR/debug.apk"
copy_unique_apk "$ANDROID_ROOT/app/build/outputs/apk/releaseLike" "$REPEAT_DIR/releaseLike.apk"
for variant in debug releaseLike; do
  [[ "$(shasum -a 256 "$ARTIFACT_DIR/$variant.apk" | awk '{print $1}')" == "$(shasum -a 256 "$REPEAT_DIR/$variant.apk" | awk '{print $1}')" ]] || blocked "two clean ${variant} assemblies differ byte-for-byte."
done

bash "$SCRIPT_DIR/verify-apk.sh" --apk "$ARTIFACT_DIR/releaseLike.apk" --variant releaseLike
node "$SCRIPT_DIR/evidence.mjs" --run-dir "$RUN_DIR" --write-build
node "$SCRIPT_DIR/evidence.mjs" --validate "$RUN_DIR/08-build.json"
printf 'Phase 8 candidate sealed at %s; no emulator was launched.\n' "${RUN_DIR#$REPO_ROOT/}"
