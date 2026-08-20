#!/usr/bin/env bash
# Tren en Piper-stemme fra opplastede klipp.
# Brukes av GUI-et; agenten bytter ut {mappe} {manifest} {navn} {ut} før den
# kjører kommandoen med `bash -lc`.
set -euo pipefail

MAPPE="${1:-}"
MANIFEST="${2:-}"
NAVN="${3:-stemme}"
UT="${4:-/tmp/piper-trening}"

if [ -z "$MAPPE" ] || [ -z "$MANIFEST" ] || [ -z "$UT" ]; then
  echo "Bruk: $0 <mappe-med-klipp> <metadata.csv> <navn> <ut-mappe>" >&2
  exit 1
fi

DATASET="$UT/dataset"
PREP="$UT/pre"
WAV="$DATASET/wav"
mkdir -p "$WAV"

# Aktiver venv hvis det finnes (PIPER_VENV overstyrer alt)
aktiver_venv() {
  for v in \
    "${PIPER_VENV:-}" \
    /opt/jarvis/piper/src/python/.venv \
    "$HOME/piper/src/python/.venv" \
    "$HOME/piper/.venv" \
    /opt/jarvis/piper/.venv \
    /opt/piper/.venv; do
    [ -n "$v" ] && [ -f "$v/bin/activate" ] && { source "$v/bin/activate"; echo "venv: $v"; return 0; }
  done
  echo "Ingen Piper venv funnet – bruker system-python"
}
aktiver_venv

HER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTO="${JARVIS_AUTO_INSTALL:-0}"

# Kan agenten installere selv? Krever passordfri sudo (settes av oppsett.sh).
kan_sudo() { [ "$(id -u)" -eq 0 ] || sudo -n true >/dev/null 2>&1; }
som_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi; }

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v espeak-ng >/dev/null 2>&1; then
  if [ "$AUTO" = "1" ] && kan_sudo; then
    echo "==> Mangler ffmpeg/espeak-ng – installerer automatisk"
    som_root apt-get update -qq || true
    som_root apt-get install -y ffmpeg espeak-ng libespeak-ng1
  fi
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg mangler – installer det først (apt install ffmpeg)" >&2; exit 1; }

if ! python3 -m piper_train.preprocess --help >/dev/null 2>&1; then
  if [ "$AUTO" = "1" ] && kan_sudo && [ -f "$HER/installer-piper.sh" ]; then
    echo "==> Piper-treningsmiljø mangler – installerer det nå (kan ta 10-20 min)"
    som_root bash "$HER/installer-piper.sh"
    aktiver_venv
  fi
fi
python3 -m piper_train.preprocess --help >/dev/null 2>&1 || {
  echo "piper_train mangler – installer Piper-treningsmiljøet først" >&2
  echo "Tips: sudo bash agent/scripts/installer-piper.sh" >&2
  exit 1
}

# Finjustering fra ferdig norsk stemme gir mye bedre resultat med lite data.
if [ "${PIPER_FINETUNE_NO:-0}" = "1" ] && [ -z "${PIPER_CHECKPOINT:-}" ]; then
  CKPT_DIR="${PIPER_CKPT_DIR:-/opt/jarvis/piper/checkpoints}"
  mkdir -p "$CKPT_DIR" 2>/dev/null || { CKPT_DIR="$UT/checkpoints"; mkdir -p "$CKPT_DIR"; }
  BASE_CKPT="$CKPT_DIR/no_NO-talesyntese-medium.ckpt"
  if [ ! -f "$BASE_CKPT" ]; then
    echo "==> Laster ned norsk basismodell for finjustering"
    URL="https://huggingface.co/datasets/rhasspy/piper-checkpoints/resolve/main/no/no_NO/talesyntese/medium/epoch%3D3459-step%3D2052250.ckpt"
    curl -fL --retry 3 -o "$BASE_CKPT.tmp" "$URL" && mv "$BASE_CKPT.tmp" "$BASE_CKPT" || {
      echo "  klarte ikke laste ned basismodell – trener fra bunnen i stedet" >&2
      rm -f "$BASE_CKPT.tmp"
    }
  fi
  [ -f "$BASE_CKPT" ] && export PIPER_CHECKPOINT="$BASE_CKPT"
fi

echo "==> Bygger datasett for $NAVN"
while IFS='|' read -r id tekst; do
  [ -n "$id" ] || continue
  src=$(find "$MAPPE" -maxdepth 1 -type f -name "$id.*" | head -n1)
  if [ -z "$src" ]; then
    echo "  hopper over $id (ingen lydfil)" >&2
    continue
  fi
  ffmpeg -y -hide_banner -loglevel error -i "$src" -ar 22050 -ac 1 -c:a pcm_s16le "$WAV/$id.wav"
done < "$MANIFEST"

cp "$MANIFEST" "$DATASET/metadata.csv"

echo "==> Pre-prosesserer (espeak-ng + phonemizer)"
python3 -m piper_train.preprocess \
  --language no \
  --input-dir "$DATASET" \
  --output-dir "$PREP" \
  --dataset-format ljspeech \
  --single-speaker \
  --sample-rate 22050

echo "==> Tren"
EPOCHS="${PIPER_EPOCHS:-2000}"
BS="${PIPER_BATCH:-8}"
KVAL="${PIPER_QUALITY:-low}"
RESUME="${PIPER_CHECKPOINT:+--resume_from_checkpoint $PIPER_CHECKPOINT}"

python3 -m piper_train \
  --dataset-dir "$PREP" \
  --accelerator gpu \
  --devices 1 \
  --batch-size "$BS" \
  --validation-split 0.0 \
  --num-test-examples 0 \
  --max_epochs "$EPOCHS" \
  --checkpoint-epochs 1 \
  --quality "$KVAL" \
  --precision 32 \
  $RESUME

echo "==> Eksporterer ONNX"
CKPT=$(find "$PREP/lightning_logs" -name '*.ckpt' -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
[ -n "$CKPT" ] || { echo "Fant ingen checkpoint"; exit 1; }

python3 -m piper_train.export_onnx "$CKPT" "$UT/model.onnx"
cp "$PREP/config.json" "$UT/model.onnx.json"

echo "==> FERDIG: $UT/model.onnx"
