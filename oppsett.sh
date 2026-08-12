#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  JARVIS – komplett oppsett med ett kommando
#
#    sudo bash oppsett.sh
#    sudo bash oppsett.sh --stille --epost meg@example.com --passord hemmelig
#
#  Skriptet gjør ALT:
#    1. installerer Node.js 20 og Ollama
#    2. henter AI-modellene (chat, Hermes, embeddings)
#    3. lager /etc/jarvis/agent.env med tilfeldige hemmeligheter og admin-bruker
#    4. installerer agenten som systemd-tjeneste (jarvis-agent)
#    5. bygger web-GUI-et og serverer det som systemd-tjeneste (jarvis-gui)
#    6. verifiserer at alt svarer, og skriver ut innlogging + adresser
#
#  Kjør på nytt når som helst – eksisterende konfig og data røres ikke.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RED="\033[31m"; RST="\033[0m"
si()  { echo -e "${BLA}▸ $*${RST}"; }
ok()  { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }
feil(){ echo -e "${RED}✗ $*${RST}"; }

# ── Argumenter ───────────────────────────────────────────────────────────────
STILLE=0
EPOST="${JARVIS_ADMIN_EPOST:-}"
PASSORD="${JARVIS_ADMIN_PASSORD:-}"
CHAT_MODELL="${JARVIS_CHAT_MODEL:-llama3.2:3b}"
HERMES_MODELL="${JARVIS_HERMES_MODEL:-hermes3:8b}"
EMBED_MODELL="${JARVIS_EMBED_MODEL:-nomic-embed-text}"
AGENT_PORT="${AGENT_PORT:-8787}"
GUI_PORT="${JARVIS_GUI_PORT:-8080}"
HOPP_GUI=0
HOPP_MODELLER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --stille|-s)        STILLE=1 ;;
    --epost)            EPOST="$2"; shift ;;
    --passord)          PASSORD="$2"; shift ;;
    --chat-modell)      CHAT_MODELL="$2"; shift ;;
    --hermes-modell)    HERMES_MODELL="$2"; shift ;;
    --port)             AGENT_PORT="$2"; shift ;;
    --gui-port)         GUI_PORT="$2"; shift ;;
    --uten-gui)         HOPP_GUI=1 ;;
    --uten-modeller)    HOPP_MODELLER=1 ;;
    -h|--hjelp|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) feil "Ukjent valg: $1"; exit 1 ;;
  esac
  shift
done

if [ "$(id -u)" -ne 0 ]; then
  feil "Må kjøres som root:  sudo bash $0"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$REPO_DIR/agent"
APP_DIR="/opt/jarvis-agent"
GUI_DIR="/opt/jarvis-gui"
DATA_DIR="${AGENT_DATA:-/var/lib/jarvis/data}"
SANDBOX_DIR="${AGENT_SANDBOX:-/var/lib/jarvis/sandbox}"
ENV_FILE="/etc/jarvis/agent.env"

[ -d "$AGENT_DIR" ] || { feil "Fant ikke $AGENT_DIR – kjør skriptet fra prosjektmappa."; exit 1; }

echo
echo -e "${GRN}╔══════════════════════════════════════════════╗${RST}"
echo -e "${GRN}║   J A R V I S   ·   O P P S E T T            ║${RST}"
echo -e "${GRN}╚══════════════════════════════════════════════╝${RST}"
echo

# ── Spørsmål (kun i interaktiv modus, og bare hvis konfig mangler) ───────────
if [ "$STILLE" -eq 0 ] && [ ! -f "$ENV_FILE" ]; then
  read -r -p "Admin e-post [admin@jarvis.local]: " svar || true
  EPOST="${svar:-${EPOST:-admin@jarvis.local}}"
  read -r -s -p "Admin passord (blank = generer tilfeldig): " svar || true; echo
  PASSORD="${svar:-$PASSORD}"
  read -r -p "Chat-modell [$CHAT_MODELL]: " svar || true
  CHAT_MODELL="${svar:-$CHAT_MODELL}"
  read -r -p "Hjelpemodell (Hermes) [$HERMES_MODELL]: " svar || true
  HERMES_MODELL="${svar:-$HERMES_MODELL}"
  read -r -p "Bygge og servere web-GUI-et her? [J/n]: " svar || true
  case "${svar:-J}" in [nN]*) HOPP_GUI=1 ;; esac
  echo
fi
EPOST="${EPOST:-admin@jarvis.local}"

# ── 1. Systempakker ──────────────────────────────────────────────────────────
si "Sjekker systempakker …"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || adv "apt-get update feilet – fortsetter"
  apt-get install -y -qq curl ca-certificates openssl python3 git >/dev/null 2>&1 || adv "Noen pakker manglet"
else
  adv "Fant ikke apt-get – hopper over systempakker"
fi
ok "Systempakker klare"

# ── 2. Node.js 20 ────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  si "Installerer Node.js 20 …"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v)"

# ── 3. Ollama + modeller ─────────────────────────────────────────────────────
if ! command -v ollama >/dev/null 2>&1; then
  si "Installerer Ollama …"
  curl -fsSL https://ollama.com/install.sh | sh
else
  ok "Ollama er allerede installert"
fi

si "Lar Ollama lytte på hele nettverket (0.0.0.0:11434)"
mkdir -p /etc/systemd/system/ollama.service.d
cat >/etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=30m"
EOF
systemctl daemon-reload
systemctl enable --now ollama >/dev/null 2>&1 || adv "Fikk ikke startet ollama-tjenesten"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

if [ "$HOPP_MODELLER" -eq 0 ]; then
  for m in "$CHAT_MODELL" "$HERMES_MODELL" "$EMBED_MODELL"; do
    [ -n "$m" ] || continue
    si "Henter modell $m (kan ta noen minutter) …"
    ollama pull "$m" || adv "Klarte ikke hente $m – hopper over"
  done
fi
ok "Modeller: $(ollama list 2>/dev/null | awk 'NR>1{printf "%s ", $1}')"

# ── 4. Bruker, kataloger og konfig ───────────────────────────────────────────
si "Setter opp bruker, kataloger og konfig"
id -u jarvis >/dev/null 2>&1 || useradd --system --home /var/lib/jarvis --shell /usr/sbin/nologin jarvis
mkdir -p "$DATA_DIR" "$SANDBOX_DIR" /etc/jarvis
chown -R jarvis:jarvis /var/lib/jarvis

NY_INNLOGGING=0
if [ ! -f "$ENV_FILE" ]; then
  [ -n "$PASSORD" ] || PASSORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  cat >"$ENV_FILE" <<EOF
AGENT_HOST=0.0.0.0
AGENT_PORT=$AGENT_PORT
AGENT_TOKEN=$(openssl rand -hex 32)
AGENT_SECRET_KEY=$(openssl rand -hex 32)
AGENT_DATA=$DATA_DIR
AGENT_SANDBOX=$SANDBOX_DIR
AGENT_ORIGINS=http://localhost:*,http://*:$GUI_PORT,https://*.lovable.app
AGENT_ALLOW_NETWORK=0
AGENT_BACKUP_HOURS=24
AGENT_BACKUP_KEEP=14

# AI: lokal Ollama på denne maskinen
JARVIS_AI_BASE_URL=http://127.0.0.1:11434/v1
JARVIS_AI_MODEL=$CHAT_MODELL
JARVIS_HERMES_MODEL=$HERMES_MODELL
JARVIS_EMBED_MODEL=$EMBED_MODELL

# Første innlogging i web-GUI-et
JARVIS_ADMIN_EPOST=$EPOST
JARVIS_ADMIN_PASSORD=$PASSORD
EOF
  chmod 600 "$ENV_FILE"; chown jarvis:jarvis "$ENV_FILE"
  printf '%s / %s\n' "$EPOST" "$PASSORD" >/root/jarvis-innlogging.txt
  chmod 600 /root/jarvis-innlogging.txt
  NY_INNLOGGING=1
  ok "Opprettet $ENV_FILE"
else
  ok "$ENV_FILE finnes fra før – beholdes uendret"
fi

# ── 5. Agenten som systemd-tjeneste ──────────────────────────────────────────
si "Installerer agenten i $APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$AGENT_DIR/." "$APP_DIR/"
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null)
chown -R jarvis:jarvis "$APP_DIR"

cp "$AGENT_DIR/jarvis-agent.service" /etc/systemd/system/jarvis-agent.service
systemctl daemon-reload
systemctl enable --now jarvis-agent
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$AGENT_PORT/health" >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS "http://127.0.0.1:$AGENT_PORT/health" >/dev/null 2>&1; then
  ok "Agenten svarer på port $AGENT_PORT"
else
  adv "Agenten svarer ikke ennå – se: journalctl -u jarvis-agent -f"
fi

# ── 6. Web-GUI ───────────────────────────────────────────────────────────────
if [ "$HOPP_GUI" -eq 0 ] && [ -f "$REPO_DIR/package.json" ]; then
  si "Bygger web-GUI-et (kan ta et par minutter) …"
  (cd "$REPO_DIR" && npm install --no-audit --no-fund >/dev/null && npm run build >/dev/null) \
    && ok "GUI bygget" || { adv "Bygg feilet – hopper over GUI-tjenesten"; HOPP_GUI=1; }
fi

if [ "$HOPP_GUI" -eq 0 ]; then
  mkdir -p "$GUI_DIR"
  cp -r "$REPO_DIR/." "$GUI_DIR/" 2>/dev/null || true
  chown -R jarvis:jarvis "$GUI_DIR"
  cat >/etc/systemd/system/jarvis-gui.service <<EOF
[Unit]
Description=Jarvis web-GUI
After=network-online.target jarvis-agent.service

[Service]
Type=simple
User=jarvis
WorkingDirectory=$GUI_DIR
Environment=PORT=$GUI_PORT
Environment=HOST=0.0.0.0
Environment=NODE_ENV=production
Environment=GUI_DIR=$GUI_DIR
ExecStart=/usr/bin/env bash $GUI_DIR/agent/scripts/start-gui.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now jarvis-gui >/dev/null 2>&1 || adv "Fikk ikke startet jarvis-gui"
  for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$GUI_PORT/" >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS "http://127.0.0.1:$GUI_PORT/" >/dev/null 2>&1 \
    && ok "GUI svarer på port $GUI_PORT" \
    || adv "GUI svarer ikke ennå – se: journalctl -u jarvis-gui -f"
fi

# ── 7. Oppsummering ──────────────────────────────────────────────────────────
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="127.0.0.1"

echo
echo -e "${GRN}────────────────────────────────────────────────${RST}"
echo -e " ${GRN}Ferdig!${RST} Jarvis kjører på denne maskinen."
echo
echo "   Web-GUI       : http://$IP:$GUI_PORT"
echo "   Backend       : http://$IP:$AGENT_PORT"
echo "   Ollama        : http://$IP:11434/v1"
echo "   Chat-modell   : $CHAT_MODELL"
echo "   Hjelpemodell  : $HERMES_MODELL"
if [ "$NY_INNLOGGING" -eq 1 ]; then
  echo
  echo -e "   ${GRN}Innlogging    : $EPOST / $PASSORD${RST}"
  echo "   (lagret i /root/jarvis-innlogging.txt)"
else
  echo
  echo "   Innlogging    : uendret (se $ENV_FILE)"
fi
echo
echo " Neste steg i GUI-et: NODER › HURTIGOPPSETT → skriv inn $IP"
echo
echo " Nyttige kommandoer:"
echo "   systemctl status jarvis-agent jarvis-gui"
echo "   journalctl -u jarvis-agent -f"
echo "   sudo bash agent/scripts/update-jetson.sh     # oppdater senere"
echo -e "${GRN}────────────────────────────────────────────────${RST}"
