/**
 * Verktøygenerering i sandkasse for Jarvis.
 * Lukket sløyfe: beskrivelse → generer → test i sandkasse → les feil → forbedre → test igjen.
 * Verktøy versjoneres, får bruksstatistikk og kan rulles tilbake.
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";
import { askJson } from "./ai.mjs";
import { remember } from "./memory.mjs";
import { kjorISandkasse } from "./sandkasse.mjs";

function db() {
  return doc("generatedTools", { list: [], statistikk: {} });
}

function persist(item) {
  saveDoc("generatedTools", item);
}

export function listGeneratedTools() {
  return db().list;
}

export function getGeneratedTool(id) {
  return db().list.find((t) => t.id === id);
}

export function deleteGeneratedTool(id) {
  const d = db();
  const before = d.list.length;
  d.list = d.list.filter((t) => t.id !== id);
  if (d.list.length !== before) persist(d);
  return { fjernet: before - d.list.length };
}

/** Bruksstatistikk per verktøy: antall kall, feilrate, snittid. */
export function recordUsage(navn, { ok = true, ms = 0, feil = "" } = {}) {
  if (!navn) return;
  const d = db();
  d.statistikk = d.statistikk || {};
  const s = d.statistikk[navn] || { kall: 0, feil: 0, sumMs: 0, sisteFeil: "" };
  s.kall += 1;
  if (!ok) {
    s.feil += 1;
    s.sisteFeil = String(feil).slice(0, 300);
    s.sisteFeilTid = Date.now();
  }
  s.sumMs += Number(ms) || 0;
  s.sist = Date.now();
  d.statistikk[navn] = s;
  persist(d);
}

export function toolStats() {
  const s = db().statistikk || {};
  return Object.entries(s)
    .map(([navn, v]) => ({
      navn,
      kall: v.kall,
      feil: v.feil,
      feilrate: v.kall ? Math.round((v.feil / v.kall) * 100) : 0,
      snittMs: v.kall ? Math.round(v.sumMs / v.kall) : 0,
      sisteFeil: v.sisteFeil || "",
      sist: v.sist || 0,
    }))
    .sort((a, b) => b.feilrate - a.feilrate || b.kall - a.kall);
}

/** Verktøy som bør repareres (feilrate over 30 % og minst 3 kall). */
export function verktoyMedProblemer() {
  return toolStats().filter((t) => t.kall >= 3 && t.feilrate >= 30);
}

const TOOL_TEMPLATE = `Du skal lage et nytt verktøy for Jarvis.
Verktøyet er en Node.js-funksjon som tar et objekt "args" og returnerer et objekt.

Svar KUN med JSON på denne formen:
{
  "name": "verktoy_navn",
  "description": "Hva verktøyet gjør",
  "inputSchema": {"type":"object","properties":{"felt1":{"type":"string"}},"required":["felt1"]},
  "testArgs": {"felt1": "eksempelverdi"},
  "code": "module.exports = async function(args) { ... }"
}

Krav til koden:
- Kjøres i en sandkasse: du har global fetch, men KUN lesende GET/HEAD mot lokale adresser
  (127.0.0.1, 10.x, 192.168.x, 172.16-31.x, *.local). Internett og skriving er blokkert.
- Ingen require, ingen filsystem, ingen child_process.
- Maks 8 sekunder kjøretid og maks 8 utgående kall.
- Returner alltid { ok: true, resultat: ... } eller { ok: false, feil: ... }.

Brukerens ønske: `;

function normaliser(parsed) {
  return {
    name: String(parsed.name || "generert_verktoy").slice(0, 32),
    description: String(parsed.description || "").slice(0, 500),
    inputSchema: parsed.inputSchema || { type: "object", properties: {}, required: [] },
    testArgs: parsed.testArgs && typeof parsed.testArgs === "object" ? parsed.testArgs : {},
    code: String(parsed.code || "").slice(0, 12000),
  };
}

export async function generateTool(beskrivelse) {
  if (!beskrivelse || typeof beskrivelse !== "string") throw new Error("Beskrivelse må være satt.");
  const parsed = normaliser(await askJson(`${TOOL_TEMPLATE}${beskrivelse}`, { timeoutMs: 90_000 }));
  const tool = {
    id: randomUUID(),
    tid: Date.now(),
    beskrivelse,
    ...parsed,
    enabled: false,
    testet: false,
    testResult: null,
    versjoner: [],
  };
  const d = db();
  d.list.unshift(tool);
  persist(d);
  remember({
    tekst: `Genererte verktøyet «${tool.name}» på forespørsel: ${beskrivelse}`,
    type: "erfaring",
    kontekst: `tool-id ${tool.id}`,
    viktighet: 5,
  });
  return tool;
}

/**
 * Lukket sløyfe: generer, test i sandkassen, gi feilmeldingen tilbake til modellen,
 * forbedre, test igjen. Aktiverer verktøyet først når en test faktisk går grønt.
 */
export async function byggVerktoy(beskrivelse, { runder = 3 } = {}) {
  const historikk = [];
  let tool = await generateTool(beskrivelse);

  for (let i = 0; i < Math.max(1, Math.min(runder, 4)); i++) {
    const res = await kjorISandkasse(tool.code, tool.testArgs || {});
    historikk.push({ runde: i + 1, ok: res.ok, detalj: res.ok ? res.resultat : res.feil, logg: res.logg });

    const d = db();
    const lagret = d.list.find((t) => t.id === tool.id);
    if (lagret) {
      lagret.testet = true;
      lagret.testResult = res.ok ? { ok: true, resultat: res.resultat } : { ok: false, feil: res.feil };
      lagret.enabled = res.ok;
      lagret.historikk = historikk;
      persist(d);
    }

    if (res.ok) return { ok: true, verktoy: lagret ?? tool, runder: i + 1, historikk };

    // Be modellen rette feilen og prøv igjen.
    const forbedret = await askJson(
      `${TOOL_TEMPLATE}${beskrivelse}\n\nForrige forsøk feilet i sandkassen med:\n${res.feil}\n\nKode som feilet:\n${tool.code}\n\nRett feilen og svar med hele JSON-objektet på nytt.`,
      { timeoutMs: 90_000 },
    ).catch(() => null);
    if (!forbedret) break;
    const neste = normaliser(forbedret);
    const d2 = db();
    const l2 = d2.list.find((t) => t.id === tool.id);
    if (l2) {
      l2.versjoner = [{ tid: Date.now(), code: l2.code, feil: res.feil }, ...(l2.versjoner || [])].slice(0, 10);
      Object.assign(l2, neste);
      persist(d2);
      tool = l2;
    } else {
      tool = { ...tool, ...neste };
    }
  }

  return { ok: false, verktoy: getGeneratedTool(tool.id) ?? tool, historikk };
}

/** Ruller verktøyet tilbake til forrige versjon. */
export function rollbackTool(id) {
  const d = db();
  const t = d.list.find((x) => x.id === id);
  if (!t) throw new Error("Fant ikke verktøyet.");
  const forrige = (t.versjoner || [])[0];
  if (!forrige) throw new Error("Verktøyet har ingen tidligere versjon.");
  t.versjoner = t.versjoner.slice(1);
  t.code = forrige.code;
  t.enabled = false;
  t.testet = false;
  persist(d);
  return t;
}

/** Kjør et generert verktøy i sandkassen. */
export async function testTool(id, args = {}) {
  const tool = getGeneratedTool(id);
  if (!tool) throw new Error("Fant ikke verktøyet.");
  const res = await kjorISandkasse(tool.code, Object.keys(args).length ? args : tool.testArgs || {});
  const d = db();
  const lagret = d.list.find((t) => t.id === id);
  if (lagret) {
    lagret.testet = true;
    lagret.testResult = res.ok ? { ok: true, resultat: res.resultat } : { ok: false, feil: res.feil };
    if (res.ok) lagret.enabled = true;
    persist(d);
  }
  recordUsage(tool.name, { ok: res.ok, ms: res.ms, feil: res.feil });
  if (!res.ok) throw new Error(`Verktøyet feilet: ${res.feil}`);
  return { ok: true, resultat: res.resultat, logg: res.logg, utskrift: res.utskrift };
}

/** Kjør et aktivert, generert verktøy (brukes av chat-loopen). */
export async function runGeneratedTool(navn, args = {}) {
  const tool = db().list.find((t) => t.name === navn && t.enabled);
  if (!tool) throw new Error(`Verktøyet «${navn}» finnes ikke eller er ikke aktivert.`);
  const res = await kjorISandkasse(tool.code, args);
  recordUsage(navn, { ok: res.ok, ms: res.ms, feil: res.feil });
  if (!res.ok) throw new Error(res.feil);
  return res.resultat;
}

export function enableTool(id, enabled) {
  const d = db();
  const t = d.list.find((x) => x.id === id);
  if (!t) throw new Error("Fant ikke verktøyet.");
  t.enabled = !!enabled;
  persist(d);
  return t;
}
