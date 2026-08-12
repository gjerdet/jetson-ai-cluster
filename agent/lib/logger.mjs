/**
 * Logglesing for HUD-en: systemd-journaler for agent/GUI/Ollama, samt
 * oppsett- og helsesjekk-loggene som `oppsett.sh` skriver.
 *
 * Alt er strengt hvitelistet – frontend kan aldri be om vilkårlige filer
 * eller vilkårlige systemd-enheter.
 */
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const LOGG_DIR = process.env.JARVIS_LOG_DIR || "/var/log/jarvis";

/** Hvitelistede kilder. `unit` = journalctl, `fil` = ren tekstfil. */
export const LOGG_KILDER = [
  { id: "agent", navn: "Backend-agent", unit: "jarvis-agent" },
  { id: "gui", navn: "Web-GUI", unit: "jarvis-gui" },
  { id: "ollama", navn: "Ollama", unit: "ollama" },
  { id: "oppsett", navn: "Oppsett (oppsett.sh)", fil: `${LOGG_DIR}/oppsett.log` },
  { id: "helsesjekk", navn: "Helsesjekk", fil: `${LOGG_DIR}/helsesjekk.log` },
];

const kildeFor = (id) => LOGG_KILDER.find((k) => k.id === String(id || "").trim());

const kjor = (kommando, args, timeoutMs = 8000) =>
  new Promise((resolve) => {
    let ut = "";
    let feil = "";
    let barn;
    try {
      barn = spawn(kommando, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, ut: "", feil: String(e?.message || e) });
      return;
    }
    const t = setTimeout(() => barn.kill("SIGKILL"), timeoutMs);
    barn.stdout.on("data", (d) => (ut += d.toString()));
    barn.stderr.on("data", (d) => (feil += d.toString()));
    barn.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, ut: "", feil: String(e?.message || e) });
    });
    barn.on("close", (kode) => {
      clearTimeout(t);
      resolve({ ok: kode === 0, ut, feil });
    });
  });

/** Er systemd-enheten aktiv? Returnerer «active», «inactive», «ukjent» … */
export async function tjenesteStatus(unit) {
  const r = await kjor("systemctl", ["is-active", unit], 5000);
  const tekst = (r.ut || r.feil || "").trim();
  return tekst || "ukjent";
}

const halen = (tekst, linjer) => {
  const alle = String(tekst).split("\n");
  return alle.slice(Math.max(0, alle.length - linjer)).join("\n").trimEnd();
};

/**
 * Henter siste loggposter for en kilde.
 * @param {string} id      kilde-id fra LOGG_KILDER
 * @param {object} valg    { linjer = 200, siden = "" }
 */
export async function hentLogg(id, valg = {}) {
  const kilde = kildeFor(id);
  if (!kilde) throw new Error(`Ukjent loggkilde «${id}».`);
  const linjer = Math.min(2000, Math.max(10, Number(valg.linjer) || 200));
  const siden = String(valg.siden || "").slice(0, 40);

  if (kilde.unit) {
    const args = ["-u", kilde.unit, "-n", String(linjer), "--no-pager", "--output=short-iso"];
    if (siden) args.push("--since", siden);
    const r = await kjor("journalctl", args, 10_000);
    const status = await tjenesteStatus(kilde.unit);
    return {
      kilde: kilde.id,
      navn: kilde.navn,
      type: "systemd",
      enhet: kilde.unit,
      status,
      tekst: (r.ok ? r.ut : `${r.ut}\n${r.feil}`).trimEnd() || "(ingen loggposter)",
      tid: Date.now(),
    };
  }

  try {
    const info = await stat(kilde.fil);
    const innhold = await readFile(kilde.fil, "utf8");
    return {
      kilde: kilde.id,
      navn: kilde.navn,
      type: "fil",
      sti: kilde.fil,
      status: "fil",
      endret: info.mtimeMs,
      tekst: halen(innhold, linjer) || "(tom fil)",
      tid: Date.now(),
    };
  } catch {
    return {
      kilde: kilde.id,
      navn: kilde.navn,
      type: "fil",
      sti: kilde.fil,
      status: "mangler",
      tekst: `Fant ikke ${kilde.fil}. Kjør «sudo bash oppsett.sh» for å opprette den.`,
      tid: Date.now(),
    };
  }
}

/** Oversikt over kildene med tjenestestatus – brukes til fanene i HUD-en. */
export async function loggKilder() {
  return Promise.all(
    LOGG_KILDER.map(async (k) => ({
      id: k.id,
      navn: k.navn,
      type: k.unit ? "systemd" : "fil",
      enhet: k.unit ?? null,
      sti: k.fil ?? null,
      status: k.unit ? await tjenesteStatus(k.unit) : "fil",
    })),
  );
}
