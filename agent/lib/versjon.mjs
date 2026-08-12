/**
 * Versjonshåndtering og eksport/import av konfigurasjon.
 *
 * Formålet: du skal kunne ta en «konfig-pakke» fra én Jarvis-installasjon
 * (eller fra HUD-en) og hente den ned til en lokal Jetson-node uten å sette
 * opp alt på nytt. Hemmeligheter (passord, API-nøkler, tokens) blir aldri
 * med ut av maskinen.
 */
import { doc, saveDoc } from "./store.mjs";
import { API_VERSION, CONFIG_BUNDLE_VERSION, CONFIG_DOCS } from "./contract.mjs";
import { createHash } from "node:crypto";
import os from "node:os";

/** Agentens egen versjon – speiler agent/package.json. */
export const AGENT_VERSION = "2.2.0";

/** Felt som ALDRI eksporteres, uansett hvilket dokument de ligger i. */
const HEMMELIGE_FELT = new Set([
  "apiKey",
  "token",
  "botToken",
  "passord",
  "password",
  "hash",
  "salt",
  "secret",
  "privateKey",
]);

function skrubb(value) {
  if (Array.isArray(value)) return value.map(skrubb);
  if (value && typeof value === "object") {
    const ut = {};
    for (const [k, v] of Object.entries(value)) {
      if (HEMMELIGE_FELT.has(k)) continue;
      ut[k] = skrubb(v);
    }
    return ut;
  }
  return value;
}

export function sjekksum(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

/** Full versjonsinfo om denne installasjonen. */
export function versjonsinfo() {
  const cfg = doc("config", { versjon: 0, data: null });
  return {
    agent: AGENT_VERSION,
    api: API_VERSION,
    konfigpakke: CONFIG_BUNDLE_VERSION,
    konfigVersjon: cfg.versjon || 0,
    konfigOppdatert: cfg.oppdatert || null,
    node: process.version,
    vert: os.hostname(),
    plattform: `${os.platform()}/${os.arch()}`,
    oppetidSek: Math.round(process.uptime()),
  };
}

/** Lager en konfig-pakke uten hemmeligheter. */
export function eksporterKonfig(valgte) {
  const navn = (valgte?.length ? valgte : CONFIG_DOCS).filter((n) => CONFIG_DOCS.includes(n));
  const dokumenter = {};
  for (const n of navn) {
    const d = doc(n, null);
    if (d == null) continue;
    dokumenter[n] = skrubb(d);
  }
  const pakke = {
    type: "jarvis-konfig",
    pakkeversjon: CONFIG_BUNDLE_VERSION,
    agent: AGENT_VERSION,
    api: API_VERSION,
    laget: new Date().toISOString(),
    vert: os.hostname(),
    dokumenter,
  };
  return { ...pakke, sjekksum: sjekksum(dokumenter) };
}

/** Ser på en pakke uten å skrive noe – brukes til forhåndsvisning i HUD-en. */
export function inspiserKonfig(pakke) {
  if (!pakke || pakke.type !== "jarvis-konfig")
    throw new Error("Ugyldig konfig-pakke (mangler type: jarvis-konfig).");
  if (Number(pakke.pakkeversjon) > CONFIG_BUNDLE_VERSION)
    throw new Error(
      `Pakken er laget av en nyere versjon (${pakke.pakkeversjon}). Oppdater agenten først.`,
    );
  const dokumenter = pakke.dokumenter && typeof pakke.dokumenter === "object" ? pakke.dokumenter : {};
  const ukjente = Object.keys(dokumenter).filter((n) => !CONFIG_DOCS.includes(n));
  const gyldig = Object.keys(dokumenter).filter((n) => CONFIG_DOCS.includes(n));
  const sjekk = pakke.sjekksum ? pakke.sjekksum === sjekksum(dokumenter) : null;
  return { dokumenter: gyldig, ukjente, sjekksumOk: sjekk, laget: pakke.laget || null, agent: pakke.agent || null };
}

/**
 * Skriver pakken inn i datamappen.
 * modus "flett" (standard) beholder felt som ikke finnes i pakken,
 * modus "erstatt" bytter dokumentet helt ut.
 */
export function importerKonfig(pakke, { modus = "flett", bare } = {}) {
  const info = inspiserKonfig(pakke);
  const valgte = bare?.length ? info.dokumenter.filter((n) => bare.includes(n)) : info.dokumenter;
  const skrevet = [];
  for (const n of valgte) {
    const ny = pakke.dokumenter[n];
    if (modus === "erstatt" || Array.isArray(ny) || typeof ny !== "object" || ny === null) {
      saveDoc(n, ny);
    } else {
      const gammel = doc(n, {});
      saveDoc(n, { ...(gammel && typeof gammel === "object" ? gammel : {}), ...ny });
    }
    skrevet.push(n);
  }
  const cfg = doc("config", { versjon: 0, data: null });
  saveDoc("config", {
    ...cfg,
    versjon: (cfg.versjon || 0) + 1,
    oppdatert: Date.now(),
    siste_import: { tid: Date.now(), fra: pakke.vert || null, dokumenter: skrevet },
  });
  return { ok: true, skrevet, hoppetOver: info.ukjente, sjekksumOk: info.sjekksumOk };
}
