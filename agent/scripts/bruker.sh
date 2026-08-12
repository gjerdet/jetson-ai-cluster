#!/usr/bin/env bash
# Wrapper som kjører bruker-CLI-et med samme datakatalog som tjenesten.
#   sudo bash agent/scripts/bruker.sh liste
#   sudo bash agent/scripts/bruker.sh passord meg@eksempel.no nyttpassord123
set -euo pipefail

ROT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AGENT_DATA="${AGENT_DATA:-$ROT/data}"

cd "$ROT/.."
node "$ROT/scripts/bruker.mjs" "$@"
