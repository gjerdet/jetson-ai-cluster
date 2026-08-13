/**
 * Mål- og planleggingssystem for Jarvis.
 * Bryter høynivåmål ned til deloppgaver og kjører dem sekvensielt.
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";
import { askJson } from "./ai.mjs";
import { remember } from "./memory.mjs";
import { listGeneratedTools } from "./toolgen.mjs";

const STATUS = ["venter", "aktiv", "fullført", "feilet", "påvent"];

function db() {
  return doc("plans", { list: [] });
}

function persist(item) {
  saveDoc("plans", item);
}

export function listPlans({ aktiv = false, limit = 50 } = {}) {
  let list = db().list;
  if (aktiv) list = list.filter((p) => p.status === "aktiv" || p.status === "påvent");
  return list.slice(0, limit);
}

export function getPlan(id) {
  return db().list.find((p) => p.id === id);
}

export async function createPlan(mål, { kilde = "bruker", kontekst = "" } = {}) {
  if (!mål || typeof mål !== "string") throw new Error("Målet må være tekst.");
  const plan = {
    id: randomUUID(),
    tid: Date.now(),
    mål: mål.slice(0, 500),
    kilde,
    status: "aktiv",
    steg: [],
    logg: [],
  };

  const verktoy = listGeneratedTools();
  const verktoyListe = verktoy.length
    ? verktoy.map(t => `- ${t.name}: ${t.description}`).join("\n")
    : "- Ingen genererte verktøy ennå.";

  const prompt = `Bryt følgende mål ned i konkrete deloppgaver. Hver oppgave skal ha:
- id (tall, 1,2,3...)
- navn (kort)
- beskrivelse
- avhengigheter (liste med id-er, tom for første steg)
- type: "ai" (krever AI-svar), "verktoy" (kjør et verktøy), "sjekk" (hent data), eller "vent" (vent på bruker/betingelse)
- valgfritt: "verktøy" med navn og argumenter hvis type er "verktoy"

Tilgjengelige verktøy:
${verktoyListe}

Svar KUN med JSON på formen: {"steg": [{"id":1,"navn":"...","beskrivelse":"...","avhengigheter":[],"type":"...","verktøy":{"navn":"...","args":{}}}]}.

Mål: ${mål}
${kontekst ? `Kontekst: ${kontekst}` : ""}`;

  const parsed = await askJson(prompt, { timeoutMs: 90_000 });
  if (!Array.isArray(parsed.steg)) throw new Error("Planleggeren returnerte ikke en stegliste.");
  plan.steg = parsed.steg.map((s) => ({
    id: String(s.id ?? randomUUID()),
    navn: String(s.navn || "Steg").slice(0, 100),
    beskrivelse: String(s.beskrivelse || "").slice(0, 500),
    avhengigheter: Array.isArray(s.avhengigheter) ? s.avhengigheter.map(String) : [],
    type: ["ai", "verktoy", "sjekk", "vent"].includes(s.type) ? s.type : "ai",
    verktøy: s.verktøy && typeof s.verktøy === "object" ? s.verktøy : null,
    status: "venter",
    resultat: null,
  }));

  const d = db();
  d.list.unshift(plan);
  persist(d);
  remember({
    tekst: `Opprettet plan: ${plan.mål}`,
    type: "mål",
    kontekst: `plan-id ${plan.id}`,
    kilder: [kontekst || kilde],
    viktighet: 7,
  });
  return plan;
}

export async function enqueuePlan(planId, opts = {}) {
  const concurrency = Number(opts.concurrency ?? 2);
  const state = doc("planQueue", { items: [], active: [] });
  if (state.items.find((q) => q.planId === planId)) return { queued: true, queue: state.items };
  state.items.push({ planId, lagtTil: Date.now(), prioritet: Number(opts.prioritet || 0), status: "venter" });
  persist(state);
  return { queued: true, queue: state.items };
}

export function removeFromQueue(planId) {
  const state = doc("planQueue", { items: [], active: [] });
  const before = state.items.length;
  state.items = state.items.filter((q) => q.planId !== planId);
  state.active = state.active.filter((q) => q.planId !== planId);
  persist(state);
  return { fjernet: before - state.items.length };
}

export function listQueue() {
  return doc("planQueue", { items: [], active: [] });
}

export function cancelPlan(id) {
  const d = db();
  const plan = d.list.find((p) => p.id === id);
  if (!plan) throw new Error("Fant ikke planen.");
  plan.status = "påvent";
  persist(d);
  return plan;
}

export function resumePlan(id) {
  const d = db();
  const plan = d.list.find((p) => p.id === id);
  if (!plan) throw new Error("Fant ikke planen.");
  plan.status = "aktiv";
  persist(d);
  return plan;
}

export function loggPlan(planId, tekst, { nivå = "info" } = {}) {
  const d = db();
  const plan = d.list.find((p) => p.id === planId);
  if (!plan) return;
  plan.logg.unshift({ tid: Date.now(), nivå, tekst: String(tekst).slice(0, 500) });
  plan.logg = plan.logg.slice(0, 200);
  persist(d);
}

export function oppdaterSteg(planId, stegId, { status, resultat }) {
  const d = db();
  const plan = d.list.find((p) => p.id === planId);
  if (!plan) throw new Error("Fant ikke planen.");
  const steg = plan.steg.find((s) => s.id === stegId);
  if (!steg) throw new Error("Fant ikke steget.");
  if (status && STATUS.includes(status)) steg.status = status;
  if (resultat !== undefined) steg.resultat = String(resultat).slice(0, 2000);
  persist(d);
  return plan;
}

/**
 * Finn neste kjørbare steg i en plan.
 */
export function nesteSteg(plan) {
  const fullførte = new Set(plan.steg.filter((s) => s.status === "fullført").map((s) => String(s.id)));
  return plan.steg.find((s) => s.status === "venter" && s.avhengigheter.every((a) => fullførte.has(String(a))));
}

export function planErFerdig(plan) {
  return plan.steg.every((s) => s.status === "fullført" || s.status === "feilet");
}

export function markerPlanFerdig(planId, { status = "fullført", oppsummering = "" } = {}) {
  const d = db();
  const plan = d.list.find((p) => p.id === planId);
  if (!plan) throw new Error("Fant ikke planen.");
  plan.status = status;
  plan.ferdig = Date.now();
  plan.oppsummering = String(oppsummering).slice(0, 1000);
  persist(d);
  remember({
    tekst: `Plan fullført: ${plan.mål}. ${oppsummering}`,
    type: "erfaring",
    kontekst: `plan-id ${plan.id}`,
    viktighet: 6,
  });
  return plan;
}

export function activePlanCount() {
  return db().list.filter((p) => p.status === "aktiv").length;
}
