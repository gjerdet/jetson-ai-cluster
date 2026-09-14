#!/usr/bin/env bash
# Installerer turbovec lokalt slik at kunnskapsbasen kan søke raskt og
# komprimert. Alt kjører lokalt på noden – ingen sky.
set -euo pipefail

BLA="\033[36m"; GRN="\033[32m"; GUL="\033[33m"; RST="\033[0m"
si() { echo -e "${BLA}▸ $*${RST}"; }
ok() { echo -e "${GRN}✓ $*${RST}"; }
adv() { echo -e "${GUL}! $*${RST}"; }

[ "$(id -u)" -eq 0 ] || { echo "Kjør med sudo"; exit 1; }

TURBOVEC_DIR="${TURBOVEC_DIR:-/opt/jarvis/turbovec}"
TURBOVEC_VENV="${TURBOVEC_VENV:-$TURBOVEC_DIR/.venv}"
DATA_DIR="${JARVIS_DATA_DIR:-/var/lib/jarvis/data}"
SKRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=/dev/null
source "$SKRIPT_DIR/apt-felles.sh"

# Ikke la GUI-knappen og en manuell kjøring rote i apt/pip samtidig.
mkdir -p /run/lock
exec 9>/run/lock/jarvis-turbovec-installasjon.lock
if ! flock -w 900 9; then
  echo "En annen turbovec-installasjon kjører fortsatt. Vent til den er ferdig." >&2
  exit 75
fi

si "Installerer systemavhengigheter"
vent_paa_dpkg || true
if dpkg-query -W -f='${Package} ${db:Status-Abbrev}\n' 2>/dev/null | grep -qv ' ii$'; then
  adv "Oppdaget halvinstallerte pakker – reparerer pakkesystemet først"
  reparer_pakkesystem
fi
if ! apt_installer_robust python3-dev python3-venv python3-pip build-essential curl; then
  MANGLENDE=""
  command -v python3 >/dev/null 2>&1 || MANGLENDE="$MANGLENDE python3"
  python3 -c 'import venv' >/dev/null 2>&1 || MANGLENDE="$MANGLENDE python3-venv"
  [ -n "$MANGLENDE" ] && { echo "Mangler fortsatt:$MANGLENDE" >&2; exit 1; }
  adv "apt feilet, men verktøyene finnes allerede – fortsetter"
fi

mkdir -p "$TURBOVEC_DIR" "$DATA_DIR" "$DATA_DIR/turbovec"

if [ ! -x "$TURBOVEC_VENV/bin/python" ]; then
  si "Lager Python-miljø i $TURBOVEC_VENV"
  python3 -m venv --system-site-packages "$TURBOVEC_VENV"
fi
PY="$TURBOVEC_VENV/bin/python"

si "Installerer turbovec (ferdig hjul hvis det finnes for ARM64)"
"$PY" -m pip install --upgrade pip setuptools wheel >/dev/null
"$PY" -m pip install --upgrade "numpy<2" >/dev/null || "$PY" -m pip install --upgrade numpy >/dev/null

if ! "$PY" -m pip install --upgrade turbovec; then
  adv "Fant ikke ferdig hjul – bygger turbovec fra kildekode (krever Rust)"
  if ! command -v cargo >/dev/null 2>&1; then
    si "Installerer Rust-verktøykjeden"
    curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    export PATH="$HOME/.cargo/bin:$PATH"
  fi
  PATH="$HOME/.cargo/bin:$PATH" "$PY" -m pip install --upgrade --no-binary :all: turbovec
fi

"$PY" - <<'PY'
import numpy as np
from turbovec import IdMapIndex

idx = IdMapIndex(dim=8, bit_width=4)
idx.add_with_ids(np.ones((1, 8), dtype=np.float32), np.array([1], dtype=np.uint64))
poeng, ider = idx.search(np.ones((1, 8), dtype=np.float32), k=1)
assert len(ider) >= 1, "turbovec returnerte ingen treff"
print("turbovec fungerer – testsøk OK")
PY

echo "$TURBOVEC_VENV" > "$DATA_DIR/turbovec-venv.sti"
chmod 644 "$DATA_DIR/turbovec-venv.sti" || true
chown -R jarvis:jarvis "$DATA_DIR/turbovec" 2>/dev/null || true
ok "Ferdig. Start indeksen fra SYSTEM → KUNNSKAP."
