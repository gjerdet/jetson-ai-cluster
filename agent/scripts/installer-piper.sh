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
# shellcheck source=/dev/null
source "$(dirname "$(readlink -f "$0")")/apt-felles.sh"

# Ikke la GUI-knappen, en treningsjobb og en manuell kjøring endre apt/dpkg
# samtidig. Vi sletter aldri dpkg-låsefiler; vi venter på den lovlige eieren.
exec 9>/run/lock/jarvis-piper-installasjon.lock
if ! flock -w 900 9; then
  echo "En annen Piper-installasjon kjører fortsatt. Vent til den er ferdig og prøv igjen." >&2
  exit 75
fi

installer_avhengigheter() {
  apt_installer_robust \
    git build-essential python3-dev python3-venv python3-pip \
    espeak-ng libespeak-ng1 ffmpeg cmake pkg-config \
    libsndfile1-dev libespeak-ng-dev
}

si "Installerer systemavhengigheter"
vent_paa_dpkg || true
# Halvinstallerte pakker (typisk ninja-build på enkelte Jetson-images) blokkerer
# alle videre apt-kall. Rydd opp før første forsøk.
if dpkg-query -W -f='${Package} ${db:Status-Abbrev}\n' 2>/dev/null | grep -qv ' ii$'; then
  adv "Oppdaget halvinstallerte pakker – reparerer pakkesystemet først"
  reparer_pakkesystem
fi
if ! installer_avhengigheter; then
  # En skadet systempakke (typisk libc-bin) skal ikke stoppe Piper når
  # verktøyene vi faktisk trenger allerede ligger på maskinen.
  MANGLENDE=""
  for verktoy in git gcc make cmake pkg-config espeak-ng ffmpeg python3; do
    command -v "$verktoy" >/dev/null 2>&1 || MANGLENDE="$MANGLENDE $verktoy"
  done
  python3 -c 'import venv' >/dev/null 2>&1 || MANGLENDE="$MANGLENDE python3-venv"
  if [ -n "$MANGLENDE" ]; then
    echo "Pakkeinstallasjonen feilet og disse mangler fortsatt:$MANGLENDE" >&2
    echo "Reparer systempakkene med: sudo apt-get --fix-broken install" >&2
    exit 1
  fi
  adv "apt feilet, men alle nødvendige verktøy finnes allerede – fortsetter"
fi

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

# Preflight: NVIDIA PyTorch med CUDA må være på plass i system-Python før
# Piper i det hele tatt prøver å starte. Vi oppdager JetPack-versjonen og
# installerer riktig hjul automatisk i stedet for bare å feile.
PYTORCH_SKRIPT="$(dirname "$(readlink -f "$0")")/installer-pytorch.sh"
if ! python3 -c 'import torch,sys;sys.exit(0 if int(torch.__version__.split(".")[0]) >= 2 and torch.cuda.is_available() else 1)' >/dev/null 2>&1; then
  if [ "${JARVIS_AUTO_PYTORCH:-1}" = "1" ] && [ -f "$PYTORCH_SKRIPT" ]; then
    adv "NVIDIA PyTorch med CUDA mangler – installerer riktig versjon for JetPack først"
    bash "$PYTORCH_SKRIPT"
  fi
fi
if ! python3 -c 'import torch,sys;sys.exit(0 if int(torch.__version__.split(".")[0]) >= 2 else 1)' >/dev/null 2>&1; then
  echo "NVIDIA PyTorch 2.x mangler i system-Python." >&2
  echo "Kjør: sudo bash $PYTORCH_SKRIPT – den oppdager JetPack-versjonen og installerer riktig hjul." >&2
  exit 1
fi
if ! python3 -c 'import torch,sys;sys.exit(0 if torch.cuda.is_available() else 1)' >/dev/null 2>&1; then
  adv "PyTorch er installert, men ser ingen CUDA-enhet. Treningen blir svært treg på CPU."
fi


si "Oppretter Python-venv i $PY_DIR/.venv"
# JetPack leverer normalt en CUDA-tilpasset PyTorch i system-Python. Behold
# tilgang til den i venv-et; en tilfeldig PyPI-utgave av torch mangler ofte
# GPU-støtten som stemmetreningen trenger på Jetson.
python3 -m venv --system-site-packages --clear "$PY_DIR/.venv"
source "$PY_DIR/.venv/bin/activate"
python -m pip install --upgrade pip wheel setuptools scikit-build ninja

si "Installerer Python-pakker (dette kan ta flere minutter)"
# Installer treningsavhengighetene eksplisitt uten torch. Venv-et arver den
# CUDA-tilpassede NVIDIA-utgaven fra JetPack; pip må aldri erstatte den.
# NumPy 2 kan ikke laste eldre matplotlib-utvidelser fra JetPack-systemet og
# gir da «numpy.core.multiarray failed to import». En lokal NumPy 1.26 og en
# samsvarende matplotlib i venv-et overstyrer systemkopiene uten å røre CUDA-
# PyTorch i system-Python.
python -m pip install \
  'numpy>=1.24,<2' 'matplotlib>=3.8,<4' \
  'lightning>=2,<3' 'tensorboard>=2,<3' 'tensorboardX>=2,<3' \
  'jsonargparse[signatures]>=4.27.7' 'onnx>=1,<2' \
  'pysilero-vad>=2.1,<3' 'cython>=3,<4' 'librosa<1' \
  'onnxruntime>=1,<2' 'pathvalidate>=3,<4'
python -m pip install --no-deps -e "$PY_DIR"

si "Kontrollerer NumPy, matplotlib, PyTorch og Lightning"
if ! python - <<'PY'
import matplotlib
import numpy
import torch
import lightning

numpy_major = int(numpy.__version__.split(".")[0])
if numpy_major >= 2:
    raise RuntimeError(f"Piper krever NumPy 1.x i dette miljøet, fant {numpy.__version__}")
print(
    "Python-pakker OK:",
    f"numpy={numpy.__version__}",
    f"matplotlib={matplotlib.__version__}",
    f"torch={torch.__version__}",
    f"lightning={lightning.__version__}",
)
PY
then
  echo "Python-pakkene i Piper-miljøet er inkompatible." >&2
  echo "Slettingen og nyopprettingen av $PY_DIR/.venv lyktes ikke fullt ut." >&2
  exit 1
fi

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

# Lagre venv-sti i agent.env så tren-stemme.sh finner den automatisk.
# Under systemd kan /etc være skrivebeskyttet (ProtectSystem). Da skal ikke
# hele installasjonen feile – vi legger stien i datamappen i stedet.
lagre_venv_sti() {
  local sti="$PY_DIR/.venv"
  if [ -f "$ENV_FILE" ] && [ -w "$ENV_FILE" ]; then
    local tmp
    tmp="$(mktemp /tmp/jarvis-env.XXXXXX)" || return 1
    if grep -q "^PIPER_VENV=" "$ENV_FILE"; then
      sed "s|^PIPER_VENV=.*|PIPER_VENV=$sti|" "$ENV_FILE" > "$tmp" || return 1
    else
      cat "$ENV_FILE" > "$tmp" || return 1
      echo "PIPER_VENV=$sti" >> "$tmp"
    fi
    cat "$tmp" > "$ENV_FILE" && rm -f "$tmp" && return 0
    rm -f "$tmp"
    return 1
  fi
  return 1
}

if lagre_venv_sti; then
  ok "PIPER_VENV lagt til i $ENV_FILE"
else
  RESERVE="${AGENT_DATA:-/var/lib/jarvis/data}/piper-venv.sti"
  mkdir -p "$(dirname "$RESERVE")" 2>/dev/null || true
  if echo "$PY_DIR/.venv" > "$RESERVE" 2>/dev/null; then
    chown jarvis:jarvis "$RESERVE" 2>/dev/null || true
    adv "Kunne ikke skrive til $ENV_FILE – lagret venv-stien i $RESERVE i stedet"
  else
    adv "Kunne ikke lagre venv-stien automatisk. Legg til PIPER_VENV=$PY_DIR/.venv i $ENV_FILE manuelt."
  fi
fi

ok "Piper-treningsmiljø verifisert i $PY_DIR/.venv"
echo ""
echo "Neste steg:"
echo "  1. Last opp stemmeklipp under SYSTEM → STEMME"
echo "  2. Gå til SYSTEM → TRENINGSKØ og bruk kommandoen:"
echo "     bash /opt/jarvis-agent/scripts/tren-stemme.sh {mappe} {manifest} {navn} {ut}"
