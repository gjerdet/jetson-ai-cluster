#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Legg til en ny Jetson (eller annen maskin) som node i Jarvis-klyngen.
#
#  Kjøres PÅ DEN NYE MASKINEN:
#     sudo bash agent/scripts/legg-til-node.sh --master 192.168.1.50
#
#  Skriptet:
#    1. installerer Ollama og henter modellene som skal kjøre på denne noden
#    2. åpner Ollama for nettverket (0.0.0.0:11434)
#    3. henter agent-tokenet fra master (eller tar det som argument)
#    4. registrerer seg selv i klyngen via POST /api/noder/registrer
#       → noden dukker automatisk opp i web-GUI-et under NODER
#
#  Idempotent: kan kjøres på nytt. Eksisterende node oppdateres i stedet for
#  å dupliseres (master matcher på id/baseUrl).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RED="\033[31m"; RST="\033[0m"
si()  { echo -e "${BLA}▸ $*${RST}"; }
ok()  { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }
feil(){ echo -e "${RED}✗ $*${RST}"; }

MASTER=""
MASTER_PORT="${MASTER_PORT:-8787}"
TOKEN="${AGENT_TOKEN:-}"
NAVN="${JARVIS_NODE_NAVN:-$(hostname | tr '[:lower:]' '[:upper:]')}"
MODELLER="${JARVIS_MODELS:-llama3.2:3b}"
ROLLE="worker"
OPPGAVER="chat,verktoy"
VEKT=1
MIN_IP=""
HOPP_MODELLER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --master)       MASTER="$2"; shift ;;
    --master-port)  MASTER_PORT="$2"; shift ;;
    --token)        TOKEN="$2"; shift ;;
    --navn)         NAVN="$2"; shift ;;
    --modeller)     MODELLER="$2"; shift ;;
    --rolle)        ROLLE="$2"; shift ;;
    --oppgaver)     OPPGAVER="$2"; shift ;;
    --vekt)         VEKT="$2"; shift ;;
    --ip)           MIN_IP="$2"; shift ;;
    --uten-modeller) HOPP_MODELLER=1 ;;
    -h|--hjelp|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) feil "Ukjent valg: $1"; exit 1 ;;
  esac
  shift
done

if [ -z "$MASTER" ]; then
  read -r -p "IP/vertsnavn til master-noden (der backend kjører): " MASTER
fi
[ -n "$MASTER" ] || { feil "Master-adresse mangler."; exit 1; }

[ -n "$MIN_IP" ] || MIN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$MIN_IP" ] || { feil "Fant ikke IP-en til denne maskinen – bruk --ip."; exit 1; }

MASTER_URL="http://$MASTER:$MASTER_PORT"
MIN_URL="http://$MIN_IP:11434/v1"
HOVEDMODELL="$(printf '%s' "$MODELLER" | awk '{print $1}')"

echo
echo -e "${GRN}── NY NODE I JARVIS-KLYNGEN ────────────────${RST}"
echo "   Denne maskinen : $NAVN ($MIN_IP)"
echo "   Master         : $MASTER_URL"
echo "   Modeller       : $MODELLER"
echo

# ── 1. Ollama ────────────────────────────────────────────────────────────────
if [ "$(id -u)" -eq 0 ]; then
  if ! command -v ollama >/dev/null 2>&1; then
    si "Installerer Ollama …"
    curl -fsSL https://ollama.com/install.sh | sh
  else
    ok "Ollama er allerede installert"
  fi

  si "Åpner Ollama for nettverket"
  mkdir -p /etc/systemd/system/ollama.service.d
  cat >/etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=30m"
EOF
  systemctl daemon-reload
  systemctl enable --now ollama >/dev/null 2>&1 || adv "Fikk ikke startet ollama"
  for i in $(seq 1 30); do curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

  if [ "$HOPP_MODELLER" -eq 0 ]; then
    for m in $MODELLER; do
      if ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$m"; then
        ok "Modell $m finnes allerede"
      else
        si "Henter modell $m …"
        ollama pull "$m" || adv "Klarte ikke hente $m"
      fi
    done
  fi
else
  adv "Kjører uten root – hopper over installasjon av Ollama (registrerer bare noden)"
fi

# ── 2. Verifiser at Ollama svarer utenfra ────────────────────────────────────
si "Tester $MIN_URL"
if curl -fsS --max-time 8 "http://$MIN_IP:11434/api/tags" >/dev/null 2>&1; then
  ok "Ollama svarer på $MIN_IP:11434"
else
  feil "Ollama svarer ikke på $MIN_IP:11434 – master vil ikke kunne bruke noden."
  exit 1
fi

# ── 3. Agent-token ───────────────────────────────────────────────────────────
if [ -z "$TOKEN" ] && [ -r /etc/jarvis/agent.env ]; then
  TOKEN="$(grep -E '^AGENT_TOKEN=' /etc/jarvis/agent.env | cut -d= -f2- || true)"
fi
if [ -z "$TOKEN" ]; then
  echo
  echo "Agent-tokenet finner du på master-noden:"
  echo "   sudo grep AGENT_TOKEN /etc/jarvis/agent.env"
  read -r -s -p "Lim inn AGENT_TOKEN: " TOKEN; echo
fi
[ -n "$TOKEN" ] || { feil "Token mangler."; exit 1; }

# ── 4. Registrer i klyngen ───────────────────────────────────────────────────
NODE_ID="node-$(printf '%s' "$MIN_IP" | tr '.' '-')"
DUTIES="$(printf '%s' "$OPPGAVER" | awk -F, '{for(i=1;i<=NF;i++) printf "%s\"%s\"", (i>1?",":""), $i}')"

LAST="{\"id\":\"$NODE_ID\",\"name\":\"$NAVN\",\"baseUrl\":\"$MIN_URL\",\"model\":\"$HOVEDMODELL\",\"role\":\"$ROLLE\",\"duties\":[$DUTIES],\"weight\":$VEKT,\"enabled\":true}"

si "Registrerer noden hos master …"
SVAR="$(curl -fsS --max-time 15 -X POST "$MASTER_URL/api/noder/registrer" \
        -H "content-type: application/json" \
        -H "x-agent-token: $TOKEN" \
        -d "$LAST" 2>&1)" || {
  feil "Registrering feilet: $SVAR"
  echo
  echo "Vanlige årsaker:"
  echo "  · «Selvregistrering av noder er slått av» → slå på i GUI: SYSTEM › Innstillinger"
  echo "  · Feil AGENT_TOKEN → sjekk /etc/jarvis/agent.env på master"
  echo "  · Master ikke nåbar → curl $MASTER_URL/health"
  exit 1
}

ok "Noden er registrert i klyngen"
echo "   Svar fra master: $SVAR"
echo
echo -e "${GRN}────────────────────────────────────────────${RST}"
echo " $NAVN er nå med i klyngen og dukker opp under NODER i web-GUI-et."
echo "   Adresse   : $MIN_URL"
echo "   Modell    : $HOVEDMODELL"
echo "   Oppgaver  : $OPPGAVER"
echo
echo " Lastbalanseringen tar noden i bruk automatisk (POOL-panelet viser den)."
echo -e "${GRN}────────────────────────────────────────────${RST}"
