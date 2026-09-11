/**
 * AirLLM som lokal «stor modell»-motor.
 *
 * AirLLM laster ett lag om gangen inn på GPU-en, slik at 30B–70B-modeller
 * kan kjøre på en Jetson med lite minne. Det er tregt (minutter per svar),
 * så motoren brukes til tunge oppgaver – ikke vanlig chat.
 *
 * Her styres installasjon (som jobb med logg), start/stopp av den lokale
 * OpenAI-kompatible tjenesten, og statusen GUI-et viser.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR, doc, saveDoc } from "./store.mjs";
import { finnSkript, koLeggTil, listJobber } from "./trening.mjs";

export const AIRLLM_INSTALLER = finnSkript("installer-airllm.sh", process.env.JARVIS_AIRLLM_INSTALLER || "");
export const AIRLLM_SERVER = finnSkript("airllm-server.py", process.env.JARVIS_AIRLLM_SERVER || "");

const LOGG_FIL = path.join(DATA_DIR, "airllm-server.log");
const VENV_FIL = path.join(DATA_DIR, "airllm-venv.sti");
const STANDARD = {
  modell: "v2ray/Llama-3-8B",
  port: 11500,
  maksTokens: 256,
  komprimering: "",
  aktiv: false,
};

/**
 * Ferdige valg. Diskplass og svartid er grove anslag for en Jetson Nano
 * Super, slik at man ser hva man går til før nedlastingen starter.
 */
export const AIRLLM_MODELLER = [
  { id: "v2ray/Llama-3-8B", navn: "Llama 3 · 8B", diskGb: 16, svartid: "20–60 sek", hint: "Raskest – god til daglig tung bruk" },
  { id: "Qwen/Qwen2.5-14B-Instruct", navn: "Qwen 2.5 · 14B", diskGb: 30, svartid: "1–3 min", hint: "God balanse mellom kvalitet og tid" },
  { id: "Qwen/Qwen2.5-32B-Instruct", navn: "Qwen 2.5 · 32B", diskGb: 65, svartid: "3–8 min", hint: "Kraftig – krever rask SSD" },
  { id: "v2ray/Llama-3-70B", navn: "Llama 3 · 70B", diskGb: 140, svartid: "8–25 min", hint: "Best kvalitet, kun for bakgrunnsoppgaver" },
];

/** Lagret oppsett for motoren. */
export function airllmConfig() {
  return { ...STANDARD, ...doc("airllm", STANDARD) };
}

export function lagreAirllmConfig(verdier = {}) {
  const naa = airllmConfig();
  const ny = {
    ...naa,
    modell: String(verdier.modell ?? naa.modell).trim() || STANDARD.modell,
    port: Number(verdier.port ?? naa.port) || STANDARD.port,
    maksTokens: Math.max(32, Number(verdier.maksTokens ?? naa.maksTokens) || STANDARD.maksTokens),
    komprimering: String(verdier.komprimering ?? naa.komprimering || ""),
  };
  saveDoc("airllm", ny);
  return ny;
}

function venvSti() {
  const fra = [process.env.AIRLLM_VENV, "/opt/jarvis/airllm/.venv"].filter(Boolean);
  try {
    if (fsSync.existsSync(VENV_FIL)) fra.unshift(fsSync.readFileSync(VENV_FIL, "utf8").trim());
  } catch {
    /* ignorer */
  }
  return fra.find((s) => s && fsSync.existsSync(path.join(s, "bin", "python"))) || "";
}

let prosess = null;

async function svarerPaaPort(port, ms = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Alt GUI-et trenger: installert, kjører, modell, siste svartid og logg. */
export async function airllmStatus() {
  const cfg = airllmConfig();
  const venv = venvSti();
  const helse = await svarerPaaPort(cfg.port);
  let logg = "";
  try {
    const tekst = await fs.readFile(LOGG_FIL, "utf8");
    logg = tekst.split("\n").slice(-40).join("\n");
  } catch {
    /* ingen logg ennå */
  }
  const jobb = listJobber().find(
    (j) => /installer-airllm/i.test(j.navn || "") && (j.status === "kø" || j.status === "kjører"),
  );
  return {
    installert: Boolean(venv),
    venv,
    installerSkript: AIRLLM_INSTALLER,
    serverSkript: AIRLLM_SERVER,
    kjorer: Boolean(helse),
    opptatt: Boolean(helse?.opptatt),
    lastet: Boolean(helse?.lastet),
    sisteSvarSek: helse?.sisteSvarSek ?? null,
    feil: helse?.feil || "",
    pid: prosess?.pid || null,
    baseUrl: `http://127.0.0.1:${cfg.port}/v1`,
    config: cfg,
    modeller: AIRLLM_MODELLER,
    installasjonsjobb: jobb?.id || null,
    logg,
  };
}

/** Installerer AirLLM (og laster ned valgt modell) som jobb med logg. */
export async function startInstallasjonAirllm({ modell = "" } = {}) {
  if (!fsSync.existsSync(AIRLLM_INSTALLER))
    throw new Error(
      `Fant ikke installer-airllm.sh (${AIRLLM_INSTALLER}). Kjør «git pull» og sudo bash agent/scripts/update-jetson.sh på noden.`,
    );

  const paagaar = listJobber().find(
    (j) => /installer-airllm/i.test(j.navn || "") && (j.status === "kø" || j.status === "kjører"),
  );
  if (paagaar) return paagaar;

  const cfg = modell ? lagreAirllmConfig({ modell }) : airllmConfig();
  const erRoot = typeof process.getuid === "function" ? process.getuid() === 0 : false;
  const bash = fsSync.existsSync("/usr/bin/bash") ? "/usr/bin/bash" : "/bin/bash";
  const env = `AIRLLM_MODELL=${JSON.stringify(cfg.modell)}`;
  const kommando = erRoot
    ? `${env} ${bash} ${JSON.stringify(AIRLLM_INSTALLER)}`
    : `sudo -n ${env} ${bash} ${JSON.stringify(AIRLLM_INSTALLER)}`;

  return koLeggTil({ navn: "installer-airllm", kommando, autoTranskriber: false, hoppOverValidering: true });
}

/** Starter den lokale AirLLM-tjenesten i bakgrunnen. */
export async function startAirllm() {
  const cfg = airllmConfig();
  if (await svarerPaaPort(cfg.port)) return { ok: true, alleredeKjorer: true, ...(await airllmStatus()) };

  const venv = venvSti();
  if (!venv) throw new Error("AirLLM er ikke installert ennå. Kjør «Installer AirLLM» først.");
  if (!fsSync.existsSync(AIRLLM_SERVER)) throw new Error(`Fant ikke airllm-server.py (${AIRLLM_SERVER}).`);

  const logg = fsSync.openSync(LOGG_FIL, "a");
  prosess = spawn(path.join(venv, "bin", "python"), [AIRLLM_SERVER], {
    detached: true,
    stdio: ["ignore", logg, logg],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      AIRLLM_MODELL: cfg.modell,
      AIRLLM_PORT: String(cfg.port),
      AIRLLM_COMPRESSION: cfg.komprimering || "",
    },
  });
  prosess.unref();
  saveDoc("airllm", { ...cfg, aktiv: true });

  // Vent litt så GUI-et kan vise om tjenesten faktisk kom opp.
  for (let i = 0; i < 15; i += 1) {
    if (await svarerPaaPort(cfg.port, 1500)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: true, ...(await airllmStatus()) };
}

/** Stopper tjenesten. Modellen lastes ut og minnet frigjøres. */
export async function stoppAirllm() {
  const cfg = airllmConfig();
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
  saveDoc("airllm", { ...cfg, aktiv: false });
  return { ok: true, ...(await airllmStatus()) };
}
