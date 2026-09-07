/**
 * GitHub-repoer: Jarvis kan klone, utforske, søke i og indeksere repoer i den
 * lokale kunnskapsbasen (RAG). Alt lagres lokalt på Jetson-noden.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, doc, saveDoc } from "./store.mjs";
import { addDocument, deleteDocument } from "./rag.mjs";

const REPO_DIR = path.join(DATA_DIR, "repos");
const MAX_TOTAL_MB = 400; // maksgrense per repo på disk
const MAX_FIL_MB = 2; // les aldri filer større enn dette
const MAX_INDEKS_FILER = 250;
const TEKST_SUFFIKSER = new Set([
  ".md", ".txt", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json", ".yaml", ".yml",
  ".toml", ".sh", ".bash", ".rs", ".go", ".java", ".c", ".h", ".cpp", ".hpp", ".css", ".html",
  ".sql", ".dockerfile", ".env.example", ".cfg", ".ini",
]);
const HOPP_OVER_MAPPER = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".turbo",
  "vendor", ".mypy_cache", ".pytest_cache", "target",
]);

function kjor(cmd, args, timeout = 120_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, cwd: REPO_DIR }, (feil, ut, err) => {
      resolve({ ok: !feil, ut: String(ut || ""), feil: feil ? String(err || feil.message) : "" });
    });
  });
}

function db() {
  return doc("github_repos", { list: [] });
}

function lagre(d) {
  saveDoc("github_repos", d);
}

/** Tillater «owner/repo» eller full https-URL (github.com / gitlab). */
export function parseRepo(ref) {
  const r = String(ref || "").trim();
  if (!r) throw new Error("Mangler repo, f.eks. OpenHands/OpenHands.");
  let url;
  let navn;
  const mUrl = r.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (mUrl) {
    navn = `${mUrl[2]}__${mUrl[3]}`;
    url = r;
  } else if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(r)) {
    const [owner, repo] = r.split("/");
    navn = `${owner}__${repo.replace(/\.git$/, "")}`;
    url = `https://github.com/${owner}/${repo}.git`;
  } else {
    throw new Error(`Ugyldig repo «${r}». Bruk owner/repo eller full https-URL.`);
  }
  return { navn, url };
}

export function repoSti(navn) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(navn || "")) || String(navn).includes("..")) {
    throw new Error("Ugyldig repo-navn.");
  }
  return path.join(REPO_DIR, navn);
}

async function mappeFiler(rot) {
  const ut = [];
  async function gaa(dir, rel = "") {
    if (ut.length > 5000) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (HOPP_OVER_MAPPER.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const st = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await gaa(full, st);
      else ut.push({ sti: st, full });
    }
  }
  await gaa(rot);
  return ut;
}

/** Alle repoer med status. */
export async function githubRepos() {
  await fs.mkdir(REPO_DIR, { recursive: true });
  const d = db();
  const list = [];
  for (const r of d.list || []) {
    const sti = repoSti(r.navn);
    let filer = 0;
    let storrelseMb = 0;
    try {
      const stat = await fs.stat(sti);
      if (stat.isDirectory()) {
        const alle = await mappeFiler(sti);
        filer = alle.length;
        for (const f of alle.slice(0, 2000)) {
          storrelseMb += ((await fs.stat(f.full).catch(() => ({ size: 0 }))).size || 0) / 1e6;
        }
      }
    } catch {
      /* repo-mappen mangler */
    }
    list.push({ ...r, filer, storrelseMb: +storrelseMb.toFixed(1), sti: `~/.jarvis-data/repos/${r.navn}` });
  }
  return list;
}

/** Klon et repo (shallow) og lagre metadata. */
export async function githubKlon({ repo, url }) {
  await fs.mkdir(REPO_DIR, { recursive: true });
  const parsed = parseRepo(repo || url || "");
  const sti = repoSti(parsed.navn);
  const finnes = await fs
    .stat(sti)
    .then(() => true)
    .catch(() => false);
  if (!finnes) {
    const g = await kjor("git", ["clone", "--depth", "1", "--single-branch", parsed.url, parsed.navn], 300_000);
    if (!g.ok) {
      throw new Error(`git clone feilet: ${(g.feil || g.ut).slice(0, 400)}`);
    }
  } else {
    const p = await kjor("git", ["-C", sti, "pull", "--ff-only"], 60_000);
    if (!p.ok) {
      // Fallback: tøm og klon på nytt.
      await fs.rm(sti, { recursive: true, force: true });
      const g = await kjor("git", ["clone", "--depth", "1", parsed.url, parsed.navn], 300_000);
      if (!g.ok) throw new Error(`git clone feilet: ${(g.feil || g.ut).slice(0, 400)}`);
    }
  }
  const alle = await mappeFiler(sti);
  let totalMb = 0;
  for (const f of alle) totalMb += ((await fs.stat(f.full).catch(() => ({ size: 0 }))).size || 0) / 1e6;
  if (totalMb > MAX_TOTAL_MB) {
    await fs.rm(sti, { recursive: true, force: true });
    throw new Error(`Repoet er for stort (${totalMb.toFixed(0)} MB > ${MAX_TOTAL_MB} MB).`);
  }

  let commit = "";
  const c = await kjor("git", ["-C", sti, "rev-parse", "--short", "HEAD"], 10_000);
  if (c.ok) commit = c.ut.trim();
  let beskrivelse = "";
  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.navn.replace("__", "/")}`);
    if (res.ok) beskrivelse = String((await res.json())?.description || "");
  } catch {
    /* kun beskrivelse – valgfritt */
  }

  const d = db();
  const eksisterende = (d.list || []).find((x) => x.navn === parsed.navn);
  const oppf = {
    navn: parsed.navn,
    url: parsed.url,
    beskrivelse,
    commit,
    klonet: Date.now(),
    indeksert: eksisterende?.indeksert || 0,
    dokId: eksisterende?.dokId || "",
    feil: "",
  };
  if (eksisterende) Object.assign(eksisterende, oppf);
  else (d.list = d.list || []).unshift(oppf);
  lagre(d);
  return { ok: true, ...oppf, filer: alle.length, storrelseMb: +totalMb.toFixed(1) };
}

/** Les én fil fra et repo. */
export async function githubFil({ repo, sti: filsti }) {
  const sti = repoSti(repo);
  const mål = path.resolve(sti, String(filsti || ""));
  if (!mål.startsWith(sti + path.sep) && mål !== sti) throw new Error("Ugyldig filsti.");
  const innhold = await fs.readFile(mål, "utf8");
  return { ok: true, sti: String(filsti), tegn: innhold.length, tekst: innhold.slice(0, 40_000) };
}

/** Fritekstsøk i repoet (grep -rIn). */
export async function githubSok({ repo, sok, maks = 30 }) {
  const sti = repoSti(repo);
  const q = String(sok || "").trim();
  if (!q) throw new Error("Mangler søketekst.");
  const g = await kjor(
    "grep",
    ["-rIn", "--exclude-dir=.git", "--exclude-dir=node_modules", "-m", "5", "-e", q, "."],
    60_000,
  );
  const linjer = g.ut.split("\n").filter(Boolean).slice(0, Math.max(1, Math.min(Number(maks) || 30, 100)));
  return { ok: true, sok: q, treff: linjer.length, linjer: linjer.map((l) => l.slice(0, 500)) };
}

async function indekserbarFil(f) {
  const base = path.basename(f).toLowerCase();
  if (TEKST_SUFFIKSER.has(path.extname(f).toLowerCase())) return true;
  if (base === "dockerfile" || base === "makefile" || base === "license" || base === "readme") return true;
  return false;
}

/** Indekser hele repoet i den lokale kunnskapsbasen (RAG). */
export async function githubIndekser({ repo }) {
  const sti = repoSti(repo);
  const d = db();
  const meta = (d.list || []).find((x) => x.navn === repo);
  if (!meta) throw new Error(`Repoet «${repo}» er ikke klonet. Klon det først.`);
  if (meta.dokId) await deleteDocument(meta.dokId).catch(() => {});

  const alle = await mappeFiler(sti);
  const deler = [];
  let filer = 0;
  let tegn = 0;
  for (const f of alle) {
    if (deler.length >= MAX_INDEKS_FILER) break;
    if (!(await indekserbarFil(f.sti))) continue;
    const stat = await fs.stat(f.full).catch(() => null);
    if (!stat || stat.size > MAX_FIL_MB * 1e6) continue;
    const innhold = await fs.readFile(f.full, "utf8").catch(() => "");
    if (!innhold.trim()) continue;
    deler.push(`### FIL: ${f.sti}\n${innhold}`);
    filer++;
    tegn += innhold.length;
193:  }
  const tittel = `GitHub: ${meta.navn}`;
  const r = await addDocument({
    tittel,
    tekst: deler.join("\n\n"),
    kilde: meta.url,
    type: "github",
  });
  meta.indeksert = Date.now();
  meta.dokId = r?.dokument?.id || "";
  meta.indeksFiler = filer;
  lagre(d);
  return {
    ok: true,
    repo: meta.navn,
    filer,
    tegn,
    biter: r?.biter ?? 0,
    embedFeil: r?.embedFeil ?? null,
    dokId: meta.dokId,
  };
}

/** Slett repo fra disk og kunnskapsbase. */
export async function githubSlett({ repo }) {
  const sti = repoSti(repo);
  const d = db();
  const meta = (d.list || []).find((x) => x.navn === repo);
  if (meta?.dokId) await deleteDocument(meta.dokId).catch(() => {});
  await fs.rm(sti, { recursive: true, force: true });
  d.list = (d.list || []).filter((x) => x.navn !== repo);
  lagre(d);
  return { ok: true };
}
