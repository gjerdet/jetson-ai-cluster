#!/usr/bin/env bash
set -euo pipefail

REQUEST_FILE="/var/lib/jarvis/update-request"
SOURCE_FILE="/etc/jarvis/source-dir"
UPDATE_SCRIPT="/opt/jarvis-agent/scripts/update-jetson.sh"
LOG_FILE="/var/log/jarvis/oppdatering.log"

mkdir -p /var/log/jarvis
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== GUI-oppdatering startet $(date -Is) ==="

[ -f "$REQUEST_FILE" ] || { echo "Mangler $REQUEST_FILE"; exit 1; }
[ -f "$SOURCE_FILE" ] || { echo "Mangler $SOURCE_FILE – kjør oppsett.sh på nytt"; exit 1; }
[ -x "$UPDATE_SCRIPT" ] || chmod +x "$UPDATE_SCRIPT"

REF="$(tr -d '\r\n' < "$REQUEST_FILE")"
SOURCE_DIR="$(head -n 1 "$SOURCE_FILE")"
if [[ ! "$REF" =~ ^[A-Za-z0-9._/-]{1,120}$ ]] || [[ "$REF" == *..* ]] || [[ "$REF" == /* ]]; then
  echo "Ugyldig Git-referanse"
  exit 1
fi
if [ ! -d "$SOURCE_DIR/.git" ]; then
  echo "$SOURCE_DIR er ikke et Git-repo"
  exit 1
fi

JARVIS_SOURCE_DIR="$SOURCE_DIR" bash "$UPDATE_SCRIPT" "$REF"
echo "=== GUI-oppdatering fullført $(date -Is) ==="