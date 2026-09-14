#!/usr/bin/env bash
set -euo pipefail

HER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKRIPT="$HER/tren-stemme.sh"

bash -n "$SKRIPT"

python3 - "$SKRIPT" <<'PY'
import json
import re
import sys

tekst = open(sys.argv[1], encoding="utf-8").read()
treff = re.search(r"^\s*CHECKPOINT_CALLBACKS='(.+)'$", tekst, re.MULTILINE)
assert treff, "Fant ikke eksplisitt checkpoint-konfigurasjon"
callbacks = json.loads(treff.group(1))
assert len(callbacks) == 1
args = callbacks[0]["init_args"]
assert args["monitor"] == "val_mel"
assert args["mode"] == "min"
assert args["save_last"] is True
assert "--trainer.callbacks \"$CHECKPOINT_CALLBACKS\"" in tekst
assert "monitor\":\"val_mos" not in treff.group(1)
print("OK: Piper lagrer kontrollpunkter med val_mel uten val_mos-avhengighet")
PY