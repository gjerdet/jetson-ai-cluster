import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";

const STATE_DIR = process.env.JARVIS_STATE_DIR || "/var/lib/jarvis";
const REQUEST_FILE = `${STATE_DIR}/update-request`;
const LOG_FILE = process.env.JARVIS_UPDATE_LOG || "/var/log/jarvis/oppdatering.log";
const SERVICE = "jarvis-update.service";
const UNIT_FILE = "/etc/systemd/system/jarvis-update.service";
const SUDOERS_FILE = "/etc/sudoers.d/jarvis-update";
const SOURCE_FILE = "/etc/jarvis/source-dir";

const finnes = async (sti) => {
  try {
    await access(sti, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const gyldigRef = (value) => {
  const ref = String(value || "main").trim();
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(ref) || ref.includes("..") || ref.startsWith("/")) {
    throw new Error("Ugyldig versjon eller Git-referanse.");
  }
  return ref;
};

const kjor = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (data) => (out += data.toString()));
    child.stderr.on("data", (data) => (out += data.toString()));
    child.on("error", (error) => resolve({ ok: false, text: String(error?.message || error) }));
    child.on("close", (code) => resolve({ ok: code === 0, text: out.trim() }));
  });

const systemctl = (args) => kjor("systemctl", args);

/** Sjekker at alt oppdateringen trenger faktisk er installert på noden. */
export async function updateDiagnose() {
  const [unit, sudoers, source, kjorerSomRoot] = await Promise.all([
    finnes(UNIT_FILE),
    finnes(SUDOERS_FILE),
    finnes(SOURCE_FILE),
    Promise.resolve(typeof process.getuid === "function" ? process.getuid() === 0 : false),
  ]);
  const mangler = [];
  if (!unit) mangler.push("Tjenesten jarvis-update.service mangler på noden.");
  if (!sudoers && !kjorerSomRoot) mangler.push("Agenten mangler tillatelse til å starte oppdateringstjenesten (sudoers).");
  if (!source) mangler.push("/etc/jarvis/source-dir mangler – Jarvis vet ikke hvor kildekoden ligger.");
  return {
    klar: mangler.length === 0,
    mangler,
    rettelse: mangler.length ? "Kjør `sudo bash oppsett.sh -s` én gang fra kilde-repoet for å installere oppdateringstjenesten." : null,
  };
}

export async function updateStatus() {
  const active = await systemctl(["is-active", SERVICE]);
  let logg = "";
  try {
    logg = await readFile(LOG_FILE, "utf8");
    logg = logg.split("\n").slice(-120).join("\n").trim();
  } catch {
    logg = "Ingen oppdateringslogg ennå.";
  }
  const diagnose = await updateDiagnose();
  return {
    aktiv: active.text === "active" || active.text === "activating",
    status: active.text || "ukjent",
    logg,
    klar: diagnose.klar,
    mangler: diagnose.mangler,
    rettelse: diagnose.rettelse,
    oppdatert: Date.now(),
  };
}

export async function startUpdate(value) {
  const current = await updateStatus();
  if (current.aktiv) throw new Error("En oppdatering kjører allerede.");
  if (!current.klar) {
    throw new Error(`${current.mangler.join(" ")} ${current.rettelse ?? ""}`.trim());
  }

  const ref = gyldigRef(value);
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(REQUEST_FILE, `${ref}\n`, { mode: 0o600 });

  // Kjører agenten som root trengs ikke sudo. Ellers prøves begge vanlige
  // systemctl-stier, siden sudoers-regelen må treffe eksakt sti.
  const forsok = [];
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    forsok.push(["systemctl", ["start", "--no-block", SERVICE]]);
  }
  forsok.push(["/usr/bin/sudo", ["-n", "/usr/bin/systemctl", "start", "--no-block", SERVICE]]);
  forsok.push(["/usr/bin/sudo", ["-n", "/bin/systemctl", "start", "--no-block", SERVICE]]);

  let siste = { ok: false, text: "" };
  for (const [cmd, args] of forsok) {
    siste = await kjor(cmd, args);
    if (siste.ok) {
      return { ok: true, ref, melding: "Oppdateringen er startet. GUI-et kan bli utilgjengelig noen minutter." };
    }
  }

  throw new Error(
    `Oppdateringstjenesten kunne ikke startes: ${siste.text || "ukjent feil"}. Kjør \`sudo bash oppsett.sh -s\` fra kilde-repoet én gang.`,
  );
}
