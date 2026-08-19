#!/usr/bin/env bash
# Installerer lokal tale-til-tekst (faster-whisper) på Jetson-en, slik at
# opplastede stemmeklipp kan auto-transkriberes uten sky. Idempotent.
set -euo pipefail

MAPPE=${STT_DIR:-/opt/jarvis-stt}
PORT=${STT_PORT:-8001}
MODELL=${STT_MODELL:-small}
SPRAK=${STT_SPRAK:-no}

echo "==> installerer systempakker"
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-venv python3-pip ffmpeg

echo "==> setter opp venv i $MAPPE"
sudo mkdir -p "$MAPPE"
sudo chown "$USER":"$USER" "$MAPPE"
[ -d "$MAPPE/venv" ] || python3 -m venv "$MAPPE/venv"
"$MAPPE/venv/bin/pip" install -q --upgrade pip
"$MAPPE/venv/bin/pip" install -q faster-whisper fastapi "uvicorn[standard]" python-multipart

cat > "$MAPPE/server.py" <<'PY'
"""Minimal OpenAI-kompatibel /v1/audio/transcriptions med faster-whisper."""
import os, tempfile
from fastapi import FastAPI, UploadFile, File, Form
from faster_whisper import WhisperModel

MODELL = os.environ.get("STT_MODELL", "small")
model = WhisperModel(MODELL, device="auto", compute_type="int8")
app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "modell": MODELL}


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model: str = Form(None), language: str = Form(None)):
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(file.filename or "a.wav")[1], delete=False) as f:
        f.write(data)
        sti = f.name
    try:
        segs, _ = globals()["model"].transcribe(sti, language=language or None, vad_filter=True)
        tekst = " ".join(s.text.strip() for s in segs).strip()
    finally:
        os.unlink(sti)
    return {"text": tekst}
PY

echo "==> systemd-tjeneste jarvis-stt"
sudo tee /etc/systemd/system/jarvis-stt.service >/dev/null <<UNIT
[Unit]
Description=Jarvis lokal tale-til-tekst (faster-whisper)
After=network-online.target

[Service]
Environment=STT_MODELL=$MODELL
WorkingDirectory=$MAPPE
ExecStart=$MAPPE/venv/bin/uvicorn server:app --host 127.0.0.1 --port $PORT
Restart=on-failure
User=$USER

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now jarvis-stt
sleep 3
if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "OK: STT kjører på http://127.0.0.1:$PORT/v1/audio/transcriptions"
  echo "Sett denne adressen i SYSTEM → STEMME (sttUrl), språk: $SPRAK"
else
  echo "ADVARSEL: fikk ikke svar enda – følg med: journalctl -u jarvis-stt -f"
fi
