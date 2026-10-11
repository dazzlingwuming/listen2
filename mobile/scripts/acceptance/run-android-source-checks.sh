#!/usr/bin/env bash
set -euo pipefail
[[ $# == 0 ]] || { echo 'usage: run-android-source-checks.sh' >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Fixed Android boundary scope; this is intentionally not the complete Jest or
# eslint suite. Broader source checks are selected by the change owner in CI.
node "$SCRIPT_DIR/candidate.test.mjs"
node "$SCRIPT_DIR/evidence.mjs" --self-test-containment
node "$MOBILE_ROOT/scripts/verify-phase7-security.mjs"
(
  cd "$MOBILE_ROOT"
  ./node_modules/.bin/jest --runInBand --runTestsByPath \
    src/api/__tests__/mediaDescriptorMigration.test.ts \
    src/player/__tests__/playerController.lifecycle.test.ts \
    src/player/__tests__/playerController.bilibiliRetry.test.ts
  ./node_modules/.bin/tsc --noEmit
  ./node_modules/.bin/eslint --quiet src/api/nativePlayback.ts src/api/client.ts src/player/playerController.ts
)
