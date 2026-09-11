#!/usr/bin/env bash
# Ett-kommandos oppsett av Jarvis på en Jetson (eller annen Ubuntu/Debian-maskin).
#
#   curl -fsSL <url>/install-jetson.sh | bash
#   eller: sudo bash agent/scripts/install-jetson.sh
#
# Skriptet:
#   1. installerer Ollama og henter modellene (llama3.2:3b, hermes3:8b, nomic-embed-text)
#   2. setter opp /etc/jarvis/agent.env med tilfeldige hemmeligheter
#   3. installerer og starter jarvis-agent som systemd-tjeneste
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RST="\033[0m"
si() { echo -e "${BLA}▸ $*${RST}"; }
ok() { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Kjør med sudo: sudo bash $0"
  exit 1
fi

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
AGENT_DIR="$REPO_DIR/agent"
DATA_DIR="${AGENT_DATA:-/var/lib/jarvis/data}"
SANDBOX_DIR="${AGENT_SANDBOX:-/var/lib/jarvis/sandbox}"
ENV_FILE="/etc/jarvis/agent.env"
MODELLER="${JARVIS_MODELS:-llama3.2:3b hermes3:8b nomic-embed-text}"
ADMIN_EPOST="${JARVIS_ADMIN_EPOST:-}"

# ── 1. Ollama ────────────────────────────────────────────────────────────────
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
systemctl enable --now ollama
sleep 3

for m in $MODELLER; do
  si "Henter modell $m (dette kan ta noen minutter) …"
  ollama pull "$m" || adv "Klarte ikke hente $m – hopper over"
done
ok "Modeller klare: $(ollama list | awk 'NR>1{printf "%s ", $1}')"

# ── 2. Node.js ───────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  si "Installerer Node.js 20 …"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v)"

# ── 3. Agent-oppsett ─────────────────────────────────────────────────────────
si "Setter opp kataloger og rettigheter"
id -u jarvis >/dev/null 2>&1 || useradd --system --home /var/lib/jarvis --shell /usr/sbin/nologin jarvis
mkdir -p "$DATA_DIR" "$SANDBOX_DIR" /etc/jarvis
chown -R jarvis:jarvis /var/lib/jarvis

if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(openssl rand -hex 32)"
  SECRET="$(openssl rand -hex 32)"
  PASSORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  [ -n "$ADMIN_EPOST" ] || ADMIN_EPOST="admin@jarvis.local"
  cat >"$ENV_FILE" <<EOF
AGENT_HOST=0.0.0.0
AGENT_PORT=8787
AGENT_TOKEN=$TOKEN
AGENT_SECRET_KEY=$SECRET
AGENT_DATA=$DATA_DIR
AGENT_SANDBOX=$SANDBOX_DIR
AGENT_ORIGINS=http://localhost:*,https://*.lovable.app
AGENT_ALLOW_NETWORK=0
AGENT_BACKUP_HOURS=24
AGENT_BACKUP_KEEP=14

# AI: lokal Ollama på denne maskinen
JARVIS_AI_BASE_URL=http://127.0.0.1:11434/v1
JARVIS_AI_MODEL=llama3.2:3b

# Første innlogging i web-GUI-et
JARVIS_ADMIN_EPOST=$ADMIN_EPOST
JARVIS_ADMIN_PASSORD=$PASSORD
EOF
  chmod 600 "$ENV_FILE"
  chown jarvis:jarvis "$ENV_FILE"
  ok "Opprettet $ENV_FILE"
  echo -e "${GRN}   Innlogging: $ADMIN_EPOST / $PASSORD${RST}"
  echo "$ADMIN_EPOST / $PASSORD" >/root/jarvis-innlogging.txt
  chmod 600 /root/jarvis-innlogging.txt
else
  ok "$ENV_FILE finnes allerede – beholdes"
fi

si "Installerer agent-koden i /opt/jarvis-agent"
mkdir -p /opt/jarvis-agent
cp -r "$AGENT_DIR/." /opt/jarvis-agent/
cd /opt/jarvis-agent
npm install --omit=dev --no-audit --no-fund
chown -R jarvis:jarvis /opt/jarvis-agent

si "Installerer systemd-tjenesten"
cp "$AGENT_DIR/jarvis-agent.service" /etc/systemd/system/jarvis-agent.service
systemctl daemon-reload
systemctl enable --now jarvis-agent
sleep 2

IP="$(hostname -I | awk '{print $1}')"
if curl -fsS "http://127.0.0.1:8787/api/status" >/dev/null 2>&1; then
  ok "Agenten kjører"
else
  adv "Agenten svarer ikke ennå – se: journalctl -u jarvis-agent -f"
fi

# Stemme (PyTorch + Piper) installeres automatisk med mindre HOPP_OVER_STEMME=1
if [ "${HOPP_OVER_STEMME:-0}" != "1" ]; then
  si "Installerer stemmestøtte (NVIDIA PyTorch + Piper) – dette kan ta 10–30 min"
  if bash "$AGENT_DIR/scripts/installer-pytorch.sh"; then
    ok "PyTorch installert"
  else
    adv "PyTorch-installasjon feilet – prøv INSTALLER PYTORCH i GUI-et senere"
  fi
  if bash "$AGENT_DIR/scripts/installer-piper.sh"; then
    ok "Piper installert"
  else
    adv "Piper-installasjon feilet – prøv INSTALLER PIPER AUTOMATISK i GUI-et senere"
  fi
else
  si "Hopper over stemmeinstallasjon (HOPP_OVER_STEMME=1)"
fi

cat <<EOF

${GRN}────────────────────────────────────────────────${RST}
 Ferdig. Åpne web-GUI-et og kjør HURTIGOPPSETT under NODER.

   Jetson-IP     : $IP
   Ollama        : http://$IP:11434/v1
   Backend       : http://$IP:8787
   Innlogging    : se /root/jarvis-innlogging.txt

 Nyttig:
   systemctl status jarvis-agent
   journalctl -u jarvis-agent -f
   ollama list
${GRN}────────────────────────────────────────────────${RST}
EOF
