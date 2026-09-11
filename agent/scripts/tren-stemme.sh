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

# Finn Python direkte i Piper-miljøet. En absolutt interpreter er mer robust
# enn å stole på at `source activate` endrer PATH i et systemd/bash-lc-miljø.
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

har_piper() { "$1" -c 'import piper.train' >/dev/null 2>&1 || "$1" -m piper_train.preprocess --help >/dev/null 2>&1; }
har_torch() { "$1" -c 'import torch' >/dev/null 2>&1; }
har_cuda_torch() { "$1" -c 'import torch,sys;sys.exit(0 if torch.cuda.is_available() else 1)' >/dev/null 2>&1; }

# Velg først en tolker som har både Piper og torch. Et venv uten torch gir
# ellers «ModuleNotFoundError: No module named torch» langt inne i treningen.
finn_piper_python() {
  local beste="" delvis=""
  while read -r p; do
    [ -n "$p" ] || continue
    if har_piper "$p"; then
      if har_torch "$p" && har_cuda_torch "$p"; then beste="$p"; break; fi
      [ -z "$delvis" ] && delvis="$p"
    fi
  done < <(kandidat_python)
  if [ -n "$beste" ]; then echo "$beste"; return 0; fi
  if [ -n "$delvis" ]; then echo "$delvis"; return 0; fi
  kandidat_python | head -n1
}
PIPER_PYTHON_BIN="$(finn_piper_python)"
echo "Piper Python: $PIPER_PYTHON_BIN"

HER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTO="${JARVIS_AUTO_INSTALL:-0}"

# Kan agenten installere akkurat Piper-skriptet? Sudoers er med vilje begrenset
# til denne kommandoen, så `sudo -n true` gir falsk negativ.
kan_installere_piper() {
  [ "$(id -u)" -eq 0 ] && return 0
  local bash_sti="/bin/bash"
  [ -x /usr/bin/bash ] && bash_sti="/usr/bin/bash"
  sudo -n -l "$bash_sti" "$HER/installer-piper.sh" >/dev/null 2>&1
}
som_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi; }

kjor_installasjon() {
  [ "$AUTO" = "1" ] || return 1
  kan_installere_piper || return 1
  [ -f "$HER/installer-piper.sh" ] || return 1
  som_root bash "$HER/installer-piper.sh" || return 1
  PIPER_PYTHON_BIN="$(finn_piper_python)"
  echo "Piper Python: $PIPER_PYTHON_BIN"
}

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v espeak-ng >/dev/null 2>&1; then
  echo "==> Mangler ffmpeg/espeak-ng – kjører Piper-installatøren"
  kjor_installasjon || true
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg mangler – installer det først (apt install ffmpeg)" >&2; exit 1; }
command -v espeak-ng >/dev/null 2>&1 || { echo "espeak-ng mangler – installer det først (apt install espeak-ng)" >&2; exit 1; }

# Piper/espeak-ng bruker ISO 639-koden «nb» for norsk bokmål. «no» kan se
# riktig ut, men finnes ikke i espeakbridge på nyere Piper og feiler først når
# hele datasettet skal fonemiseres. Test den samme broen som treningen bruker
# før vi bruker tid på lydkonvertering og modelloppstart.
ESPEAK_STEMME="${PIPER_ESPEAK_VOICE:-nb}"
if ! espeak-ng -v "$ESPEAK_STEMME" --stdout "språktest" >/dev/null 2>&1; then
  echo "eSpeak-stemmen '$ESPEAK_STEMME' finnes ikke. Norsk bokmål krever stemmen 'nb'." >&2
  echo "Tilgjengelige norske stemmer:" >&2
  espeak-ng --voices 2>/dev/null | awk 'tolower($0) ~ /norwegian|bokm.l| nynorsk|[[:space:]]nb([[:space:]]|$)/ {print}' >&2 || true
  exit 1
fi

har_ny_piper() { "$PIPER_PYTHON_BIN" -m piper.train fit --help >/dev/null 2>&1; }
har_gammel_piper() { "$PIPER_PYTHON_BIN" -m piper_train.preprocess --help >/dev/null 2>&1; }

if ! har_ny_piper && ! har_gammel_piper; then
  echo "==> Piper-treningsmiljø mangler – installerer det nå (kan ta 10-20 min)"
  kjor_installasjon || true
fi

if har_ny_piper && ! "$PIPER_PYTHON_BIN" - "$ESPEAK_STEMME" <<'PY' >/dev/null 2>&1
import sys
from piper import espeakbridge
espeakbridge.set_voice(sys.argv[1])
PY
then
  echo "Piper klarte ikke å åpne eSpeak-stemmen '$ESPEAK_STEMME'." >&2
  echo "Installer norske eSpeak-data på nytt, eller bruk PIPER_ESPEAK_VOICE=nb." >&2
  exit 1
fi

# PyTorch mangler ofte selv om Piper er installert: venv-et arver system-Python,
# og der er NVIDIA-hjulet ikke alltid på plass. Prøv å installere det først.
if ! har_torch "$PIPER_PYTHON_BIN"; then
  echo "==> PyTorch mangler i $PIPER_PYTHON_BIN – installerer NVIDIA PyTorch og Piper på nytt"
  kjor_installasjon || true
fi
if har_torch "$PIPER_PYTHON_BIN" && ! har_cuda_torch "$PIPER_PYTHON_BIN"; then
  echo "PyTorch i Piper-miljøet mangler CUDA-støtte – installerer riktig NVIDIA-utgave og bygger Piper-miljøet på nytt" >&2
  kjor_installasjon || true
fi
if ! har_torch "$PIPER_PYTHON_BIN"; then
  echo "PyTorch (torch) mangler i Piper-miljøet: $PIPER_PYTHON_BIN" >&2
  "$PIPER_PYTHON_BIN" -c 'import sys; print("sys.executable:", sys.executable); print("sys.path:", sys.path)' >&2 2>/dev/null || true
  echo "Kjør én vanlig Jarvis-oppdatering; den installerer PyTorch og bygger Piper-miljøet automatisk." >&2
  exit 1
fi

if ! har_ny_piper && ! har_gammel_piper; then
  echo "Piper-treningsmiljøet mangler – installer Piper først" >&2
  "$PIPER_PYTHON_BIN" -m piper.train fit --help 2>&1 | tail -n 12 >&2 || true
  echo "Tips: sudo bash agent/scripts/installer-piper.sh" >&2
  exit 1
fi


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

# Tomt datasett gir en kryptisk Python-feil langt inne i treningen.
# Stopp tidlig med en forklarende melding i stedet.
ANTALL_WAV=$(find "$WAV" -maxdepth 1 -type f -name '*.wav' | wc -l)
if [ "$ANTALL_WAV" -eq 0 ]; then
  echo "Ingen lydfiler ble bygget fra $MAPPE og $MANIFEST." >&2
  echo "Sjekk at klippene er lastet opp og at metadata.csv har linjer på formen id|tekst." >&2
  exit 1
fi
echo "==> $ANTALL_WAV klipp klare i $WAV"

EPOCHS="${PIPER_EPOCHS:-2000}"
BS="${PIPER_BATCH:-8}"
KVAL="${PIPER_QUALITY:-low}"

# Velg akselerator ut fra hva torch faktisk ser. Uten dette krasjer Lightning
# med "No supported gpu backend found" når CUDA-hjulet mangler.
if "$PIPER_PYTHON_BIN" -c 'import torch,sys;sys.exit(0 if torch.cuda.is_available() else 1)' >/dev/null 2>&1; then
  AKSEL="gpu"
else
  AKSEL="cpu"
  echo "! Fant ingen CUDA-enhet – trener på CPU (mye tregere)." >&2
  echo "  Kjør INSTALLER PYTORCH i GUI-et for GPU-trening." >&2
fi



if har_ny_piper; then
  # Ny Piper (Open Home Foundation) bruker lydfilnavn i første CSV-kolonne.
  awk -F'|' 'BEGIN{OFS="|"} NF>=2 {$1=$1 ".wav"; print}' "$MANIFEST" > "$DATASET/metadata.csv"
  CONFIG="$UT/model.onnx.json"
  echo "==> Trener med aktiv Piper-CLI"
  CMD=("$PIPER_PYTHON_BIN" -m piper.train fit
    --data.voice_name "$NAVN"
    --data.csv_path "$DATASET/metadata.csv"
    --data.audio_dir "$WAV"
    --model.sample_rate 22050
    --data.espeak_voice "$ESPEAK_STEMME"
    --data.cache_dir "$PREP/cache"
    --data.config_path "$CONFIG"
    --data.batch_size "$BS"
    --trainer.max_epochs "$EPOCHS"
    --trainer.accelerator "$AKSEL"
    --trainer.devices 1
    --trainer.default_root_dir "$PREP")
  [ -n "${PIPER_CHECKPOINT:-}" ] && CMD+=(--ckpt_path "$PIPER_CHECKPOINT")
  "${CMD[@]}"

  echo "==> Eksporterer ONNX"
  CKPT=$(find "$PREP" -name '*.ckpt' -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
  [ -n "$CKPT" ] || { echo "Fant ingen checkpoint"; exit 1; }
  "$PIPER_PYTHON_BIN" -m piper.train.export_onnx --checkpoint "$CKPT" --output-file "$UT/model.onnx"
else
  # Kompatibilitet for noder som fortsatt har et fungerende eldre miljø.
  cp "$MANIFEST" "$DATASET/metadata.csv"
  echo "==> Pre-prosesserer med eldre Piper"
  "$PIPER_PYTHON_BIN" -m piper_train.preprocess \
    --language "$ESPEAK_STEMME" --input-dir "$DATASET" --output-dir "$PREP" \
    --dataset-format ljspeech --single-speaker --sample-rate 22050
  echo "==> Trener med eldre Piper"
  RESUME="${PIPER_CHECKPOINT:+--resume_from_checkpoint $PIPER_CHECKPOINT}"
  "$PIPER_PYTHON_BIN" -m piper_train \
    --dataset-dir "$PREP" --accelerator "$AKSEL" --devices 1 --batch-size "$BS" \
    --validation-split 0.0 --num-test-examples 0 --max_epochs "$EPOCHS" \
    --checkpoint-epochs 1 --quality "$KVAL" --precision 32 $RESUME
  echo "==> Eksporterer ONNX"
  CKPT=$(find "$PREP/lightning_logs" -name '*.ckpt' -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
  [ -n "$CKPT" ] || { echo "Fant ingen checkpoint"; exit 1; }
  "$PIPER_PYTHON_BIN" -m piper_train.export_onnx "$CKPT" "$UT/model.onnx"
  cp "$PREP/config.json" "$UT/model.onnx.json"
fi

echo "==> FERDIG: $UT/model.onnx"
