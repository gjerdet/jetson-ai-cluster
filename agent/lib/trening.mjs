/**
 * Treningskø for Piper-stemmer.
 * Én jobb om gangen (Jetson har begrenset RAM). Hver jobb har status,
 * fremdrift i prosent og en logg som GUI-et poller mens treningen kjører.
 * Alt kjører lokalt – ingen sky.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DATA_DIR, doc, saveDoc, flushNow } from "./store.mjs";
import { clipDir, trainingManifest, clipStats, ttsConfig, saveTtsConfig, transkriberAlle } from "./tts.mjs";

const MAKS_LOGG = 500;
const jobbDoc = () => doc("treningsjobber", { list: [] });
const lagre = (list) => {
  saveDoc("treningsjobber", { list: list.slice(-40) });
  flushNow();
};

/** Alle jobber, nyeste først. */
export function listJobber() {
  return [...(jobbDoc().list || [])].sort((a, b) => (a.opprettet < b.opprettet ? 1 : -1));
}

export function hentJobb(id) {
  return (jobbDoc().list || []).find((j) => j.id === id) || null;
}

function oppdater(id, patch) {
  const list = jobbDoc().list || [];
  const i = list.findIndex((j) => j.id === id);
  if (i < 0) return null;
  const ny = [...list];
  ny[i] = { ...ny[i], ...patch };
  lagre(ny);
  return ny[i];
}

function logg(id, linje) {
  const j = hentJobb(id);
  if (!j) return;
  const l = [...(j.logg || []), `${new Date().toISOString().slice(11, 19)} ${linje}`].slice(-MAKS_LOGG);
  oppdater(id, { logg: l });
}

const prosesser = new Map();

/** Legger en jobb i køen og starter den hvis ingen kjører. */
export async function koLeggTil({ navn, kommando, autoTranskriber = true } = {}) {
  let stat = clipStats();
  // Klipp uten tekst kan ikke trenes på – prøv lokal STT først, slik at
  // brukeren bare trenger å laste opp lyd og trykke start.
  let transkripsjon = null;
  if (autoTranskriber && stat.medTekst < stat.aktive) {
    transkripsjon = await transkriberAlle().catch((e) => ({ feilet: 1, feil: [String(e?.message || e)] }));
    stat = clipStats();
  }
  if (!stat.medTekst && transkripsjon?.feil?.length)
    throw new Error(`Auto-transkripsjon feilet: ${transkripsjon.feil[0]} – sett STT-adressen i SYSTEM → STEMME eller skriv teksten manuelt.`);
  if (!stat.medTekst) throw new Error("Ingen aktive klipp med transkripsjon – legg til tekst før du starter trening.");
  const cfg = ttsConfig();
  const cmd = String(kommando || cfg.treningKommando || "").trim();
  if (!cmd) throw new Error("Ingen treningskommando er satt (SYSTEM → STEMME → treningKommando).");

  const id = randomUUID();
  const jobbNavn = String(navn || `stemme-${new Date().toISOString().slice(0, 10)}`).replace(/[^\w.\- ]+/g, "_").slice(0, 60);
  const utMappe = path.join(DATA_DIR, "stemmemodeller", `${jobbNavn}-${id.slice(0, 8)}`);
  await fs.mkdir(utMappe, { recursive: true });
  const manifestFil = path.join(utMappe, "metadata.csv");
  await fs.writeFile(manifestFil, trainingManifest());

  const jobb = {
    id,
    navn: jobbNavn,
    status: "kø",
    fremdrift: 0,
    klipp: stat.medTekst,
    sekunder: stat.aktiveSekunder,
    manifest: manifestFil,
    utMappe,
    kommando: cmd
      .replaceAll("{manifest}", manifestFil)
      .replaceAll("{mappe}", clipDir())
      .replaceAll("{navn}", jobbNavn)
      .replaceAll("{ut}", utMappe),
    logg: [],
    feil: "",
    opprettet: new Date().toISOString(),
    startet: "",
    ferdig: "",
  };
  lagre([...(jobbDoc().list || []), jobb]);
  kjorNeste();
  return jobb;
}

/** Avbryter en jobb som kjører, eller fjerner den fra køen. */
export function avbryt(id) {
  const p = prosesser.get(id);
  if (p) {
    p.kill("SIGTERM");
    prosesser.delete(id);
  }
  const j = hentJobb(id);
  if (!j) return false;
  if (j.status === "ferdig" || j.status === "feilet") return false;
  oppdater(id, { status: "avbrutt", ferdig: new Date().toISOString() });
  logg(id, "avbrutt av bruker");
  kjorNeste();
  return true;
}

export function slettJobb(id) {
  avbryt(id);
  lagre((jobbDoc().list || []).filter((j) => j.id !== id));
  return true;
}

/** Peker aktiv Piper-modell til en ferdigtrent .onnx-fil. */
export function publiser(id, modell) {
  const j = hentJobb(id);
  if (!j) throw new Error("Fant ikke jobben.");
  const fil = String(modell || j.modellFil || "").trim();
  if (!fil) throw new Error("Ingen modellfil å publisere.");
  saveTtsConfig({ modell: fil });
  oppdater(id, { publisert: fil });
  logg(id, `publisert som aktiv stemme: ${fil}`);
  return { modell: fil };
}

function kjorNeste() {
  if (prosesser.size) return;
  const neste = (jobbDoc().list || []).find((j) => j.status === "kø");
  if (!neste) return;
  start(neste.id);
}

function start(id) {
  const j = hentJobb(id);
  if (!j) return;
  oppdater(id, { status: "kjører", startet: new Date().toISOString(), fremdrift: 1 });
  logg(id, `starter: ${j.kommando}`);
  let p;
  try {
    p = spawn("bash", ["-lc", j.kommando], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    oppdater(id, { status: "feilet", feil: String(e?.message || e), ferdig: new Date().toISOString() });
    logg(id, `kunne ikke starte prosessen: ${String(e?.message || e)}`);
    return;
  }
  prosesser.set(id, p);

  const lesLinjer = (strom) => {
    let rest = "";
    strom.setEncoding("utf8");
    strom.on("data", (d) => {
      rest += d;
      const deler = rest.split(/\r?\n/);
      rest = deler.pop() || "";
      for (const linje of deler) {
        if (!linje.trim()) continue;
        logg(id, linje.slice(0, 400));
        // Fange opp prosent eller "epoch x/y" fra typiske trenere.
        const pros = linje.match(/(\d{1,3})\s?%/);
        const epoke = linje.match(/epoch[^\d]*(\d+)\s*\/\s*(\d+)/i);
        if (epoke) oppdater(id, { fremdrift: Math.min(99, Math.round((Number(epoke[1]) / Math.max(1, Number(epoke[2]))) * 100)) });
        else if (pros) oppdater(id, { fremdrift: Math.min(99, Number(pros[1])) });
        const onnx = linje.match(/([\w./\-]+\.onnx)/);
        if (onnx) oppdater(id, { modellFil: onnx[1] });
      }
    });
  };
  lesLinjer(p.stdout);
  lesLinjer(p.stderr);

  p.on("close", async (kode) => {
    prosesser.delete(id);
    const gjeldende = hentJobb(id);
    if (gjeldende?.status === "avbrutt") return kjorNeste();
    if (kode === 0) {
      // Let etter en .onnx i utmappa hvis loggen ikke oppga den.
      let modellFil = gjeldende?.modellFil || "";
      if (!modellFil) {
        const filer = await fs.readdir(gjeldende?.utMappe || "", { recursive: true }).catch(() => []);
        const treff = filer.find((f) => String(f).endsWith(".onnx"));
        if (treff) modellFil = path.join(gjeldende.utMappe, String(treff));
      }
      oppdater(id, { status: "ferdig", fremdrift: 100, ferdig: new Date().toISOString(), modellFil });
      logg(id, modellFil ? `ferdig – modell: ${modellFil}` : "ferdig (fant ingen .onnx automatisk)");
    } else {
      oppdater(id, { status: "feilet", feil: `Prosessen avsluttet med kode ${kode}`, ferdig: new Date().toISOString() });
      logg(id, `feilet med kode ${kode}`);
    }
    kjorNeste();
  });
}

export function koStatus() {
  const list = listJobber();
  return {
    jobber: list,
    kjorer: list.find((j) => j.status === "kjører")?.id || "",
    iKo: list.filter((j) => j.status === "kø").length,
  };
}
