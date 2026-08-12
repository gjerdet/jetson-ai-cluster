#!/usr/bin/env bash
# Starter det bygde web-GUI-et. Brukes av systemd-tjenesten jarvis-gui.
set -euo pipefail
cd "${GUI_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export PORT="${PORT:-8080}"
export HOST="${HOST:-0.0.0.0}"
export NITRO_PORT="$PORT"
export NITRO_HOST="$HOST"

for kandidat in .output/server/index.mjs dist/server/index.mjs .vinxi/build/server/index.mjs; do
  if [ -f "$kandidat" ]; then
    exec node "$kandidat"
  fi
done

echo "Fant ingen kjørbar GUI-server. Kjør oppsett.sh på nytt for å bygge Node-serveren." >&2
exit 1
