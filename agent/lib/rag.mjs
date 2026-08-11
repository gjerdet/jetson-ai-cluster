/**
 * Lokal kunnskapsbase (RAG) for Jarvis.
 *  - dokumenter deles i biter (chunks)
 *  - hver bit får en vektor-embedding fra en lokal modell (Ollama e.l.)
 *  - alt lagres i SQLite under AGENT_DATA/kunnskap.db
 *
 * Ingen sky: embeddings hentes fra den adressen du selv setter,
 * som standard Ollama på samme maskin.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { DATA_DIR, doc, saveDoc } from "./store.mjs";

const DB_FILE = path.join(DATA_DIR, "kunnskap.db");

export const RAG_DEFAULTS = {
  aktiv: true,
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "nomic-embed-text",
  apiKey: "",
  bitStorrelse: 900,
  overlapp: 150,
  topK: 5,
  minPoeng: 0.2,
};

export const ragConfig = () => ({ ...RAG_DEFAULTS, ...(doc("rag", {}) || {}) });
export function saveRagConfig(input = {}) {
  const c = ragConfig();
  const next = {
    aktiv: input.aktiv != null ? !!input.aktiv : c.aktiv,
    baseUrl: String(input.baseUrl ?? c.baseUrl).trim().slice(0, 300),
    model: String(input.model ?? c.model).trim().slice(0, 120),
    apiKey: input.apiKey != null ? String(input.apiKey).slice(0, 500) : c.apiKey,
    bitStorrelse: clamp(Number(input.bitStorrelse ?? c.bitStorrelse), 200, 4000),
    overlapp: clamp(Number(input.overlapp ?? c.overlapp), 0, 1000),
    topK: clamp(Number(input.topK ?? c.topK), 1, 20),
    minPoeng: clamp(Number(input.minPoeng ?? c.minPoeng), 0, 1),
  };
  saveDoc("rag", next);
  return next;
}
const clamp = (n, min, maks) => (Number.isFinite(n) ? Math.min(maks, Math.max(min, n)) : min);

// ---------------------------------------------------------------- database
let db = null;
let sqliteMod = null;

/** node:sqlite er innebygd fra Node 22 og krever ingen npm-pakke. */
function loadSqlite() {
  if (sqliteMod) return sqliteMod;
  try {
    sqliteMod = createRequire(import.meta.url)("node:sqlite");
  } catch {
    throw new Error("node:sqlite mangler. Kjør agenten med Node 22 eller nyere for å bruke kunnskapsbasen.");
  }
  return sqliteMod;
}

export function initRag() {
  if (db) return db;
  const { DatabaseSync } = loadSqlite();
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dokumenter (
      id TEXT PRIMARY KEY,
      tittel TEXT NOT NULL,
      kilde TEXT DEFAULT '',
      type TEXT DEFAULT 'tekst',
      tegn INTEGER DEFAULT 0,
      opprettet INTEGER NOT NULL,
      tekst TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS biter (
      id TEXT PRIMARY KEY,
      dok_id TEXT NOT NULL,
      nr INTEGER NOT NULL,
      tekst TEXT NOT NULL,
      vektor TEXT,
      model TEXT
    );
    CREATE INDEX IF NOT EXISTS biter_dok ON biter(dok_id);
  `);
  return db;
}

// ---------------------------------------------------------------- chunking
/** Deler tekst i biter på setnings-/avsnittsgrenser med litt overlapp. */
export function chunkText(tekst, storrelse = 900, overlapp = 150) {
  const clean = String(tekst || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  const stykker = clean.split(/\n\n+/);
  const biter = [];
  let buffer = "";
  const push = () => {
    const t = buffer.trim();
    if (t) biter.push(t);
    buffer = overlapp > 0 ? t.slice(-overlapp) : "";
  };
  for (const s of stykker) {
    if (s.length > storrelse) {
      for (const setning of s.split(/(?<=[.!?])\s+/)) {
        if (buffer.length + setning.length > storrelse) push();
        buffer += (buffer ? " " : "") + setning;
      }
      continue;
    }
    if (buffer.length + s.length > storrelse) push();
    buffer += (buffer ? "\n\n" : "") + s;
  }
  const rest = buffer.trim();
  if (rest) biter.push(rest);
  return biter.filter((b, i, a) => b.length > 20 || a.length === 1);
}

// -------------------------------------------------------------- embeddings
/** Henter vektorer fra den lokale embedding-modellen. Tom liste = ikke tilgjengelig. */
export async function embed(tekster, cfg = ragConfig()) {
  if (!tekster.length) return [];
  const url = `${String(cfg.baseUrl).replace(/\/+$/, "")}/embeddings`;
  const ut = [];
  // små grupper slik at en Jetson ikke går tom for minne
  for (let i = 0; i < tekster.length; i += 16) {
    const gruppe = tekster.slice(i, i + 16);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, input: gruppe }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Embedding-modellen svarte ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const rad of data.data || []) ut.push(rad.embedding);
  }
  return ut;
}

const cos = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** Reservesøk når embeddings ikke er tilgjengelig: enkel ordoverlapp. */
function keywordScore(sporsmal, tekst) {
  const ord = [...new Set(sporsmal.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])];
  if (!ord.length) return 0;
  const lav = tekst.toLowerCase();
  let treff = 0;
  for (const o of ord) if (lav.includes(o)) treff++;
  return treff / ord.length;
}

// ---------------------------------------------------------------- dokument
export async function addDocument({ tittel, tekst, kilde = "", type = "tekst" }) {
  initRag();
  const cfg = ragConfig();
  const rein = String(tekst || "").trim();
  if (!rein) throw new Error("Dokumentet er tomt.");
  const id = randomUUID();
  const nå = Date.now();
  db.prepare(
    "INSERT INTO dokumenter (id, tittel, kilde, type, tegn, opprettet, tekst) VALUES (?,?,?,?,?,?,?)",
  ).run(id, String(tittel || "Uten tittel").slice(0, 300), String(kilde).slice(0, 500), String(type).slice(0, 40), rein.length, nå, rein);

  const biter = chunkText(rein, cfg.bitStorrelse, cfg.overlapp);
  let vektorer = [];
  let embedFeil = null;
  try {
    vektorer = await embed(biter, cfg);
  } catch (e) {
    embedFeil = String(e?.message || e);
  }
  const stmt = db.prepare("INSERT INTO biter (id, dok_id, nr, tekst, vektor, model) VALUES (?,?,?,?,?,?)");
  biter.forEach((b, i) => {
    const v = vektorer[i];
    stmt.run(randomUUID(), id, i, b, v ? JSON.stringify(v) : null, v ? cfg.model : null);
  });
  return { dokument: getDocument(id), biter: biter.length, embedFeil };
}

export function getDocument(id) {
  initRag();
  const r = db
    .prepare("SELECT id, tittel, kilde, type, tegn, opprettet FROM dokumenter WHERE id = ?")
    .get(id);
  if (!r) return null;
  const c = db.prepare("SELECT COUNT(*) AS n, SUM(vektor IS NOT NULL) AS v FROM biter WHERE dok_id = ?").get(id);
  return { ...r, biter: Number(c?.n || 0), vektorer: Number(c?.v || 0) };
}

export function listDocuments() {
  initRag();
  const rader = db
    .prepare("SELECT id, tittel, kilde, type, tegn, opprettet FROM dokumenter ORDER BY opprettet DESC")
    .all();
  const tellinger = db
    .prepare("SELECT dok_id, COUNT(*) AS n, SUM(vektor IS NOT NULL) AS v FROM biter GROUP BY dok_id")
    .all();
  const kart = new Map(tellinger.map((t) => [t.dok_id, t]));
  return rader.map((r) => ({
    ...r,
    biter: Number(kart.get(r.id)?.n || 0),
    vektorer: Number(kart.get(r.id)?.v || 0),
  }));
}

export function deleteDocument(id) {
  initRag();
  db.prepare("DELETE FROM biter WHERE dok_id = ?").run(id);
  const r = db.prepare("DELETE FROM dokumenter WHERE id = ?").run(id);
  return Number(r.changes || 0) > 0;
}

/** Lager embeddings på nytt for alle biter (f.eks. etter modellbytte). */
export async function reindex() {
  initRag();
  const cfg = ragConfig();
  const biter = db.prepare("SELECT id, tekst FROM biter").all();
  const vektorer = await embed(biter.map((b) => b.tekst), cfg);
  const stmt = db.prepare("UPDATE biter SET vektor = ?, model = ? WHERE id = ?");
  let n = 0;
  biter.forEach((b, i) => {
    if (!vektorer[i]) return;
    stmt.run(JSON.stringify(vektorer[i]), cfg.model, b.id);
    n++;
  });
  return { oppdatert: n, totalt: biter.length, model: cfg.model };
}

/**
 * Søker i kunnskapsbasen.
 * Bruker vektorlikhet når embeddings finnes, ellers ordoverlapp.
 */
export async function search(sporsmal, { topK, minPoeng } = {}) {
  initRag();
  const cfg = ragConfig();
  const k = clamp(Number(topK ?? cfg.topK), 1, 20);
  const grense = minPoeng != null ? Number(minPoeng) : cfg.minPoeng;
  const rader = db
    .prepare(
      "SELECT b.id, b.dok_id, b.nr, b.tekst, b.vektor, d.tittel, d.kilde, d.type FROM biter b JOIN dokumenter d ON d.id = b.dok_id",
    )
    .all();
  if (!rader.length) return { treff: [], metode: "tom" };

  let metode = "vektor";
  let spor = null;
  try {
    const [v] = await embed([String(sporsmal)], cfg);
    spor = v || null;
  } catch {
    spor = null;
  }
  if (!spor) metode = "nokkelord";

  const scoret = rader.map((r) => {
    let poeng = 0;
    if (spor && r.vektor) {
      try {
        poeng = cos(spor, JSON.parse(r.vektor));
      } catch {
        poeng = 0;
      }
    } else {
      poeng = keywordScore(String(sporsmal), r.tekst);
    }
    return {
      id: r.id,
      dokId: r.dok_id,
      nr: r.nr,
      tittel: r.tittel,
      kilde: r.kilde,
      type: r.type,
      tekst: r.tekst,
      poeng: Number(poeng.toFixed(4)),
    };
  });
  scoret.sort((a, b) => b.poeng - a.poeng);
  const treff = scoret.filter((s) => s.poeng >= grense).slice(0, k);
  return { treff: treff.length ? treff : scoret.slice(0, Math.min(k, 3)), metode };
}

export function ragStats() {
  try {
    initRag();
    const d = db.prepare("SELECT COUNT(*) AS n FROM dokumenter").get();
    const b = db.prepare("SELECT COUNT(*) AS n, SUM(vektor IS NOT NULL) AS v FROM biter").get();
    return {
      dokumenter: Number(d?.n || 0),
      biter: Number(b?.n || 0),
      vektorer: Number(b?.v || 0),
      model: ragConfig().model,
    };
  } catch (e) {
    return { dokumenter: 0, biter: 0, vektorer: 0, feil: String(e?.message || e) };
  }
}
