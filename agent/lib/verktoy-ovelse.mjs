/**
 * Verktøyøvelser: Jarvis trener på sine egne verktøy hver dag.
 *  - Han kjører et ekte verktøykall (vær, nettlesing, nettsøk).
 *  - Feiler det, noterer han et kunnskapshull, leser seg opp på temaet
 *    og prøver ÉN gang til (søk → lær → søk igjen).
 *  - Resultatet lagres som øvelseslogg og vises i DAGLIG FREMGANG.
 * Alt lokalt, ingen betalte tjenester.
 */
import { doc, saveDoc } from "./store.mjs";
import { hentVaer, vaerTekst } from "./vaer.mjs";
import { laerTema, registrerHull } from "./selvlaering.mjs";

const NOKKEL = "verktoy-ovelse";

/** Varierende norske steder han trener værvarsel på – ikke fast sted. */
const STEDER = [
  "Oslo", "Bergen", "Trondheim", "Tromsø", "Kristiansand",
  "Bodø", "Ålesund", "Hamar", "Lillehammer", "Ringsaker",
  "Åsmarka", "Stavanger", "Alta", "Røros", "Sogndal",
];

function db() {
  return doc(NOKKEL, { logg: [], sisteKjoring: 0, sted: "", indeks: 0 });
}

function persist(d) {
  saveDoc(NOKKEL, d);
}

/**
 * Stedet han øver værvarsel på denne runden.
 * Har brukeren satt et eget sted, brukes det – ellers roterer han
 * gjennom en liste av norske steder, slik at øvelsen aldri er den samme.
 */
export function ovelseSted() {
  const d = db();
  if (d.sted) return String(d.sted);
  const i = Number(d.indeks || 0) % STEDER.length;
  return STEDER[i];
}

/** Brukeren kan sette et fast øvelsessted; tom streng = tilbake til rotasjon. */
export function settOvelseSted(sted) {
  const d = db();
  d.sted = String(sted || "").trim().slice(0, 80);
  persist(d);
  return { sted: d.sted || "(roterer)" };
}

/** Alle øvelser han kan trene på. */
export function ovelser() {
  const sted = ovelseSted();
  return [
    {
      navn: "vaer",
      tittel: `Værvarsel for ${sted}`,
      tema: `MET Norway (Yr) locationforecast API og geokoding av norske stedsnavn`,
      prioritet: 6,
      async kjor() {
        const v = await hentVaer({ sted, timer: 6 });
        const grader = Number(v?.na?.temperatur);
        if (!Number.isFinite(grader)) throw new Error("fikk ingen temperatur tilbake fra værtjenesten");
        return vaerTekst(v).slice(0, 220);
      },
    },
  ];
}

/**
 * Kjører én øvelse. Feiler den: lær om temaet, og prøv på nytt.
 * @returns {Promise<{navn:string, ok:boolean, forsok:number, laerte:boolean, resultat:string, feil:string}>}
 */
export async function kjorOvelse(navn) {
  const ov = ovelser().find((o) => o.navn === navn) || ovelser()[0];
  if (!ov) return { navn: String(navn || ""), ok: false, forsok: 0, laerte: false, resultat: "", feil: "ingen slik øvelse" };

  let feil = "";
  let laerte = false;

  for (let forsok = 1; forsok <= 2; forsok++) {
    try {
      const resultat = await ov.kjor();
      const post = { navn: ov.navn, tittel: ov.tittel, ok: true, forsok, laerte, resultat, feil: "", tid: Date.now() };
      loggOvelse(post);
      return post;
    } catch (e) {
      feil = String(e?.message || e).slice(0, 300);
      if (forsok === 1) {
        // Søk → lær → søk igjen: han leser seg opp på det som feilet før nytt forsøk.
        try {
          registrerHull(ov.tema, `Verktøyøvelse «${ov.navn}» feilet: ${feil}`);
          const r = await laerTema(ov.tema);
          laerte = !!r?.ok;
        } catch {
          /* læring er best-effort */
        }
      }
    }
  }

  const post = { navn: ov.navn, tittel: ov.tittel, ok: false, forsok: 2, laerte, resultat: "", feil, tid: Date.now() };
  loggOvelse(post);
  return post;
}

function loggOvelse(post) {
  const d = db();
  d.logg = [post, ...(d.logg || [])].slice(0, 100);
  d.sisteKjoring = post.tid;
  // Neste øvelse får et nytt sted (med mindre brukeren har valgt et fast).
  if (!d.sted) d.indeks = (Number(d.indeks || 0) + 1) % STEDER.length;
  persist(d);
}

/** Køposter for alle øvelser – legges inn av bakgrunnsmotoren. */
export function ovelseJobber() {
  return ovelser().map((o) => ({
    type: "verktoy-ovelse",
    tekst: `Øv på verktøyet «${o.navn}»: ${o.tittel}`,
    prioritet: o.prioritet || 5,
    data: { navn: o.navn, tema: o.tema },
  }));
}

/** Sant når det er over et døgn siden siste øvelsesrunde. */
export function trengerOvelse() {
  return Date.now() - Number(db().sisteKjoring || 0) > 20 * 60 * 60 * 1000;
}

export function ovelseStatus(limit = 20) {
  const d = db();
  const logg = (d.logg || []).slice(0, limit);
  return {
    sted: ovelseSted(),
    sisteKjoring: Number(d.sisteKjoring || 0),
    ovelser: ovelser().map((o) => ({ navn: o.navn, tittel: o.tittel })),
    logg,
  };
}
