#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/toolchain-preflight.sh"

APK=""
VARIANT=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --apk) APK="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    *) printf 'usage: verify-apk.sh --apk FILE --variant releaseLike\n' >&2; exit 2 ;;
  esac
done

[[ "$VARIANT" == "releaseLike" && -f "$APK" ]] || { printf 'Phase 8 APK verification requires a releaseLike APK.\n' >&2; exit 2; }
phase8_preflight

ZIPALIGN="$ANDROID_SDK_ROOT/build-tools/37.0.0/zipalign"
APKSIGNER="$ANDROID_SDK_ROOT/build-tools/37.0.0/apksigner"
AAPT="$ANDROID_SDK_ROOT/build-tools/37.0.0/aapt"
APKANALYZER="$(dirname "$PHASE8_SDKMANAGER")/apkanalyzer"

"$ZIPALIGN" -c -P 16 4 "$APK"
"$APKSIGNER" verify --verbose --print-certs "$APK" >/dev/null

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/listen2-phase8-apk.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT
unzip -qq "$APK" -d "$TMP_DIR"

if find "$TMP_DIR" -type f \( -name '*.map' -o -path '*listen1_chrome_extension*' -o -path '*appassets.androidplatform.net*' -o -path '*electron*' \) -print -quit | grep -q .; then
  printf 'Phase 8 APK verification failed: legacy desktop/WebView/source-map asset found.\n' >&2
  exit 1
fi
if grep -RIlE '(-----BEGIN[[:space:]]+PRIVATE|AKIA[0-9A-Z]{16}|X-Amz-Signature=|[?&](sig|token|key)=|/Users/|C:\\Users\\|PHASE7_(SECRET|COOKIE|SIGNED_URL|PRIVATE_PATH|FULL_LYRIC|RAW_MODEL))' "$TMP_DIR" >/dev/null 2>&1; then
  printf 'Phase 8 APK verification failed: secret, signed transport, local path, or security canary detected.\n' >&2
  exit 1
fi
node "$SCRIPT_DIR/../verify-phase7-security.mjs" "$TMP_DIR"

MANIFEST="$TMP_DIR/AndroidManifest.xml"
if [[ -x "$APKANALYZER" ]]; then
  "$APKANALYZER" manifest print "$APK" > "$MANIFEST"
elif [[ -x "$AAPT" ]]; then
  "$AAPT" dump xmltree "$APK" AndroidManifest.xml > "$MANIFEST"
else
  printf 'Phase 8 APK verification blocked: no apkanalyzer or aapt available.\n' >&2
  exit 1
fi
grep -q 'com.dazzlingwuming.listen2' "$MANIFEST"
grep -q 'debuggable.*false\|android:debuggable="false"' "$MANIFEST" || { printf 'releaseLike is debuggable.\n' >&2; exit 1; }
if grep -q 'usesCleartextTraffic.*true' "$MANIFEST"; then
  printf 'releaseLike enables cleartext transport.\n' >&2
  exit 1
fi
for authority in offline-cache local-media media; do
  grep -q "$authority" "$MANIFEST" || { printf 'required private media provider missing.\n' >&2; exit 1; }
done
if grep -E 'provider.*exported.*true|exported.*true.*provider' "$MANIFEST" >/dev/null; then
  printf 'Phase 8 APK verification failed: an unexpected exported provider exists.\n' >&2
  exit 1
fi

MAPPING="$MOBILE_ROOT/android/app/build/outputs/mapping/releaseLike"
for file in mapping.txt usage.txt seeds.txt; do
  [[ -s "$MAPPING/$file" ]] || { printf 'Phase 8 APK verification failed: R8 %s is missing.\n' "$file" >&2; exit 1; }
done
printf 'Phase 8 APK verification passed: aligned, development-signed, minified and asset-bounded.\n'
