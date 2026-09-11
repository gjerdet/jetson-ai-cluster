/**
 * Refleksjon: Jarvis lærer av egne kjøringer.
 *  - fører statistikk per verktøy (treffrate, tid, typiske feil)
 *  - oppdager feilmønstre og lager adferdsregler av dem
 *  - trekker ut lærdom fra en samtalerunde og lagrer den varig
 * Alt kjører lokalt mot data/ – ingen sky.
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";
import { laerRegel, laerteRegler } from "./initiative.mjs";
import { remember } from "./memory.mjs";
import { askJson } from "./ai.mjs";

const MAKS_HENDELSER = 300;
const FEILGRENSE = 3;

function db() {
  return doc("refleksjon", { verktoy: {}, hendelser: [], laerdommer: [] });
}

const lagre = (d) => saveDoc("refleksjon", d);
const kort = (v, n = 400) => String(v ?? "").trim().slice(0, n);

/**
 * Registrerer utfallet av en samtalerunde med verktøykall.
 * `verktoy`: [{ navn, ok, ms, feil }]
 */
export function registrerUtfall({ oppgave = "", verktoy = [], svar = "", ok = true } = {}) {
  const d = db();
  for (const v of Array.isArray(verktoy) ? verktoy : []) {
    const navn = kort(v?.navn ?? v, 80);
    if (!navn) continue;
    const s = (d.verktoy[navn] ||= { navn, kall: 0, ok: 0, feil: 0, msTotal: 0, sisteFeil: "", sistBrukt: 0 });
    s.kall++;
    if (v?.ok === false) {
      s.feil++;
      s.sisteFeil = kort(v?.feil, 300);
    } else s.ok++;
    s.msTotal += Number(v?.ms) || 0;
    s.sistBrukt = Date.now();
  }
  d.hendelser.unshift({
    id: randomUUID(),
    tid: Date.now(),
    oppgave: kort(oppgave, 300),
    verktoy: (Array.isArray(verktoy) ? verktoy : []).map((v) => ({
      navn: kort(v?.navn ?? v, 80),
      ok: v?.ok !== false,
      ms: Number(v?.ms) || 0,
      feil: kort(v?.feil, 200),
    })),
    ok: !!ok,
    svar: kort(svar, 500),
  });
  d.hendelser = d.hendelser.slice(0, MAKS_HENDELSER);
  lagre(d);
  return { registrert: true, ...feilmonstre() };
}

/** Statistikk per verktøy, sortert etter mest brukt. */
export function verktoyStats() {
  const d = db();
  const list = Object.values(d.verktoy).map((s) => ({
    ...s,
    treffrate: s.kall ? Number(((s.ok / s.kall) * 100).toFixed(1)) : 0,
    snittMs: s.kall ? Math.round(s.msTotal / s.kall) : 0,
  }));
  list.sort((a, b) => b.kall - a.kall);
  return {
    verktoy: list,
    antallKall: list.reduce((s, v) => s + v.kall, 0),
    ustabile: list.filter((v) => v.kall >= FEILGRENSE && v.treffrate < 60),
    laerdommer: d.laerdommer.slice(0, 20),
  };
}

/** Ser etter verktøy som feiler gjentatte ganger og lager regler av det. */
export function feilmonstre() {
  const d = db();
  const nye = [];
  for (const s of Object.values(d.verktoy)) {
    if (s.feil < FEILGRENSE) continue;
    const rate = s.ok / Math.max(1, s.kall);
    if (rate >= 0.6) continue;
    const tekst = `Verktøyet ${s.navn} feiler ofte (${s.feil} av ${s.kall} kall${s.sisteFeil ? `, siste feil: ${s.sisteFeil}` : ""}). Sjekk forutsetningene før du bruker det, og ha en plan B.`;
    if (laerteRegler().some((r) => r.tekst.includes(`Verktøyet ${s.navn} feiler ofte`))) continue;
    const regel = laerRegel(tekst, "Automatisk oppdaget feilmønster");
    if (regel) nye.push(regel.tekst);
  }
  if (nye.length) {
    d.laerdommer = [...nye.map((t) => ({ tid: Date.now(), tekst: t, kilde: "feilmønster" })), ...d.laerdommer].slice(0, 100);
    lagre(d);
  }
  return { nyeRegler: nye };
}

/**
 * Reflekterer over en samtalerunde: hva gikk bra, hva bør gjøres annerledes.
 * Lagrer fakta som minne og arbeidsmåte som adferdsregel.
 */
export async function reflekter({ oppgave, svar, verktoy = [], utfall = "" } = {}) {
  const q = kort(oppgave, 1000);
  if (!q) throw new Error("Mangler oppgave å reflektere over.");
  const brukt = (Array.isArray(verktoy) ? verktoy : [])
    .map((v) => `${v?.navn ?? v}${v?.ok === false ? ` (FEILET: ${kort(v?.feil, 120)})` : ""}`)
    .join(", ");

  const prompt = `Du er en lokal AI-agent som gjennomgår ditt eget arbeid for å bli bedre.
Svar KUN med JSON:
{"gikkBra":"...","gikkDaarlig":"...","regel":"...","faktum":"...","verdt":true/false}
- "regel": kort, handlingsrettet regel om HVORDAN du bør jobbe neste gang (tom streng hvis ingenting nytt).
- "faktum": varig faktum om brukerens utstyr/nett/oppsett (tom streng hvis ingenting nytt).
- "verdt": false hvis runden var triviell og ingenting bør lagres.
Skriv norsk bokmål.

Oppgave: ${q}
Verktøy brukt: ${brukt || "ingen"}
Svar som ble gitt: ${kort(svar, 1500)}
${utfall ? `Utfall: ${kort(utfall, 300)}` : ""}`;

  const p = await askJson(prompt, { timeoutMs: 90_000 });
  const resultat = {
    gikkBra: kort(p.gikkBra, 400),
    gikkDaarlig: kort(p.gikkDaarlig, 400),
    regel: "",
    faktum: "",
    lagret: [],
  };

  if (p.verdt !== false && kort(p.regel)) {
    const r = laerRegel(kort(p.regel, 300), "Refleksjon etter oppgave");
    if (r) {
      resultat.regel = r.tekst;
      resultat.lagret.push("regel");
    }
  }
  if (p.verdt !== false && kort(p.faktum)) {
    remember({
      tekst: kort(p.faktum, 500),
      type: "faktum",
      kontekst: `refleksjon: ${q.slice(0, 120)}`,
      kilder: ["refleksjon"],
      viktighet: 7,
    });
    resultat.faktum = kort(p.faktum, 500);
    resultat.lagret.push("faktum");
  }

  const d = db();
  d.laerdommer = [
    { tid: Date.now(), tekst: resultat.regel || resultat.gikkDaarlig || resultat.gikkBra, kilde: "refleksjon" },
    ...d.laerdommer,
  ].slice(0, 100);
  lagre(d);
  return resultat;
}

/**
 * Hint til systemprompten: hvilke verktøy som pleier å virke for slike
 * oppgaver, og hvilke som er ustabile akkurat nå.
 */
export function verktoyHint(sporsmal = "", { maks = 6 } = {}) {
  const { verktoy, ustabile } = verktoyStats();
  if (!verktoy.length) return "";
  const ord = String(sporsmal || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 2);
  const relevante = verktoy
    .map((v) => ({ v, p: ord.reduce((s, w) => s + (v.navn.includes(w) ? 2 : 0), 0) + Math.min(3, v.kall / 5) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, maks)
    .map(({ v }) => `${v.navn}: ${v.treffrate}% treff, ~${v.snittMs} ms`);
  const linjer = [];
  if (relevante.length) linjer.push(`Erfaring med verktøy: ${relevante.join(" · ")}`);
  if (ustabile.length)
    linjer.push(
      `Ustabile nå (ha plan B): ${ustabile.map((v) => `${v.navn}${v.sisteFeil ? ` (${v.sisteFeil.slice(0, 60)})` : ""}`).join(" · ")}`,
    );
  return linjer.join("\n");
}
