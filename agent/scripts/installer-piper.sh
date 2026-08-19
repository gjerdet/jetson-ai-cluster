#!/usr/bin/env bash
# Installerer Piper-treningsmiljøet lokalt på Jetson/Ubuntu.
# Dette gjør det mulig å trene stemmer 100 % lokalt uten sky-tjenester.
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RST="\033[0m"
si() { echo -e "${BLA}▸ $*${RST}"; }
ok() { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }

[ "$(id -u)" -eq 0 ] || { echo "Kjør med sudo"; exit 1; }

PIPER_DIR="${PIPER_DIR:-/opt/jarvis/piper}"
ENV_FILE="${ENV_FILE:-/etc/jarvis/agent.env}"

si "Installerer systemavhengigheter"
apt-get update
apt-get install -y \
  git build-essential python3-dev python3-venv python3-pip \
  espeak-ng libespeak-ng1 ffmpeg cmake pkg-config \
  libsndfile1-dev libespeak-ng-dev

mkdir -p "$PIPER_DIR"

if [ ! -d "$PIPER_DIR/.git" ]; then
  si "Kloner rhasspy/piper"
  git clone --depth 1 https://github.com/rhasspy/piper.git "$PIPER_DIR"
else
  ok "Piper-repo finnes allerede"
fi

PY_DIR="$PIPER_DIR/src/python"
[ -d "$PY_DIR" ] || { echo "Fant ikke $PY_DIR"; exit 1; }

si "Oppretter Python-venv i $PY_DIR/.venv"
python3 -m venv "$PY_DIR/.venv"
source "$PY_DIR/.venv/bin/activate"
pip install --upgrade pip wheel setuptools

si "Installerer Python-pakker (dette kan ta flere minutter)"
# Prøv requirements.txt først; fall tilbake til setup.py hvis den mangler
if [ -f "$PY_DIR/requirements.txt" ]; then
  pip install -r "$PY_DIR/requirements.txt" || adv "Noen pakker feilet – fortsetter"
fi
pip install -e "$PY_DIR" || adv "pip install -e feilet"

si "Bygger monotonic_align"
if [ -f "$PY_DIR/build_monotonic_align.sh" ]; then
  (cd "$PY_DIR" && bash build_monotonic_align.sh) || adv "build_monotonic_align feilet"
else
  adv "build_monotonic_align.sh ikke funnet"
fi

chown -R jarvis:jarvis "$PIPER_DIR" 2>/dev/null || true

# Lagre venv-sti i agent.env så tren-stemme.sh finner den automatisk
if [ -f "$ENV_FILE" ]; then
  if grep -q "^PIPER_VENV=" "$ENV_FILE"; then
    sed -i "s|^PIPER_VENV=.*|PIPER_VENV=$PY_DIR/.venv|" "$ENV_FILE"
  else
    echo "PIPER_VENV=$PY_DIR/.venv" >> "$ENV_FILE"
  fi
  ok "PIPER_VENV lagt til i $ENV_FILE"
fi

ok "Piper-treningsmiljø klart i $PY_DIR/.venv"
echo ""
echo "Neste steg:"
echo "  1. Last opp stemmeklipp under SYSTEM → STEMME"
echo "  2. Gå til SYSTEM → TRENINGSKØ og bruk kommandoen:"
echo "     bash /opt/jarvis-agent/scripts/tren-stemme.sh {mappe} {manifest} {navn} {ut}"
