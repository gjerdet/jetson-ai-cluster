/**
 * Sandkasse for Jarvis: kjører generert kode i en isolert Node-VM.
 * Kan lese lokale tjenester på eget LAN (Ollama, MQTT-HTTP, TrueNAS, Proxmox,
 * UniFi …), men aldri skrive, aldri ut på internett, og aldri child_process.
 */
import vm from "node:vm";

const STANDARD = {
  timeoutMs: 8000,
  maksKall: 8,
  maksSvarBytes: 256 * 1024,
};

/** True for adresser i private/lenke-lokale områder + loopback. */
export function erPrivatVert(vert) {
  const h = String(vert || "").toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Lesende fetch med hviteliste, kall-tak og loggføring. */
function lagFetch(logg, grenser) {
  let brukt = 0;
  return async function sandkasseFetch(input, init = {}) {
    const url = new URL(String(input));
    const metode = String(init.method || "GET").toUpperCase();
    if (metode !== "GET" && metode !== "HEAD")
      throw new Error(`Sandkassen tillater bare lesende kall (GET/HEAD), ikke ${metode}.`);
    if (!erPrivatVert(url.hostname))
      throw new Error(`Sandkassen når bare lokale adresser. «${url.hostname}» er utenfor eget nett.`);
    if (++brukt > grenser.maksKall) throw new Error(`Sandkassen har brukt opp kall-budsjettet (${grenser.maksKall}).`);

    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(grenser.timeoutMs, 6000));
    try {
      const r = await fetch(url, { method: metode, signal: ctrl.signal, headers: init.headers || {} });
      const tekst = (await r.text()).slice(0, grenser.maksSvarBytes);
      logg.push({ url: url.toString(), status: r.status, ms: Date.now() - t0 });
      return {
        ok: r.ok,
        status: r.status,
        text: async () => tekst,
        json: async () => JSON.parse(tekst),
      };
    } catch (e) {
      logg.push({ url: url.toString(), feil: String(e?.message || e), ms: Date.now() - t0 });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Kjør kildekode som `module.exports = async (args) => ...`.
 * Returnerer { ok, resultat|feil, logg, ms }.
 */
export async function kjorISandkasse(kode, args = {}, opts = {}) {
  const grenser = { ...STANDARD, ...opts };
  const logg = [];
  const utskrift = [];
  const t0 = Date.now();

  const context = vm.createContext({
    args,
    module: { exports: {} },
    exports: {},
    URL,
    JSON,
    Math,
    Date,
    Number,
    String,
    Array,
    Object,
    Promise,
    fetch: lagFetch(logg, grenser),
    console: {
      log: (...a) => utskrift.push(a.map(String).join(" ")),
      error: (...a) => utskrift.push(`FEIL: ${a.map(String).join(" ")}`),
      warn: (...a) => utskrift.push(`ADVARSEL: ${a.map(String).join(" ")}`),
    },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 2000)),
    require: () => {
      throw new Error("require er ikke tillatt i sandkassen.");
    },
    process: undefined,
  });

  try {
    new vm.Script(kode, { timeout: grenser.timeoutMs }).runInContext(context, {
      timeout: grenser.timeoutMs,
    });
    const fn = context.module.exports;
    if (typeof fn !== "function") throw new Error("Koden eksporterer ikke en funksjon (module.exports = async (args) => …).");
    const resultat = await Promise.race([
      fn(args),
      new Promise((_, avvis) => setTimeout(() => avvis(new Error("Tidsavbrudd i sandkassen")), grenser.timeoutMs)),
    ]);
    return { ok: true, resultat, logg, utskrift, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, feil: String(e?.message || e), logg, utskrift, ms: Date.now() - t0 };
  }
}
