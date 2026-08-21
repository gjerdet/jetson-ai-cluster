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
PIPER_REPO="https://github.com/OHF-Voice/piper1-gpl.git"

si "Installerer systemavhengigheter"
apt-get update
apt-get install -y \
  git build-essential python3-dev python3-venv python3-pip \
  espeak-ng libespeak-ng1 ffmpeg cmake ninja-build pkg-config \
  libsndfile1-dev libespeak-ng-dev

if [ -d "$PIPER_DIR/.git" ] && ! git -C "$PIPER_DIR" remote get-url origin 2>/dev/null | grep -qi 'OHF-Voice/piper1-gpl'; then
  LEGACY="${PIPER_DIR}.legacy-$(date +%Y%m%d-%H%M%S)"
  adv "Fant arkivert rhasspy/piper – flytter det til $LEGACY"
  mv "$PIPER_DIR" "$LEGACY"
fi

if [ ! -d "$PIPER_DIR/.git" ]; then
  si "Kloner aktiv Piper fra Open Home Foundation"
  git clone --depth 1 "$PIPER_REPO" "$PIPER_DIR"
else
  ok "Aktivt Piper-repo finnes allerede"
  git -C "$PIPER_DIR" fetch --depth 1 origin main
  git -C "$PIPER_DIR" checkout -B main origin/main
fi

PY_DIR="$PIPER_DIR"
[ -f "$PY_DIR/setup.py" ] || { echo "Fant ikke $PY_DIR/setup.py"; exit 1; }

if ! python3 -c 'import torch; assert int(torch.__version__.split(".")[0]) >= 2' >/dev/null 2>&1; then
  echo "NVIDIA PyTorch 2.x mangler i system-Python." >&2
  echo "Installer PyTorch-pakken som hører til JetPack-versjonen din, og prøv igjen." >&2
  exit 1
fi

si "Oppretter Python-venv i $PY_DIR/.venv"
# JetPack leverer normalt en CUDA-tilpasset PyTorch i system-Python. Behold
# tilgang til den i venv-et; en tilfeldig PyPI-utgave av torch mangler ofte
# GPU-støtten som stemmetreningen trenger på Jetson.
python3 -m venv --system-site-packages --clear "$PY_DIR/.venv"
source "$PY_DIR/.venv/bin/activate"
python -m pip install --upgrade pip wheel setuptools scikit-build

si "Installerer Python-pakker (dette kan ta flere minutter)"
# Installer treningsavhengighetene eksplisitt uten torch. Venv-et arver den
# CUDA-tilpassede NVIDIA-utgaven fra JetPack; pip må aldri erstatte den.
python -m pip install \
  'lightning>=2,<3' 'tensorboard>=2,<3' 'tensorboardX>=2,<3' \
  'jsonargparse[signatures]>=4.27.7' 'onnx>=1,<2' \
  'pysilero-vad>=2.1,<3' 'cython>=3,<4' 'librosa<1' \
  'onnxruntime>=1,<2' 'pathvalidate>=3,<4'
python -m pip install --no-deps -e "$PY_DIR"

si "Bygger monotonic_align"
if [ -f "$PY_DIR/build_monotonic_align.sh" ]; then
  (cd "$PY_DIR" && bash build_monotonic_align.sh && python setup.py build_ext --inplace)
else
  echo "Fant ikke $PY_DIR/build_monotonic_align.sh" >&2
  exit 1
fi

si "Verifiserer Piper-trening"
if ! "$PY_DIR/.venv/bin/python" -m piper.train fit --help >/dev/null 2>&1; then
  echo "Piper-installasjonen ble ikke fullført: piper.train kan ikke startes." >&2
  echo "Python: $($PY_DIR/.venv/bin/python --version 2>&1)" >&2
  "$PY_DIR/.venv/bin/python" -m piper.train fit --help 2>&1 | tail -n 20 >&2 || true
  exit 1
fi

if ! "$PY_DIR/.venv/bin/python" -c 'import torch, lightning; assert torch.cuda.is_available()' >/dev/null 2>&1; then
  echo "Piper er installert, men CUDA/PyTorch/Lightning kan ikke brukes." >&2
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
