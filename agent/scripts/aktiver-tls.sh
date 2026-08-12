#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Slår på HTTPS for Jarvis-agenten og binder den til hele LAN-et.
#
#    sudo bash agent/scripts/aktiver-tls.sh 192.168.12.5
#    sudo bash agent/scripts/aktiver-tls.sh 192.168.12.5 jetson-2-rag.local
#
#  Skriptet:
#    1. lager (eller gjenbruker) et selvsignert sertifikat i /etc/jarvis/certs
#    2. setter AGENT_TLS_CERT/KEY, AGENT_PORT=8443 og AGENT_HOST=0.0.0.0
#    3. rydder bort gamle prosesser som holder porten
#    4. restarter tjenesten og verifiserer at den svarer på https
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RED="\033[31m"; RST="\033[0m"
si()  { echo -e "${BLA}▸ $*${RST}"; }
ok()  { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }
feil(){ echo -e "${RED}✗ $*${RST}"; }

[ "$(id -u)" -eq 0 ] || { feil "Må kjøres som root:  sudo bash $0 <ip>"; exit 1; }

ENV_FILE="/etc/jarvis/agent.env"
CERT_DIR="/etc/jarvis/certs"
TLS_PORT="${TLS_PORT:-8443}"

[ -f "$ENV_FILE" ] || { feil "Fant ikke $ENV_FILE – kjør oppsett.sh først."; exit 1; }

VERTER=("$@")
if [ "${#VERTER[@]}" -eq 0 ]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$IP" ] || { feil "Klarte ikke å finne IP – oppgi den: sudo bash $0 192.168.12.5"; exit 1; }
  VERTER=("$IP" "$(hostname)")
  adv "Ingen vert oppgitt – bruker ${VERTER[*]}"
fi

# ── 1. Sertifikat ────────────────────────────────────────────────────────────
mkdir -p "$CERT_DIR"
if [ -f "$CERT_DIR/agent.crt" ] && [ -f "$CERT_DIR/agent.key" ] && [ "${TVING_CERT:-0}" != "1" ]; then
  ok "Sertifikat finnes fra før i $CERT_DIR (kjør med TVING_CERT=1 for å lage nytt)"
else
  si "Lager selvsignert sertifikat for: ${VERTER[*]}"
  ALT=""; i=1
  for h in "${VERTER[@]}"; do
    if [[ "$h" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then ALT+="IP.$i:$h,"; else ALT+="DNS.$i:$h,"; fi
    i=$((i + 1))
  done
  ALT+="IP.$i:127.0.0.1,DNS.$((i + 1)):localhost"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/agent.key" -out "$CERT_DIR/agent.crt" \
    -days "${DAYS:-825}" -sha256 -subj "/CN=jarvis-agent" \
    -addext "subjectAltName=${ALT%,}" \
    -addext "keyUsage=digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
  ok "Sertifikat laget"
fi
chmod 640 "$CERT_DIR/agent.key" "$CERT_DIR/agent.crt"
chown -R root:jarvis "$CERT_DIR" 2>/dev/null || true
chmod 750 "$CERT_DIR"

# ── 2. Miljøvariabler ────────────────────────────────────────────────────────
sett_env() {
  local n="$1" v="$2"
  if grep -qE "^$n=" "$ENV_FILE"; then
    sed -i "s|^$n=.*|$n=$v|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$n" "$v" >>"$ENV_FILE"
  fi
}
sett_env AGENT_HOST 0.0.0.0
sett_env AGENT_PORT "$TLS_PORT"
sett_env AGENT_TLS_CERT "$CERT_DIR/agent.crt"
sett_env AGENT_TLS_KEY "$CERT_DIR/agent.key"
ok "Konfig oppdatert: HTTPS på port $TLS_PORT, bundet til 0.0.0.0"

# ── 3. Frigjør porten ────────────────────────────────────────────────────────
frigjor_port() {
  local port="$1"
  local pider
  pider="$(ss -tlnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  [ -n "$pider" ] || return 0
  for p in $pider; do
    if [ "$p" = "$(systemctl show -p MainPID --value jarvis-agent 2>/dev/null)" ]; then continue; fi
    adv "Stopper gammel prosess (pid $p) som holder port $port"
    kill "$p" 2>/dev/null || true
  done
  sleep 2
  for p in $pider; do kill -9 "$p" 2>/dev/null || true; done
}
systemctl stop jarvis-agent 2>/dev/null || true
frigjor_port 8787
frigjor_port "$TLS_PORT"

# ── 4. Start og verifiser ────────────────────────────────────────────────────
systemctl daemon-reload
systemctl restart jarvis-agent
for _ in $(seq 1 30); do
  curl -fsSk "https://127.0.0.1:$TLS_PORT/api/status" >/dev/null 2>&1 && break
  sleep 1
done
if curl -fsSk "https://127.0.0.1:$TLS_PORT/api/status" >/dev/null 2>&1; then
  IP1="${VERTER[0]}"
  ok "Agenten svarer på https://$IP1:$TLS_PORT/api/status"
  echo
  echo "Neste steg på telefonen (samme Wi-Fi):"
  echo "  1. åpne https://$IP1:$TLS_PORT/api/status og godta sertifikatet"
  echo "  2. åpne HUD-en og logg inn"
else
  feil "Agenten svarer fortsatt ikke – siste logglinjer:"
  SYSTEMD_PAGER=cat journalctl -u jarvis-agent -n 30 --no-pager -o cat 2>/dev/null || true
  exit 1
fi
