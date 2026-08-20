/**
 * Treningskø for Piper-stemmer.
 * Én jobb om gangen (Jetson har begrenset RAM). Hver jobb har status,
 * fremdrift i prosent og en logg som GUI-et poller mens treningen kjører.
 * Alt kjører lokalt – ingen sky.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DATA_DIR, doc, saveDoc, flushNow } from "./store.mjs";
import { clipDir, trainingManifest, clipStats, ttsConfig, saveTtsConfig, transkriberAlle, listClips } from "./tts.mjs";
import { gpuStatus } from "./gpu.mjs";
import os from "node:os";

const SKRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");

/**
 * Finner et skript uansett om agenten kjører fra /opt/jarvis-agent, fra
 * git-utsjekken eller i en container. Returnerer første sti som finnes,
 * ellers standardstien (så feilmeldingen blir forståelig).
 */
export function finnSkript(navn, envVerdi = "") {
  const kandidater = [
    envVerdi,
    path.join(SKRIPT_DIR, navn),
    `/opt/jarvis-agent/scripts/${navn}`,
    `/opt/jarvis/agent/scripts/${navn}`,
    path.join(process.cwd(), "agent", "scripts", navn),
    path.join(process.cwd(), "scripts", navn),
  ].filter(Boolean);
  for (const k of kandidater) {
    try {
      if (fsSync.existsSync(k)) return k;
    } catch {
      /* ignorer */
    }
  }
  return kandidater[1];
}

/** Skriptet som gjør hele Piper-jobben lokalt (datasett → trening → onnx). */
export const TRENING_SKRIPT = finnSkript("tren-stemme.sh", process.env.JARVIS_TRENING_SKRIPT || "");

/** Skriptet som installerer selve Piper-treningsmiljøet. */
export const INSTALLER_SKRIPT = finnSkript("installer-piper.sh", process.env.JARVIS_INSTALLER_SKRIPT || "");

/**
 * Starter installasjon av Piper som en vanlig jobb med logg.
 * Krever root eller passordfri sudo – ellers gir vi en tydelig feil
 * i stedet for en kryptisk «kode 1».
 */
export async function startInstallasjonPiper() {
  const skript = INSTALLER_SKRIPT;
  if (!(await fileFinnes(skript)))
    throw new Error(`Fant ikke installasjonsskriptet (${skript}). Kjør «git pull» og sudo bash agent/scripts/update-jetson.sh på Jetson-noden.`);

  const erRoot = typeof process.getuid === "function" ? process.getuid() === 0 : false;
  let kommando = `/bin/bash ${shellArg(skript)}`;
  if (!erRoot) {
    // Test den nøyaktige kommandoen sudoers gir tilgang til. `sudo -n true`
    // er med vilje ikke tillatt av den begrensede regelen og ga derfor falsk
    // negativ selv når Piper-installasjonen faktisk var autorisert.
    const bashSti = fsSync.existsSync("/usr/bin/bash") ? "/usr/bin/bash" : "/bin/bash";
    const sudoOk = Boolean(await kjor("sudo", ["-n", "-l", bashSti, skript], 8000));
    if (!sudoOk)
      throw new Error(
        `Piper-installasjonen er ikke autorisert for agentbrukeren. Kjør én gang på Jetson: sudo bash agent/scripts/update-jetson.sh`,
      );
    kommando = `sudo -n ${bashSti} ${shellArg(skript)}`;
  }

  return koLeggTil({
    navn: "installer-piper",
    kommando,
    autoTranskriber: false,
    hoppOverValidering: true,
  });
}

function shellArg(verdi) {
  return `'${String(verdi).replaceAll("'", `'\\''`)}'`;
}


/**
 * Ferdige oppsett for Jetson Nano Super (8 GB delt minne).
 * `env` legges foran kommandoen slik at tren-stemme.sh plukker dem opp.
 */
export const TRENING_PRESETS = [
  {
    id: "jetson-lav",
    navn: "Jetson · lav VRAM (trygg)",
    beskrivelse: "Liten batch og low quality. Bruker minst minne – start her hvis trening kræsjer.",
    env: { PIPER_BATCH: "4", PIPER_EPOCHS: "1500", PIPER_QUALITY: "low" },
  },
  {
    id: "jetson-balansert",
    navn: "Jetson · balansert",
    beskrivelse: "Standardvalg. Grei kvalitet uten å sprenge minnet på 8 GB.",
    env: { PIPER_BATCH: "8", PIPER_EPOCHS: "2000", PIPER_QUALITY: "medium" },
  },
  {
    id: "jetson-kvalitet",
    navn: "Jetson · høy kvalitet (treg)",
    beskrivelse: "Flere epoker og medium quality. Tar mange timer – kjør over natta.",
    env: { PIPER_BATCH: "6", PIPER_EPOCHS: "4000", PIPER_QUALITY: "medium" },
  },
  {
    id: "finetune-no",
    navn: "Finjuster norsk stemme (få klipp)",
    beskrivelse: "Bygger videre på en ferdig norsk modell. Best når du har under 30 minutter lyd.",
    env: { PIPER_BATCH: "4", PIPER_EPOCHS: "800", PIPER_QUALITY: "medium", PIPER_FINETUNE_NO: "1" },
  },
];

const MAKS_TELEMETRI = 120;

function kjor(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, encoding: "utf8" }, (err, stdout) => resolve(err && !stdout ? null : String(stdout || "").trim()));
    } catch {
      resolve(null);
    }
  });
}

async function harKommando(navn) {
  return Boolean(await kjor("bash", ["-lc", `command -v ${navn} >/dev/null 2>&1 && echo ja`]));
}

const piperPythonKandidater = () => [
  process.env.PIPER_PYTHON,
  process.env.PIPER_VENV ? path.join(process.env.PIPER_VENV, "bin", "python") : "",
  "/opt/jarvis/piper/src/python/.venv/bin/python",
  "/opt/jarvis/piper/.venv/bin/python",
  "/opt/piper/.venv/bin/python",
  path.join(os.homedir(), "piper", "src", "python", ".venv", "bin", "python"),
  path.join(os.homedir(), "piper", ".venv", "bin", "python"),
  "python3",
].filter(Boolean);

async function finnPiperPython() {
  for (const python of piperPythonKandidater()) {
    if (python.includes("/") && !(await fileFinnes(python))) continue;
    const ut = await kjor(python, ["-m", "piper_train.preprocess", "--help"], 15000);
    if (ut !== null) return python;
  }
  return "";
}

/**
 * Forhåndsvisning + validering før trening: hvilke stier som brukes,
 * hva som mangler på maskinen, og en ferdig utfylt kommando.
 */
export async function treningPlan({ navn = "", preset = "jetson-balansert" } = {}) {
  const stat = clipStats();
  const jobbNavn = rentNavn(navn);
  const utMappe = path.join(DATA_DIR, "stemmemodeller", `${jobbNavn}-<jobbid>`);
  const mappe = clipDir();
  const manifest = path.join(utMappe, "metadata.csv");

  const [ffmpeg, espeak, piperPython, gpu] = await Promise.all([
    harKommando("ffmpeg"),
    harKommando("espeak-ng"),
    finnPiperPython(),
    gpuStatus().catch(() => null),
  ]);
  const piperTrain = Boolean(piperPython);

  const filer = await fs.readdir(mappe).catch(() => null);
  const utenLyd = [];
  for (const k of listClips().filter((x) => x.tekst && !x.pauset)) {
    const base = String(k.fil || "").replace(/\.[^.]+$/, "");
    if (!(filer || []).some((f) => String(f).replace(/\.[^.]+$/, "") === base)) utenLyd.push(base);
  }

  const problemer = [];
  if (filer === null) problemer.push(`Klippmappa finnes ikke enda: ${mappe} – last opp minst ett klipp først.`);
  if (!stat.aktive) problemer.push("Ingen aktive klipp. Last opp lyd under SYSTEM → STEMME.");
  if (stat.aktive && !stat.medTekst) problemer.push("Ingen klipp har transkripsjon. Kjør AUTO-TRANSKRIBER eller skriv teksten selv.");
  if (utenLyd.length) problemer.push(`${utenLyd.length} klipp mangler lydfil på disk (${utenLyd.slice(0, 3).join(", ")}).`);
  if (stat.aktiveSekunder < 300)
    problemer.push(`Bare ${Math.round(stat.aktiveSekunder / 60)} min lyd – regn med svakt resultat. 15–30 min anbefales.`);

  const mangler = [];
  if (!ffmpeg) mangler.push("ffmpeg");
  if (!espeak) mangler.push("espeak-ng");
  if (!piperTrain) mangler.push("piper_train");

  const valgt = TRENING_PRESETS.find((p) => p.id === preset) || TRENING_PRESETS[1];
  return {
    mappe,
    manifest,
    navn: jobbNavn,
    utMappe,
    skript: TRENING_SKRIPT,
    kommando: byggKommando(valgt.id),
    presets: TRENING_PRESETS,
    preset: valgt.id,
    statistikk: stat,
    miljo: { ffmpeg, espeak, piperTrain, piperPython, skript: await fileFinnes(TRENING_SKRIPT), gpu },
    mangler,
    // Kritiske problemer stopper start; advarsler gjør det ikke.
    problemer,
    kanStarte: Boolean(stat.medTekst) && filer !== null && !utenLyd.length,
  };
}

const fileFinnes = (f) => fs.access(f).then(() => true).catch(() => false);

const rentNavn = (n) =>
  String(n || `stemme-${new Date().toISOString().slice(0, 10)}`).replace(/[^\w.\- ]+/g, "_").slice(0, 60) || "stemme";

/** Bygger en komplett bash-kommando for et preset (med plassholdere intakt). */
export function byggKommando(presetId = "jetson-balansert", { autoInstall = true } = {}) {
  const p = TRENING_PRESETS.find((x) => x.id === presetId) || TRENING_PRESETS[1];
  const env = { ...(autoInstall ? { JARVIS_AUTO_INSTALL: "1" } : {}), ...p.env };
  const pre = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${pre} bash ${TRENING_SKRIPT} {mappe} {manifest} {navn} {ut}`;
}

const MAKS_LOGG = 500;
const jobbDoc = () => doc("treningsjobber", { list: [] });
const lagre = (list) => {
  saveDoc("treningsjobber", { list: list.slice(-40) });
  flushNow();
};

/** Alle jobber, nyeste først. */
export function listJobber() {
  return [...(jobbDoc().list || [])].sort((a, b) => (a.opprettet < b.opprettet ? 1 : -1));
}

export function hentJobb(id) {
  return (jobbDoc().list || []).find((j) => j.id === id) || null;
}

function oppdater(id, patch) {
  const list = jobbDoc().list || [];
  const i = list.findIndex((j) => j.id === id);
  if (i < 0) return null;
  const ny = [...list];
  ny[i] = { ...ny[i], ...patch };
  lagre(ny);
  return ny[i];
}

function logg(id, linje) {
  const j = hentJobb(id);
  if (!j) return;
  const l = [...(j.logg || []), `${new Date().toISOString().slice(11, 19)} ${linje}`].slice(-MAKS_LOGG);
  oppdater(id, { logg: l });
}

const prosesser = new Map();

/** Legger en jobb i køen og starter den hvis ingen kjører. */
export async function koLeggTil({ navn, kommando, autoTranskriber = true, hoppOverValidering = false } = {}) {
  let stat = clipStats();
  if (hoppOverValidering) return koLeggTilRaa({ navn, kommando, stat });
  // Klipp uten tekst kan ikke trenes på – prøv lokal STT først, slik at
  // brukeren bare trenger å laste opp lyd og trykke start.
  let transkripsjon = null;
  if (autoTranskriber && stat.medTekst < stat.aktive) {
    transkripsjon = await transkriberAlle().catch((e) => ({ feilet: 1, feil: [String(e?.message || e)] }));
    stat = clipStats();
  }
  if (!stat.medTekst && transkripsjon?.feil?.length)
    throw new Error(`Auto-transkripsjon feilet: ${transkripsjon.feil[0]} – sett STT-adressen i SYSTEM → STEMME eller skriv teksten manuelt.`);
  if (!stat.medTekst) throw new Error("Ingen aktive klipp med transkripsjon – legg til tekst før du starter trening.");
  const cfg = ttsConfig();
  // Tomt felt? Bruk standardkommandoen så brukeren slipper å finne på noe.
  const cmd = String(kommando || cfg.treningKommando || byggKommando()).trim();

  // Validering før vi bruker timer på en jobb som uansett feiler.
  const plan = await treningPlan({ navn });
  if (!plan.kanStarte) throw new Error(plan.problemer[0] || "Treningssettet er ikke klart.");

  const id = randomUUID();
  const jobbNavn = rentNavn(navn);
  const utMappe = path.join(DATA_DIR, "stemmemodeller", `${jobbNavn}-${id.slice(0, 8)}`);
  await fs.mkdir(utMappe, { recursive: true });
  const manifestFil = path.join(utMappe, "metadata.csv");
  await fs.writeFile(manifestFil, trainingManifest());

  const jobb = {
    id,
    navn: jobbNavn,
    status: "kø",
    fremdrift: 0,
    klipp: stat.medTekst,
    sekunder: stat.aktiveSekunder,
    manifest: manifestFil,
    utMappe,
    kommando: cmd
      .replaceAll("{manifest}", manifestFil)
      .replaceAll("{mappe}", clipDir())
      .replaceAll("{navn}", jobbNavn)
      .replaceAll("{ut}", utMappe),
    logg: [],
    telemetri: [],
    mangler: plan.mangler,
    feil: "",
    opprettet: new Date().toISOString(),
    startet: "",
    ferdig: "",
  };
  lagre([...(jobbDoc().list || []), jobb]);
  kjorNeste();
  return jobb;
}

/** Kjører en vilkårlig kommando (f.eks. installasjon) som en jobb med logg. */
async function koLeggTilRaa({ navn, kommando, stat }) {
  const cmd = String(kommando || "").trim();
  if (!cmd) throw new Error("Ingen kommando å kjøre.");
  const id = randomUUID();
  const jobbNavn = rentNavn(navn);
  const utMappe = path.join(DATA_DIR, "stemmemodeller", `${jobbNavn}-${id.slice(0, 8)}`);
  await fs.mkdir(utMappe, { recursive: true });
  const jobb = {
    id,
    navn: jobbNavn,
    status: "kø",
    fremdrift: 0,
    klipp: stat?.medTekst || 0,
    sekunder: 0,
    manifest: "",
    utMappe,
    kommando: cmd.replaceAll("{ut}", utMappe).replaceAll("{navn}", jobbNavn),
    logg: [],
    telemetri: [],
    feil: "",
    opprettet: new Date().toISOString(),
    startet: "",
    ferdig: "",
  };
  lagre([...(jobbDoc().list || []), jobb]);
  kjorNeste();
  return jobb;
}

/** Avbryter en jobb som kjører, eller fjerner den fra køen. */
export function avbryt(id) {
  const p = prosesser.get(id);
  if (p) {
    p.kill("SIGTERM");
    prosesser.delete(id);
  }
  const j = hentJobb(id);
  if (!j) return false;
  if (j.status === "ferdig" || j.status === "feilet") return false;
  oppdater(id, { status: "avbrutt", ferdig: new Date().toISOString() });
  logg(id, "avbrutt av bruker");
  kjorNeste();
  return true;
}

export function slettJobb(id) {
  avbryt(id);
  lagre((jobbDoc().list || []).filter((j) => j.id !== id));
  return true;
}

/** Peker aktiv Piper-modell til en ferdigtrent .onnx-fil. */
export function publiser(id, modell) {
  const j = hentJobb(id);
  if (!j) throw new Error("Fant ikke jobben.");
  const fil = String(modell || j.modellFil || "").trim();
  if (!fil) throw new Error("Ingen modellfil å publisere.");
  saveTtsConfig({ modell: fil });
  oppdater(id, { publisert: fil });
  logg(id, `publisert som aktiv stemme: ${fil}`);
  return { modell: fil };
}

function kjorNeste() {
  if (prosesser.size) return;
  const neste = (jobbDoc().list || []).find((j) => j.status === "kø");
  if (!neste) return;
  start(neste.id);
}

function start(id) {
  const j = hentJobb(id);
  if (!j) return;
  oppdater(id, { status: "kjører", startet: new Date().toISOString(), fremdrift: 1 });
  logg(id, `starter: ${j.kommando}`);
  let p;
  try {
    p = spawn("bash", ["-lc", j.kommando], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    oppdater(id, { status: "feilet", feil: String(e?.message || e), ferdig: new Date().toISOString() });
    logg(id, `kunne ikke starte prosessen: ${String(e?.message || e)}`);
    return;
  }
  prosesser.set(id, p);

  // Sanntids ressursbruk (CPU/GPU/VRAM) mens jobben kjører – vises i GUI-et.
  const telemetriTimer = setInterval(async () => {
    const gpu = await gpuStatus().catch(() => null);
    const fri = os.freemem() / 1048576;
    const total = os.totalmem() / 1048576;
    const punkt = {
      tid: Date.now(),
      cpu: Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100),
      minneBruktMb: Math.round(total - fri),
      minneTotalMb: Math.round(total),
      gpuUtnyttelse: gpu?.utnyttelse ?? null,
      gpuBruktMb: gpu?.bruktMb ?? null,
      gpuTotalMb: gpu?.totalMb ?? null,
      tempC: gpu?.tempC ?? null,
    };
    const j2 = hentJobb(id);
    if (!j2 || j2.status !== "kjører") return;
    oppdater(id, { telemetri: [...(j2.telemetri || []), punkt].slice(-MAKS_TELEMETRI) });
  }, 5000);

  const lesLinjer = (strom) => {
    let rest = "";
    strom.setEncoding("utf8");
    strom.on("data", (d) => {
      rest += d;
      const deler = rest.split(/\r?\n/);
      rest = deler.pop() || "";
      for (const linje of deler) {
        if (!linje.trim()) continue;
        logg(id, linje.slice(0, 400));
        // Fange opp prosent eller "epoch x/y" fra typiske trenere.
        const pros = linje.match(/(\d{1,3})\s?%/);
        const epoke = linje.match(/epoch[^\d]*(\d+)\s*\/\s*(\d+)/i);
        if (epoke) oppdater(id, { fremdrift: Math.min(99, Math.round((Number(epoke[1]) / Math.max(1, Number(epoke[2]))) * 100)) });
        else if (pros) oppdater(id, { fremdrift: Math.min(99, Number(pros[1])) });
        const onnx = linje.match(/([\w./\-]+\.onnx)/);
        if (onnx) oppdater(id, { modellFil: onnx[1] });
      }
    });
  };
  lesLinjer(p.stdout);
  lesLinjer(p.stderr);

  p.on("close", async (kode) => {
    clearInterval(telemetriTimer);
    prosesser.delete(id);
    const gjeldende = hentJobb(id);
    if (gjeldende?.status === "avbrutt") return kjorNeste();
    if (kode === 0) {
      // Let etter en .onnx i utmappa hvis loggen ikke oppga den.
      let modellFil = gjeldende?.modellFil || "";
      if (!modellFil) {
        const filer = await fs.readdir(gjeldende?.utMappe || "", { recursive: true }).catch(() => []);
        const treff = filer.find((f) => String(f).endsWith(".onnx"));
        if (treff) modellFil = path.join(gjeldende.utMappe, String(treff));
      }
      oppdater(id, { status: "ferdig", fremdrift: 100, ferdig: new Date().toISOString(), modellFil });
      logg(id, modellFil ? `ferdig – modell: ${modellFil}` : "ferdig (fant ingen .onnx automatisk)");
    } else {
      const siste = (gjeldende?.logg || []).slice(-25).join("\n");
      const hint = tolkFeil(siste);
      oppdater(id, {
        status: "feilet",
        feil: `Prosessen avsluttet med kode ${kode}${hint ? ` – ${hint}` : ""}`,
        ferdig: new Date().toISOString(),
      });
      logg(id, `feilet med kode ${kode}${hint ? ` (${hint})` : ""}`);
    }
    kjorNeste();
  });
}

/** Oversetter typiske feil i loggen til noe brukeren kan handle på. */
function tolkFeil(logg = "") {
  const t = String(logg);
  if (/Kjør med sudo|sudo: a (terminal|password) is required|must be run as root|Permission denied/i.test(t))
    return "Installasjonen trenger root. Gi jarvis-brukeren passordfri sudo, eller kjør «sudo bash agent/scripts/installer-piper.sh» på noden.";
  if (/No such file or directory.*installer-piper|installer-piper\.sh: .*not found/i.test(t))
    return "Fant ikke installer-piper.sh – kjør git pull og sudo bash agent/scripts/update-jetson.sh.";
  if (/piper_train mangler|No module named .?piper_train/i.test(t))
    return "Piper-treningsmiljøet mangler. Kjør INSTALLER PIPER (eller sudo bash agent/scripts/installer-piper.sh).";

  if (/ffmpeg mangler|ffmpeg: not found/i.test(t)) return "ffmpeg mangler – sudo apt install ffmpeg.";
  if (/espeak/i.test(t) && /not found|mangler/i.test(t)) return "espeak-ng mangler – sudo apt install espeak-ng.";
  if (/out of memory|CUDA out of memory|Killed/i.test(t)) return "Tom for minne – velg presetet «Jetson · lav VRAM».";
  if (/ingen lydfil|No such file/i.test(t)) return "Fant ikke lydfilene som manifestet peker på.";
  if (/Fant ingen checkpoint/i.test(t)) return "Treningen rakk aldri å lagre et checkpoint – øk epoker eller sjekk loggen over.";
  return "";
}

export function koStatus() {
  const list = listJobber();
  return {
    jobber: list,
    kjorer: list.find((j) => j.status === "kjører")?.id || "",
    iKo: list.filter((j) => j.status === "kø").length,
  };
}
