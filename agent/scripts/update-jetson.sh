#!/usr/bin/env bash
# Oppdaterer Jarvis på en Jetson-node uten å miste data eller konfig.
# Bruk:  sudo ./agent/scripts/update-jetson.sh [git-ref]
#
# Skriptet er idempotent og robust:
#   - tar backup av data, konfig og systemd-unit
#   - henter ny kode
#   - installerer avhengigheter
#   - bygger GUI-et
#   - frigjør porter som kan være opptatt av gamle prosesser
#   - restarter tjenestene
#   - verifiserer at backend svarer (både HTTP og HTTPS)
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RED="\033[31m"; RST="\033[0m"
si()  { echo -e "${BLA}▸ $*${RST}"; }
ok()  { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }
feil(){ echo -e "${RED}✗ $*${RST}"; }

[ "$(id -u)" -eq 0 ] || { feil "Må kjøres som root:  sudo bash $0"; exit 1; }

REF="${1:-main}"
APP_DIR="${JARVIS_DIR:-/opt/jarvis-agent}"
GUI_DIR="${JARVIS_GUI_DIR:-/opt/jarvis-gui}"
DATA_DIR="${AGENT_DATA:-$APP_DIR/agent/data}"
ENV_FILE="/etc/jarvis/agent.env"
SERVICE="${JARVIS_SERVICE:-jarvis-agent}"
GUI_SERVICE="${JARVIS_GUI_SERVICE:-jarvis-gui}"

[ -d "$APP_DIR" ] || { feil "Fant ikke $APP_DIR – kjør oppsett.sh først."; exit 1; }

cd "$APP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$APP_DIR/.oppdatering/$STAMP"
mkdir -p "$BACKUP"

echo ""
echo -e "${GRN}╔══════════════════════════════════════════════╗${RST}"
echo -e "${GRN}║   J A R V I S   ·   O P P D A T E R I N G    ║${RST}"
echo -e "${GRN}╚══════════════════════════════════════════════╝${RST}"
echo ""

# ── 1. Sikkerhetskopi ──────────────────────────────────────────────────────────
si "Tar sikkerhetskopi …"
[ -d "$DATA_DIR" ] && cp -a "$DATA_DIR" "$BACKUP/data"
[ -f "$ENV_FILE" ] && cp -a "$ENV_FILE" "$BACKUP/agent.env"
[ -f "/etc/systemd/system/$SERVICE.service" ] && cp -a "/etc/systemd/system/$SERVICE.service" "$BACKUP/"
[ -f "/etc/systemd/system/$GUI_SERVICE.service" ] && cp -a "/etc/systemd/system/$GUI_SERVICE.service" "$BACKUP/"
ok "Backup lagret i $BACKUP"

# ── 2. Hent ny kode ───────────────────────────────────────────────────────────
FOER="$(git rev-parse --short HEAD 2>/dev/null || echo ukjent)"
si "Henter ny versjon ($REF) …"
git fetch --all --tags --prune

# Hvis det finnes lokale endringer (f.eks. konfigfiler), lagre dem midlertidig.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  adv "Lokale endringer i repoet oppdaget – lagrer i stash"
  git stash push -m "auto-stash-før-oppdatering-$STAMP" || true
fi

git checkout "$REF"
git pull --ff-only
ETTER="$(git rev-parse --short HEAD 2>/dev/null || echo ukjent)"
ok "$FOER → $ETTER"

# ── 3. Installer avhengigheter ────────────────────────────────────────────────
si "Installerer avhengigheter …"
if [ -f "$APP_DIR/agent/package.json" ]; then
  (cd "$APP_DIR/agent" && npm ci --omit=dev 2>/dev/null) || (cd "$APP_DIR/agent" && npm install --omit=dev)
fi
if [ -f "$APP_DIR/package.json" ]; then
  (cd "$APP_DIR" && npm ci 2>/dev/null) || (cd "$APP_DIR" && npm install)
fi

# ── 4. Bygg GUI ───────────────────────────────────────────────────────────────
if [ -f "$APP_DIR/package.json" ] && [ "${HOPP_GUI:-0}" -eq 0 ]; then
  si "Bygger web-GUI …"
  (cd "$APP_DIR" && NITRO_PRESET=node-server npm run build)
  ok "GUI bygget"
fi

# ── 5. Frigjør porter ────────────────────────────────────────────────────────
frigjor_port() {
  local port="$1"
  local pider
  pider="$(ss -tlnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  [ -n "$pider" ] || return 0
  for p in $pider; do
    # Ikke drepe vår egen tjeneste – den skal restartes ordentlig
    if [ "$p" = "$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null)" ]; then continue; fi
    adv "Stopper gammel prosess (pid $p) som holder port $port"
    kill "$p" 2>/dev/null || true
  done
  sleep 2
  for p in $pider; do kill -9 "$p" 2>/dev/null || true; done
}

AGENT_PORT="8787"
AGENT_TLS_PORT="8443"
if [ -f "$ENV_FILE" ]; then
  P="$(grep -E '^AGENT_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"; [ -n "$P" ] && AGENT_PORT="$P"
fi

systemctl stop "$SERVICE" 2>/dev/null || true
systemctl stop "$GUI_SERVICE" 2>/dev/null || true
frigjor_port "$AGENT_PORT"
frigjor_port "$AGENT_TLS_PORT"
frigjor_port "${JARVIS_GUI_PORT:-8080}"

# ── 6. Oppdater systemd-unit hvis malen er endret ─────────────────────────────
AGENT_SERVICE_MAL="$APP_DIR/agent/jarvis-agent.service"
if [ -f "$AGENT_SERVICE_MAL" ] && [ -f "/etc/systemd/system/$SERVICE.service" ]; then
  if ! cmp -s "$AGENT_SERVICE_MAL" "/etc/systemd/system/$SERVICE.service"; then
    si "Oppdaterer systemd-unit for $SERVICE"
    cp "$AGENT_SERVICE_MAL" "/etc/systemd/system/$SERVICE.service"
  fi
fi
systemctl daemon-reload

# ── 7. Start tjenester ─────────────────────────────────────────────────────────
si "Starter tjenester på nytt …"
systemctl restart "$SERVICE"
systemctl restart "$GUI_SERVICE" 2>/dev/null || adv "$GUI_SERVICE kunne ikke startes"
sleep 3

# ── 8. Verifiser at agenten svarer ────────────────────────────────────────────
si "Verifiserer at backend svarer …"
TOKEN=""
if [ -f "$ENV_FILE" ]; then
  TOKEN="$(grep -E '^AGENT_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
fi

URL=""
if [ "$AGENT_PORT" = "8443" ] || grep -q '^AGENT_TLS_CERT=' "$ENV_FILE" 2>/dev/null; then
  # Prøv HTTPS først
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  LAN_IP="${LAN_IP:-127.0.0.1}"
  for host in "127.0.0.1" "$LAN_IP"; do
    if curl -fsSk -H "Authorization: Bearer $TOKEN" "https://${host}:8443/api/status" >/dev/null 2>&1; then
      URL="https://${host}:8443"
      break
    fi
  done
fi

if [ -z "$URL" ]; then
  for host in "127.0.0.1" "$(hostname -I 2>/dev/null | awk '{print $1}')"; do
    if curl -fsS -H "Authorization: Bearer $TOKEN" "http://${host}:${AGENT_PORT}/api/status" >/dev/null 2>&1; then
      URL="http://${host}:${AGENT_PORT}"
      break
    fi
  done
fi

if [ -n "$URL" ]; then
  ok "Backend svarer på $URL/api/status"
else
  feil "Backend svarer ikke – siste logglinjer:"
  SYSTEMD_PAGER=cat journalctl -u "$SERVICE" -n 30 --no-pager -o cat 2>/dev/null || true
  echo ""
  echo "Rull tilbake ved behov:"
  echo "  sudo cp -a $BACKUP/data/. $DATA_DIR/"
  echo "  sudo cp -a $BACKUP/agent.env $ENV_FILE"
  [ -f "$BACKUP/$SERVICE.service" ] && echo "  sudo cp -a $BACKUP/$SERVICE.service /etc/systemd/system/"
  echo "  sudo systemctl restart $SERVICE"
  exit 1
fi

# ── 9. Oppdater GUI-konfig hvis backend-adressen har endret seg ───────────────
if [ -f "$GUI_DIR/.output/server/index.mjs" ] || [ -d "$APP_DIR/dist" ]; then
  adv "Husk å åpne HUD-en på nytt i nettleseren for å laste siste versjon."
fi

echo ""
echo "Ferdig. $FOER → $ETTER"
echo "Data og konfig ble ikke rørt."
echo "Backup: $BACKUP"
echo "Backend: $URL"
echo ""
echo "Rull tilbake ved behov:"
echo "  sudo cp -a $BACKUP/data/. $DATA_DIR/"
echo "  sudo cp -a $BACKUP/agent.env $ENV_FILE"
[ -f "$BACKUP/$SERVICE.service" ] && echo "  sudo cp -a $BACKUP/$SERVICE.service /etc/systemd/system/"
echo "  sudo systemctl restart $SERVICE"
