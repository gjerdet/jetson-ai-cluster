#!/usr/bin/env bash
# Lager et selvsignert TLS-sertifikat for Jarvis-agenten (LAN-bruk).
# Bruk:  ./scripts/make-cert.sh 192.168.1.50 jetson.local
set -euo pipefail

OUT_DIR="${CERT_DIR:-./certs}"
DAYS="${DAYS:-825}"
mkdir -p "$OUT_DIR"

if [ "$#" -eq 0 ]; then
  echo "Bruk: $0 <ip-eller-vertsnavn> [flere ...]" >&2
  exit 1
fi

ALT=""
i=1
for host in "$@"; do
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    ALT+="IP.$i:$host,"
  else
    ALT+="DNS.$i:$host,"
  fi
  i=$((i + 1))
done
ALT+="IP.$i:127.0.0.1,DNS.$((i + 1)):localhost"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT_DIR/agent.key" \
  -out "$OUT_DIR/agent.crt" \
  -days "$DAYS" -sha256 \
  -subj "/CN=jarvis-agent" \
  -addext "subjectAltName=${ALT%,}" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 600 "$OUT_DIR/agent.key"
echo "Ferdig:"
echo "  AGENT_TLS_CERT=$(cd "$OUT_DIR" && pwd)/agent.crt"
echo "  AGENT_TLS_KEY=$(cd "$OUT_DIR" && pwd)/agent.key"
echo
echo "Åpne https://<ip>:8787/api/status i nettleseren én gang og godta sertifikatet,"
echo "ellers blokkerer nettleseren HUD-ens kall mot backend-en."
