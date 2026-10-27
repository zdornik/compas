#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
source scripts/mac-dependencies.sh
compass_require_dependencies
"$COMPASS_NODE" scripts/mac-bundle-launch.mjs
if [ "${COMPASS_NO_OPEN:-0}" != 1 ]; then /usr/bin/open 'http://127.0.0.1:4176/'; fi
