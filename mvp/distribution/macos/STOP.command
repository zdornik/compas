#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export COMPASS_NO_INSTALL=1
source scripts/mac-dependencies.sh
compass_require_dependencies
"$COMPASS_NODE" scripts/presentation.mjs stop
