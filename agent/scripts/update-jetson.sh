#!/usr/bin/env bash
# Oppdaterer Jarvis på en Jetson-node uten å miste data eller konfig.
# Bruk:  sudo ./agent/scripts/update-jetson.sh [git-ref]
set -euo pipefail

REF="${1:-main}"
APP_DIR="${JARVIS_DIR:-/opt/jarvis}"
DATA_DIR="${AGENT_DATA:-$APP_DIR/agent/data}"
SERVICE="${JARVIS_SERVICE:-jarvis-agent}"

cd "$APP_DIR"

echo "→ Tar sikkerhetskopi av data og konfig …"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$APP_DIR/.oppdatering/$STAMP"
mkdir -p "$BACKUP"
[ -d "$DATA_DIR" ] && cp -a "$DATA_DIR" "$BACKUP/data"
[ -f "$APP_DIR/agent/agent.env" ] && cp -a "$APP_DIR/agent/agent.env" "$BACKUP/agent.env"
echo "   lagret i $BACKUP"

FOER="$(git rev-parse --short HEAD 2>/dev/null || echo ukjent)"
echo "→ Henter ny versjon ($REF) …"
git fetch --all --tags --prune
git checkout "$REF"
git pull --ff-only

echo "→ Installerer avhengigheter …"
npm ci --omit=dev --prefix agent 2>/dev/null || npm install --omit=dev --prefix agent
if [ -f package.json ]; then
  npm ci 2>/dev/null || npm install
  npm run build
fi

ETTER="$(git rev-parse --short HEAD 2>/dev/null || echo ukjent)"
echo "→ Starter tjenesten på nytt …"
if systemctl list-unit-files | grep -q "^${SERVICE}.service"; then
  systemctl restart "$SERVICE"
  sleep 2
  systemctl --no-pager --lines=5 status "$SERVICE" || true
else
  echo "   Fant ikke systemd-tjenesten $SERVICE – start agenten manuelt (node agent/server.mjs)."
fi

echo
echo "Ferdig. $FOER → $ETTER"
echo "Data og konfig ble ikke rørt. Rull tilbake ved behov:"
echo "  git checkout $FOER && cp -a $BACKUP/data/. $DATA_DIR/ && systemctl restart $SERVICE"
