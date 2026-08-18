/**
 * Maskin-ID-kort for Jarvis.
 * Samler hvem og hva denne maskinen faktisk er – målt, ikke gjettet.
 * Kortet caches og friskes opp hvert 5. minutt, og legges først i systemprompten
 * slik at agenten aldri må anta noe om egen maskinvare eller eget nett.
 */
import os from "node:os";
import fs from "node:fs";
import { lokalSnapshot } from "./gpu.mjs";
import { doc } from "./store.mjs";

const FRISK_MS = 5 * 60 * 1000;

let kort = null;
let bygger = null;

/** Aktivt LAN-grensesnitt (første ikke-interne IPv4). */
export function nettverkskort() {
  const ut = [];
  const alle = os.networkInterfaces();
  for (const [navn, liste] of Object.entries(alle)) {
    for (const i of liste || []) {
      if (i.family !== "IPv4" && i.family !== 4) continue;
      if (i.internal) continue;
      const bits = maskeTilBits(i.netmask);
      ut.push({
        grensesnitt: navn,
        ip: i.address,
        maske: i.netmask,
        cidr: bits ? `${nettadresse(i.address, bits)}/${bits}` : "",
        mac: i.mac,
      });
    }
  }
  return ut;
}

function maskeTilBits(maske) {
  if (!maske) return 0;
  return maske
    .split(".")
    .map((n) => Number(n).toString(2).padStart(8, "0"))
    .join("")
    .split("1").length - 1;
}

function nettadresse(ip, bits) {
  const okt = ip.split(".").map(Number);
  const tall = ((okt[0] << 24) >>> 0) + (okt[1] << 16) + (okt[2] << 8) + okt[3];
  const maske = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const nett = (tall & maske) >>> 0;
  return [(nett >>> 24) & 255, (nett >>> 16) & 255, (nett >>> 8) & 255, nett & 255].join(".");
}

function kortModell() {
  // Jetson-plattformen legger modellnavnet i device tree.
  try {
    return fs.readFileSync("/proc/device-tree/model", "utf8").replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

async function bygg() {
  const snap = await lokalSnapshot().catch(() => null);
  const nett = nettverkskort();
  const noder = doc("nodes", { list: [] }).list || [];
  return {
    tid: Date.now(),
    vert: os.hostname(),
    modell: kortModell() || `${os.type()} ${os.arch()}`,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    kjerner: os.cpus?.()?.length || 0,
    minneMb: Math.round(os.totalmem() / 1048576),
    fritt_minne_mb: Math.round(os.freemem() / 1048576),
    oppetidSek: Math.round(os.uptime()),
    last: Math.round((os.loadavg?.()[0] || 0) * 100) / 100,
    nett,
    primaerIp: nett[0]?.ip || "",
    subnett: nett[0]?.cidr || "",
    gpu: snap?.gpu ?? null,
    tjenester: snap?.tjenester ?? null,
    modeller: (snap?.modeller?.installerte || []).map((m) => m.navn),
    lastedeModeller: (snap?.modeller?.lastet || []).map((m) => m.navn),
    klynge: noder.map((n) => ({ id: n.id, navn: n.navn ?? n.name, baseUrl: n.baseUrl })),
  };
}

/** Ferskt maskin-ID-kort. Bygger på nytt hvis cachen er eldre enn 5 minutter. */
export async function maskinKort({ tving = false } = {}) {
  if (!tving && kort && Date.now() - kort.tid < FRISK_MS) return kort;
  if (bygger) return bygger;
  bygger = bygg()
    .then((k) => {
      kort = k;
      return k;
    })
    .finally(() => {
      bygger = null;
    });
  return bygger;
}

/** Cachet kort uten å bygge på nytt (null hvis aldri bygget). */
export function cachetKort() {
  return kort;
}

/** Kompakt tekst til systemprompten. */
export function kortTekst(k) {
  if (!k) return "";
  const nett = k.nett.map((n) => `${n.grensesnitt} ${n.ip} (${n.cidr || "ukjent maske"})`).join(", ");
  return [
    "MASKIN-ID-KORT (målt av backend, ikke gjett – dette ER deg):",
    `- Vert: ${k.vert} · Modell: ${k.modell}`,
    `- OS: ${k.os} · ${k.kjerner} kjerner · ${k.minneMb} MB RAM (${k.fritt_minne_mb} MB fritt) · last ${k.last}`,
    `- Nett: ${nett || "ingen aktive LAN-grensesnitt"} · primær IP ${k.primaerIp || "ukjent"} · subnett ${k.subnett || "ukjent"}`,
    k.gpu ? `- GPU: ${JSON.stringify(k.gpu).slice(0, 240)}` : "- GPU: ikke målt",
    `- Lokale modeller: ${k.modeller.join(", ") || "ingen"}${k.lastedeModeller.length ? ` (lastet: ${k.lastedeModeller.join(", ")})` : ""}`,
    `- Klyngenoder: ${k.klynge.map((n) => `${n.navn || n.id} @ ${n.baseUrl}`).join(", ") || "kun denne noden"}`,
    `- Målt ${new Date(k.tid).toLocaleString("nb-NO")}. Er tallet eldre enn 5 minutter, mål på nytt før du svarer.`,
  ].join("\n");
}

/** Selvtest: stemmer kortet med målt virkelighet? */
export async function selvtest() {
  const ferskt = await maskinKort({ tving: true });
  const avvik = [];
  if (!ferskt.primaerIp) avvik.push("Fant ingen aktiv LAN-IP.");
  if (!ferskt.modeller.length) avvik.push("Ingen lokale modeller er installert (ollama pull mangler).");
  if (ferskt.tjenester && ferskt.tjenester.ollama === false) avvik.push("Ollama-tjenesten svarer ikke.");
  return { ok: avvik.length === 0, avvik, kort: ferskt };
}
