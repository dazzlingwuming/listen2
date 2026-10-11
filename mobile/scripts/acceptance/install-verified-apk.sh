#!/usr/bin/env bash
# Installs only a verified development candidate; no device is selected implicitly.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/install-verified-apk.mjs" "$@"
