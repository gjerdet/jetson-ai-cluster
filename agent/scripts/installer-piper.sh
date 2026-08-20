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
# JetPack leverer normalt en CUDA-tilpasset PyTorch i system-Python. Behold
# tilgang til den i venv-et; en tilfeldig PyPI-utgave av torch mangler ofte
# GPU-støtten som stemmetreningen trenger på Jetson.
python3 -m venv --system-site-packages --clear "$PY_DIR/.venv"
source "$PY_DIR/.venv/bin/activate"
python -m pip install --upgrade "pip<24.1" wheel "setuptools<70"

si "Installerer Python-pakker (dette kan ta flere minutter)"
# Pipers arkiverte requirements krever torch<2. JetPack kan ha en nyere,
# NVIDIA-bygget torch som må beholdes. Installer derfor resten av kravene og
# selve piper_train uten å la pip erstatte JetPack-utgaven av torch.
if [ -f "$PY_DIR/requirements.txt" ]; then
  grep -vE '^torch([<>=~!]|$)' "$PY_DIR/requirements.txt" >"$PY_DIR/.jarvis-requirements.txt"
  python -m pip install -r "$PY_DIR/.jarvis-requirements.txt"
fi
python -m pip install --no-deps -e "$PY_DIR"

si "Bygger monotonic_align"
if [ -f "$PY_DIR/build_monotonic_align.sh" ]; then
  (cd "$PY_DIR" && bash build_monotonic_align.sh)
else
  echo "Fant ikke $PY_DIR/build_monotonic_align.sh" >&2
  exit 1
fi

si "Verifiserer piper_train"
if ! "$PY_DIR/.venv/bin/python" -m piper_train.preprocess --help >/dev/null 2>&1; then
  echo "Piper-installasjonen ble ikke fullført: piper_train kan ikke startes." >&2
  echo "Python: $($PY_DIR/.venv/bin/python --version 2>&1)" >&2
  echo "Kjør skriptet på nytt og se den første pip-feilen over." >&2
  exit 1
fi

if ! "$PY_DIR/.venv/bin/python" -c 'import torch, pytorch_lightning' >/dev/null 2>&1; then
  echo "Piper er installert, men PyTorch/PyTorch Lightning kan ikke importeres." >&2
  echo "Installer NVIDIA PyTorch for din JetPack-versjon og kjør skriptet på nytt." >&2
  exit 1
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

ok "Piper-treningsmiljø verifisert i $PY_DIR/.venv"
echo ""
echo "Neste steg:"
echo "  1. Last opp stemmeklipp under SYSTEM → STEMME"
echo "  2. Gå til SYSTEM → TRENINGSKØ og bruk kommandoen:"
echo "     bash /opt/jarvis-agent/scripts/tren-stemme.sh {mappe} {manifest} {navn} {ut}"
