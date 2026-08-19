/**
 * Tale (TTS) for Jarvis-backend.
 *  - proxy mot en lokal Piper-server (piper-http / wyoming-piper med HTTP-fasade)
 *  - lagring av treningsklipp (lyd + transkripsjon) for opplæring av ny stemme
 * Alt ligger lokalt under AGENT_DATA – ingen sky.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, doc, saveDoc, flushNow } from "./store.mjs";

const CLIP_DIR = path.join(DATA_DIR, "stemmeklipp");
const MAKS_KLIPP_BYTES = 25 * 1024 * 1024;

export const TTS_DEFAULTS = {
  piperUrl: "http://127.0.0.1:5000/api/tts",
  voicesUrl: "",
  modell: "en_GB-alan-medium",
  lengthScale: 1,
  noiseScale: 0.667,
};

export function ttsConfig() {
  return { ...TTS_DEFAULTS, ...(doc("tts", {}) || {}) };
}

export function saveTtsConfig(inn = {}) {
  const c = ttsConfig();
  const ny = {
    piperUrl: String(inn.piperUrl ?? c.piperUrl).trim(),
    voicesUrl: String(inn.voicesUrl ?? c.voicesUrl).trim(),
    modell: String(inn.modell ?? c.modell).trim(),
    lengthScale: Number(inn.lengthScale ?? c.lengthScale) || 1,
    noiseScale: Number(inn.noiseScale ?? c.noiseScale) || 0.667,
  };
  saveDoc("tts", ny);
  return ny;
}

/** Syntetiserer tale via Piper. Returnerer { lyd: Buffer, mime }. */
export async function syntetiser(tekst, opts = {}) {
  const cfg = ttsConfig();
  const url = String(opts.piperUrl || cfg.piperUrl || "").trim();
  if (!url) throw new Error("Piper-URL er ikke satt.");
  const fullBody = {
    text: tekst,
    voice: opts.modell || cfg.modell,
    length_scale: Number(opts.lengthScale ?? cfg.lengthScale),
    noise_scale: Number(opts.noiseScale ?? cfg.noiseScale),
  };
  const send = (body) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  let res = await send(fullBody);
  // Flere Piper HTTP-fasader laster én modell ved oppstart og godtar bare
  // { text }. De svarer 400/422 hvis voice/skalafelt følger med.
  if (res.status === 400 || res.status === 422) {
    res = await send({ text: tekst });
  }
  if (!res.ok) throw new Error(`Piper svarte ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Piper svarte uten lyddata.");
  return { lyd: buf, mime: res.headers.get("content-type") || "audio/wav" };
}

/** Henter modell-lista fra Piper hvis serveren tilbyr det. */
export async function piperStemmer() {
  const cfg = ttsConfig();
  const url = (cfg.voicesUrl || "").trim() || cfg.piperUrl.replace(/\/api\/tts$/, "/api/voices");
  if (!url) return [];
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => null);
  if (!data) return [];
  if (Array.isArray(data)) return data.map((v) => (typeof v === "string" ? v : v.key || v.name)).filter(Boolean);
  return Object.keys(data);
}

// ---- treningsklipp -------------------------------------------------------

const klippDoc = () => doc("stemmeklipp", { list: [] });

export function listClips() {
  return [...(klippDoc().list || [])].sort((a, b) => (a.opprettet < b.opprettet ? 1 : -1));
}

export function clipStats() {
  const l = listClips();
  return {
    antall: l.length,
    sekunder: Math.round(l.reduce((s, k) => s + (k.sekunder || 0), 0)),
    bytes: l.reduce((s, k) => s + (k.bytes || 0), 0),
  };
}

/** Lagrer et lydklipp med transkripsjon. `lydBase64` uten data:-prefiks. */
export async function addClip({ navn, tekst, lydBase64, mime = "audio/wav", sekunder = 0 }) {
  const rentNavn = String(navn || "klipp").replace(/[^\w.\- ]+/g, "_").slice(0, 80);
  const b64 = String(lydBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!b64) throw new Error("Lydfila er tom.");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw new Error("Klarte ikke lese lydfila.");
  if (buf.length > MAKS_KLIPP_BYTES) throw new Error("Klippet er for stort (maks 25 MB).");
  await fs.mkdir(CLIP_DIR, { recursive: true });
  const id = randomUUID();
  const ext = mime.includes("mpeg") ? "mp3" : mime.includes("ogg") ? "ogg" : mime.includes("webm") ? "webm" : "wav";
  const fil = `${id}.${ext}`;
  await fs.writeFile(path.join(CLIP_DIR, fil), buf);
  const klipp = {
    id,
    navn: rentNavn,
    tekst: String(tekst || "").trim().slice(0, 2000),
    fil,
    mime,
    bytes: buf.length,
    sekunder: Number(sekunder) || 0,
    opprettet: new Date().toISOString(),
  };
  const d = klippDoc();
  saveDoc("stemmeklipp", { list: [...(d.list || []), klipp] });
  // Skriv til disk med en gang: ellers kan et klipp gå tapt hvis agenten
  // startes på nytt før den utsatte skrivingen kjører.
  flushNow();
  return klipp;
}

export async function deleteClip(id) {
  const d = klippDoc();
  const treff = (d.list || []).find((k) => k.id === id);
  if (!treff) return false;
  await fs.unlink(path.join(CLIP_DIR, treff.fil)).catch(() => {});
  saveDoc("stemmeklipp", { list: (d.list || []).filter((k) => k.id !== id) });
  flushNow();
  return true;
}

/** LJSpeech-lignende manifest (id|tekst) som piper-train kan bruke. */
export function trainingManifest() {
  return listClips()
    .filter((k) => k.tekst)
    .map((k) => `${k.fil.replace(/\.[^.]+$/, "")}|${k.tekst.replace(/[\r\n|]+/g, " ")}`)
    .join("\n");
}

export const clipDir = () => CLIP_DIR;
