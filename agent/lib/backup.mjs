/**
 * Sikkerhetskopi av datamappen. Tar med JSON-dokumenter (brukere, config,
 * regler, enheter, samtaler) og siste døgns målinger. Roterer automatisk.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const DATA_DIR = () => path.resolve(process.env.AGENT_DATA || "./data");
const BACKUP_DIR = () => path.resolve(process.env.AGENT_BACKUP_DIR || path.join(DATA_DIR(), "backups"));
const KEEP = Number(process.env.AGENT_BACKUP_KEEP || 14);
const INTERVAL_H = Number(process.env.AGENT_BACKUP_HOURS || 24);

/** Lager én sikkerhetskopi (gzippet JSON-bundle). Returnerer filnavnet. */
export async function runBackup() {
  const data = DATA_DIR();
  const dir = BACKUP_DIR();
  await fs.mkdir(dir, { recursive: true });

  const bundle = { tid: Date.now(), dokumenter: {}, maalinger: {} };
  for (const f of await fs.readdir(data).catch(() => [])) {
    if (!f.endsWith(".json")) continue;
    try {
      bundle.dokumenter[f.replace(/\.json$/, "")] = JSON.parse(await fs.readFile(path.join(data, f), "utf8"));
    } catch {
      /* hopp over ødelagte filer */
    }
  }
  const sampleDir = path.join(data, "samples");
  const today = new Date().toISOString().slice(0, 10);
  for (const f of await fs.readdir(sampleDir).catch(() => [])) {
    if (!f.includes(today)) continue;
    bundle.maalinger[f] = await fs.readFile(path.join(sampleDir, f), "utf8").catch(() => "");
  }

  const name = `jarvis-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`;
  await fs.writeFile(path.join(dir, name), gzipSync(Buffer.from(JSON.stringify(bundle))), { mode: 0o600 });
  await prune();
  return name;
}

/** Sletter de eldste kopiene ut over AGENT_BACKUP_KEEP. */
export async function prune() {
  const dir = BACKUP_DIR();
  const files = (await fs.readdir(dir).catch(() => []))
    .filter((f) => f.startsWith("jarvis-backup-"))
    .sort();
  const remove = files.slice(0, Math.max(0, files.length - KEEP));
  for (const f of remove) await fs.unlink(path.join(dir, f)).catch(() => {});
  return remove.length;
}

export async function listBackups() {
  const dir = BACKUP_DIR();
  const out = [];
  for (const f of (await fs.readdir(dir).catch(() => [])).filter((f) => f.startsWith("jarvis-backup-"))) {
    try {
      const st = fsSync.statSync(path.join(dir, f));
      out.push({ navn: f, bytes: st.size, tid: st.mtime.toISOString() });
    } catch {
      /* ignorer */
    }
  }
  return out.sort((a, b) => (a.tid < b.tid ? 1 : -1));
}

let timer = null;

/** Starter periodisk sikkerhetskopiering (én gang ved oppstart, så hver N. time). */
export function startBackups() {
  if (timer || INTERVAL_H <= 0) return;
  runBackup().catch((e) => console.error("[backup] feilet:", e?.message));
  timer = setInterval(
    () => runBackup().catch((e) => console.error("[backup] feilet:", e?.message)),
    INTERVAL_H * 3600 * 1000,
  );
  timer.unref?.();
}

export const backupDir = BACKUP_DIR;
