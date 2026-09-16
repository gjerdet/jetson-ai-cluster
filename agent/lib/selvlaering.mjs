/**
 * Selvlæring for Jarvis.
 *
 *  - Oppdager kunnskapshull i egne svar (ingen treff i kunnskapsbasen eller
 *    usikre formuleringer) og noterer temaet.
 *  - Lærer om hullene på egen hånd når maskinen er ledig: nettsøk → tekst →
 *    lokal kunnskapsbase.
 *  - Kjører selvtest (quiz) mot egen kunnskapsbase, evaluerer svaret sitt og
 *    lager nytt læringsbehov når han svarer dårlig.
 *
 * Alt lagres lokalt. Ingen skytjenester utenom selve nettsøket.
 */
import { doc, saveDoc } from "./store.mjs";
import { askAi, askJson } from "./ai.mjs";
import { search, listDocuments, getDocument } from "./rag.mjs";
import { laerOm } from "./laering.mjs";
import { evaluate } from "./evaluator.mjs";
import { remember } from "./memory.mjs";

/** Formuleringer som avslører at han ikke vet svaret. */
const USIKKER =
  /(vet ikke|veit ikke|usikker|har ikke (nok )?informasjon|mangler informasjon|kan ikke svare|ingen kjennskap|ikke kjent for meg|finner ikke noe om|har ikke tilgang til)/i;

const STOPPORD = new Set([
  "hva","hvem","hvor","hvorfor","hvordan","når","er","var","kan","skal","vil","det","den","de","en","et","og","eller","som","til","for","med","på","i","om","av","har","hva's","du","jeg","meg","han","vi","så","at","ikke","men","må","får","blir","være","gjøre","lage","finne","dette","disse",
]);

function db() {
  return doc("selvlaering", { samtaler: [], hull: [], okter: [], aktiv: true });
}

function persist(d) {
  saveDoc("selvlaering", d);
}

/** Plukker ut de mest meningsbærende ordene som tema. */
export function temaFraSporsmal(tekst) {
  const ord = String(tekst || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((o) => o.length > 3 && !STOPPORD.has(o));
  const tema = ord.slice(0, 6).join(" ").trim();
  return tema || String(tekst || "").trim().slice(0, 80);
}

/** Er selvlæring slått på? */
export function erPa() {
  return db().aktiv !== false;
}

export function settPa(verdi) {
  const d = db();
  d.aktiv = !!verdi;
  persist(d);
  return { aktiv: d.aktiv };
}

/** Noterer et kunnskapshull (eller øker telleren på et kjent hull). */
export function registrerHull(tema, grunn = "") {
  const emne = String(tema || "").trim().slice(0, 120);
  if (!emne) return null;
  const d = db();
  const finnes = (d.hull || []).find((h) => h.tema.toLowerCase() === emne.toLowerCase());
  if (finnes) {
    finnes.antall = (finnes.antall || 1) + 1;
    finnes.sist = Date.now();
    if (finnes.status === "lukket") finnes.status = "åpen";
    persist(d);
    return finnes;
  }
  const hull = {
    id: `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    tema: emne,
    grunn: String(grunn).slice(0, 200),
    antall: 1,
    tid: Date.now(),
    sist: Date.now(),
    status: "åpen",
  };
  d.hull = [hull, ...(d.hull || [])].slice(0, 200);
  persist(d);
  return hull;
}

function lukkHull(tema, resultat = "") {
  const d = db();
  const h = (d.hull || []).find((x) => x.tema.toLowerCase() === String(tema).toLowerCase());
  if (!h) return;
  h.status = "lukket";
  h.resultat = String(resultat).slice(0, 300);
  h.lukket = Date.now();
  persist(d);
}

/**
 * Kalles etter hvert chat-svar. Lagrer en kort logg og oppdager hull.
 * Skal aldri kaste – chatten er viktigere enn læringen.
 */
export function registrerSamtale({ sporsmal, svar, treff = 0 }) {
  try {
    const q = String(sporsmal || "").trim();
    if (!q) return null;
    const s = String(svar || "");
    const usikkert = USIKKER.test(s);
    const utenKunnskap = Number(treff) <= 0;
    const d = db();
    d.samtaler = [
      { tid: Date.now(), sporsmal: q.slice(0, 400), svarLengde: s.length, treff: Number(treff) || 0, usikkert },
      ...(d.samtaler || []),
    ].slice(0, 200);
    persist(d);
    if (usikkert || utenKunnskap) {
      return registrerHull(
        temaFraSporsmal(q),
        usikkert ? "svarte usikkert" : "ingen treff i kunnskapsbasen",
      );
    }
    return null;
  } catch {
    return null;
  }
}

export function listHull(limit = 50) {
  return (db().hull || []).slice(0, limit);
}

export function listOkter(limit = 30) {
  return (db().okter || []).slice(0, limit);
}

function loggOkt(post) {
  const d = db();
  d.okter = [{ tid: Date.now(), ...post }, ...(d.okter || [])].slice(0, 100);
  persist(d);
  return post;
}

/** Åpne hull sortert etter hvor ofte de har dukket opp. */
export function apneHull(maks = 3) {
  return (db().hull || [])
    .filter((h) => h.status !== "lukket")
    .sort((a, b) => (b.antall || 1) - (a.antall || 1) || b.sist - a.sist)
    .slice(0, maks);
}

/** Lærer om ett tema: nettsøk → tekst → lokal kunnskapsbase. */
export async function laerTema(tema, { antall = 3 } = {}) {
  const emne = String(tema || "").trim();
  if (!emne) throw new Error("Mangler tema.");
  const r = await laerOm({ tema: emne, antall });
  const kilder = (r.kilder || []).filter((k) => k.biter > 0);
  if (kilder.length) {
    lukkHull(emne, `${kilder.length} kilder lært`);
    remember({
      tekst: `Lærte om «${emne}» fra ${kilder.length} kilder: ${kilder.map((k) => k.tittel).join("; ").slice(0, 300)}`,
      type: "faktum",
      kontekst: "selvlæring",
      kilder: kilder.map((k) => k.url).slice(0, 5),
      viktighet: 5,
    });
  }
  loggOkt({ type: "laer-om", tema: emne, kilder: kilder.length, ok: kilder.length > 0 });
  return { tema: emne, kilder: kilder.length, ok: kilder.length > 0 };
}

/**
 * Selvtest: lager et spørsmål ut fra et tilfeldig dokument i kunnskapsbasen,
 * svarer uten å se fasiten og evaluerer seg selv. Svakt svar → nytt hull.
 */
export async function selvQuiz() {
  const dokumenter = listDocuments();
  if (!dokumenter.length) return { hoppet: "kunnskapsbasen er tom" };
  const valgt = dokumenter[Math.floor(Math.random() * dokumenter.length)];
  const full = getDocument(valgt.id) || valgt;
  const utdrag = String(full.tekst || full.utdrag || "").slice(0, 3000);
  if (!utdrag) return { hoppet: "fant ingen tekst å teste på" };

  const laget = await askJson(
    `Her er et utdrag fra en lokal kunnskapsbase:\n\n${utdrag}\n\nLag ett konkret kontrollspørsmål som kan besvares ut fra utdraget, og en kort fasit. Svar KUN med JSON på norsk bokmål: {"sporsmal":"...","fasit":"..."}`,
    { timeoutMs: 90_000 },
  ).catch(() => null);
  const sporsmal = String(laget?.sporsmal || "").trim();
  if (!sporsmal) return { hoppet: "klarte ikke lage kontrollspørsmål" };

  const kunnskap = await search(sporsmal, { topK: 4 }).catch(() => ({ treff: [] }));
  const kontekst = (kunnskap?.treff || [])
    .map((t) => String(t.tekst || t.innhold || "").slice(0, 900))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);

  const svar = await askAi(
    `Svar kort og presist på norsk bokmål.${kontekst ? `\n\nKjent kunnskap:\n${kontekst}` : ""}\n\nSpørsmål: ${sporsmal}`,
    { timeoutMs: 120_000 },
  ).catch(() => "");
  if (!svar) return { hoppet: "fikk ikke svar fra modellen" };

  let score = null;
  try {
    const ev = await evaluate({ spørsmål: sporsmal, svar, kontekst: "selvtest av kunnskapsbasen" });
    score = ev?.score ?? null;
  } catch {
    /* evaluatoren er valgfri */
  }

  const svakt = score !== null && score < 7;
  if (svakt) registrerHull(temaFraSporsmal(sporsmal), `selvtest ga ${score}/10`);
  loggOkt({ type: "selvtest", tema: valgt.tittel || "ukjent dokument", sporsmal: sporsmal.slice(0, 200), score, svakt });
  return { sporsmal, score, svakt, dokument: valgt.tittel || "" };
}

/**
 * Oppsummerer det han har lært siden sist til varige notater i minnet,
 * slik at kunnskapen brukes i senere samtaler uten nytt søk.
 */
export async function konsoliderLaering() {
  const okter = listOkter(20).filter((o) => o.type === "laer-om" && o.ok);
  if (!okter.length) return { hoppet: "ingenting nytt å oppsummere" };
  const parsed = await askJson(
    `En lokal AI-agent har nettopp lært om disse temaene:\n${okter.map((o) => `- ${o.tema} (${o.kilder} kilder)`).join("\n").slice(0, 1500)}\n\nSkriv maks 3 korte, varige huskeregler agenten bør ha med seg videre. Svar KUN med JSON på norsk bokmål: {"notater":["..."]}`,
    { timeoutMs: 90_000 },
  ).catch(() => ({ notater: [] }));
  let lagt = 0;
  for (const n of (parsed.notater || []).slice(0, 3)) {
    const tekst = String(n || "").trim();
    if (!tekst) continue;
    remember({ tekst: tekst.slice(0, 400), type: "faktum", kontekst: "selvlæring", viktighet: 5 });
    lagt++;
  }
  loggOkt({ type: "konsolidering", notater: lagt, ok: lagt > 0 });
  return { notater: lagt };
}

/**
 * Finner egne læringsmål når ingen hull er notert: ser på hva samtalene har
 * handlet om og hva kunnskapsbasen allerede dekker, og velger selv temaer å
 * bli bedre på. Temaene legges inn som åpne hull med grunn «eget mål».
 */
export async function foreslaMal({ antall = 3 } = {}) {
  const d = db();
  const samtaler = (d.samtaler || []).slice(0, 15).map((s) => s.sporsmal).filter(Boolean);
  const dokumenter = listDocuments().slice(0, 20).map((x) => x.tittel).filter(Boolean);
  const alt = new Set((d.hull || []).map((h) => h.tema.toLowerCase()));
  const parsed = await askJson(
    `Du er en lokal AI-agent som skal bli bedre for hver dag.\n` +
      `Dette har brukeren spurt om i det siste:\n${samtaler.join("\n").slice(0, 1200) || "(ingenting ennå)"}\n\n` +
      `Dette dekker kunnskapsbasen allerede:\n${dokumenter.join("; ").slice(0, 1200) || "(tom)"}\n\n` +
      `Velg ${antall} konkrete temaer du bør lære deg for å hjelpe brukeren bedre. ` +
      `Hvert tema skal være kort (maks 8 ord) og søkbart. Svar KUN med JSON på norsk bokmål: {"mal":[{"tema":"...","hvorfor":"..."}]}`,
    { timeoutMs: 90_000 },
  ).catch(() => ({ mal: [] }));

  const lagt = [];
  for (const m of (parsed.mal || []).slice(0, antall)) {
    const tema = String(m?.tema || "").trim().slice(0, 120);
    if (!tema || alt.has(tema.toLowerCase())) continue;
    const hull = registrerHull(tema, `eget mål: ${String(m?.hvorfor || "vil bli bedre").slice(0, 120)}`);
    if (hull) lagt.push(tema);
  }
  loggOkt({ type: "egne-mal", tema: lagt.join("; ").slice(0, 200), antall: lagt.length, ok: lagt.length > 0 });
  return { mal: lagt, antall: lagt.length };
}

/** Jobber selvlæringen ønsker å kjøre når maskinen er ledig. */
export function planleggLaering() {
  if (!erPa()) return [];
  const apne = apneHull(3);
  const jobber = apne.map((h) => ({
    type: "laer-om",
    tekst: `Lær om «${h.tema}» (${h.antall} gang${h.antall > 1 ? "er" : ""} uten svar)`,
    prioritet: Math.min(9, 6 + (h.antall || 1)),
    data: { tema: h.tema },
  }));
  // Har han ingen hull å tette, finner han selv ut hva han bør bli bedre på.
  if (apne.length < 2)
    jobber.push({ type: "finn-mal", tekst: "Finn selv nye temaer å bli bedre på", prioritet: 6 });
  jobber.push({ type: "selvtest", tekst: "Selvtest mot egen kunnskapsbase", prioritet: 4 });
  jobber.push({ type: "konsolider-laering", tekst: "Oppsummer ny kunnskap til varige notater", prioritet: 3 });
  return jobber;
}

export function laeringStatus() {
  const d = db();
  const hull = d.hull || [];
  const okter = d.okter || [];
  const laerte = okter.filter((o) => o.type === "laer-om" && o.ok).length;
  const siste = okter[0] || null;
  return {
    aktiv: d.aktiv !== false,
    apneHull: hull.filter((h) => h.status !== "lukket").length,
    lukkedeHull: hull.filter((h) => h.status === "lukket").length,
    laerteTemaer: laerte,
    okter: okter.length,
    sisteOkt: siste ? { tid: siste.tid, type: siste.type, tema: siste.tema || "", ok: siste.ok !== false } : null,
    samtaler: (d.samtaler || []).length,
  };
}
