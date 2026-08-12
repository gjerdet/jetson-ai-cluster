#!/usr/bin/env bash
# Wrapper som kjører bruker-CLI-et med samme datakatalog som tjenesten.
#   sudo bash agent/scripts/bruker.sh liste
#   sudo bash agent/scripts/bruker.sh passord meg@eksempel.no nyttpassord123
set -euo pipefail

ROT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Bruk samme datakatalog som systemd-tjenesten (/etc/jarvis/agent.env),
# ellers standarden fra oppsett.sh, ellers repo-lokal ./data.
if [ -z "${AGENT_DATA:-}" ] && [ -r /etc/jarvis/agent.env ]; then
  AGENT_DATA="$(grep -E '^AGENT_DATA=' /etc/jarvis/agent.env | tail -1 | cut -d= -f2- || true)"
fi
if [ -z "${AGENT_DATA:-}" ] && [ -d /var/lib/jarvis/data ]; then
  AGENT_DATA=/var/lib/jarvis/data
fi
export AGENT_DATA="${AGENT_DATA:-$ROT/data}"
echo "Datakatalog: $AGENT_DATA"

cd "$ROT/.."
node "$ROT/scripts/bruker.mjs" "$@"

