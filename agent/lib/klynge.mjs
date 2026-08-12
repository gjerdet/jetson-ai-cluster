/**
 * Klyngehelse og konfigdistribusjon.
 *
 * - `klyngeHelse()` spør hver node om GPU, modeller og tjenester og gjør om
 *   svaret til en enkel status (ok / advarsel / feil) med tydelige grunner.
 * - Resultatet mates inn i lastbalansereren slik at rutingen blir adaptiv:
 *   noder med mye ledig GPU og frisk helse får flere forespørsler.
 * - `distribuerKonfig()` sender konfig-pakken til alle noder og verifiserer
 *   etterpå at hver node faktisk har fått nøyaktig samme innhold.
 */
import { lokalSnapshot } from "./gpu.mjs";
import { settRessurser, nodeStats } from "./balancer.mjs";
import { sjekksum } from "./versjon.mjs";

const CACHE_MS = 10_000;
let cache = { tid: 0, data: null };

const trim = (u) => String(u || "").replace(/\/+$/, "");
const agentBase = (node) => trim(node.agentUrl || "");

async function hentJson(url, { timeout = 6000, token = "", method = "GET", body = null } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}`, "x-agent-token": token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const tekst = await r.text();
    let data = null;
    try {
      data = tekst ? JSON.parse(tekst) : null;
    } catch {
      data = null;
    }
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** Regner om et snapshot til status + varsler HUD-en kan farge på. */
export function vurderSnapshot(snap, { ventetModell = "" } = {}) {
  const varsler = [];
  let niva = "ok";
  const hev = (n) => {
    if (n === "feil" || (n === "advarsel" && niva === "ok")) niva = n;
  };

  const gpu = snap?.gpu;
  const fritt = Number(gpu?.frittMb) || 0;
  const total = Number(gpu?.totalMb) || 0;
  const frittProsent = total ? Math.round((fritt / total) * 100) : null;
  if (frittProsent != null && frittProsent < 8) {
    varsler.push(`Kun ${frittProsent}% GPU-minne ledig`);
    hev("feil");
  } else if (frittProsent != null && frittProsent < 20) {
    varsler.push(`Lite GPU-minne ledig (${frittProsent}%)`);
    hev("advarsel");
  }
  if (Number(gpu?.tempC) >= 85) {
    varsler.push(`Høy GPU-temperatur (${gpu.tempC} °C)`);
    hev("feil");
  } else if (Number(gpu?.tempC) >= 75) {
    varsler.push(`GPU går varm (${gpu.tempC} °C)`);
    hev("advarsel");
  }

  const mod = snap?.modeller;
  if (!mod?.ok) {
    varsler.push(mod?.feil || "Ollama svarer ikke");
    hev("feil");
  } else {
    if (!mod.modeller?.length) {
      varsler.push("Ingen modeller lastet ned");
      hev("feil");
    } else if (ventetModell && !mod.modeller.some((m) => m.navn === ventetModell || m.navn.startsWith(`${ventetModell}:`))) {
      varsler.push(`Mangler modellen «${ventetModell}»`);
      hev("advarsel");
    }
  }

  for (const t of snap?.tjenester || []) {
    if (t.status === "failed") {
      varsler.push(`Tjenesten ${t.navn} har feilet`);
      hev("feil");
    } else if (t.navn === "jarvis-agent" && t.status === "inactive") {
      varsler.push("jarvis-agent kjører ikke");
      hev("feil");
    } else if (t.navn === "ollama" && t.status === "inactive") {
      varsler.push("ollama kjører ikke");
      hev("advarsel");
    }
  }

  return { niva, varsler, frittProsent };
}

/** Sjekker én node: full snapshot om den har agent, ellers Ollama-probe. */
export async function sjekkNode(node, { token = "" } = {}) {
  const t0 = Date.now();
  const base = agentBase(node);
  const felles = { id: node.id, navn: node.navn, baseUrl: node.baseUrl, agentUrl: base || null, modell: node.modell || "" };
  try {
    let snapshot;
    let via;
    if (base) {
      const svar = await hentJson(`${base}/api/klynge/lokal`, { token: node.agentToken || token });
      snapshot = svar?.snapshot ?? svar;
      via = "agent";
    } else {
      // Uten agent på noden nøyer vi oss med det Ollama kan fortelle.
      const { modellStatus } = await import("./gpu.mjs");
      const modeller = await modellStatus(node.baseUrl);
      if (!modeller.ok) throw new Error(modeller.feil || "Ollama svarer ikke");
      snapshot = { vert: node.navn, tid: Date.now(), gpu: null, tjenester: [], modeller, minne: null, last: null };
      via = "ollama";
    }
    const svarMs = Date.now() - t0;
    const vurdering = vurderSnapshot(snapshot, { ventetModell: node.modell });
    settRessurser(node.id, {
      frittGpuMb: Number(snapshot?.gpu?.frittMb) || null,
      frittProsent: vurdering.frittProsent,
      utnyttelse: Number.isFinite(Number(snapshot?.gpu?.utnyttelse)) ? Number(snapshot.gpu.utnyttelse) : null,
      niva: vurdering.niva,
      sjekket: Date.now(),
    });
    return { ...felles, online: true, via, svarMs, snapshot, ...vurdering, feil: null };
  } catch (e) {
    const feil = String(e?.message || e);
    settRessurser(node.id, { frittGpuMb: null, frittProsent: null, utnyttelse: null, niva: "feil", sjekket: Date.now() });
    return {
      ...felles,
      online: false,
      via: base ? "agent" : "ollama",
      svarMs: Date.now() - t0,
      snapshot: null,
      niva: "feil",
      varsler: [feil],
      frittProsent: null,
      feil,
    };
  }
}

/** Helsen til hele klyngen, inkludert denne maskinen. */
export async function klyngeHelse(noder, { token = "", force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.tid < CACHE_MS) return cache.data;
  const liste = Array.isArray(noder) ? noder : [];
  const lokal = await lokalSnapshot().catch(() => null);
  const lokalVurdering = lokal ? vurderSnapshot(lokal) : { niva: "feil", varsler: ["Fant ikke lokal status"], frittProsent: null };
  const eksterne = await Promise.all(liste.map((n) => sjekkNode(n, { token })));
  const beriket = eksterne.map((n) => ({ ...n, balanserer: nodeStats(n.id) }));
  const alle = [
    {
      id: "lokal",
      navn: `${lokal?.vert || "denne maskinen"} (backend)`,
      baseUrl: "",
      agentUrl: null,
      modell: "",
      online: true,
      via: "lokal",
      svarMs: 0,
      snapshot: lokal,
      balanserer: null,
      feil: null,
      ...lokalVurdering,
    },
    ...beriket,
  ];
  const data = {
    tid: Date.now(),
    antall: alle.length,
    feil: alle.filter((n) => n.niva === "feil").length,
    advarsler: alle.filter((n) => n.niva === "advarsel").length,
    niva: alle.some((n) => n.niva === "feil") ? "feil" : alle.some((n) => n.niva === "advarsel") ? "advarsel" : "ok",
    noder: alle,
  };
  cache = { tid: Date.now(), data };
  return data;
}

export function tomKlyngeCache() {
  cache = { tid: 0, data: null };
}

/**
 * Sender konfig-pakken til hver node som har en agent, og verifiserer
 * etterpå at nodens egen eksport har samme sjekksum som det vi sendte.
 */
export async function distribuerKonfig(noder, pakke, { modus = "flett", bare = [], token = "" } = {}) {
  const mål = (Array.isArray(noder) ? noder : []).filter((n) => n.aktiv !== false && agentBase(n));
  const forventet = sjekksum(pakke?.dokumenter || {});
  const dokumenter = Object.keys(pakke?.dokumenter || {});
  const resultater = await Promise.all(
    mål.map(async (node) => {
      const base = agentBase(node);
      const nodeToken = node.agentToken || token;
      const t0 = Date.now();
      try {
        const svar = await hentJson(`${base}/api/config/import`, {
          method: "POST",
          token: nodeToken,
          timeout: 20_000,
          body: { pakke, modus, ...(bare.length ? { bare } : {}) },
        });
        // Verifikasjon: hent nodens egen eksport og sammenlign sjekksummen.
        let verifisert = false;
        let nodeSjekksum = null;
        let konfigVersjon = null;
        try {
          const q = dokumenter.length ? `?bare=${encodeURIComponent(dokumenter.join(","))}` : "";
          const eksport = await hentJson(`${base}/api/config/eksport${q}`, { token: nodeToken, timeout: 15_000 });
          nodeSjekksum = eksport?.sjekksum ?? null;
          verifisert = !!nodeSjekksum && nodeSjekksum === forventet;
          const v = await hentJson(`${base}/api/versjon`, { token: nodeToken, timeout: 8000 }).catch(() => null);
          konfigVersjon = v?.konfigVersjon ?? v?.versjon?.konfigVersjon ?? null;
        } catch (e) {
          return {
            id: node.id,
            navn: node.navn,
            agentUrl: base,
            ok: true,
            verifisert: false,
            skrevet: svar?.skrevet || [],
            msek: Date.now() - t0,
            feil: `Import ok, men verifikasjon feilet: ${String(e?.message || e)}`,
          };
        }
        return {
          id: node.id,
          navn: node.navn,
          agentUrl: base,
          ok: true,
          verifisert,
          nodeSjekksum,
          konfigVersjon,
          skrevet: svar?.skrevet || [],
          msek: Date.now() - t0,
          feil: verifisert ? null : "Sjekksummen på noden stemmer ikke med pakken som ble sendt.",
        };
      } catch (e) {
        return {
          id: node.id,
          navn: node.navn,
          agentUrl: base,
          ok: false,
          verifisert: false,
          skrevet: [],
          msek: Date.now() - t0,
          feil: String(e?.message || e),
        };
      }
    }),
  );
  const uten = (Array.isArray(noder) ? noder : []).filter((n) => !agentBase(n)).map((n) => n.navn || n.id);
  return {
    sjekksum: forventet,
    modus,
    dokumenter,
    sendt: resultater.length,
    ok: resultater.filter((r) => r.ok).length,
    verifisert: resultater.filter((r) => r.verifisert).length,
    hoppetOver: uten,
    resultater,
  };
}
