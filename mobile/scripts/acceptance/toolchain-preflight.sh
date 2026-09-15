#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ANDROID_ROOT="$MOBILE_ROOT/android"
REPO_ROOT="$(cd "$MOBILE_ROOT/.." && pwd)"

phase8_fail() {
  printf 'Phase 8 toolchain BLOCKED: %s\n' "$*" >&2
  return 1
}

phase8_resolve_java() {
  local candidate=""
  if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" && -x "$JAVA_HOME/bin/javac" ]]; then
    candidate="$JAVA_HOME"
  elif [[ "$(uname -s)" == "Darwin" ]] && candidate="$(/usr/libexec/java_home -v 17 2>/dev/null || true)" && [[ -x "$candidate/bin/java" && -x "$candidate/bin/javac" ]]; then
    :
  else
    local javac_path
    javac_path="$(command -v javac 2>/dev/null || true)"
    [[ -n "$javac_path" ]] || phase8_fail 'JDK 17 is missing; set JAVA_HOME to an installed JDK 17.'
    candidate="$(cd "$(dirname "$javac_path")/.." && pwd)"
  fi
  local java_version
  java_version="$($candidate/bin/java -version 2>&1 | head -n 1)"
  [[ "$java_version" == *'17.'* || "$java_version" == *' 17 '* ]] || phase8_fail 'JDK 17 is required for the acceptance candidate.'
  export JAVA_HOME="$candidate"
  export PATH="$JAVA_HOME/bin:$PATH"
}

phase8_resolve_sdk() {
  local candidate="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  if [[ -z "$candidate" && -f "$ANDROID_ROOT/local.properties" ]]; then
    candidate="$(sed -n 's/^sdk\.dir=//p' "$ANDROID_ROOT/local.properties" | head -n 1 | sed 's#\\:#:#g')"
  fi
  [[ -n "$candidate" && -d "$candidate" ]] || phase8_fail 'Android SDK is missing; set ANDROID_SDK_ROOT or ANDROID_HOME.'
  export ANDROID_SDK_ROOT="$candidate"
  export ANDROID_HOME="$candidate"
  SDKMANAGER="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"
  [[ -x "$SDKMANAGER" ]] || SDKMANAGER="$(find "$ANDROID_SDK_ROOT/cmdline-tools" -path '*/bin/sdkmanager' -type f 2>/dev/null | head -n 1 || true)"
  [[ -x "$SDKMANAGER" ]] || phase8_fail 'Android cmdline-tools sdkmanager is missing.'
  [[ -x "$ANDROID_SDK_ROOT/emulator/emulator" ]] || phase8_fail 'Android emulator tool is missing.'
  [[ -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]] || phase8_fail 'Android platform-tools adb is missing.'
  [[ -x "$ANDROID_SDK_ROOT/build-tools/37.0.0/zipalign" ]] || phase8_fail 'Android Build Tools 37.0.0 zipalign is missing.'
  [[ -x "$ANDROID_SDK_ROOT/build-tools/37.0.0/apksigner" ]] || phase8_fail 'Android Build Tools 37.0.0 apksigner is missing.'
  [[ -d "$ANDROID_SDK_ROOT/platforms/android-37" ]] || phase8_fail 'Android platform android-37 is missing.'
  export PHASE8_SDKMANAGER="$SDKMANAGER"
}

phase8_check_node() {
  command -v node >/dev/null || phase8_fail 'Node.js is missing.'
  command -v npm >/dev/null || phase8_fail 'npm is missing.'
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$major" -ge 22 ]] || phase8_fail 'Node.js 22 or newer is required.'
  [[ -f "$MOBILE_ROOT/package-lock.json" ]] || phase8_fail 'mobile/package-lock.json is missing.'
  [[ -x "$ANDROID_ROOT/gradlew" ]] || phase8_fail 'mobile/android/gradlew is missing or not executable.'
}

phase8_export_evidence_environment() {
  export PHASE8_NPM_VERSION="$(npm --version)"
  export PHASE8_JAVA_VERSION="$($JAVA_HOME/bin/java -version 2>&1 | head -n 1 | tr -d '\r')"
  export PHASE8_GRADLE_VERSION="$(cd "$ANDROID_ROOT" && ./gradlew --version --offline | awk '/^Gradle / { print $2; exit }')"
  export PHASE8_ANDROID_HOME_HASH="$(printf '%s' "$ANDROID_SDK_ROOT" | shasum -a 256 | awk '{print $1}')"
}

phase8_preflight() {
  phase8_resolve_java
  phase8_resolve_sdk
  phase8_check_node
  phase8_export_evidence_environment
  printf 'Phase 8 toolchain preflight passed: JDK 17, Android SDK platform 37, Build Tools 37.0.0.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:---check-only}" in
    --check-only) phase8_preflight ;;
    --emit-env)
      phase8_preflight
      printf 'export JAVA_HOME=%q\nexport ANDROID_SDK_ROOT=%q\nexport ANDROID_HOME=%q\n' "$JAVA_HOME" "$ANDROID_SDK_ROOT" "$ANDROID_HOME"
      ;;
    *) phase8_fail 'usage: toolchain-preflight.sh [--check-only|--emit-env]' ;;
  esac
fi
