#!/usr/bin/env bash
# Oppdager JetPack/L4T-versjon og installerer NVIDIA PyTorch med riktig
# CUDA-kompatibilitet i system-Python. Kjøres av GUI-et (INSTALLER PYTORCH)
# eller automatisk fra installer-piper.sh. Alt skjer lokalt på noden.
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RST="\033[0m"
si() { echo -e "${BLA}▸ $*${RST}"; }
ok() { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }

[ "$(id -u)" -eq 0 ] || { echo "Kjør med sudo"; exit 1; }

# shellcheck source=/dev/null
source "$(dirname "$(readlink -f "$0")")/apt-felles.sh"

exec 9>/run/lock/jarvis-pytorch-installasjon.lock
if ! flock -w 900 9; then
  echo "En annen PyTorch-installasjon kjører fortsatt. Vent til den er ferdig." >&2
  exit 75
fi

# ---- 1. Oppdag JetPack / L4T ------------------------------------------------
L4T_MAJOR=""
L4T_FULL=""
if [ -f /etc/nv_tegra_release ]; then
  L4T_FULL="$(head -n1 /etc/nv_tegra_release)"
  L4T_MAJOR="$(sed -n 's/^# R\([0-9]\+\).*/\1/p' /etc/nv_tegra_release)"
fi
if [ -z "$L4T_MAJOR" ]; then
  L4T_MAJOR="$(dpkg-query -W -f='${Version}' nvidia-l4t-core 2>/dev/null | cut -d. -f1 || true)"
fi
JETPACK_PAKKE="$(dpkg-query -W -f='${Version}' nvidia-jetpack 2>/dev/null || true)"

si "L4T: ${L4T_FULL:-ukjent} (major ${L4T_MAJOR:-?}), JetPack-pakke: ${JETPACK_PAKKE:-ukjent}"

case "$L4T_MAJOR" in
  39) INDEKS="https://download.pytorch.org/whl/cu132"; JP="7.2"; CUDA_FORVENTET="13.2" ;;
  38) INDEKS="https://download.pytorch.org/whl/cu130"; JP="7.x"; CUDA_FORVENTET="13.0" ;;
  36) INDEKS="https://pypi.jetson-ai-lab.io/jp6/cu126"; JP="6.x"; CUDA_FORVENTET="12.6" ;;
  35) INDEKS="https://pypi.jetson-ai-lab.io/jp5/cu114"; JP="5.x"; CUDA_FORVENTET="11.4" ;;
  *)
    # Nyere L4T-utgaver (38, 39 …) er ikke i kartet ennå. I stedet for å stoppe
    # faller vi tilbake til nyeste kjente serie, JetPack 7 / CUDA 13.
    if [ -n "$L4T_MAJOR" ] && [ "$L4T_MAJOR" -ge 39 ] 2>/dev/null; then
      INDEKS="https://download.pytorch.org/whl/cu132"; JP="7.2+ (antatt for L4T R$L4T_MAJOR)"; CUDA_FORVENTET="13.2"
      adv "L4T R$L4T_MAJOR er nyere enn kartet – bruker offisielle SBSA-hjul for CUDA 13.2"
    elif [ -n "$L4T_MAJOR" ] && [ "$L4T_MAJOR" -ge 36 ] 2>/dev/null; then
      INDEKS="https://pypi.jetson-ai-lab.io/jp6/cu126"; JP="6.x (antatt)"; CUDA_FORVENTET="12.6"
    else
      echo "Ukjent eller manglende JetPack/L4T-versjon (major='${L4T_MAJOR:-}')." >&2
      echo "Denne noden ser ikke ut til å være en Jetson med JetPack 5/6/7." >&2
      echo "Installer PyTorch manuelt for maskinvaren din og kjør Piper-installasjonen på nytt." >&2
      exit 2
    fi
    ;;
esac
ok "JetPack $JP – bruker PyTorch-indeks $INDEKS (CUDA $CUDA_FORVENTET)"

# ---- 2. Preflight: CUDA på maskinen ----------------------------------------
CUDA_VERSJON=""
if command -v nvcc >/dev/null 2>&1; then
  CUDA_VERSJON="$(nvcc --version | sed -n 's/.*release \([0-9.]*\).*/\1/p')"
elif [ -f /usr/local/cuda/version.json ]; then
  CUDA_VERSJON="$(python3 -c 'import json;print(json.load(open("/usr/local/cuda/version.json"))["cuda"]["version"])' 2>/dev/null | cut -d. -f1,2 || true)"
fi
if [ -z "$CUDA_VERSJON" ]; then
  adv "Fant ikke CUDA-verktøykjeden (nvcc). Installerer CUDA-runtime fra JetPack-metapakken."
  apt_installer_robust nvidia-jetpack || adv "Klarte ikke installere nvidia-jetpack automatisk – fortsetter."
else
  ok "CUDA $CUDA_VERSJON funnet"
fi

# ---- 3. Avhengigheter -------------------------------------------------------
si "Installerer systemavhengigheter for PyTorch"
if ! apt_installer_robust python3-pip python3-dev libopenblas-dev libopenmpi-dev libomp-dev; then
  # Siste utvei: installer pakkene én for én, slik at én skadet .deb ikke
  # river med seg hele settet.
  adv "Samlet installasjon feilet – installerer pakkene enkeltvis"
  MANGLER=""
  for p in python3-pip python3-dev libopenblas-dev libopenmpi-dev libomp-dev; do
    apt_installer_robust "$p" || MANGLER="$MANGLER $p"
  done
  [ -n "$MANGLER" ] && adv "Disse pakkene kunne ikke installeres:$MANGLER – fortsetter, PyTorch-hjulet er ofte selvforsynt"
fi

# PEP 668: nyere Ubuntu (JetPack 7) merker system-Python som "externally managed".
# Da må pip få lov til å skrive dit likevel.
PIPFLAGG=(--no-cache-dir)
if python3 -m pip install --dry-run --quiet wheel >/dev/null 2>&1; then
  :
else
  PIPFLAGG+=(--break-system-packages)
  adv "System-Python er externally managed – bruker --break-system-packages"
fi

python3 -m pip install "${PIPFLAGG[@]}" --upgrade pip setuptools wheel || \
  adv "Klarte ikke oppgradere pip/setuptools – fortsetter"

# numpy 1.x kreves kun for JetPack 5/6-hjulene. JetPack 7 bruker numpy 2.
if [ "$JP" = "5.x" ] || [ "${JP:0:3}" = "6.x" ]; then
  python3 -m pip install "${PIPFLAGG[@]}" 'numpy<2' || adv "numpy<2 feilet – fortsetter"
fi

# ---- 4. Installer NVIDIA PyTorch -------------------------------------------
INDEKSER=("$INDEKS")
case "$JP" in
  7.2*|7.x*) INDEKSER+=("https://download.pytorch.org/whl/cu130" "https://pypi.jetson-ai-lab.io/sbsa/cu130") ;;
  6.x*) INDEKSER+=("https://pypi.jetson-ai-lab.io/jp6/cu129" "https://pypi.jetson-ai-lab.io/jp6/cu128") ;;
esac
if [ "$L4T_MAJOR" -lt 38 ] 2>/dev/null; then
  INDEKSER+=("https://developer.download.nvidia.com/compute/redist/jp/v${L4T_MAJOR}")
fi

INSTALLERT=0
for idx in "${INDEKSER[@]}"; do
  si "Prøver PyTorch-indeks $idx (dette tar noen minutter)"
  # Indeksen må være primær. Med --extra-index-url kunne pip velge den vanlige
  # PyPI-utgaven uten Jetson/SBSA-CUDA selv om NVIDIA-hjulet var tilgjengelig.
  if python3 -m pip install "${PIPFLAGG[@]}" --upgrade --index-url "$idx" torch; then
    if python3 -c 'import torch,sys; print("torch", torch.__version__, "cuda", torch.version.cuda, "available", torch.cuda.is_available()); sys.exit(0 if torch.cuda.is_available() else 1)'; then
      INSTALLERT=1
      ok "PyTorch med CUDA installert fra $idx"
      break
    fi
    adv "Pakken fra $idx kan importeres, men mangler CUDA – prøver neste kilde"
  fi
  adv "Indeksen $idx ga ingen brukbar pakke – prøver neste"
done

if [ "$INSTALLERT" -ne 1 ]; then
  echo "Fant ingen PyTorch-hjul som passer denne Jetson-en (L4T R${L4T_MAJOR:-?})." >&2
  echo "Sjekk nettilgang til pypi.jetson-ai-lab.io og prøv igjen." >&2
  exit 4
fi

# ---- 5. Verifiser ------------------------------------------------------------
si "Verifiserer installasjonen"
if ! python3 - <<'PY'
import sys, torch
print("torch", torch.__version__, "cuda", torch.version.cuda, "available", torch.cuda.is_available())
sys.exit(0 if int(torch.__version__.split(".")[0]) >= 2 else 1)
PY
then
  echo "PyTorch 2.x ble ikke installert riktig i system-Python." >&2
  exit 1
fi

if ! python3 -c 'import torch,sys;sys.exit(0 if torch.cuda.is_available() else 1)'; then
  echo "PyTorch er installert, men ser ingen CUDA-enhet." >&2
  echo "Sjekk at brukeren har tilgang til /dev/nvhost* og at JetPack-driverne er installert." >&2
  exit 3
fi

ok "NVIDIA PyTorch med CUDA er klar i system-Python"
