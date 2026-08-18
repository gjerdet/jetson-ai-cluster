/**
 * Enkle systemverktøy som kjøres direkte på Jetson-noden (ikke i sandkassen):
 * lagringsstatus (df) og IP-tilkoplingssjekk (ping + valgfri portprobe).
 */
import { execFile } from "node:child_process";
import net from "node:net";

const IP_RE = /^[a-zA-Z0-9._-]+$/;

function kjor(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (feil, ut, err) => {
      resolve({ ok: !feil, ut: String(ut || ""), feil: feil ? String(err || feil.message) : "" });
    });
  });
}

/** Lagring på denne maskinen: alle ekte filsystem fra `df -B1`. */
export async function lagringsStatus() {
  const r = await kjor("df", ["-B1", "-x", "tmpfs", "-x", "devtmpfs", "-x", "overlay"]);
  if (!r.ok) return { ok: false, feil: r.feil || "df feilet" };
  const linjer = r.ut.trim().split("\n").slice(1);
  const disker = linjer
    .map((l) => l.trim().split(/\s+/))
    .filter((d) => d.length >= 6)
    .map((d) => {
      const total = Number(d[1]) || 0;
      const brukt = Number(d[2]) || 0;
      const ledig = Number(d[3]) || 0;
      return {
        filsystem: d[0],
        montert: d[5],
        totalGb: +(total / 1e9).toFixed(1),
        bruktGb: +(brukt / 1e9).toFixed(1),
        ledigGb: +(ledig / 1e9).toFixed(1),
        bruktProsent: total ? Math.round((brukt / total) * 100) : 0,
      };
    });
  const rot = disker.find((d) => d.montert === "/") || disker[0] || null;
  return {
    ok: true,
    vert: process.env.HOSTNAME || "",
    rot,
    disker,
    advarsel: rot && rot.bruktProsent >= 85 ? `Lite plass igjen på ${rot.montert} (${rot.bruktProsent} %).` : "",
  };
}

function portProbe(vert, port, timeout = 1500) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host: vert, port, timeout });
    const ferdig = (aapen, feil = "") => {
      sock.destroy();
      resolve({ port, aapen, ms: Date.now() - t0, feil });
    };
    sock.on("connect", () => ferdig(true));
    sock.on("timeout", () => ferdig(false, "tidsavbrudd"));
    sock.on("error", (e) => ferdig(false, String(e?.message || e)));
  });
}

/** Sjekk om en IP/vert svarer: ping + valgfrie porter. */
export async function ipSjekk(vert, porter = []) {
  const m = String(vert || "").trim();
  if (!m || !IP_RE.test(m)) throw new Error(`Ugyldig vert «${vert}».`);
  const p = await kjor("ping", ["-c", "2", "-W", "1", m], 6000);
  const svarMs = Number((p.ut.match(/= [\d.]+\/([\d.]+)\//) || [])[1]) || null;
  const tap = Number((p.ut.match(/(\d+)% packet loss/) || [])[1]);
  const liste = (Array.isArray(porter) ? porter : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
    .slice(0, 8);
  const portResultat = await Promise.all(liste.map((port) => portProbe(m, port)));
  return {
    ok: true,
    vert: m,
    svarer: p.ok,
    svarMs,
    pakketapProsent: Number.isFinite(tap) ? tap : null,
    porter: portResultat,
    raa: p.ut.trim().slice(0, 800),
  };
}
