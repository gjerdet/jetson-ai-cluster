/**
 * Eget initiativ / bakgrunnsprosess for Jarvis.
 * Vurderer periodisk sensorer, minne og planer, og foreslår/utfører handlinger.
 */
import { doc, saveDoc } from "./store.mjs";
import { latest } from "./store.mjs";
import { askJson } from "./ai.mjs";
import { remember, recall, timeline } from "./memory.mjs";
import { listPlans, activePlanCount } from "./planner.mjs";

let aktiv = false;
let timer = null;
let sisteKjøring = 0;

function db() {
  return doc("initiative", { forslag: [], audit: [] });
}

function persist(item) {
  saveDoc("initiative", item);
}

export function isActive() {
  return aktiv;
}

export function setActive(value) {
  aktiv = !!value;
  if (aktiv) start(5 * 60 * 1000);
  else stop();
  return { aktiv };
}

export function listSuggestions(limit = 20) {
  return db().forslag.slice(0, limit);
}

export function listAudit(limit = 50) {
  return db().audit.slice(0, limit);
}

function logAudit(hendelse, { risiko = "lav", godkjent = false, auto = false } = {}) {
  const d = db();
  d.audit.unshift({
    tid: Date.now(),
    hendelse: String(hendelse).slice(0, 500),
    risiko,
    godkjent,
    auto,
  });
  d.audit = d.audit.slice(0, 500);
  persist(d);
}

function addSuggestion({ tekst, risiko = "lav", kilde = "initiativ", handling = null }) {
  const d = db();
  const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const item = { id, tid: Date.now(), tekst, risiko, kilde, handling, status: "venter" };
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

function sensorSnapshot() {
  const out = {};
  for (const [topic, { value, time }] of latest.entries()) {
    out[topic] = { value, time };
  }
  return out;
}

async function vurder() {
  sisteKjøring = Date.now();
  const sensorer = sensorSnapshot();
  const nylige = timeline({ limit: 20 });
  const planer = listPlans({ aktiv: true, limit: 5 });
  const settings = doc("settings", {});

  const prompt = `Du er Jarvis' initiativmotor. Vurder om det er behov for å handle nå basert på:
- Sensorer: ${JSON.stringify(sensorer, null, 2).slice(0, 2000)}
- Siste hendelser: ${nylige.map((m) => m.tekst).join("; ").slice(0, 1000)}
- Aktive planer: ${planer.length}

Svar KUN med JSON: {"forslag": [{"tekst":"...","risiko":"lav|medium|høy","handling":{"type":"telegram|mqtt|plan|none","payload":"..."}}]}. Hvis ingen handling trengs, returner tom liste.

Husk: lavrisiko = statusmeldinger, medium = justere smarthus, høy = krever godkjenning.`;

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

    // Full autonomi: lavrisiko-handlinger utføres automatisk.
    if (aktiv && risiko === "lav" && handling.type !== "none") {
      addSuggestion({ tekst: f.tekst, risiko, kilde: "autonom", handling });
      logAudit(`Autonom handling forberedt: ${f.tekst}`, { risiko, godkjent: true, auto: true });
      remember({
        tekst: `Autonomt initiativ: ${f.tekst}`,
        type: "hendelse",
        kontekst: handling.type,
        viktighet: 4,
      });
    } else {
      addSuggestion({ tekst: f.tekst, risiko, kilde: "initiativ", handling });
    }
  }
}

export function start(intervalMs = 5 * 60 * 1000) {
  stop();
  timer = setInterval(() => {
    vurder().catch((e) => console.error("[initiativ] feil:", e));
  }, intervalMs);
  timer.unref?.();
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function initiativeStatus() {
  return { aktiv, sisteKjøring, antallForslag: db().forslag.length, antallAudit: db().audit.length };
}

export function runNow() {
  return vurder();
}
