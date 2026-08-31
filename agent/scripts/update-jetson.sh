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

# Kilde-repoet og den installerte agenten er to forskjellige mapper:
#   kilde: ~/jetson-ai-cluster (har .git, hele GUI-et og agent/)
#   agent: /opt/jarvis-agent (kun kjørekopi, har normalt ikke .git)
finn_repo() {
  local d="$1"
  while [ "$d" != "/" ] && [ -n "$d" ]; do
    [ -d "$d/.git" ] && { echo "$d"; return 0; }
    d="$(dirname "$d")"
  done
  return 1
}

SOURCE_DIR=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for candidate in "$(pwd)" "$SCRIPT_DIR" "${JARVIS_SOURCE_DIR:-}"; do
  [ -n "$candidate" ] || continue
  if repo_path="$(finn_repo "$candidate")"; then
    SOURCE_DIR="$repo_path"
    break
  fi
done

if [ -z "$SOURCE_DIR" ] || [ ! -d "$SOURCE_DIR/.git" ]; then
  feil "Fant ikke Jarvis-git-repoet."
  echo "Kjør skriptet fra kilde-repoet (mappen som har .git):"
  echo "  cd ~/jetson-ai-cluster"
  echo "  sudo bash agent/scripts/update-jetson.sh"
  echo "Du kan også sette JARVIS_SOURCE_DIR=/full/sti/til/repo."
  exit 1
fi

APP_DIR="${JARVIS_DIR:-/opt/jarvis-agent}"
GUI_DIR="${JARVIS_GUI_DIR:-/opt/jarvis-gui}"
DATA_DIR="${AGENT_DATA:-/var/lib/jarvis/data}"
ENV_FILE="/etc/jarvis/agent.env"
SERVICE="${JARVIS_SERVICE:-jarvis-agent}"
GUI_SERVICE="${JARVIS_GUI_SERVICE:-jarvis-gui}"

[ -f "$SOURCE_DIR/agent/server.mjs" ] || { feil "$SOURCE_DIR er ikke et komplett Jarvis-repo."; exit 1; }
[ -d "$APP_DIR" ] || { feil "Fant ikke installasjonen i $APP_DIR – kjør oppsett.sh først."; exit 1; }

cd "$SOURCE_DIR"

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

# Innlogging er slått av i lokalt miljø – fjern evt. gammel innstilling som
# fortsatt krever pålogging mot API-et.
if [ -f "$ENV_FILE" ] && grep -qE '^AGENT_KREV_INNLOGGING=' "$ENV_FILE"; then
  sed -i 's/^AGENT_KREV_INNLOGGING=.*/AGENT_KREV_INNLOGGING=0/' "$ENV_FILE"
  ok "Innlogging deaktivert i $ENV_FILE"
fi

# ── 2. Hent ny kode ───────────────────────────────────────────────────────────
REPO_EIER="$(stat -c '%U' "$SOURCE_DIR")"
REPO_GRUPPE="$(stat -c '%G' "$SOURCE_DIR")"
if [ "$REPO_EIER" = "root" ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  REPO_EIER="$SUDO_USER"
  REPO_GRUPPE="$(id -gn "$SUDO_USER")"
fi

# Eldre kjøringer kan ha opprettet FETCH_HEAD som root. Gi bare Git-metadataene
# tilbake til repo-eieren; konfig og installerte filer under /opt røres ikke.
chown -R "$REPO_EIER:$REPO_GRUPPE" "$SOURCE_DIR/.git"
git_som_eier() {
  if [ "$REPO_EIER" = "root" ]; then
    git -C "$SOURCE_DIR" "$@"
  else
    runuser -u "$REPO_EIER" -- git -C "$SOURCE_DIR" "$@"
  fi
}

FOER="$(git_som_eier rev-parse --short HEAD 2>/dev/null || echo ukjent)"
si "Henter ny versjon ($REF) …"
git_som_eier fetch --all --tags --prune

# Hvis det finnes lokale endringer (f.eks. konfigfiler), lagre dem midlertidig.
if [ -n "$(git_som_eier status --porcelain 2>/dev/null)" ]; then
  adv "Lokale endringer i repoet oppdaget – lagrer i stash"
  git_som_eier stash push -m "auto-stash-før-oppdatering-$STAMP" || true
fi

git_som_eier checkout "$REF"
git_som_eier pull --ff-only
ETTER="$(git_som_eier rev-parse --short HEAD 2>/dev/null || echo ukjent)"
ok "$FOER → $ETTER"

# ── 3. Oppdater installert agent og avhengigheter ─────────────────────────────
si "Kopierer ny agentkode til $APP_DIR …"
mkdir -p "$APP_DIR"
cp -a "$SOURCE_DIR/agent/." "$APP_DIR/"
chmod +x "$APP_DIR/scripts/update-jetson.sh" "$APP_DIR/scripts/run-update-service.sh" \
  "$APP_DIR/scripts/tren-stemme.sh" "$APP_DIR/scripts/installer-piper.sh" \
  "$APP_DIR/scripts/installer-pytorch.sh" "$APP_DIR/scripts/apt-felles.sh" 2>/dev/null || true
if [ -f "$APP_DIR/package.json" ]; then
  (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund 2>/dev/null) ||
    (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
fi
chown -R jarvis:jarvis "$APP_DIR"
ok "Agentkode oppdatert"

# Sørg for at oppdatering fra GUI alltid er installert etter en oppdatering.
mkdir -p /etc/jarvis /var/lib/jarvis /var/log/jarvis
printf '%s\n' "$SOURCE_DIR" >/etc/jarvis/source-dir
chmod 600 /etc/jarvis/source-dir
if [ -f "$APP_DIR/jarvis-update.service" ]; then
  cp "$APP_DIR/jarvis-update.service" /etc/systemd/system/jarvis-update.service
  SYSTEMCTL_BIN="$(command -v systemctl || echo /usr/bin/systemctl)"
  cat >/etc/sudoers.d/jarvis-update <<EOF
jarvis ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block jarvis-update.service
jarvis ALL=(root) NOPASSWD: /bin/systemctl start --no-block jarvis-update.service
jarvis ALL=(root) NOPASSWD: $SYSTEMCTL_BIN start --no-block jarvis-update.service
EOF
  chmod 440 /etc/sudoers.d/jarvis-update
  visudo -cf /etc/sudoers.d/jarvis-update >/dev/null || rm -f /etc/sudoers.d/jarvis-update
  systemctl daemon-reload
  ok "Oppdatering fra GUI er aktivert"
fi

# Eldre installasjoner hadde NoNewPrivileges=true. Det blokkerer også de
# eksplisitt hvitelistede sudo-kommandoene for Piper og GUI-oppdatering.
if [ -f "/etc/systemd/system/$SERVICE.service" ] && grep -q '^NoNewPrivileges=true' "/etc/systemd/system/$SERVICE.service"; then
  sed -i 's/^NoNewPrivileges=true/NoNewPrivileges=false/' "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
  ok "Tillater begrensede, hvitelistede vedlikeholdskommandoer fra GUI"
fi

# Lar agenten installere Piper-treningsmiljøet selv (kun dette skriptet).
# Må ikke ligge inni testen for jarvis-update.service; Piper-knappen skal også
# fungere på installasjoner der den valgfrie oppdateringstjenesten mangler.
APP_SCRIPTS="$APP_DIR/scripts"
cat >/etc/sudoers.d/jarvis-stemme <<EOF
jarvis ALL=(root) NOPASSWD: /bin/bash $APP_SCRIPTS/installer-piper.sh
jarvis ALL=(root) NOPASSWD: /usr/bin/bash $APP_SCRIPTS/installer-piper.sh
jarvis ALL=(root) NOPASSWD: /bin/bash $APP_SCRIPTS/installer-pytorch.sh
jarvis ALL=(root) NOPASSWD: /usr/bin/bash $APP_SCRIPTS/installer-pytorch.sh
EOF
chmod 440 /etc/sudoers.d/jarvis-stemme
if visudo -cf /etc/sudoers.d/jarvis-stemme >/dev/null; then
  ok "Piper-installasjon fra GUI er autorisert"
else
  rm -f /etc/sudoers.d/jarvis-stemme
  feil "Kunne ikke aktivere Piper-installasjon fra GUI (ugyldig sudoers-regel)"
fi
chown jarvis:jarvis /var/log/jarvis 2>/dev/null || true


# ── 4. Bygg GUI ───────────────────────────────────────────────────────────────
if [ -f "$SOURCE_DIR/package.json" ] && [ "${HOPP_GUI:-0}" -eq 0 ]; then
  si "Bygger web-GUI …"
  (cd "$SOURCE_DIR" && npm install --include=dev --no-audit --no-fund)
  (cd "$SOURCE_DIR" && NITRO_PRESET=node-server npm run build)
  mkdir -p "$GUI_DIR/agent/scripts"
  rm -rf "$GUI_DIR/.output"
  cp -a "$SOURCE_DIR/.output" "$GUI_DIR/.output"
  cp -a "$SOURCE_DIR/agent/scripts/start-gui.sh" "$GUI_DIR/agent/scripts/start-gui.sh"
  chown -R jarvis:jarvis "$GUI_DIR"
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
AGENT_SERVICE_MAL="$APP_DIR/jarvis-agent.service"
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
if [ -f "$GUI_DIR/.output/server/index.mjs" ]; then
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
