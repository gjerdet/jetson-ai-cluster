/**
 * Lokal maskinvare- og tjenestestatus for denne noden.
 *
 * Brukes to steder:
 *  1) Klyngehelse-siden i HUD-en (GPU, modeller, tjenester per node).
 *  2) Adaptiv lastbalansering – noder med mye ledig GPU får flere oppgaver.
 *
 * Alt er «best effort»: mangler nvidia-smi eller systemctl, faller vi tilbake
 * på Jetson-sysfs og enkle prosess-sjekker i stedet for å feile.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";

const TJENESTER = ["jarvis-agent", "ollama", "jarvis-gui", "mosquitto"];

function kjor(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, encoding: "utf8" }, (err, stdout) => {
        resolve(err && !stdout ? null : String(stdout || "").trim());
      });
    } catch {
      resolve(null);
    }
  });
}

/** Diskret GPU via nvidia-smi (fungerer på Jetson med JetPack 6). */
async function nvidiaSmi() {
  const ut = await kjor("nvidia-smi", [
    "--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu",
    "--format=csv,noheader,nounits",
  ]);
  if (!ut) return null;
  const [navn, total, brukt, util, temp] = ut.split("\n")[0].split(",").map((s) => s.trim());
  const totalMb = Number(total);
  const bruktMb = Number(brukt);
  if (!Number.isFinite(totalMb) || totalMb <= 0) return null;
  return {
    kilde: "nvidia-smi",
    navn: navn || "NVIDIA GPU",
    totalMb,
    bruktMb: Number.isFinite(bruktMb) ? bruktMb : 0,
    frittMb: Math.max(0, totalMb - (Number.isFinite(bruktMb) ? bruktMb : 0)),
    utnyttelse: Number.isFinite(Number(util)) ? Number(util) : null,
    tempC: Number.isFinite(Number(temp)) ? Number(temp) : null,
  };
}

/**
 * Jetson deler minne mellom CPU og GPU. Uten nvidia-smi bruker vi
 * systemminnet som mål på hvor mye modellene har å gå på, og leser
 * GPU-lasten fra sysfs (load-filen finnes på alle Tegra-brikker).
 */
async function jetsonSysfs() {
  const last = await readFile("/sys/devices/gpu.0/load", "utf8").catch(() =>
    readFile("/sys/devices/platform/gpu.0/load", "utf8").catch(() => null),
  );
  const temp = await readFile("/sys/devices/virtual/thermal/thermal_zone0/temp", "utf8").catch(() => null);
  const totalMb = Math.round(os.totalmem() / 1048576);
  const frittMb = Math.round(os.freemem() / 1048576);
  const utnyttelse = last == null ? null : Math.round(Number(last.trim()) / 10);
  if (last == null && !process.env.JARVIS_ANTA_JETSON) {
    return { kilde: "system", navn: "Delt minne (ingen GPU funnet)", totalMb, bruktMb: totalMb - frittMb, frittMb, utnyttelse: null, tempC: null };
  }
  return {
    kilde: "tegra",
    navn: "Jetson (delt minne)",
    totalMb,
    bruktMb: totalMb - frittMb,
    frittMb,
    utnyttelse: Number.isFinite(utnyttelse) ? Math.min(100, Math.max(0, utnyttelse)) : null,
    tempC: temp == null ? null : Math.round(Number(temp.trim()) / 1000),
  };
}

export async function gpuStatus() {
  return (await nvidiaSmi()) ?? (await jetsonSysfs());
}

/** systemd-status per tjeneste (ukjent når systemctl ikke finnes). */
export async function tjenesteStatus() {
  const har = await kjor("sh", ["-c", "command -v systemctl || true"]);
  if (!har) return TJENESTER.map((navn) => ({ navn, status: "ukjent" }));
  return Promise.all(
    TJENESTER.map(async (navn) => ({
      navn,
      status: (await kjor("systemctl", ["is-active", navn])) || "inactive",
    })),
  );
}

const trimUrl = (u) => String(u || "").replace(/\/+$/, "").replace(/\/v1$/, "");

/** Modeller som finnes lokalt og hvilke som er lastet i minnet akkurat nå. */
export async function modellStatus(ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434", ms = 4000) {
  const base = trimUrl(ollamaUrl);
  const hent = async (sti) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(base + sti, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };
  const tags = await hent("/api/tags");
  if (!tags) return { ok: false, base, modeller: [], lastet: [], feil: "Får ikke kontakt med Ollama" };
  const ps = await hent("/api/ps");
  return {
    ok: true,
    base,
    modeller: (tags.models || []).map((m) => ({
      navn: m.name,
      storrelseMb: Math.round((m.size || 0) / 1048576),
    })),
    lastet: (ps?.models || []).map((m) => ({
      navn: m.name,
      vramMb: Math.round((m.size_vram || m.size || 0) / 1048576),
      utloper: m.expires_at || null,
    })),
    feil: null,
  };
}

/** Samlet øyeblikksbilde av denne noden – det andre noder spør etter. */
export async function lokalSnapshot() {
  const [gpu, tjenester, modeller] = await Promise.all([gpuStatus(), tjenesteStatus(), modellStatus()]);
  const lastet = os.loadavg?.() ?? [0, 0, 0];
  return {
    vert: os.hostname(),
    tid: Date.now(),
    oppetidSek: Math.round(os.uptime()),
    gpu,
    tjenester,
    modeller,
    minne: {
      totalMb: Math.round(os.totalmem() / 1048576),
      frittMb: Math.round(os.freemem() / 1048576),
    },
    last: Math.round((lastet[0] || 0) * 100) / 100,
    kjerner: os.cpus?.()?.length || 0,
  };
}
