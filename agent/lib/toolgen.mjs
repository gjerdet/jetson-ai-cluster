/**
 * Verktøygenerering i sandkasse for Jarvis.
 * AI-en kan lage nye verktøy som lagres og blir tilgjengelige for fremtidige kjeder.
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";
import { askJson } from "./ai.mjs";
import { remember } from "./memory.mjs";

function db() {
  return doc("generatedTools", { list: [] });
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

const TOOL_TEMPLATE = `Du skal lage et nytt verktøy for Jarvis.
Verktøyet skal være en Node.js-funksjon som tar et objekt "args" og returnerer et objekt.

Svar KUN med JSON på denne formen:
{
  "name": "verktoy_navn",
  "description": "Hva verktøyet gjør",
  "inputSchema": {
    "type": "object",
    "properties": {
      "felt1": { "type": "string", "description": "..." }
    },
    "required": ["felt1"]
  },
  "code": "module.exports = async function(args) { ... }"
}

Krav til koden:
- Ingen nettverk.
- Ingen filoperasjoner utenom /tmp.
- Ingen child_process.
- Kort og forutsigbar kjøretid (maks 5 sekunder).
- Returner alltid { ok: true, resultat: ... } eller { ok: false, feil: ... }.

Brukerens ønske: `;

export async function generateTool(beskrivelse) {
  if (!beskrivelse || typeof beskrivelse !== "string") throw new Error("Beskrivelse må være satt.");
  const parsed = await askJson(`${TOOL_TEMPLATE}${beskrivelse}`, { timeoutMs: 90_000 });
  const tool = {
    id: randomUUID(),
    tid: Date.now(),
    name: String(parsed.name || "generert_verktoy").slice(0, 32),
    description: String(parsed.description || "").slice(0, 500),
    inputSchema: parsed.inputSchema || { type: "object", properties: {}, required: [] },
    code: String(parsed.code || "").slice(0, 10000),
    enabled: false, // Må testes og godkjennes før aktivering
    testet: false,
    testResult: null,
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
 * Kjør et generert verktøy i en isolert Node VM uten nettverk/filsystem.
 */
export async function testTool(id, args = {}) {
  const tool = getGeneratedTool(id);
  if (!tool) throw new Error("Fant ikke verktøyet.");

  const vm = await import("node:vm");
  const context = vm.createContext({
    console: { log: () => {}, error: () => {}, warn: () => {} },
    args,
    module: { exports: {} },
    exports: {},
    require: () => {
      throw new Error("require er ikke tillatt i genererte verktøy.");
    },
    setTimeout: () => {
      throw new Error("setTimeout er ikke tillatt.");
    },
    setInterval: () => {
      throw new Error("setInterval er ikke tillatt.");
    },
  });

  const script = new vm.Script(tool.code, { timeout: 5000 });
  try {
    script.runInContext(context);
    const fn = context.module.exports;
    if (typeof fn !== "function") throw new Error("Verktøyet eksporterer ikke en funksjon.");
    const resultat = await Promise.race([
      fn(args),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Tidsavbrudd")), 5000)),
    ]);
    tool.testet = true;
    tool.testResult = { ok: true, resultat };
    tool.enabled = true;
    persist(db());
    return tool.testResult;
  } catch (e) {
    tool.testet = true;
    tool.testResult = { ok: false, feil: String(e?.message || e) };
    persist(db());
    throw new Error(`Verktøyet feilet: ${tool.testResult.feil}`);
  }
}

export function enableTool(id, enabled) {
  const d = db();
  const t = d.list.find((x) => x.id === id);
  if (!t) throw new Error("Fant ikke verktøyet.");
  t.enabled = !!enabled;
  persist(d);
  return t;
}
