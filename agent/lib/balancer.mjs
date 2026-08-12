/**
 * Lastbalansering og helsebasert ruting mellom Jetson-nodene.
 *
 * Backend-en holder selv oversikt over hvor travel og hvor rask hver node er,
 * og velger den noden som svarer best akkurat nå. Faller en node ut, settes
 * den i karantene en liten stund og forespørselen sendes videre til neste.
 */

const COOLDOWN_MS = 60_000;
const MAX_FAIL_COOLDOWN_MS = 5 * 60_000;

/** id -> { inflight, snittMs, sisteMs, feil, karanteneTil, sisteFeil, ok, kall } */
const stats = new Map();

function entry(id) {
  let s = stats.get(id);
  if (!s) {
    s = {
      inflight: 0, snittMs: null, sisteMs: null, feil: 0, karanteneTil: 0, sisteFeil: null, ok: 0, kall: 0,
      ressurser: null,
    };
    stats.set(id, s);
  }
  return s;
}

export function nodeStats(id) {
  return { ...entry(id) };
}

/**
 * Oppdaterer det klyngehelse-sjekken fant ut om noden (ledig GPU, last, nivå).
 * Dette gjør rutingen adaptiv: mye ledig GPU = billigere node.
 */
export function settRessurser(id, r) {
  const s = entry(id);
  s.ressurser = r ? { ...r } : null;
  return { ...s.ressurser };
}

/** 0.4 (nesten full GPU / syk node) … 1.6 (mye ledig GPU og frisk node). */
export function ressursfaktor(id) {
  const r = entry(id).ressurser;
  if (!r) return 1;
  if (r.niva === "feil") return 0.3;
  const fritt = Number.isFinite(Number(r.frittProsent)) ? Number(r.frittProsent) : null;
  const utnytt = Number.isFinite(Number(r.utnyttelse)) ? Number(r.utnyttelse) : null;
  let f = 1;
  if (fritt != null) f *= 0.5 + Math.min(100, Math.max(0, fritt)) / 100; // 0.5 … 1.5
  if (utnytt != null) f *= 1 - Math.min(100, Math.max(0, utnytt)) / 200; // 0.5 … 1
  if (r.niva === "advarsel") f *= 0.7;
  return Math.max(0.2, Math.min(1.6, f));
}

export function resetBalancer() {
  stats.clear();
}

const iKarantene = (s) => s.karanteneTil > Date.now();

/** Lavere er bedre: kø veier tyngst, deretter latens, delt på nodens vekt. */
function kostnad(node) {
  const s = entry(node.id);
  const latens = s.snittMs ?? s.sisteMs ?? 800;
  const vekt = Math.max(1, Number(node.vekt) || 1);
  const straff = iKarantene(s) ? 1_000_000 : 0;
  // Vekten fra brukeren kombineres med hvor mye ledig GPU noden faktisk har.
  const effektivVekt = Math.max(0.2, vekt * ressursfaktor(node.id));
  return (s.inflight * 10_000 + latens) / effektivVekt + straff;
}

/** Aktive noder som har fått ansvar for oppgaven (standard «chat»). */
export function poolFor(noder, oppgave = "chat") {
  const aktive = (Array.isArray(noder) ? noder : []).filter((n) => n && n.aktiv !== false && n.baseUrl);
  const passende = aktive.filter((n) => !n.oppgaver?.length || n.oppgaver.includes(oppgave));
  return passende.length ? passende : aktive;
}

/** Rekkefølgen forespørselen skal prøves i – best node først. */
export function rutingsRekkefolge(noder, { oppgave = "chat", foretrukket = "" } = {}) {
  const pool = poolFor(noder, oppgave);
  const sortert = pool.slice().sort((a, b) => kostnad(a) - kostnad(b));
  const pinned = foretrukket ? sortert.find((n) => n.id === foretrukket) : null;
  const rest = sortert.filter((n) => n !== pinned);
  const alle = pinned ? [pinned, ...rest] : sortert;
  // Noder i karantene havner bakerst, men brukes hvis alt annet feiler.
  const friske = alle.filter((n) => !iKarantene(entry(n.id)));
  const kalde = alle.filter((n) => iKarantene(entry(n.id)));
  return [...friske, ...kalde];
}

export function markerStart(id) {
  const s = entry(id);
  s.inflight += 1;
  s.kall += 1;
}

export function markerSlutt(id) {
  const s = entry(id);
  s.inflight = Math.max(0, s.inflight - 1);
}

export function markerOk(id, ms) {
  const s = entry(id);
  s.sisteMs = ms;
  s.snittMs = s.snittMs == null ? ms : Math.round(s.snittMs * 0.7 + ms * 0.3);
  s.feil = 0;
  s.karanteneTil = 0;
  s.sisteFeil = null;
  s.ok += 1;
}

export function markerFeil(id, arsak) {
  const s = entry(id);
  s.feil += 1;
  s.sisteFeil = String(arsak || "ukjent feil").slice(0, 300);
  s.karanteneTil = Date.now() + Math.min(COOLDOWN_MS * s.feil, MAX_FAIL_COOLDOWN_MS);
}

/** Status til HUD-en: hvem er i poolen og hvordan står det til. */
export function poolStatus(noder, oppgave = "chat") {
  const pool = poolFor(noder, oppgave);
  const naa = Date.now();
  return {
    oppgave,
    antall: pool.length,
    noder: rutingsRekkefolge(noder, { oppgave }).map((n) => {
      const s = entry(n.id);
      return {
        id: n.id,
        navn: n.navn,
        baseUrl: n.baseUrl,
        modell: n.modell,
        vekt: Number(n.vekt) || 1,
        inflight: s.inflight,
        sisteMs: s.sisteMs,
        snittMs: s.snittMs,
        kall: s.kall,
        ok: s.ok,
        feil: s.feil,
        sisteFeil: s.sisteFeil,
        karantene: s.karanteneTil > naa,
        karanteneSek: s.karanteneTil > naa ? Math.ceil((s.karanteneTil - naa) / 1000) : 0,
        kostnad: Math.round(kostnad(n)),
        ressurser: s.ressurser,
        ressursfaktor: Math.round(ressursfaktor(n.id) * 100) / 100,
      };
    }),
  };
}

/**
 * Kjører `run(node)` mot beste node med automatisk failover.
 * Returnerer { resultat, node, ms, forsok }.
 */
export async function kjorBalansert(noder, run, opts = {}) {
  const rekkefolge = rutingsRekkefolge(noder, opts);
  if (!rekkefolge.length) throw new Error("Ingen aktive noder i klyngen.");
  const forsok = [];
  let sisteFeil = null;
  for (const node of rekkefolge) {
    const t0 = Date.now();
    markerStart(node.id);
    try {
      const resultat = await run(node);
      const ms = Date.now() - t0;
      markerOk(node.id, ms);
      return { resultat, node, ms, forsok };
    } catch (e) {
      const grunn = e?.message || String(e);
      markerFeil(node.id, grunn);
      forsok.push({ node: node.navn || node.id, feil: grunn });
      sisteFeil = e;
    } finally {
      markerSlutt(node.id);
    }
  }
  const e = sisteFeil instanceof Error ? sisteFeil : new Error("Alle noder feilet");
  e.forsok = forsok;
  throw e;
}
