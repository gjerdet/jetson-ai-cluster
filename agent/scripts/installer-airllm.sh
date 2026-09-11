#!/usr/bin/env bash
# Installerer AirLLM lokalt slik at store modeller (30B–70B) kan kjøre
# lag-for-lag på en Jetson med lite GPU-minne. Alt kjører lokalt.
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RST="\033[0m"
si() { echo -e "${BLA}▸ $*${RST}"; }
ok() { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }

[ "$(id -u)" -eq 0 ] || { echo "Kjør med sudo"; exit 1; }

AIRLLM_DIR="${AIRLLM_DIR:-/opt/jarvis/airllm}"
AIRLLM_VENV="${AIRLLM_VENV:-$AIRLLM_DIR/.venv}"
AIRLLM_MODELL="${AIRLLM_MODELL:-}"
DATA_DIR="${JARVIS_DATA_DIR:-/var/lib/jarvis/data}"
SKRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=/dev/null
source "$SKRIPT_DIR/apt-felles.sh"

# Ikke la GUI-knappen og en manuell kjøring rote i apt/pip samtidig.
mkdir -p /run/lock
exec 9>/run/lock/jarvis-airllm-installasjon.lock
if ! flock -w 900 9; then
  echo "En annen AirLLM-installasjon kjører fortsatt. Vent til den er ferdig." >&2
  exit 75
fi

si "Installerer systemavhengigheter"
vent_paa_dpkg || true
if dpkg-query -W -f='${Package} ${db:Status-Abbrev}\n' 2>/dev/null | grep -qv ' ii$'; then
  adv "Oppdaget halvinstallerte pakker – reparerer pakkesystemet først"
  reparer_pakkesystem
fi
if ! apt_installer_robust python3-dev python3-venv python3-pip git; then
  MANGLENDE=""
  for verktoy in git python3; do
    command -v "$verktoy" >/dev/null 2>&1 || MANGLENDE="$MANGLENDE $verktoy"
  done
  python3 -c 'import venv' >/dev/null 2>&1 || MANGLENDE="$MANGLENDE python3-venv"
  [ -n "$MANGLENDE" ] && { echo "Mangler fortsatt:$MANGLENDE" >&2; exit 1; }
  adv "apt feilet, men verktøyene finnes allerede – fortsetter"
fi

mkdir -p "$AIRLLM_DIR" "$DATA_DIR"

# Venv med tilgang til systemets NVIDIA-PyTorch (samme mønster som Piper).
if [ ! -x "$AIRLLM_VENV/bin/python" ]; then
  si "Lager Python-miljø i $AIRLLM_VENV"
  python3 -m venv --system-site-packages "$AIRLLM_VENV"
fi
PY="$AIRLLM_VENV/bin/python"

si "Installerer AirLLM og avhengigheter (dette tar noen minutter)"
"$PY" -m pip install --upgrade pip setuptools wheel >/dev/null
if ! "$PY" -c 'import torch' >/dev/null 2>&1; then
  echo "PyTorch mangler i $AIRLLM_VENV. Kjør først: sudo bash $SKRIPT_DIR/installer-pytorch.sh" >&2
  echo "AirLLM kan ikke kjøre uten NVIDIA PyTorch med CUDA." >&2
  exit 1
fi
"$PY" -m pip install --upgrade airllm huggingface_hub accelerate safetensors

"$PY" - <<'PY'
import airllm  # noqa: F401
print("AirLLM importert OK")
PY
ok "AirLLM installert i $AIRLLM_VENV"

if [ -n "$AIRLLM_MODELL" ]; then
  si "Laster ned modell $AIRLLM_MODELL (kan ta lang tid)"
  AIRLLM_MODELL="$AIRLLM_MODELL" "$PY" - <<'PY'
import os
from huggingface_hub import snapshot_download
navn = os.environ["AIRLLM_MODELL"]
sti = snapshot_download(navn, allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt"])
print(f"Modell lastet ned til {sti}")
PY
  ok "Modell klar: $AIRLLM_MODELL"
fi

echo "$AIRLLM_VENV" > "$DATA_DIR/airllm-venv.sti"
chmod 644 "$DATA_DIR/airllm-venv.sti" || true
ok "Ferdig. Start tjenesten fra SYSTEM → MODELLER → AIRLLM."
