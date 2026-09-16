/**
 * Daglig selvforbedring for Jarvis.
 *  - Dagskort: måler egen framgang hvert døgn (verktøyfeil, selvtest, kunnskap, regler).
 *  - Retrospektiv: analyserer gårsdagen og bestemmer selv hva han skal gjøre bedre.
 *  - Selvendring av kode: skriver forslag til sine egne filer, syntakstester dem,
 *    lagrer dem som forslag med sikkerhetskopi – ingenting skrives uten godkjenning
 *    (eller AUTO-modus som brukeren selv slår på).
 * Alt lokalt. Hver endring får revisjonspost og kan rulles tilbake.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { doc, saveDoc, DATA_DIR } from "./store.mjs";
import { askJson } from "./ai.mjs";
import { toolStats } from "./toolgen.mjs";
import { laeringStatus, listHull } from "./selvlaering.mjs";

const HER = path.dirname(fileURLToPath(import.meta.url));
/** Rot for agentkoden (agent/). */
export const KODE_ROT = path.resolve(HER, "..");
const BACKUP_DIR = path.join(DATA_DIR, "selvkode-backup");

/** Filer Jarvis har lov til å endre på seg selv. */
const TILLATTE_MAPPER = ["lib", "scripts", "."];
const TILLATTE_ENDELSER = [".mjs", ".js"];
/** Filer som aldri kan endres av ham selv (fare for å låse seg ute). */
const FREDET = new Set(["lib/auth.mjs", "lib/secrets.mjs", "lib/security.mjs", "lib/selvforbedring.mjs", "server.mjs", "motor.mjs"]);

function db() {
  return doc("selvforbedring", { dager: [], kodeforslag: [], auto: false, sisteRetro: 0 });
}

function persist(d) {
  saveDoc("selvforbedring", d);
}

export function erAuto() {
  return !!db().auto;
}

export function settAuto(verdi) {
  const d = db();
  d.auto = !!verdi;
  persist(d);
  return { auto: d.auto };
}

function idag() {
  return new Date().toISOString().slice(0, 10);
}

// ---- dagskort ----------------------------------------------------------

/** Nåværende måltall for hvor god han er. */
export function maalinger() {
  const verktoy = toolStats();
  const kall = verktoy.reduce((n, v) => n + (v.kall || 0), 0);
  const feil = verktoy.reduce((n, v) => n + (v.feil || 0), 0);
  const evalueringer = (doc("evaluations", { list: [] }).list || []).slice(0, 50);
  const scorer = evalueringer.map((e) => Number(e.score ?? e.poeng ?? NaN)).filter((n) => Number.isFinite(n));
  const laering = (() => {
    try {
      return laeringStatus() || {};
    } catch {
      return {};
    }
  })();
  return {
    dato: idag(),
    tid: Date.now(),
    verktoyKall: kall,
    verktoyFeilrate: kall ? Math.round((feil / kall) * 100) : 0,
    svarScore: scorer.length ? Math.round((scorer.reduce((a, b) => a + b, 0) / scorer.length) * 10) / 10 : null,
    apneHull: (() => {
      try {
        return listHull(100).filter((h) => h.status !== "lukket").length;
      } catch {
        return 0;
      }
    })(),
    kunnskapsbiter: Number(laering.biter ?? laering.kunnskapsbiter ?? 0),
    selvtestScore: Number(laering.sisteScore ?? laering.score ?? 0) || null,
    regler: (doc("laering", { regler: [] }).regler || []).filter((r) => r.aktiv !== false).length,
  };
}

/** Lagrer dagens måltall og returnerer endring siden forrige dag. */
export function dagsRapport() {
  const d = db();
  const m = maalinger();
  const forrige = (d.dager || []).find((x) => x.dato !== m.dato) || null;
  d.dager = [m, ...(d.dager || []).filter((x) => x.dato !== m.dato)].slice(0, 120);
  persist(d);
  const diff = forrige
    ? {
        verktoyFeilrate: m.verktoyFeilrate - forrige.verktoyFeilrate,
        apneHull: m.apneHull - forrige.apneHull,
        kunnskapsbiter: m.kunnskapsbiter - forrige.kunnskapsbiter,
        regler: m.regler - forrige.regler,
        svarScore: m.svarScore != null && forrige.svarScore != null ? Math.round((m.svarScore - forrige.svarScore) * 10) / 10 : null,
      }
    : null;
  return { idag: m, forrige, endring: diff };
}

export function listDager(limit = 30) {
  return (db().dager || []).slice(0, limit);
}

// ---- retrospektiv ------------------------------------------------------

/**
 * Ser på egen framgang og bestemmer hva han skal gjøre bedre.
 * Returnerer jobber som skal legges i forbedringskøen.
 */
export async function retrospektiv({ maksJobber = 5 } = {}) {
  const r = dagsRapport();
  const verktoy = toolStats().slice(0, 8);
  const hull = (() => {
    try {
      return listHull(10).map((h) => h.tema).filter(Boolean);
    } catch {
      return [];
    }
  })();

  const parsed = await askJson(
    `Du er en lokal AI-agent som skal bli litt bedre hver dag, helt på egen hånd.\n` +
      `Måltall i dag: ${JSON.stringify(r.idag)}\n` +
      `Endring siden i går: ${JSON.stringify(r.endring)}\n` +
      `Verktøystatistikk: ${JSON.stringify(verktoy)}\n` +
      `Åpne kunnskapshull: ${JSON.stringify(hull)}\n\n` +
      `Velg maks ${maksJobber} konkrete tiltak som gjør deg bedre i morgen.\n` +
      `Svar KUN med JSON:\n` +
      `Ett av tiltakene SKAL være «verktoy-ovelse» – å øve på et ekte verktøykall (f.eks. vær) og lære av feil.\n` +
      `{"vurdering":"kort setning","jobber":[{"type":"laer-om|bygg-verktoy|reparer-verktoy|verktoy-ovelse|selvtest|kodeforbedring","tekst":"...","hvorfor":"...","prioritet":1-10,"fil":"lib/xxx.mjs (kun for kodeforbedring)","navn":"vaer (kun for verktoy-ovelse)"}]}`,
    { timeoutMs: 120_000 },
  ).catch(() => ({ vurdering: "", jobber: [] }));

  const jobber = (parsed.jobber || [])
    .slice(0, maksJobber)
    .map((j) => ({
      type: ["laer-om", "bygg-verktoy", "reparer-verktoy", "selvtest", "kodeforbedring"].includes(String(j.type)) ? String(j.type) : "laer-om",
      tekst: String(j.tekst || "").slice(0, 300),
      prioritet: Math.min(10, Math.max(1, Number(j.prioritet) || 5)),
      data: { tema: String(j.tekst || "").slice(0, 120), hvorfor: String(j.hvorfor || "").slice(0, 200), fil: String(j.fil || "").slice(0, 120), beskrivelse: String(j.tekst || "").slice(0, 300) },
    }))
    .filter((j) => j.tekst);

  const d = db();
  d.sisteRetro = Date.now();
  persist(d);
  return { vurdering: String(parsed.vurdering || "").slice(0, 300), jobber, maal: r };
}

/** Sant når det er over et døgn siden forrige retrospektiv. */
export function trengerRetrospektiv() {
  return Date.now() - Number(db().sisteRetro || 0) > 20 * 60 * 60 * 1000;
}

// ---- selvendring av egen kode -----------------------------------------

function trygtRelativt(relativ) {
  const rel = String(relativ || "").replace(/^\/+/, "").trim();
  if (!rel || rel.includes("..")) throw new Error("Ugyldig filsti.");
  if (FREDET.has(rel)) throw new Error(`«${rel}» er fredet og kan ikke endres av agenten selv.`);
  if (!TILLATTE_ENDELSER.some((e) => rel.endsWith(e))) throw new Error("Bare .mjs/.js-filer kan endres.");
  const mappe = rel.includes("/") ? rel.split("/")[0] : ".";
  if (!TILLATTE_MAPPER.includes(mappe)) throw new Error(`Mappen «${mappe}» er utenfor agentkoden.`);
  const full = path.resolve(KODE_ROT, rel);
  if (!full.startsWith(KODE_ROT + path.sep)) throw new Error("Filstien peker utenfor agentkoden.");
  return { rel, full };
}

/** Filer agenten kan velge mellom. */
export function egneFiler() {
  const ut = [];
  for (const mappe of ["lib", "."]) {
    const dir = path.resolve(KODE_ROT, mappe);
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())) {
      const rel = mappe === "." ? f.name : `${mappe}/${f.name}`;
      if (!TILLATTE_ENDELSER.some((e) => rel.endsWith(e))) continue;
      if (FREDET.has(rel)) continue;
      if (rel.endsWith(".test.mjs")) continue;
      let bytes = 0;
      try {
        bytes = fs.statSync(path.resolve(KODE_ROT, rel)).size;
      } catch {
        bytes = 0;
      }
      ut.push({ fil: rel, bytes });
    }
  }
  return ut.sort((a, b) => a.fil.localeCompare(b.fil));
}

function syntaksSjekk(kode) {
  return new Promise((resolve) => {
    const tmp = path.join(DATA_DIR, `.syntaks-${Date.now()}.mjs`);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(tmp, kode);
    } catch (e) {
      return resolve({ ok: false, feil: String(e?.message || e) });
    }
    execFile(process.execPath, ["--check", tmp], { timeout: 20_000 }, (err, _out, stderr) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignorer */
      }
      resolve(err ? { ok: false, feil: String(stderr || err.message).slice(0, 600) } : { ok: true, feil: "" });
    });
  });
}

/**
 * Lager et forslag til endring i egen kode. Skriver ingenting til kildefila.
 */
export async function lagKodeforslag(beskrivelse, { fil = "" } = {}) {
  const onske = String(beskrivelse || "").trim();
  if (!onske) throw new Error("Mangler beskrivelse av hva som skal forbedres.");

  let valgt = String(fil || "").trim();
  if (!valgt) {
    const svar = await askJson(
      `Her er filene i min egen kodebase:\n${egneFiler().map((f) => `- ${f.fil} (${f.bytes} b)`).join("\n")}\n\n` +
        `Oppgave: ${onske}\nHvilken ÉN fil bør endres? Svar KUN med JSON: {"fil":"lib/xxx.mjs","hvorfor":"..."}`,
      { timeoutMs: 90_000 },
    ).catch(() => ({}));
    valgt = String(svar.fil || "").trim();
  }
  const { rel, full } = trygtRelativt(valgt);
  const original = fs.readFileSync(full, "utf8");
  if (original.length > 60_000) throw new Error(`«${rel}» er for stor til trygg selvendring.`);

  const svar = await askJson(
    `Du endrer din egen kildekode (Node ESM). Oppgave: ${onske}\n` +
      `Fil: ${rel}\n--- NÅVÆRENDE INNHOLD ---\n${original}\n--- SLUTT ---\n\n` +
      `Skriv HELE den nye fila. Behold eksisterende eksporter og norsk kommentarstil. Ikke fjern funksjonalitet.\n` +
      `Svar KUN med JSON: {"kode":"<hele fila>","sammendrag":"hva du endret","risiko":"lav|middels|høy"}`,
    { timeoutMs: 240_000 },
  );

  const kode = String(svar.kode || "");
  if (kode.length < 50) throw new Error("Modellen leverte ikke brukbar kode.");
  const sjekk = await syntaksSjekk(kode);

  const d = db();
  const forslag = {
    id: `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    tid: Date.now(),
    fil: rel,
    onske,
    sammendrag: String(svar.sammendrag || "").slice(0, 400),
    risiko: ["lav", "middels", "høy"].includes(String(svar.risiko)) ? String(svar.risiko) : "middels",
    linjerFor: original.split("\n").length,
    linjerEtter: kode.split("\n").length,
    kode,
    syntaksOk: sjekk.ok,
    syntaksFeil: sjekk.feil,
    status: sjekk.ok ? "venter" : "forkastet",
  };
  d.kodeforslag = [forslag, ...(d.kodeforslag || [])].slice(0, 40);
  persist(d);
  return { ...forslag, kode: undefined, harKode: true };
}

export function listKodeforslag(limit = 20) {
  return (db().kodeforslag || []).slice(0, limit).map((f) => ({ ...f, kode: undefined, harKode: !!f.kode }));
}

export function hentKodeforslag(id) {
  const f = (db().kodeforslag || []).find((x) => x.id === id);
  if (!f) throw new Error("Fant ikke kodeforslaget.");
  return f;
}

/** Skriver forslaget til fila etter sikkerhetskopi. Krever omstart av tjenesten. */
export function godkjennKodeforslag(id) {
  const d = db();
  const f = (d.kodeforslag || []).find((x) => x.id === id);
  if (!f) throw new Error("Fant ikke kodeforslaget.");
  if (f.status === "iverksatt") throw new Error("Forslaget er allerede tatt i bruk.");
  if (!f.syntaksOk) throw new Error("Koden består ikke syntakssjekken.");
  const { full } = trygtRelativt(f.fil);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const kopi = path.join(BACKUP_DIR, `${f.id}-${f.fil.replace(/\//g, "_")}`);
  fs.copyFileSync(full, kopi);
  fs.writeFileSync(full, f.kode);
  f.status = "iverksatt";
  f.backup = kopi;
  f.iverksatt = Date.now();
  persist(d);
  return { ...f, kode: undefined, omstartKreves: true };
}

export function avvisKodeforslag(id) {
  const d = db();
  const f = (d.kodeforslag || []).find((x) => x.id === id);
  if (!f) throw new Error("Fant ikke kodeforslaget.");
  f.status = "avvist";
  persist(d);
  return { ...f, kode: undefined };
}

/** Legger tilbake den gamle fila fra sikkerhetskopien. */
export function rullTilbakeKode(id) {
  const d = db();
  const f = (d.kodeforslag || []).find((x) => x.id === id);
  if (!f) throw new Error("Fant ikke kodeforslaget.");
  if (f.status !== "iverksatt" || !f.backup) throw new Error("Denne endringen er ikke i bruk.");
  const { full } = trygtRelativt(f.fil);
  fs.copyFileSync(f.backup, full);
  f.status = "tilbakerullet";
  persist(d);
  return { ...f, kode: undefined, omstartKreves: true };
}

export function selvforbedringStatus() {
  const d = db();
  return {
    auto: !!d.auto,
    sisteRetro: Number(d.sisteRetro || 0),
    dager: (d.dager || []).slice(0, 14),
    idag: (d.dager || [])[0] || null,
    kodeforslag: listKodeforslag(10),
    filer: (() => {
      try {
        return egneFiler().length;
      } catch {
        return 0;
      }
    })(),
  };
}
