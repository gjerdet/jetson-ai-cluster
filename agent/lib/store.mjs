/**
 * Enkel, avhengighetsfri lagring for Jarvis-backend.
 *  - JSON-dokumenter (brukere, økter, config, enheter, regler, samtaler)
 *  - tidsserier som NDJSON, én fil per døgn (samples-YYYY-MM-DD.ndjson)
 * Alt ligger under AGENT_DATA (standard ./data).
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.AGENT_DATA || "./data");
const SAMPLE_DIR = path.join(DATA_DIR, "samples");
const RETENTION_DAYS = Number(process.env.AGENT_RETENTION_DAYS || 90);

const docs = new Map();
const dirty = new Set();
let flushTimer = null;

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export async function initStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SAMPLE_DIR, { recursive: true });
  // Rydd bort halvskrevne filer etter en eventuell krasj.
  for (const f of await fs.readdir(DATA_DIR).catch(() => [])) {
    if (f.endsWith(".json.tmp")) await fs.unlink(path.join(DATA_DIR, f)).catch(() => {});
  }
}

/** Leser et dokument (cachet i minnet). */
export function doc(name, fallback) {
  if (docs.has(name)) return docs.get(name);
  let value = fallback;
  try {
    value = JSON.parse(fsSync.readFileSync(file(name), "utf8"));
  } catch (e) {
    if (e?.code !== "ENOENT") {
      // Ta vare på den ødelagte fila slik at data kan reddes manuelt.
      try {
        fsSync.renameSync(file(name), `${file(name)}.korrupt-${Date.now()}`);
        console.error(`[store] ${name}.json var ødelagt og ble flyttet til side.`);
      } catch {
        /* ignorer */
      }
    }
    value = fallback;
  }
  docs.set(name, value);
  return value;
}

/** Atomisk skriving: skriv til .tmp og bytt navn – aldri halve filer. */
function writeAtomic(name, value) {
  const target = file(name);
  const tmp = `${target}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fsSync.renameSync(tmp, target);
}

/** Skriver et dokument (samlet skriving etter 200 ms). */
export function saveDoc(name, value) {
  docs.set(name, value);
  dirty.add(name);
  if (flushTimer) return value;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const names = [...dirty];
    dirty.clear();
    for (const n of names) {
      try {
        writeAtomic(n, docs.get(n));
      } catch (e) {
        console.error("[store] klarte ikke skrive", n, e?.message);
      }
    }
  }, 200);
  return value;
}

export function flushNow() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  for (const n of dirty) {
    try {
      writeAtomic(n, docs.get(n));
    } catch {
      /* ignorer */
    }
  }
  dirty.clear();
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const samplePath = (day) => path.join(SAMPLE_DIR, `samples-${day}.ndjson`);

/** Siste kjente verdi per emne (i minnet, gjenoppbygges fra dagens fil ved start). */
export const latest = new Map();

/** Legger til en måling i tidsserien. */
export function addSample({ topic, value, time = Date.now(), raw }) {
  const emne = String(topic ?? "").trim();
  if (!emne || emne.length > 256) throw new Error("Ugyldig emne");
  if (!Number.isFinite(time) || time < 0 || time > Date.now() + 86_400_000) time = Date.now();
  topic = emne;
  const num = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  const row = {
    t: time,
    e: topic,
    v: Number.isFinite(num) ? num : null,
    s: Number.isFinite(num) ? undefined : String(raw ?? value ?? "").slice(0, 500),
  };
  latest.set(topic, { value: row.v ?? row.s ?? "", time });
  try {
    fsSync.appendFileSync(samplePath(dayKey(time)), `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[store] kunne ikke lagre måling", e?.message);
  }
  return row;
}

function daysBetween(from, to) {
  const out = [];
  for (let t = from; t <= to + 86_400_000; t += 86_400_000) out.push(dayKey(t));
  return [...new Set(out)];
}

/** Henter målinger i et tidsrom, eventuelt filtrert på emne. */
export async function querySamples({ topic, from, to = Date.now(), limit = 5000 }) {
  const start = from ?? to - 24 * 3600 * 1000;
  const rows = [];
  for (const day of daysBetween(start, to)) {
    let text = "";
    try {
      text = await fs.readFile(samplePath(day), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r.t < start || r.t > to) continue;
      if (topic && r.e !== topic) continue;
      rows.push(r);
    }
  }
  return rows.slice(-limit);
}

/** Enkel oppsummering (antall, min, maks, snitt, siste) per emne. */
export function summarize(rows) {
  const per = new Map();
  for (const r of rows) {
    if (r.v == null) continue;
    const s = per.get(r.e) ?? { emne: r.e, antall: 0, min: Infinity, maks: -Infinity, sum: 0, siste: null, tid: 0 };
    s.antall++;
    s.min = Math.min(s.min, r.v);
    s.maks = Math.max(s.maks, r.v);
    s.sum += r.v;
    if (r.t >= s.tid) {
      s.siste = r.v;
      s.tid = r.t;
    }
    per.set(r.e, s);
  }
  return [...per.values()].map((s) => ({
    emne: s.emne,
    antall: s.antall,
    min: s.min,
    maks: s.maks,
    snitt: Number((s.sum / s.antall).toFixed(3)),
    siste: s.siste,
    tid: s.tid,
  }));
}

/** Sletter tidsseriefiler eldre enn AGENT_RETENTION_DAYS. */
export async function pruneSamples() {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  let files = [];
  try {
    files = await fs.readdir(SAMPLE_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const f of files) {
    const m = /^samples-(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(f);
    if (!m) continue;
    if (Date.parse(`${m[1]}T23:59:59Z`) < cutoff) {
      await fs.unlink(path.join(SAMPLE_DIR, f)).catch(() => {});
      removed++;
    }
  }
  return removed;
}

/** Fyller `latest` fra dagens fil slik at omstart ikke mister siste verdier. */
export async function warmLatest() {
  const rows = await querySamples({ from: Date.now() - 6 * 3600 * 1000 });
  for (const r of rows) latest.set(r.e, { value: r.v ?? r.s ?? "", time: r.t });
  return latest.size;
}
