#!/usr/bin/env python3
"""Lokal vektorindeks for Jarvis, bygget på turbovec.

Tjenesten holder én komprimert indeks i minnet og lagrer den på disk.
Jarvis sender bit-id (tekst) og vektor inn, og får id-ene tilbake ved søk.
Selve teksten blir liggende i SQLite hos Jarvis – her lagres bare vektorer.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from turbovec import IdMapIndex

PORT = int(os.environ.get("TURBOVEC_PORT", "11600"))
DATA_DIR = os.environ.get("TURBOVEC_DATA", "/var/lib/jarvis/data/turbovec")
BIT_WIDTH = int(os.environ.get("TURBOVEC_BITS", "4"))
INDEX_FIL = os.path.join(DATA_DIR, "indeks.tvim")
KART_FIL = os.path.join(DATA_DIR, "idkart.json")

os.makedirs(DATA_DIR, exist_ok=True)
laas = threading.Lock()

state = {
    "index": None,
    "dim": 0,
    "kart": {},      # tekst-id -> tallid
    "revers": {},    # tallid -> tekst-id
    "neste": 1,
    "sisteSokMs": None,
    "feil": "",
}


def lagre_kart():
    with open(KART_FIL, "w", encoding="utf-8") as f:
        json.dump({"dim": state["dim"], "neste": state["neste"], "kart": state["kart"]}, f)


def last_fra_disk():
    if not os.path.exists(KART_FIL) or not os.path.exists(INDEX_FIL):
        return
    try:
        with open(KART_FIL, "r", encoding="utf-8") as f:
            data = json.load(f)
        state["dim"] = int(data.get("dim") or 0)
        state["neste"] = int(data.get("neste") or 1)
        state["kart"] = {str(k): int(v) for k, v in (data.get("kart") or {}).items()}
        state["revers"] = {v: k for k, v in state["kart"].items()}
        state["index"] = IdMapIndex.load(INDEX_FIL)
    except Exception as e:  # noqa: BLE001 – ødelagt indeks skal ikke stoppe Jarvis
        state["feil"] = f"Klarte ikke laste indeks: {e}"
        state["index"] = None
        state["kart"] = {}
        state["revers"] = {}
        state["neste"] = 1


def sikre_index(dim: int):
    if state["index"] is not None and state["dim"] == dim:
        return state["index"]
    if state["index"] is not None and state["dim"] != dim:
        # Modellen har byttet dimensjon – start på nytt.
        nullstill()
    state["dim"] = dim
    state["index"] = IdMapIndex(dim=dim, bit_width=BIT_WIDTH)
    return state["index"]


def nullstill():
    state.update({"index": None, "dim": 0, "kart": {}, "revers": {}, "neste": 1, "feil": ""})
    for sti in (INDEX_FIL, KART_FIL):
        try:
            os.remove(sti)
        except FileNotFoundError:
            pass


def synk():
    if state["index"] is None:
        return
    state["index"].sync(INDEX_FIL)
    lagre_kart()


def legg_til(poster):
    """poster: [{id, vektor}] – erstatter eksisterende id-er."""
    gyldige = [p for p in poster if p.get("id") and p.get("vektor")]
    if not gyldige:
        return 0
    dim = len(gyldige[0]["vektor"])
    index = sikre_index(dim)
    vektorer = []
    ider = []
    for p in gyldige:
        v = p["vektor"]
        if len(v) != dim:
            continue
        tekst_id = str(p["id"])
        gammel = state["kart"].get(tekst_id)
        if gammel is not None:
            try:
                index.remove(np.uint64(gammel))
            except Exception:  # noqa: BLE001
                pass
        tallid = state["neste"]
        state["neste"] += 1
        state["kart"][tekst_id] = tallid
        state["revers"][tallid] = tekst_id
        vektorer.append(v)
        ider.append(tallid)
    if not vektorer:
        return 0
    index.add_with_ids(
        np.asarray(vektorer, dtype=np.float32),
        np.asarray(ider, dtype=np.uint64),
    )
    synk()
    return len(ider)


def slett(ider):
    n = 0
    for tekst_id in ider:
        tallid = state["kart"].pop(str(tekst_id), None)
        if tallid is None:
            continue
        state["revers"].pop(tallid, None)
        try:
            state["index"].remove(np.uint64(tallid))
            n += 1
        except Exception:  # noqa: BLE001
            pass
    if n:
        synk()
    return n


def sok(vektor, k):
    if state["index"] is None or not state["kart"]:
        return [], 0.0
    if len(vektor) != state["dim"]:
        raise ValueError(f"Vektoren har {len(vektor)} tall, indeksen bruker {state['dim']}.")
    start = time.time()
    poeng, ider = state["index"].search(np.asarray([vektor], dtype=np.float32), k=int(k))
    ms = (time.time() - start) * 1000
    state["sisteSokMs"] = round(ms, 2)
    flate_poeng = np.asarray(poeng).reshape(-1).tolist()
    flate_ider = np.asarray(ider).reshape(-1).tolist()
    treff = []
    for p, i in zip(flate_poeng, flate_ider):
        tekst_id = state["revers"].get(int(i))
        if tekst_id:
            treff.append({"id": tekst_id, "poeng": float(p)})
    return treff, round(ms, 2)


def statistikk():
    return {
        "vektorer": len(state["kart"]),
        "dim": state["dim"],
        "bits": BIT_WIDTH,
        "sisteSokMs": state["sisteSokMs"],
        "feil": state["feil"],
        "fil": INDEX_FIL,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):  # stillere logg
        pass

    def _svar(self, kode, data):
        kropp = json.dumps(data).encode("utf-8")
        self.send_response(kode)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(kropp)))
        self.end_headers()
        self.wfile.write(kropp)

    def _kropp(self):
        n = int(self.headers.get("content-length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/health") or self.path.startswith("/statistikk"):
            return self._svar(200, {"ok": True, **statistikk()})
        return self._svar(404, {"error": "Ukjent sti"})

    def do_POST(self):  # noqa: N802
        try:
            data = self._kropp()
            with laas:
                if self.path.startswith("/legg-til"):
                    n = legg_til(data.get("poster") or [])
                    return self._svar(200, {"ok": True, "lagt_til": n, **statistikk()})
                if self.path.startswith("/sok"):
                    treff, ms = sok(data.get("vektor") or [], data.get("topK") or 5)
                    return self._svar(200, {"ok": True, "treff": treff, "msBrukt": ms})
                if self.path.startswith("/slett"):
                    n = slett(data.get("ider") or [])
                    return self._svar(200, {"ok": True, "slettet": n, **statistikk()})
                if self.path.startswith("/nullstill"):
                    nullstill()
                    return self._svar(200, {"ok": True, **statistikk()})
            return self._svar(404, {"error": "Ukjent sti"})
        except Exception as e:  # noqa: BLE001
            return self._svar(400, {"ok": False, "error": str(e)})


def main():
    last_fra_disk()
    print(f"turbovec-indeks lytter på http://127.0.0.1:{PORT} ({statistikk()['vektorer']} vektorer)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
