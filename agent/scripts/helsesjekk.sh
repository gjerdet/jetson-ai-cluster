#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Jarvis helsesjekk – kjøres automatisk til slutt i oppsett.sh, og kan kjøres
#  når som helst etterpå:
#
#     sudo bash agent/scripts/helsesjekk.sh
#     bash agent/scripts/helsesjekk.sh --json
#
#  Sjekker: GPU, Ollama + modeller, systemd-tjenester, porter og diskplass.
#  Avslutter med kode 0 når alt kritisk er OK, ellers 1.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

GRN="\033[32m"; GUL="\033[33m"; RED="\033[31m"; BLA="\033[36m"; RST="\033[0m"

JSON=0
AGENT_PORT="${AGENT_PORT:-8787}"
GUI_PORT="${JARVIS_GUI_PORT:-8080}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
KREVDE_MODELLER="${JARVIS_MODELS:-${JARVIS_CHAT_MODEL:-llama3.2:3b} ${JARVIS_HERMES_MODEL:-hermes3:8b} ${JARVIS_EMBED_MODEL:-nomic-embed-text}}"
SJEKK_GUI="${SJEKK_GUI:-1}"
LOGG="${JARVIS_LOG_DIR:-/var/log/jarvis}/helsesjekk.log"

# /health beskytter OS- og sandkasseinformasjon med AGENT_TOKEN. Les tokenet
# lokalt når helsesjekken kjøres med sudo, men logg eller skriv det aldri ut.
AGENT_ENV_FILE="${AGENT_ENV_FILE:-/etc/jarvis/agent.env}"
AGENT_TOKEN_LOCAL="${AGENT_TOKEN:-}"
if [ -z "$AGENT_TOKEN_LOCAL" ] && [ -r "$AGENT_ENV_FILE" ]; then
  AGENT_TOKEN_LOCAL="$(grep -E '^AGENT_TOKEN=' "$AGENT_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON=1 ;;
    --uten-gui) SJEKK_GUI=0 ;;
    --port) AGENT_PORT="$2"; shift ;;
    --gui-port) GUI_PORT="$2"; shift ;;
    -h|--hjelp|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  esac
  shift
done

ANTALL_OK=0; ANTALL_ADV=0; ANTALL_FEIL=0
JSON_RADER=()

# resultat <status ok|advarsel|feil> <navn> <melding>
resultat() {
  local st="$1" navn="$2" melding="$3"
  case "$st" in
    ok)       ANTALL_OK=$((ANTALL_OK+1));   [ "$JSON" -eq 0 ] && echo -e "${GRN}✓${RST} $navn — $melding" ;;
    advarsel) ANTALL_ADV=$((ANTALL_ADV+1)); [ "$JSON" -eq 0 ] && echo -e "${GUL}!${RST} $navn — $melding" ;;
    feil)     ANTALL_FEIL=$((ANTALL_FEIL+1));[ "$JSON" -eq 0 ] && echo -e "${RED}✗${RST} $navn — $melding" ;;
  esac
  JSON_RADER+=("{\"navn\":\"$navn\",\"status\":\"$st\",\"melding\":\"$(printf '%s' "$melding" | sed 's/"/\\"/g')\"}")
}

[ "$JSON" -eq 0 ] && echo -e "\n${BLA}── JARVIS HELSESJEKK ──────────────────────────${RST}"

# ── 1. GPU ───────────────────────────────────────────────────────────────────
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_INFO="$(nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu \
              --format=csv,noheader,nounits 2>/dev/null | head -1)"
  if [ -n "$GPU_INFO" ]; then
    resultat ok "GPU" "nvidia-smi: $GPU_INFO"
  else
    resultat feil "GPU" "nvidia-smi finnes, men svarer ikke. Sjekk driveren."
  fi
elif command -v tegrastats >/dev/null 2>&1; then
  LINJE="$(timeout 6 tegrastats --interval 1000 2>/dev/null | head -1)"
  if [ -n "$LINJE" ]; then
    resultat ok "GPU (Jetson)" "tegrastats: $(printf '%s' "$LINJE" | cut -c1-120)"
  else
    resultat advarsel "GPU (Jetson)" "tegrastats ga ingen data"
  fi
elif ls /dev/nvidia* >/dev/null 2>&1 || [ -d /sys/devices/gpu.0 ]; then
  resultat advarsel "GPU" "GPU-enhet finnes, men verken nvidia-smi eller tegrastats er installert"
else
  resultat advarsel "GPU" "Fant ingen NVIDIA-GPU – Jarvis kjører da på CPU (tregere)"
fi

if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
  T=$(( $(cat /sys/class/thermal/thermal_zone0/temp) / 1000 ))
  if [ "$T" -ge 85 ]; then resultat advarsel "Temperatur" "${T} °C – høy, sjekk kjøling"
  else resultat ok "Temperatur" "${T} °C"; fi
fi

# ── 2. Ollama og modeller ────────────────────────────────────────────────────
if curl -fsS --max-time 8 "$OLLAMA_URL/api/tags" -o /tmp/jarvis-tags.json 2>/dev/null; then
  ANTALL_MODELLER=$(grep -o '"name"' /tmp/jarvis-tags.json | wc -l | tr -d ' ')
  resultat ok "Ollama" "svarer på $OLLAMA_URL · $ANTALL_MODELLER modeller installert"

  for m in $KREVDE_MODELLER; do
    [ -n "$m" ] || continue
    BASE="${m%%:*}"
    if grep -q "\"$m\"" /tmp/jarvis-tags.json || grep -q "\"$BASE" /tmp/jarvis-tags.json; then
      resultat ok "Modell $m" "lastet ned"
    else
      resultat feil "Modell $m" "mangler – kjør «ollama pull $m»"
    fi
  done

  # Verifiser at chat-modellen faktisk kan generere tekst (og at GPU/CPU svarer).
  CHAT="${JARVIS_CHAT_MODEL:-$(printf '%s' "$KREVDE_MODELLER" | awk '{print $1}')}"
  T0=$(date +%s%3N 2>/dev/null || echo 0)
  SVAR="$(curl -fsS --max-time 120 "$OLLAMA_URL/api/generate" \
          -d "{\"model\":\"$CHAT\",\"prompt\":\"si ok\",\"stream\":false}" 2>/dev/null)"
  T1=$(date +%s%3N 2>/dev/null || echo 0)
  if printf '%s' "$SVAR" | grep -q '"response"'; then
    resultat ok "Inferens" "$CHAT svarte på $(( T1 - T0 )) ms"
  else
    resultat feil "Inferens" "$CHAT klarte ikke å generere svar"
  fi
  rm -f /tmp/jarvis-tags.json
else
  resultat feil "Ollama" "svarer ikke på $OLLAMA_URL – «systemctl status ollama»"
fi

# ── 3. Tjenester ─────────────────────────────────────────────────────────────
sjekk_tjeneste() {
  local unit="$1" kritisk="$2"
  if ! command -v systemctl >/dev/null 2>&1; then
    resultat advarsel "Tjeneste $unit" "systemd er ikke tilgjengelig"
    return
  fi
  # LoadState er pålitelig – «list-unit-files | grep» bommer når systemd
  # sender output gjennom en pager eller kolonnene er formatert annerledes.
  local load
  load="$(SYSTEMD_PAGER=cat systemctl show -p LoadState --value "$unit" 2>/dev/null)"
  if [ "$load" = "not-found" ] || [ -z "$load" ]; then
    resultat "$kritisk" "Tjeneste $unit" "er ikke installert"
    return
  fi
  if systemctl is-active --quiet "$unit"; then
    SIDEN="$(SYSTEMD_PAGER=cat systemctl show -p ActiveEnterTimestamp --value "$unit" 2>/dev/null)"
    resultat ok "Tjeneste $unit" "aktiv siden ${SIDEN:-ukjent}"
  else
    local sub aarsak
    sub="$(SYSTEMD_PAGER=cat systemctl show -p SubState --value "$unit" 2>/dev/null)"
    aarsak="$(SYSTEMD_PAGER=cat journalctl -u "$unit" -n 40 --no-pager -o cat 2>/dev/null \
              | grep -Ei 'error|failed|cannot|exception|refused|denied|namespac' | tail -1)"
    resultat "$kritisk" "Tjeneste $unit" \
      "kjører ikke (${sub:-inaktiv})${aarsak:+ – ${aarsak:0:160}}"
  fi
}
sjekk_tjeneste ollama feil
sjekk_tjeneste jarvis-agent feil
[ "$SJEKK_GUI" -eq 1 ] && sjekk_tjeneste jarvis-gui advarsel

# ── 4. Porter / endepunkter ──────────────────────────────────────────────────
HELSE_HEADER=()
if [ -n "$AGENT_TOKEN_LOCAL" ]; then HELSE_HEADER=(-H "Authorization: Bearer $AGENT_TOKEN_LOCAL"); fi

# Agenten kan kjøre HTTP eller HTTPS (AGENT_TLS_*). Finn riktig skjema først,
# ellers rapporteres en frisk TLS-backend feilaktig som nede.
AGENT_BASE=""
for skjema in http https; do
  if curl -sSk --max-time 8 -o /dev/null "$skjema://127.0.0.1:$AGENT_PORT/api/status" 2>/dev/null; then
    AGENT_BASE="$skjema://127.0.0.1:$AGENT_PORT"
    break
  fi
done

if [ -z "$AGENT_BASE" ]; then
  resultat feil "Backend" "svarer ikke på port $AGENT_PORT"
elif curl -fsSk --max-time 8 "${HELSE_HEADER[@]}" "$AGENT_BASE/health" >/dev/null 2>&1; then
  resultat ok "Backend" "$AGENT_BASE svarer"
else
  STATUSKODE="$(curl -sSk --max-time 8 -o /dev/null -w '%{http_code}' "$AGENT_BASE/api/status" 2>/dev/null || true)"
  if [ "$STATUSKODE" = "200" ]; then
    resultat advarsel "Backend" "svarer på $AGENT_BASE, men /health avviste agent-tokenet"
  else
    resultat feil "Backend" "svarer ikke på port $AGENT_PORT"
  fi
fi

if [ -n "$AGENT_BASE" ] && STATUS="$(curl -fsSk --max-time 8 "$AGENT_BASE/api/status" 2>/dev/null)"; then
  if printf '%s' "$STATUS" | grep -q '"trengerOppsett":true'; then
    resultat advarsel "Brukere" "ingen bruker opprettet ennå – første innlogging oppretter admin"
  else
    resultat ok "Brukere" "admin-bruker finnes"
  fi
fi


if [ "$SJEKK_GUI" -eq 1 ]; then
  if curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:$GUI_PORT/" 2>/dev/null; then
    resultat ok "Web-GUI" "http://127.0.0.1:$GUI_PORT svarer"
  else
    resultat advarsel "Web-GUI" "svarer ikke på port $GUI_PORT"
  fi
fi

# ── 5. Diskplass og minne ────────────────────────────────────────────────────
BRUK=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "${BRUK:-0}" -ge 90 ]; then resultat feil "Diskplass" "${BRUK}% brukt på /"
elif [ "${BRUK:-0}" -ge 80 ]; then resultat advarsel "Diskplass" "${BRUK}% brukt på /"
else resultat ok "Diskplass" "${BRUK}% brukt på /"; fi

LEDIG_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')
[ -n "${LEDIG_MB:-}" ] && {
  if [ "$LEDIG_MB" -lt 500 ]; then resultat advarsel "Minne" "kun ${LEDIG_MB} MB ledig"
  else resultat ok "Minne" "${LEDIG_MB} MB ledig"; fi
}

# ── Oppsummering ─────────────────────────────────────────────────────────────
KODE=0
[ "$ANTALL_FEIL" -gt 0 ] && KODE=1

if [ "$JSON" -eq 1 ]; then
  printf '{"tid":%s,"ok":%d,"advarsler":%d,"feil":%d,"sjekker":[%s]}\n' \
    "$(date +%s000)" "$ANTALL_OK" "$ANTALL_ADV" "$ANTALL_FEIL" \
    "$(IFS=,; echo "${JSON_RADER[*]}")"
else
  echo -e "${BLA}───────────────────────────────────────────────${RST}"
  if [ "$KODE" -eq 0 ]; then
    echo -e "${GRN}Alt kritisk er OK${RST} · $ANTALL_OK ok · $ANTALL_ADV advarsler"
  else
    echo -e "${RED}$ANTALL_FEIL feil${RST} · $ANTALL_OK ok · $ANTALL_ADV advarsler"
    echo "Se detaljer: journalctl -u jarvis-agent -n 50"
  fi
  echo
fi

# Skriv alltid en kopi til loggen som HUD-en leser (best effort).
if mkdir -p "$(dirname "$LOGG")" 2>/dev/null; then
  {
    echo "=== helsesjekk $(date -Is) ==="
    printf '%s\n' "${JSON_RADER[@]}"
    echo "ok=$ANTALL_OK advarsler=$ANTALL_ADV feil=$ANTALL_FEIL"
  } >>"$LOGG" 2>/dev/null || true
fi

exit "$KODE"
