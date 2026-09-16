/**
 * Eget initiativ / bakgrunnsprosess for Jarvis.
 *  - Ledig-detektor: ingen chat på 10 minutter + lav GPU-last → bakgrunnsarbeid.
 *  - Forbedringskø: reparere verktøy, bygge nye, indeksere kunnskap, kartlegge nettet,
 *    evaluere egne svar og teste kollega-koblinger.
 *  - Full lokal autonomi, men hver endring får en revisjonspost som kan rulles tilbake.
 */
import { doc, saveDoc, latest } from "./store.mjs";
import { askJson } from "./ai.mjs";
import { remember, timeline } from "./memory.mjs";
import { listPlans } from "./planner.mjs";
import { maskinKort, selvtest } from "./identitet.mjs";
import { byggVerktoy, rollbackTool, verktoyMedProblemer } from "./toolgen.mjs";
import { diagnoserAlle } from "./kollega.mjs";
import { gpuStatus } from "./gpu.mjs";
import { planleggLaering, laerTema, selvQuiz, konsoliderLaering, foreslaMal } from "./selvlaering.mjs";
import {
  dagsRapport,
  retrospektiv,
  trengerRetrospektiv,
  lagKodeforslag,
  godkjennKodeforslag,
  rullTilbakeKode,
  erAuto,
} from "./selvforbedring.mjs";

let aktiv = false;
let timer = null;
let sisteKjøring = 0;
let sisteChat = Date.now();
let jobberNa = null;
let deps = { publish: null, notify: null };
let sisteAktivitetSkrevet = 0;

/** Ledig tid = ingen chat på 10 minutter. */
export const IDLE_MS = 10 * 60 * 1000;

/** Denne prosessen ER bakgrunnsmotoren (agent/motor.mjs). */
export const ER_MOTOR = process.env.JARVIS_MOTOR_PROSESS === "1";
/** Bakgrunnsmotoren kjører som egen tjeneste; backenden skal da ikke kjøre løkka selv. */
export const EGEN_MOTOR = ER_MOTOR || process.env.JARVIS_EGEN_MOTOR === "1";
/** Motoren regnes som levende når hjerteslaget er nyere enn dette. */
const HJERTESLAG_FRIST = 5 * 60 * 1000;

function db() {
  return doc("initiative", { forslag: [], audit: [], ko: [], revisjoner: [] });
}

function persist(item) {
  saveDoc("initiative", item);
}

/** Delt tilstand mellom backend-prosessen og motorprosessen (fil på disk). */
function motorDb() {
  return doc("motor", { aktiv: false, sisteAktivitet: 0, hjerteslag: 0, pid: 0, jobberNa: null, sisteJobb: null });
}

function settMotor(patch) {
  const d = { ...motorDb(), ...patch };
  saveDoc("motor", d);
  return d;
}

/** Sant når en egen motorprosess har gitt livstegn nylig. */
export function motorLever() {
  const m = motorDb();
  return !!m.hjerteslag && Date.now() - m.hjerteslag < HJERTESLAG_FRIST;
}

export function isActive() {
  return EGEN_MOTOR && !ER_MOTOR ? !!motorDb().aktiv : aktiv;
}

export function setActive(value) {
  aktiv = !!value;
  settMotor({ aktiv });
  // Når motoren har egen prosess, er dette bare et signal – løkka kjører der.
  if (EGEN_MOTOR && !ER_MOTOR) return { aktiv };
  if (aktiv) start(60 * 1000);
  else stop();
  return { aktiv };
}

export function setDeps(d) {
  deps = { ...deps, ...d };
}

/** Kalles ved hver chat-melding: brukeraktivitet stopper bakgrunnsarbeid. */
export function markerBrukeraktivitet() {
  sisteChat = Date.now();
  // Skriv til disk så motorprosessen også ser at brukeren er til stede (maks hvert 15. sek).
  if (sisteChat - sisteAktivitetSkrevet > 15_000) {
    sisteAktivitetSkrevet = sisteChat;
    try {
      settMotor({ sisteAktivitet: sisteChat });
    } catch {
      /* lagring skal aldri stoppe en samtale */
    }
  }
}

export function erLedig() {
  let sist = sisteChat;
  try {
    sist = Math.max(sist, Number(motorDb().sisteAktivitet || 0));
  } catch {
    /* bruk lokal verdi */
  }
  return Date.now() - sist >= IDLE_MS;
}

export function listSuggestions(limit = 20) {
  return db().forslag.slice(0, limit);
}

export function listAudit(limit = 50) {
  return db().audit.slice(0, limit);
}

export function listKo(limit = 50) {
  return (db().ko || []).slice(0, limit);
}

export function listRevisjoner(limit = 50) {
  return (db().revisjoner || []).slice(0, limit);
}

function logAudit(hendelse, { risiko = "lav", godkjent = false, auto = false } = {}) {
  const d = db();
  d.audit.unshift({ tid: Date.now(), hendelse: String(hendelse).slice(0, 500), risiko, godkjent, auto });
  d.audit = d.audit.slice(0, 500);
  persist(d);
}

/** Revisjonspost for alt agenten endrer på seg selv. */
export function loggRevisjon({ hva, hvorfor, resultat = "", type = "annet", ref = "" }) {
  const d = db();
  const post = {
    id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    tid: Date.now(),
    hva: String(hva).slice(0, 300),
    hvorfor: String(hvorfor).slice(0, 300),
    resultat: String(resultat).slice(0, 500),
    type,
    ref,
    tilbakerullet: false,
  };
  d.revisjoner = [post, ...(d.revisjoner || [])].slice(0, 300);
  persist(d);
  return post;
}

/** Rull tilbake en selvendring (foreløpig: verktøyversjoner og adferdsregler). */
export function rullTilbake(id) {
  const d = db();
  const post = (d.revisjoner || []).find((r) => r.id === id);
  if (!post) throw new Error("Fant ikke revisjonsposten.");
  if (post.tilbakerullet) throw new Error("Denne endringen er allerede rullet tilbake.");
  if (post.type === "verktoy" && post.ref) {
    rollbackTool(post.ref);
  } else if (post.type === "kode" && post.ref) {
    rullTilbakeKode(post.ref);
  } else if (post.type === "regel" && post.ref) {
    const l = doc("laering", { regler: [] });
    l.regler = (l.regler || []).filter((r) => r.id !== post.ref);
    saveDoc("laering", l);
  } else {
    throw new Error("Denne endringstypen kan ikke rulles tilbake automatisk.");
  }
  post.tilbakerullet = true;
  persist(d);
  logAudit(`Rullet tilbake: ${post.hva}`, { godkjent: true });
  return post;
}

/** Varige adferdsregler agenten har lært av egne evalueringer. */
export function laerteRegler() {
  return (doc("laering", { regler: [] }).regler || []).filter((r) => r.aktiv !== false);
}

export function laerRegel(tekst, hvorfor = "") {
  const l = doc("laering", { regler: [] });
  const finnes = (l.regler || []).some((r) => r.tekst.toLowerCase() === String(tekst).toLowerCase());
  if (finnes) return null;
  const regel = { id: `l-${Date.now().toString(36)}`, tid: Date.now(), tekst: String(tekst).slice(0, 300), aktiv: true };
  l.regler = [regel, ...(l.regler || [])].slice(0, 50);
  saveDoc("laering", l);
  loggRevisjon({ hva: `Ny adferdsregel: ${regel.tekst}`, hvorfor, type: "regel", ref: regel.id, resultat: "lagt til" });
  return regel;
}

function addSuggestion({ tekst, risiko = "lav", kilde = "initiativ", handling = null, status = "venter" }) {
  const d = db();
  const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const item = { id, tid: Date.now(), tekst, risiko, kilde, handling, status };
  d.forslag.unshift(item);
  d.forslag = d.forslag.slice(0, 100);
  persist(d);
  return item;
}

export function approveSuggestion(id) {
  const d = db();
  const s = d.forslag.find((x) => x.id === id);
  if (!s) throw new Error("Fant ikke forslaget.");
  s.status = "godkjent";
  persist(d);
  logAudit(`Forslag godkjent manuelt: ${s.tekst}`, { risiko: s.risiko, godkjent: true, auto: false });
  return s;
}

export function rejectSuggestion(id) {
  const d = db();
  const s = d.forslag.find((x) => x.id === id);
  if (!s) throw new Error("Fant ikke forslaget.");
  s.status = "avvist";
  persist(d);
  return s;
}

// ---- forbedringskø -----------------------------------------------------

export function leggIKo(jobb) {
  const d = db();
  const item = {
    id: `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    tid: Date.now(),
    type: jobb.type,
    tekst: String(jobb.tekst || jobb.type).slice(0, 300),
    prioritet: Number(jobb.prioritet) || 5,
    status: "venter",
    data: jobb.data || {},
  };
  d.ko = [...(d.ko || []).filter((k) => !(k.type === item.type && k.tekst === item.tekst && k.status === "venter")), item]
    .sort((a, b) => b.prioritet - a.prioritet)
    .slice(0, 100);
  persist(d);
  return item;
}

function settKoStatus(id, status, resultat = "") {
  const d = db();
  const k = (d.ko || []).find((x) => x.id === id);
  if (!k) return;
  k.status = status;
  k.resultat = String(resultat).slice(0, 500);
  k.ferdig = Date.now();
  persist(d);
}

/** Fyller køen med jobber agenten selv finner behov for. */
async function planleggForbedringer() {
  for (const t of verktoyMedProblemer())
    leggIKo({ type: "reparer-verktoy", tekst: `Reparer «${t.navn}» (${t.feilrate} % feil)`, prioritet: 9, data: { navn: t.navn, feil: t.sisteFeil } });

  const test = await selvtest().catch(() => null);
  if (test && !test.ok)
    leggIKo({ type: "identitet", tekst: `Maskin-ID-kort har avvik: ${test.avvik.join("; ")}`, prioritet: 8 });

  leggIKo({ type: "kollega-test", tekst: "Test kollega-koblinger (Hermes m.fl.)", prioritet: 6 });
  leggIKo({ type: "evaluer-svar", tekst: "Evaluer egne svar fra siste døgn og lær av dem", prioritet: 5 });
  leggIKo({ type: "kartlegg", tekst: "Oppdater maskin-ID-kort og nettbilde", prioritet: 4 });

  // Selvlæring: tett kunnskapshull, test seg selv og oppsummer ny kunnskap.
  for (const jobb of planleggLaering()) leggIKo(jobb);

  // Daglig framgang: mål seg selv og bestem selv hva som skal bli bedre i morgen.
  leggIKo({ type: "dagsrapport", tekst: "Mål egen framgang i dag", prioritet: 3 });
  if (trengerRetrospektiv())
    leggIKo({ type: "retrospektiv", tekst: "Se på gårsdagen og velg egne forbedringer", prioritet: 7 });
}

async function utforJobb(jobb) {
  jobberNa = jobb.id;
  try {
    if (jobb.type === "reparer-verktoy") {
      const r = await byggVerktoy(`Reparer verktøyet «${jobb.data.navn}». Kjent feil: ${jobb.data.feil || "ukjent"}.`, { runder: 3 });
      loggRevisjon({
        hva: `Bygget om verktøyet ${jobb.data.navn}`,
        hvorfor: `Høy feilrate: ${jobb.data.feil || "ukjent"}`,
        type: "verktoy",
        ref: r.verktoy?.id || "",
        resultat: r.ok ? "testet OK og aktivert" : "klarte ikke fikse",
      });
      return r.ok ? "reparert" : "ikke løst";
    }
    if (jobb.type === "bygg-verktoy") {
      const r = await byggVerktoy(jobb.data.beskrivelse || jobb.tekst, { runder: 3 });
      loggRevisjon({
        hva: `Nytt verktøy: ${r.verktoy?.name || "ukjent"}`,
        hvorfor: jobb.tekst,
        type: "verktoy",
        ref: r.verktoy?.id || "",
        resultat: r.ok ? "testet OK og aktivert" : "feilet i sandkassen",
      });
      return r.ok ? "bygget" : "feilet";
    }
    if (jobb.type === "identitet" || jobb.type === "kartlegg") {
      const k = await maskinKort({ tving: true });
      return `kort oppdatert (${k.primaerIp || "ingen IP"}, ${k.modeller.length} modeller)`;
    }
    if (jobb.type === "kollega-test") {
      const res = await diagnoserAlle();
      const feilende = res.filter((r) => !r.ok);
      if (feilende.length)
        addSuggestion({
          tekst: `Kollega-kobling feiler: ${feilende.map((f) => `${f.kollega} (${f.steg.find((s) => s.ok === false)?.detalj || "ukjent"})`).join("; ")}`,
          risiko: "lav",
          kilde: "utvikling",
        });
      return `${res.length - feilende.length}/${res.length} kolleger OK`;
    }
    if (jobb.type === "evaluer-svar") {
      const evalueringer = (doc("evaluations", { list: [] }).list || []).slice(0, 20);
      const svake = evalueringer.filter((e) => Number(e.score ?? e.poeng ?? 10) < 7);
      if (!svake.length) return "ingen svake svar";
      const parsed = await askJson(
        `Her er svake svar fra en lokal AI-agent:\n${svake.map((s) => `- ${s.sporsmal ?? s.spørsmål}: ${s.forbedring ?? s.begrunnelse ?? ""}`).join("\n").slice(0, 2000)}\n\nSkriv maks 3 konkrete adferdsregler som ville gjort svarene bedre. Svar KUN med JSON: {"regler": ["..."]}`,
        { timeoutMs: 90_000 },
      ).catch(() => ({ regler: [] }));
      let lagt = 0;
      for (const r of (parsed.regler || []).slice(0, 3)) if (laerRegel(r, "Fra egen evaluering av svake svar")) lagt++;
      return `${lagt} nye adferdsregler`;
    }
    if (jobb.type === "laer-om") {
      const tema = String(jobb.data?.tema || jobb.tekst);
      const r = await laerTema(tema);
      loggRevisjon({
        hva: `Lærte om «${tema}»`,
        hvorfor: "Kunnskapshull oppdaget i egne svar",
        type: "kunnskap",
        ref: tema,
        resultat: r.ok ? `${r.kilder} kilder lagret lokalt` : "fant ingen brukbare kilder",
      });
      return r.ok ? `lærte fra ${r.kilder} kilder` : "fant ingen kilder";
    }
    if (jobb.type === "finn-mal") {
      const r = await foreslaMal();
      if (r.antall)
        loggRevisjon({
          hva: `Satte seg ${r.antall} egne læringsmål`,
          hvorfor: "Ingen åpne kunnskapshull – valgte selv hva han skulle bli bedre på",
          type: "kunnskap",
          ref: r.mal.join("; ").slice(0, 200),
          resultat: r.mal.join("; ").slice(0, 200),
        });
      return r.antall ? `${r.antall} egne mål: ${r.mal.join("; ")}` : "fant ingen nye mål";
    }
    if (jobb.type === "selvtest") {
      const r = await selvQuiz();
      if (r.hoppet) return r.hoppet;
      return `selvtest ${r.score ?? "?"} /10${r.svakt ? " – nytt læringsbehov notert" : ""}`;
    }
    if (jobb.type === "konsolider-laering") {
      const r = await konsoliderLaering();
      return r.hoppet || `${r.notater} nye varige notater`;
    }
    if (jobb.type === "dagsrapport") {
      const r = dagsRapport();
      const e = r.endring;
      return e
        ? `dagskort lagret (feilrate ${e.verktoyFeilrate >= 0 ? "+" : ""}${e.verktoyFeilrate} %, hull ${e.apneHull >= 0 ? "+" : ""}${e.apneHull})`
        : "første dagskort lagret";
    }
    if (jobb.type === "retrospektiv") {
      const r = await retrospektiv();
      for (const j of r.jobber) leggIKo(j);
      loggRevisjon({
        hva: "Daglig retrospektiv",
        hvorfor: r.vurdering || "Bli litt bedre hver dag",
        type: "annet",
        resultat: `${r.jobber.length} egne tiltak planlagt`,
      });
      return `${r.jobber.length} tiltak planlagt${r.vurdering ? ` – ${r.vurdering}` : ""}`;
    }
    if (jobb.type === "kodeforbedring") {
      const f = await lagKodeforslag(jobb.data?.beskrivelse || jobb.tekst, { fil: jobb.data?.fil || "" });
      let resultat = f.syntaksOk ? `forslag til ${f.fil} klart til godkjenning` : `forslag til ${f.fil} strøk på syntakssjekk`;
      // AUTO-modus: brukeren har selv gitt ham lov til å endre koden sin uten å spørre.
      if (f.syntaksOk && erAuto()) {
        godkjennKodeforslag(f.id);
        resultat = `endret ${f.fil} selv (omstart av tjenesten kreves)`;
      }
      loggRevisjon({ hva: `Kodeforslag: ${f.fil}`, hvorfor: jobb.tekst, type: "kode", ref: f.id, resultat });
      return resultat;
    }
    return "ukjent jobbtype";
  } finally {
    jobberNa = null;
  }
}

/** Kjører køen mens maskinen er ledig. Avbrytes umiddelbart av brukeraktivitet. */
async function kjorKo() {
  const gpu = await gpuStatus().catch(() => null);
  const gpuBruk = Number(gpu?.brukProsent ?? gpu?.utilization ?? 0);
  if (gpuBruk > 60) return { hoppet: "GPU er opptatt" };

  const d = db();
  const venter = (d.ko || []).filter((k) => k.status === "venter").sort((a, b) => b.prioritet - a.prioritet);
  if (!venter.length) {
    await planleggForbedringer();
    return { planlagt: true };
  }

  const jobb = venter[0];
  settKoStatus(jobb.id, "kjører");
  try {
    const resultat = await utforJobb(jobb);
    settKoStatus(jobb.id, "ferdig", resultat);
    logAudit(`Bakgrunnsjobb: ${jobb.tekst} → ${resultat}`, { auto: true, godkjent: true });
    return { jobb: jobb.tekst, resultat };
  } catch (e) {
    settKoStatus(jobb.id, "feilet", String(e?.message || e));
    return { jobb: jobb.tekst, feil: String(e?.message || e) };
  }
}

function sensorSnapshot() {
  const out = {};
  for (const [topic, { value, time }] of latest.entries()) out[topic] = { value, time };
  return out;
}

/** Utboks: motorprosessen har ikke Telegram/MQTT selv – backenden sender for den. */
function leggIUtboks(handling, tekst) {
  const d = doc("motor-utboks", { ko: [] });
  d.ko = [...(d.ko || []), { tid: Date.now(), handling, tekst: String(tekst || "").slice(0, 1000) }].slice(-100);
  saveDoc("motor-utboks", d);
  return "lagt i utboks";
}

/** Backenden tømmer utboksen og sender meldingene videre. */
export async function tommUtboks({ publish, notify } = {}) {
  const d = doc("motor-utboks", { ko: [] });
  const ko = d.ko || [];
  if (!ko.length) return 0;
  saveDoc("motor-utboks", { ko: [] });
  let sendt = 0;
  for (const post of ko) {
    try {
      const h = post.handling || {};
      if (h.type === "telegram" && notify) {
        await notify(String(h.payload || post.tekst).slice(0, 1000));
        sendt++;
      } else if (h.type === "mqtt" && publish && h.emne) {
        await publish(String(h.emne), String(h.payload ?? ""));
        sendt++;
      }
    } catch (e) {
      console.error("[initiativ] utboks-feil:", e?.message || e);
    }
  }
  return sendt;
}

async function execute(handling, tekst) {
  try {
    if (handling.type === "telegram") {
      if (!deps.notify) return leggIUtboks(handling, tekst);
      await deps.notify(String(handling.payload || tekst).slice(0, 1000));
      return "telegram-sendt";
    }
    if (handling.type === "mqtt" && handling.emne) {
      if (!deps.publish) return leggIUtboks(handling, tekst);
      await deps.publish(String(handling.emne), String(handling.payload ?? ""));
      return "mqtt-publisert";
    }
    return "ikke-støttet";
  } catch (e) {
    console.error("[initiativ] utføringsfeil:", e?.message || e);
    return `feil: ${e?.message || "ukjent"}`;
  }
}

async function vurder() {
  sisteKjøring = Date.now();
  const sensorer = sensorSnapshot();
  const nylige = timeline({ limit: 20 });
  const planer = listPlans({ aktiv: true, limit: 5 });

  const prompt = `Du er Jarvis' initiativmotor. Vurder om det er behov for å handle nå basert på:
- Sensorer: ${JSON.stringify(sensorer, null, 2).slice(0, 2000)}
- Siste hendelser: ${nylige.map((m) => m.tekst).join("; ").slice(0, 1000)}
- Aktive planer: ${planer.length}

Svar KUN med JSON: {"forslag": [{"tekst":"...","risiko":"lav|medium|høy","handling":{"type":"telegram|mqtt|none","emne":"topic","payload":"..."}}]}. Hvis ingen handling trengs, returner tom liste.`;

  let forslag = [];
  try {
    const parsed = await askJson(prompt, { timeoutMs: 60_000 });
    forslag = Array.isArray(parsed.forslag) ? parsed.forslag : [];
  } catch (e) {
    console.error("[initiativ] vurderingsfeil:", e?.message || e);
    return;
  }

  for (const f of forslag) {
    const risiko = ["lav", "medium", "høy"].includes(f.risiko) ? f.risiko : "lav";
    const handling = f.handling && typeof f.handling === "object" ? f.handling : { type: "none" };
    if (aktiv && risiko === "lav" && handling.type !== "none") {
      const resultat = await execute(handling, f.tekst);
      addSuggestion({ tekst: f.tekst, risiko, kilde: "autonom", handling, status: "utført" });
      logAudit(`Autonom handling utført: ${f.tekst} (${resultat})`, { risiko, godkjent: true, auto: true });
      remember({ tekst: `Autonomt initiativ utført: ${f.tekst}`, type: "hendelse", kontekst: handling.type, viktighet: 4 });
    } else {
      addSuggestion({ tekst: f.tekst, risiko, kilde: "initiativ", handling });
    }
  }
}

/** Ett tikk: kjør forbedringskøen når maskinen er ledig, ellers vurder sensorer sjelden. */
async function tikk() {
  if (ER_MOTOR) {
    // Motorprosessen leser av/på-bryteren fra disk, så GUI-et styrer den uten omstart.
    const m = settMotor({ hjerteslag: Date.now(), pid: process.pid, jobberNa });
    aktiv = !!m.aktiv;
  }
  if (!aktiv) return;
  if (erLedig()) {
    const r = await kjorKo().catch((e) => {
      console.error("[initiativ] kø-feil:", e?.message || e);
      return null;
    });
    if (ER_MOTOR && r?.jobb) settMotor({ sisteJobb: { tid: Date.now(), jobb: r.jobb, resultat: r.resultat || r.feil } });
    if (Date.now() - sisteKjøring > 15 * 60 * 1000) await vurder().catch(() => {});
  }
}

export function start(intervalMs = 60 * 1000) {
  stop();
  if (ER_MOTOR) {
    // Etter omstart skal motoren bruke brukerens siste aktivitet, ikke starttidspunktet –
    // ellers ville hver omstart utsette bakgrunnsarbeidet med ti nye minutter.
    const lagret = Number(motorDb().sisteAktivitet || 0);
    if (lagret) sisteChat = lagret;
    settMotor({ hjerteslag: Date.now(), pid: process.pid });
  }
  timer = setInterval(() => {
    tikk().catch((e) => console.error("[initiativ] feil:", e));
  }, intervalMs);
  // Motorprosessen har ingenting annet å gjøre – den må holde seg i live.
  if (!ER_MOTOR) timer.unref?.();
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function initiativeStatus() {
  const d = db();
  const m = motorDb();
  return {
    aktiv: isActive(),
    sisteKjøring,
    ledig: erLedig(),
    sisteChat: Math.max(sisteChat, Number(m.sisteAktivitet || 0)),
    jobberNa: jobberNa || (EGEN_MOTOR ? m.jobberNa : null),
    antallForslag: d.forslag.length,
    antallAudit: d.audit.length,
    ko: (d.ko || []).filter((k) => k.status === "venter").length,
    revisjoner: (d.revisjoner || []).length,
    motor: {
      egenProsess: EGEN_MOTOR,
      lever: motorLever(),
      hjerteslag: Number(m.hjerteslag || 0),
      pid: Number(m.pid || 0),
      sisteJobb: m.sisteJobb || null,
    },
  };
}

export function runNow() {
  return kjorKo();
}

export { vurder as vurderNa };
