#!/usr/bin/env bash
set -euo pipefail

HER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKRIPT="$HER/tren-stemme.sh"

bash -n "$SKRIPT"

python3 - "$SKRIPT" <<'PY'
import re
import sys
import tempfile
import os

tekst = open(sys.argv[1], encoding="utf-8").read()

# Vi legger ikke til en ekstra ModelCheckpoint.
assert "--trainer.callbacks" not in tekst, "Ekstra ModelCheckpoint gir duplikatfeil"

treff = re.search(r"cat > \"\$SHIM\" <<'PYEOF'\n(.*?)\nPYEOF\n", tekst, re.DOTALL)
assert treff, "Fant ikke shim-koden som filtrerer kontrollpunktregler"
shim = treff.group(1)
assert 'getattr(cb, "monitor", None) != "val_mos"' in shim
assert 'Trainer.__init__ = _trainer_init' in shim
assert 'runpy.run_module("piper.train"' in shim
assert '"$PIPER_PYTHON_BIN" "$SHIM" fit' in tekst

# Shimen må være gyldig Python.
compile(shim, "shim.py", "exec")

# Filtreringen må fjerne bare val_mos og bevare Pipers val_mel-regel.
prove = shim.split("sys.argv = ")[0]
harness = (
    "class Trainer:\n"
    "    def __init__(self, *args, **kwargs):\n"
    "        self.callbacks = kwargs.get('callbacks', [])\n"
    "import types, sys\n"
    "p1 = types.ModuleType('lightning'); p2 = types.ModuleType('lightning.pytorch')\n"
    "p2.Trainer = Trainer\n"
    "sys.modules['lightning'] = p1; sys.modules['lightning.pytorch'] = p2\n"
    "class Callback:\n"
    "    def __init__(self, monitor): self.monitor = monitor\n"
)
rom = {}
exec(harness + prove, rom)
val_mel = rom["Callback"]("val_mel")
val_mos = rom["Callback"]("val_mos")
annen = rom["Callback"]("val_loss")
trainer = rom["Trainer"](callbacks=[val_mel, val_mos, annen])
assert trainer.callbacks == [val_mel, annen], [c.monitor for c in trainer.callbacks]

print("OK: val_mos fjernes og Pipers val_mel-regel bevares")
PY

python3 - "$SKRIPT" <<'PY'
import re
import sys

tekst = open(sys.argv[1], encoding="utf-8").read()
treff = re.search(r'cat > "\$EXPORT_SHIM" <<\'PYEOF\'\n(.*?)\nPYEOF\n', tekst, re.DOTALL)
assert treff, "Fant ikke kompatibilitetskode for ONNX-eksport"
shim = treff.group(1)
assert 'kwargs["dynamo"] = False' in shim, "ONNX-eksporten må slå av dynamo"
assert 'runpy.run_module("piper.train.export_onnx"' in shim
assert 'onnx.checker.check_model(model)' in tekst, "Den eksporterte modellen må valideres"
assert 'MODEL_TMP="$UT/model.onnx.tmp"' in tekst, "Ufullstendig eksport må ikke bli aktiv modell"
compile(shim, "piper_onnx_compat.py", "exec")
print("OK: ONNX-eksport bruker dynamo=False og validerer modellen")
PY
