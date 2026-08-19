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
  // Lokal tale-til-tekst (OpenAI-kompatibel, f.eks. faster-whisper-server)
  sttUrl: "http://127.0.0.1:8001/v1/audio/transcriptions",
  sttModell: "Systran/faster-whisper-small",
  sttSprak: "no",
  // Kommando som kjører finetuning. {manifest} {mappe} {navn} {ut} byttes ut.
  treningKommando: "",
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
    sttUrl: String(inn.sttUrl ?? c.sttUrl).trim(),
    sttModell: String(inn.sttModell ?? c.sttModell).trim(),
    sttSprak: String(inn.sttSprak ?? c.sttSprak).trim(),
    treningKommando: String(inn.treningKommando ?? c.treningKommando ?? "").trim(),
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
  const aktive = l.filter((k) => !k.pauset);
  return {
    antall: l.length,
    aktive: aktive.length,
    pauset: l.length - aktive.length,
    medTekst: aktive.filter((k) => (k.tekst || "").trim()).length,
    sekunder: Math.round(l.reduce((s, k) => s + (k.sekunder || 0), 0)),
    aktiveSekunder: Math.round(aktive.reduce((s, k) => s + (k.sekunder || 0), 0)),
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
    pauset: false,
    tekstKilde: String(tekst || "").trim() ? "manuell" : "",
    opprettet: new Date().toISOString(),
  };
  const d = klippDoc();
  const foer = (d.list || []).length;
  // Additivt, alltid: nye klipp legges bakerst, ingen eksisterende røres.
  saveDoc("stemmeklipp", { list: [...(d.list || []), klipp] });
  // Skriv til disk med en gang: ellers kan et klipp gå tapt hvis agenten
  // startes på nytt før den utsatte skrivingen kjører.
  flushNow();
  const etter = (klippDoc().list || []).length;
  if (etter !== foer + 1) throw new Error(`Lagring feilet: hadde ${foer} klipp, har ${etter} etter opplasting.`);
  klipp.antallFoer = foer;
  klipp.antallEtter = etter;
  return klipp;
}

/** Endrer transkripsjon eller pause-status på ett klipp. */
export function oppdaterKlipp(id, inn = {}) {
  const d = klippDoc();
  const list = d.list || [];
  const i = list.findIndex((k) => k.id === id);
  if (i < 0) return null;
  const k = { ...list[i] };
  if (inn.tekst !== undefined) {
    k.tekst = String(inn.tekst || "").trim().slice(0, 2000);
    k.tekstKilde = k.tekst ? String(inn.tekstKilde || "manuell") : "";
  }
  if (inn.pauset !== undefined) k.pauset = Boolean(inn.pauset);
  const ny = [...list];
  ny[i] = k;
  saveDoc("stemmeklipp", { list: ny });
  flushNow();
  return k;
}

/**
 * Sjekker at hvert klipp i registeret har fila si på disk, og at ingen filer
 * ligger igjen som «foreldreløse». Brukes av GUI-et for å bevise at
 * opplastinger er additive og at ingenting er slettet.
 */
export async function verifiserKlipp() {
  const list = listClips();
  await fs.mkdir(CLIP_DIR, { recursive: true });
  const paaDisk = new Set(await fs.readdir(CLIP_DIR).catch(() => []));
  const mangler = [];
  for (const k of list) {
    if (!paaDisk.has(k.fil)) mangler.push({ id: k.id, navn: k.navn, fil: k.fil });
    paaDisk.delete(k.fil);
  }
  return {
    ok: mangler.length === 0,
    antall: list.length,
    mangler,
    foreldrelose: [...paaDisk],
    mappe: CLIP_DIR,
    statistikk: clipStats(),
  };
}

/** Auto-transkriberer et klipp med lokal STT-server (OpenAI-kompatibel). */
export async function transkriberKlipp(id, { overskriv = false } = {}) {
  const k = listClips().find((x) => x.id === id);
  if (!k) throw new Error("Fant ikke klippet.");
  if (!overskriv && (k.tekst || "").trim()) return { klipp: k, hoppetOver: true };
  const cfg = ttsConfig();
  const url = String(cfg.sttUrl || "").trim();
  if (!url) throw new Error("STT-adresse (sttUrl) er ikke satt i tale-innstillingene.");
  const buf = await fs.readFile(path.join(CLIP_DIR, k.fil));
  const form = new FormData();
  form.append("file", new Blob([buf], { type: k.mime || "audio/wav" }), k.fil);
  if (cfg.sttModell) form.append("model", cfg.sttModell);
  if (cfg.sttSprak) form.append("language", cfg.sttSprak);
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error(`STT svarte ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json().catch(() => null);
  const tekst = String(data?.text ?? data?.transcript ?? "").trim();
  if (!tekst) throw new Error("STT ga tom transkripsjon.");
  return { klipp: oppdaterKlipp(id, { tekst, tekstKilde: "auto" }), hoppetOver: false };
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
    .filter((k) => k.tekst && !k.pauset)
    .map((k) => `${k.fil.replace(/\.[^.]+$/, "")}|${k.tekst.replace(/[\r\n|]+/g, " ")}`)
    .join("\n");
}

export const clipDir = () => CLIP_DIR;
