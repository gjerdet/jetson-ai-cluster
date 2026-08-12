import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const STATE_DIR = process.env.JARVIS_STATE_DIR || "/var/lib/jarvis";
const REQUEST_FILE = `${STATE_DIR}/update-request`;
const LOG_FILE = process.env.JARVIS_UPDATE_LOG || "/var/log/jarvis/oppdatering.log";
const SERVICE = "jarvis-update.service";

const gyldigRef = (value) => {
  const ref = String(value || "main").trim();
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(ref) || ref.includes("..") || ref.startsWith("/")) {
    throw new Error("Ugyldig versjon eller Git-referanse.");
  }
  return ref;
};

const systemctl = (args) =>
  new Promise((resolve) => {
    const child = spawn("systemctl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (data) => (out += data.toString()));
    child.stderr.on("data", (data) => (out += data.toString()));
    child.on("error", (error) => resolve({ ok: false, text: String(error?.message || error) }));
    child.on("close", (code) => resolve({ ok: code === 0, text: out.trim() }));
  });

export async function updateStatus() {
  const active = await systemctl(["is-active", SERVICE]);
  let logg = "";
  try {
    logg = await readFile(LOG_FILE, "utf8");
    logg = logg.split("\n").slice(-120).join("\n").trim();
  } catch {
    logg = "Ingen oppdateringslogg ennå.";
  }
  return {
    aktiv: active.text === "active" || active.text === "activating",
    status: active.text || "ukjent",
    logg,
    oppdatert: Date.now(),
  };
}

export async function startUpdate(value) {
  const current = await updateStatus();
  if (current.aktiv) throw new Error("En oppdatering kjører allerede.");

  const ref = gyldigRef(value);
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(REQUEST_FILE, `${ref}\n`, { mode: 0o600 });

  const started = await new Promise((resolve) => {
    const child = spawn("/usr/bin/sudo", ["-n", "/usr/bin/systemctl", "start", "--no-block", SERVICE], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    child.stdout.on("data", (data) => (text += data.toString()));
    child.stderr.on("data", (data) => (text += data.toString()));
    child.on("error", (error) => resolve({ ok: false, text: String(error?.message || error) }));
    child.on("close", (code) => resolve({ ok: code === 0, text: text.trim() }));
  });

  if (!started.ok) {
    throw new Error(started.text || "Oppdateringstjenesten kunne ikke startes. Kjør oppsett.sh på nytt én gang.");
  }
  return { ok: true, ref, melding: "Oppdateringen er startet. GUI-et kan bli utilgjengelig noen minutter." };
}