/**
 * turbovec som lokal vektorindeks for kunnskapsbasen.
 *
 * Indeksen komprimerer vektorene til 2–4 bit og søker med SIMD, slik at
 * søket holder seg raskt når antall dokumenter vokser. Alt kjører lokalt.
 *
 * Modulen styrer installasjon (som jobb med logg), start/stopp av den lokale
 * indekstjenesten, og statusen GUI-et viser. Faller Jarvis tilbake til
 * dagens søk, skjer det stille i rag.mjs.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR, doc, saveDoc } from "./store.mjs";
import { finnSkript, koLeggTil, listJobber } from "./trening.mjs";

export const TURBOVEC_INSTALLER = finnSkript("installer-turbovec.sh", process.env.JARVIS_TURBOVEC_INSTALLER || "");
export const TURBOVEC_SERVER = finnSkript("turbovec-server.py", process.env.JARVIS_TURBOVEC_SERVER || "");

const LOGG_FIL = path.join(DATA_DIR, "turbovec-server.log");
const VENV_FIL = path.join(DATA_DIR, "turbovec-venv.sti");
const INDEKS_DIR = path.join(DATA_DIR, "turbovec");
const STANDARD = { port: 11600, bits: 4, aktiv: false, vert: "127.0.0.1", token: "", delt: false };

export function turbovecConfig() {
  return { ...STANDARD, ...doc("turbovec", STANDARD) };
}

export function lagreTurbovecConfig(verdier = {}) {
  const naa = turbovecConfig();
  const ny = {
    ...naa,
    port: Number(verdier.port ?? naa.port) || STANDARD.port,
    bits: [2, 4].includes(Number(verdier.bits)) ? Number(verdier.bits) : naa.bits,
    vert: String(verdier.vert ?? naa.vert).trim().replace(/^https?:\/\//, "") || STANDARD.vert,
    token: verdier.token != null ? String(verdier.token).trim() : naa.token,
    delt: verdier.delt != null ? Boolean(verdier.delt) : naa.delt,
  };
  saveDoc("turbovec", ny);
  return ny;
}

function venvSti() {
  const fra = [process.env.TURBOVEC_VENV, "/opt/jarvis/turbovec/.venv"].filter(Boolean);
  try {
    if (fsSync.existsSync(VENV_FIL)) fra.unshift(fsSync.readFileSync(VENV_FIL, "utf8").trim());
  } catch {
    /* ignorer */
  }
  return fra.find((s) => s && fsSync.existsSync(path.join(s, "bin", "python"))) || "";
}

/** Sant når indeksen ligger på en annen maskin enn denne noden. */
export function turbovecErFjern() {
  const v = turbovecConfig().vert;
  return Boolean(v) && v !== "127.0.0.1" && v !== "localhost";
}

function basisUrl(cfg = turbovecConfig()) {
  return `http://${cfg.vert || "127.0.0.1"}:${cfg.port}`;
}

let prosess = null;

async function kall(sti, kropp, ms = 4000) {
  const cfg = turbovecConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const headers = {};
    if (kropp) headers["content-type"] = "application/json";
    if (cfg.token) headers["authorization"] = `Bearer ${cfg.token}`;
    const r = await fetch(`${basisUrl(cfg)}${sti}`, {
      method: kropp ? "POST" : "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      body: kropp ? JSON.stringify(kropp) : undefined,
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error || `Indeksen svarte ${r.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Sant når indekstjenesten svarer akkurat nå. */
export async function turbovecHelse() {
  try {
    return await kall("/health", null, 2000);
  } catch {
    return null;
  }
}

export async function turbovecLeggTil(poster) {
  if (!poster?.length) return 0;
  const svar = await kall("/legg-til", { poster }, 120_000);
  return Number(svar?.lagt_til || 0);
}

export async function turbovecSlett(ider) {
  if (!ider?.length) return 0;
  const svar = await kall("/slett", { ider }, 30_000);
  return Number(svar?.slettet || 0);
}

export async function turbovecSok(vektor, topK) {
  const svar = await kall("/sok", { vektor, topK }, 15_000);
  return { treff: svar?.treff || [], msBrukt: Number(svar?.msBrukt || 0) };
}

export async function turbovecNullstill() {
  return kall("/nullstill", {}, 30_000);
}

/** Alt GUI-et trenger: installert, kjører, antall vektorer og logg. */
export async function turbovecStatus() {
  const cfg = turbovecConfig();
  const venv = venvSti();
  const helse = await turbovecHelse();
  let logg = "";
  try {
    logg = (await fs.readFile(LOGG_FIL, "utf8")).split("\n").slice(-40).join("\n");
  } catch {
    /* ingen logg ennå */
  }
  const jobb = listJobber().find(
    (j) => /installer-turbovec/i.test(j.navn || "") && (j.status === "kø" || j.status === "kjører"),
  );
  return {
    installert: Boolean(venv),
    fjern: turbovecErFjern(),
    baseUrl: basisUrl(cfg),
    venv,
    installerSkript: TURBOVEC_INSTALLER,
    serverSkript: TURBOVEC_SERVER,
    kjorer: Boolean(helse),
    vektorer: Number(helse?.vektorer || 0),
    dim: Number(helse?.dim || 0),
    bits: Number(helse?.bits || cfg.bits),
    sisteSokMs: helse?.sisteSokMs ?? null,
    feil: helse?.feil || "",
    pid: prosess?.pid || null,
    config: cfg,
    installasjonsjobb: jobb?.id || null,
    logg,
  };
}

/** Installerer turbovec som jobb med logg, samme flyt som AirLLM. */
export async function startInstallasjonTurbovec() {
  if (!fsSync.existsSync(TURBOVEC_INSTALLER))
    throw new Error(
      `Fant ikke installer-turbovec.sh (${TURBOVEC_INSTALLER}). Kjør «git pull» og sudo bash agent/scripts/update-jetson.sh på noden.`,
    );

  const paagaar = listJobber().find(
    (j) => /installer-turbovec/i.test(j.navn || "") && (j.status === "kø" || j.status === "kjører"),
  );
  if (paagaar) return paagaar;

  const erRoot = typeof process.getuid === "function" ? process.getuid() === 0 : false;
  const bash = fsSync.existsSync("/usr/bin/bash") ? "/usr/bin/bash" : "/bin/bash";
  const kommando = erRoot
    ? `${bash} ${JSON.stringify(TURBOVEC_INSTALLER)}`
    : `sudo -n ${bash} ${JSON.stringify(TURBOVEC_INSTALLER)}`;

  return koLeggTil({ navn: "installer-turbovec", kommando, autoTranskriber: false, hoppOverValidering: true });
}

/** Starter den lokale indekstjenesten i bakgrunnen. */
export async function startTurbovec() {
  const cfg = turbovecConfig();
  if (turbovecErFjern())
    throw new Error(
      `Indeksen er satt opp på en annen node (${cfg.vert}). Start den der, eller sett verten tilbake til 127.0.0.1.`,
    );
  if (await turbovecHelse()) return { ok: true, alleredeKjorer: true, ...(await turbovecStatus()) };

  const venv = venvSti();
  if (!venv) throw new Error("turbovec er ikke installert ennå. Kjør «Installer turbovec» først.");
  if (!fsSync.existsSync(TURBOVEC_SERVER)) throw new Error(`Fant ikke turbovec-server.py (${TURBOVEC_SERVER}).`);

  fsSync.mkdirSync(INDEKS_DIR, { recursive: true });
  const logg = fsSync.openSync(LOGG_FIL, "a");
  prosess = spawn(path.join(venv, "bin", "python"), [TURBOVEC_SERVER], {
    detached: true,
    stdio: ["ignore", logg, logg],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      TURBOVEC_PORT: String(cfg.port),
      TURBOVEC_BITS: String(cfg.bits),
      TURBOVEC_DATA: INDEKS_DIR,
      TURBOVEC_BIND: cfg.delt ? "0.0.0.0" : "127.0.0.1",
      TURBOVEC_TOKEN: cfg.token || "",
    },
  });
  prosess.unref();
  saveDoc("turbovec", { ...cfg, aktiv: true });

  for (let i = 0; i < 15; i += 1) {
    if (await turbovecHelse()) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: true, ...(await turbovecStatus()) };
}

/** Stopper indekstjenesten. Søket faller da tilbake til dagens metode. */
export async function stoppTurbovec() {
  const cfg = turbovecConfig();
  if (prosess?.pid) {
    try {
      process.kill(-prosess.pid, "SIGTERM");
    } catch {
      try {
        prosess.kill("SIGTERM");
      } catch {
        /* allerede død */
      }
    }
    prosess = null;
  }
  saveDoc("turbovec", { ...cfg, aktiv: false });
  return { ok: true, ...(await turbovecStatus()) };
}
