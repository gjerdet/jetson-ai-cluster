#!/usr/bin/env bash
# Eksporter en ferdig Piper-stemme fra et lagret checkpoint – UTEN å trene.
#
# Treningen er det tunge steget; når et checkpoint finnes trenger vi bare å
# skrive ut model.onnx. Dette kjøres med vilje på CPU slik at det ikke kan bli
# drept av tomt GPU-/systemminne (kode 137) slik en ny treningsrunde kan.
#
# Bruk: eksporter-stemme.sh <ut-mappe> [checkpoint]
set -euo pipefail

UT="${1:-}"
CKPT="${2:-}"
[ -n "$UT" ] || { echo "Bruk: $0 <ut-mappe> [checkpoint]" >&2; exit 1; }
[ -d "$UT" ] || { echo "Fant ikke stemmemappa: $UT" >&2; exit 1; }

PREP="$UT/pre"

if [ -z "$CKPT" ]; then
  CKPT=$(find "$UT" -name '*.ckpt' -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
fi
[ -n "$CKPT" ] && [ -f "$CKPT" ] || {
  echo "Fant ingen lagret checkpoint i $UT – stemmen må trenes først." >&2
  exit 1
}
echo "==> Eksporterer fra checkpoint: $CKPT"

# --- finn Python i Piper-miljøet (samme kandidater som treningsskriptet) ---
RESERVE_STI="${AGENT_DATA:-/var/lib/jarvis/data}/piper-venv.sti"
LAGRET_VENV=""
[ -f "$RESERVE_STI" ] && LAGRET_VENV="$(cat "$RESERVE_STI" 2>/dev/null || true)"

kandidat_python() {
  [ -n "${PIPER_PYTHON:-}" ] && [ -x "$PIPER_PYTHON" ] && echo "$PIPER_PYTHON"
  for v in \
    "${PIPER_VENV:-}" \
    "$LAGRET_VENV" \
    /opt/jarvis/piper/.venv \
    /opt/jarvis/piper/src/python/.venv \
    "$HOME/piper/src/python/.venv" \
    "$HOME/piper/.venv" \
    /opt/piper/.venv; do
    [ -n "$v" ] && [ -x "$v/bin/python" ] && echo "$v/bin/python"
  done
  command -v python3 || true
}

PIPER_PYTHON_BIN=""
while read -r p; do
  [ -n "$p" ] || continue
  if "$p" -c 'import piper.train' >/dev/null 2>&1 || "$p" -m piper_train.export_onnx --help >/dev/null 2>&1; then
    PIPER_PYTHON_BIN="$p"
    break
  fi
done < <(kandidat_python)
[ -n "$PIPER_PYTHON_BIN" ] || { echo "Fant ingen Python med Piper installert." >&2; exit 1; }
echo "Piper Python: $PIPER_PYTHON_BIN"

# Eksport trenger ingen GPU. Å skjule den fjerner hele OOM-risikoen.
export CUDA_VISIBLE_DEVICES=""
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

MODEL_TMP="$UT/model.onnx.tmp"
rm -f "$MODEL_TMP"

if "$PIPER_PYTHON_BIN" -c 'import piper.train' >/dev/null 2>&1; then
  # PyTorch 2.9 bruker den nye dynamo/torch.export-eksportøren, som stopper på
  # en datastyrt spline-kontroll i VITS. Den stabile TorchScript-veien virker.
  SHIM="$UT/piper_onnx_compat.py"
  cat > "$SHIM" <<'PYEOF'
import runpy
import sys

import torch

_original_export = torch.onnx.export


def _legacy_export(*args, **kwargs):
    kwargs["dynamo"] = False
    return _original_export(*args, **kwargs)


torch.onnx.export = _legacy_export
sys.argv = ["piper.train.export_onnx", *sys.argv[1:]]
runpy.run_module("piper.train.export_onnx", run_name="__main__")
PYEOF
  if ! "$PIPER_PYTHON_BIN" "$SHIM" --checkpoint "$CKPT" --output-file "$MODEL_TMP"; then
    echo "Kompatibel ONNX-eksport feilet – prøver Pipers ordinære eksportør." >&2
    rm -f "$MODEL_TMP"
    if ! "$PIPER_PYTHON_BIN" -c 'import onnxscript' >/dev/null 2>&1; then
      echo "==> Installerer onnxscript"
      "$PIPER_PYTHON_BIN" -m pip install --no-cache-dir onnxscript || true
    fi
    "$PIPER_PYTHON_BIN" -m piper.train.export_onnx --checkpoint "$CKPT" --output-file "$MODEL_TMP"
  fi
else
  "$PIPER_PYTHON_BIN" -m piper_train.export_onnx "$CKPT" "$MODEL_TMP"
fi

[ -s "$MODEL_TMP" ] || { echo "Eksporten laget ingen modellfil. Kontrollpunktet er bevart." >&2; exit 1; }

"$PIPER_PYTHON_BIN" - "$MODEL_TMP" <<'PY' || true
import sys

try:
    import onnx
except ImportError:
    print("==> onnx-pakken mangler; hopper over kontroll av modellfila")
    sys.exit(0)

model = onnx.load(sys.argv[1])
onnx.checker.check_model(model)
print("==> ONNX-modellen er kontrollert og gyldig")
PY

mv "$MODEL_TMP" "$UT/model.onnx"

# Stemmen trenger en konfigurasjonsfil ved siden av modellen.
if [ ! -f "$UT/model.onnx.json" ]; then
  for k in "$PREP/config.json" "$UT/config.json" "$PREP/model.onnx.json"; do
    [ -f "$k" ] && cp "$k" "$UT/model.onnx.json" && break
  done
fi
[ -f "$UT/model.onnx.json" ] || echo "! Fant ingen konfigurasjonsfil (model.onnx.json) – stemmen kan mangle uttaleoppsett." >&2

echo "==> FERDIG: $UT/model.onnx"
