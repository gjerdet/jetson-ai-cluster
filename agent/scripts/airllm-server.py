#!/usr/bin/env python3
"""Minimal OpenAI-kompatibel server foran AirLLM.

Kjører store modeller lag-for-lag på lite GPU-minne. Én forespørsel om
gangen (sekvensiell kø) – Jetson har ikke minne til mer. Endepunkter:
  GET  /health
  GET  /v1/models
  POST /v1/chat/completions
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELL = os.environ.get("AIRLLM_MODELL", "v2ray/Llama-3-8B")
PORT = int(os.environ.get("AIRLLM_PORT", "11500"))
MAKS_LENGDE = int(os.environ.get("AIRLLM_MAX_LENGTH", "512"))
KOMPRIMERING = os.environ.get("AIRLLM_COMPRESSION", "").strip()

_laas = threading.Lock()
_model = None
_status = {"modell": MODELL, "lastet": False, "feil": "", "sisteSvarSek": None, "startet": time.time()}


def hent_modell():
    global _model
    if _model is None:
        from airllm import AutoModel

        kwargs = {}
        if KOMPRIMERING:
            kwargs["compression"] = KOMPRIMERING
        _model = AutoModel.from_pretrained(MODELL, **kwargs)
        _status["lastet"] = True
    return _model


def flat_melding(meldinger):
    deler = []
    for m in meldinger:
        rolle = m.get("role", "user")
        innhold = m.get("content", "")
        if not isinstance(innhold, str):
            innhold = json.dumps(innhold, ensure_ascii=False)
        deler.append(f"{rolle}: {innhold}")
    deler.append("assistant:")
    return "\n".join(deler)


def generer(meldinger, maks_tokens):
    model = hent_modell()
    prompt = flat_melding(meldinger)
    inndata = model.tokenizer(
        [prompt], return_tensors="pt", return_attention_mask=False, truncation=True, max_length=MAKS_LENGDE
    )
    utdata = model.generate(
        inndata["input_ids"].cuda() if hasattr(inndata["input_ids"], "cuda") else inndata["input_ids"],
        max_new_tokens=maks_tokens,
        use_cache=True,
        return_dict_in_generate=True,
    )
    sekvens = getattr(utdata, "sequences", utdata)
    tekst = model.tokenizer.decode(sekvens[0], skip_special_tokens=True)
    return tekst[len(prompt):].strip() if tekst.startswith(prompt) else tekst.strip()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _svar(self, kode, data):
        kropp = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(kode)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(kropp)))
        self.end_headers()
        self.wfile.write(kropp)

    def log_message(self, fmt, *args):  # dempet, agentloggen holder
        pass

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._svar(200, {"ok": True, **_status, "opptatt": _laas.locked()})
        if self.path.startswith("/v1/models"):
            return self._svar(200, {"data": [{"id": MODELL, "object": "model"}], "object": "list"})
        self._svar(404, {"error": "ukjent sti"})

    def do_POST(self):
        if not self.path.startswith("/v1/chat/completions"):
            return self._svar(404, {"error": "ukjent sti"})
        lengde = int(self.headers.get("content-length") or 0)
        try:
            kropp = json.loads(self.rfile.read(lengde) or b"{}")
        except json.JSONDecodeError:
            return self._svar(400, {"error": "ugyldig JSON"})
        meldinger = kropp.get("messages") or []
        maks = int(kropp.get("max_tokens") or kropp.get("max_completion_tokens") or 256)
        start = time.time()
        with _laas:
            try:
                tekst = generer(meldinger, maks)
            except Exception as feil:  # noqa: BLE001 – rapporteres til GUI-et
                _status["feil"] = str(feil)[:400]
                return self._svar(500, {"error": {"message": str(feil)[:400]}})
        _status["sisteSvarSek"] = round(time.time() - start, 1)
        _status["feil"] = ""
        self._svar(
            200,
            {
                "id": f"airllm-{int(start)}",
                "object": "chat.completion",
                "model": MODELL,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": tekst}, "finish_reason": "stop"}],
            },
        )


if __name__ == "__main__":
    print(f"AirLLM-server starter på port {PORT} med modell {MODELL}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
