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

# Vi legger ikke lenger til en ekstra ModelCheckpoint – Lightning godtar bare én.
assert "--trainer.callbacks" not in tekst, "Ekstra ModelCheckpoint gir duplikatfeil"

treff = re.search(r"cat > \"\$SHIM\" <<'PYEOF'\n(.*?)\nPYEOF\n", tekst, re.DOTALL)
assert treff, "Fant ikke shim-koden som bytter kontrollpunktmåling"
shim = treff.group(1)
assert 'kwargs.get("monitor") == "val_mos"' in shim
assert 'kwargs["monitor"] = "val_mel"' in shim
assert 'runpy.run_module("piper.train"' in shim
assert '"$PIPER_PYTHON_BIN" "$SHIM" fit' in tekst

# Shimen må være gyldig Python.
compile(shim, "shim.py", "exec")

# Selve ombyttingen må fungere på en etterligning av Lightning-klassen.
prove = shim.split("sys.argv = ")[0]
harness = (
    "class ModelCheckpoint:\n"
    "    def __init__(self, **kw):\n"
    "        self.kw = kw\n"
    "import types, sys\n"
    "m = types.ModuleType('lightning.pytorch.callbacks')\n"
    "m.ModelCheckpoint = ModelCheckpoint\n"
    "p1 = types.ModuleType('lightning'); p2 = types.ModuleType('lightning.pytorch')\n"
    "sys.modules['lightning'] = p1; sys.modules['lightning.pytorch'] = p2\n"
    "sys.modules['lightning.pytorch.callbacks'] = m\n"
)
rom = {}
exec(harness + prove, rom)
c = rom["ModelCheckpoint"](monitor="val_mos", filename="epoch={epoch}-{val_mos:.2f}")
assert c.kw["monitor"] == "val_mel", c.kw
assert c.kw["mode"] == "min"
assert "val_mel" in c.kw["filename"]
u = rom["ModelCheckpoint"](monitor="val_loss")
assert u.kw["monitor"] == "val_loss"

print("OK: Pipers egen kontrollpunktregel bytter val_mos til val_mel")
PY
