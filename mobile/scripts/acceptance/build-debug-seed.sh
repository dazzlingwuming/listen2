#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  grep -Fq 'debuggableVariants.set([])' "$SCRIPT_DIR/debug-seed.init.gradle" || { echo 'debug seed init script does not force a bundled debug variant' >&2; exit 1; }
  grep -Fq ':app:assembleDebug' "$0" || { echo 'debug seed build task is missing' >&2; exit 1; }
  FORBIDDEN_TASK=':app:assembleRelease'"Like"
  ! grep -Fq "$FORBIDDEN_TASK" "$0" || { echo 'debug seed build must not assemble releaseLike' >&2; exit 1; }
  echo 'Bundled debug seed self-test passed.'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ANDROID_ROOT="$MOBILE_ROOT/android"
OUTPUT=""; LINEAGE_APK=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT="$2"; shift 2 ;;
    --lineage-apk) LINEAGE_APK="$2"; shift 2 ;;
    *) echo 'usage: build-debug-seed.sh --output FILE --lineage-apk FILE' >&2; exit 2 ;;
  esac
done
[[ -n "$OUTPUT" && -n "$LINEAGE_APK" && -f "$LINEAGE_APK" ]] || { echo 'output and sealed lineage APK are required' >&2; exit 2; }
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"; [[ -n "$SDK" ]] || { echo 'ANDROID_SDK_ROOT is required' >&2; exit 3; }
APKSIGNER="$SDK/build-tools/37.0.0/apksigner"; AAPT="$SDK/build-tools/37.0.0/aapt"
[[ -x "$APKSIGNER" && -x "$AAPT" ]] || { echo 'Android Build Tools 37.0.0 are required' >&2; exit 3; }

signer() {
  "$APKSIGNER" verify --verbose --print-certs "$1" | awk -F': ' '/(Signer #1|V[0-9.]+ Signer): certificate SHA-256 digest/ { print $NF; exit }'
}

(
  cd "$ANDROID_ROOT"
  ./gradlew --offline --no-daemon --init-script "$SCRIPT_DIR/debug-seed.init.gradle" :app:assembleDebug
)

BUILT_APK="$ANDROID_ROOT/app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$BUILT_APK" ]] || { echo 'bundled debug seed APK is missing' >&2; exit 1; }
mkdir -p "$(dirname "$OUTPUT")"
cp "$BUILT_APK" "$OUTPUT"
unzip -Z1 "$OUTPUT" | grep -Fx 'assets/index.android.bundle' >/dev/null || { echo 'debug seed APK lacks assets/index.android.bundle' >&2; exit 1; }
BADGING="$($AAPT dump badging "$OUTPUT")"
[[ "$BADGING" == *"package: name='com.dazzlingwuming.listen2' versionCode='1'"* ]] || { echo 'debug seed APK package or versionCode is unexpected' >&2; exit 1; }
[[ "$(signer "$OUTPUT")" =~ ^[a-f0-9]{64}$ && "$(signer "$OUTPUT")" == "$(signer "$LINEAGE_APK")" ]] || { echo 'debug seed APK signer does not match the sealed development lineage' >&2; exit 1; }
printf 'Bundled debug seed sealed: sha256=%s bytes=%s signer=%s\n' "$(shasum -a 256 "$OUTPUT" | awk '{print $1}')" "$(wc -c < "$OUTPUT" | tr -d ' ')" "$(signer "$OUTPUT")"
