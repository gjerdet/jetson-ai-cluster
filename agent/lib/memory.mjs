/**
 * Vedvarende episodisk minne for Jarvis.
 * Lagrer hendelser, beslutninger, fakta og erfaringer i data/memory.json.
 * Henting skjer via nøkkelord + viktighet + recency (embedding kan kobles på senere).
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";

const DEFAULT_TTL_DAYS = 90;
const MAX_ITEMS = 2000;

export const MEMORY_TYPES = ["hendelse", "beslutning", "faktum", "erfaring", "mål", "plan"];

function db() {
  return doc("memory", { list: [], index: {} });
}

function persist(item) {
  saveDoc("memory", item);
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function score(item, queryWords) {
  const words = normalize(item.tekst + " " + (item.kontekst || "") + " " + (item.tag || ""));
  const matches = queryWords.filter((w) => words.includes(w)).length;
  const daysOld = (Date.now() - item.tid) / 86_400_000;
  const recency = Math.max(0.1, 1 - daysOld / DEFAULT_TTL_DAYS);
  const importance = Math.max(0.1, Math.min(1, (item.viktighet || 5) / 10));
  return matches * recency * importance * (item.pinned ? 2 : 1);
}

export function remember({
  tekst,
  type = "hendelse",
  kontekst = "",
  kilder = [],
  viktighet = 5,
  ttlDager = DEFAULT_TTL_DAYS,
  pinned = false,
  tag = "",
}) {
  if (!tekst || typeof tekst !== "string") throw new Error("Minnet må ha tekst.");
  const item = {
    id: randomUUID(),
    tid: Date.now(),
    type: MEMORY_TYPES.includes(type) ? type : "hendelse",
    tekst: tekst.slice(0, 2000),
    kontekst: String(kontekst || "").slice(0, 1000),
    kilder: Array.isArray(kilder) ? kilder.map(String).slice(0, 10) : [],
    viktighet: Math.max(1, Math.min(10, Number(viktighet) || 5)),
    utløp: Date.now() + Math.max(1, Number(ttlDager) || DEFAULT_TTL_DAYS) * 86_400_000,
    pinned: !!pinned,
    tag: String(tag || "").slice(0, 100),
  };
  const d = db();
  d.list.unshift(item);
  // Hold listen innenfor grensen, behold pinned lengst.
  d.list = [...d.list.filter((m) => m.pinned), ...d.list.filter((m) => !m.pinned)].slice(0, MAX_ITEMS);
  persist(d);
  return item;
}

/** Erstatter et dynamisk systemfaktum i stedet for å samle utdaterte kopier. */
export function rememberCurrent({ tag, ...input }) {
  const key = String(tag || "").trim();
  if (!key) throw new Error("Et løpende systemminne må ha tag.");
  const d = db();
  d.list = d.list.filter((item) => item.tag !== key);
  persist(d);
  return remember({ ...input, tag: key });
}

export function recall(query, { topK = 5, type, fra, til } = {}) {
  const q = normalize(query);
  let list = db().list;
  if (type) list = list.filter((m) => m.type === type);
  if (fra) list = list.filter((m) => m.tid >= Number(fra));
  if (til) list = list.filter((m) => m.tid <= Number(til));
  return list
    .map((m) => ({ ...m, score: score(m, q) }))
    .filter((m) => m.score > 0 || q.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, ...rest }) => rest);
}

export function timeline({ limit = 50, type } = {}) {
  let list = db().list;
  if (type) list = list.filter((m) => m.type === type);
  return list.slice(0, limit);
}

export function getMemory(id) {
  return db().list.find((m) => m.id === id);
}

export function forget(id) {
  const d = db();
  const before = d.list.length;
  d.list = d.list.filter((m) => m.id !== id);
  if (d.list.length !== before) persist(d);
  return { fjernet: before - d.list.length };
}

export function pruneExpired() {
  const d = db();
  const now = Date.now();
  const before = d.list.length;
  d.list = d.list.filter((m) => m.pinned || m.utløp > now);
  if (d.list.length !== before) persist(d);
  return { fjernet: before - d.list.length, gjenstaende: d.list.length };
}

export function memoryStats() {
  const d = db();
  const perType = {};
  for (const m of d.list) perType[m.type] = (perType[m.type] || 0) + 1;
  return { antall: d.list.length, perType, maks: MAX_ITEMS };
}

/**
 * Bygger en kompakt minnekontekst som kan injiseres i systemprompten.
 */
export function memoryContext(query, { topK = 5, maksLengde = 1500 } = {}) {
  const relevant = recall(query, { topK });
  if (!relevant.length) return "";
  const tekst = relevant
    .map((m) => `[${new Date(m.tid).toISOString().slice(0, 16)} ${m.type}] ${m.tekst}`)
    .join("\n");
  return tekst.length > maksLengde ? tekst.slice(0, maksLengde) + "\n…" : tekst;
}
