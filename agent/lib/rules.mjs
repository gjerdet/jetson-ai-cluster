/**
 * Regelmotor som kjører i agenten – uavhengig av om HUD-en er åpen.
 * Regler evalueres for hver innkommende måling og kan publisere MQTT,
 * varsle på Telegram og skrive til hendelsesloggen.
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc, latest } from "./store.mjs";
import { validateRule } from "./contract.mjs";

export const rulesDoc = () => doc("rules", { list: [] });
export const logDoc = () => doc("rule-log", { list: [] });

export function listRules() {
  return rulesDoc().list;
}

export function saveRules(list) {
  const clean = (Array.isArray(list) ? list : []).map((r) => ({
    id: r.id || randomUUID(),
    navn: String(r.navn || "Regel"),
    aktiv: r.aktiv !== false,
    emne: String(r.emne || ""),
    operator: ["over", "under", "lik", "endres"].includes(r.operator) ? r.operator : "over",
    verdi: r.verdi ?? "",
    pauseSek: Number(r.pauseSek) || 300,
    handlinger: (Array.isArray(r.handlinger) ? r.handlinger : []).map((h) => ({
      type: ["mqtt", "telegram", "logg"].includes(h.type) ? h.type : "logg",
      emne: String(h.emne || ""),
      payload: String(h.payload ?? ""),
      tekst: String(h.tekst ?? ""),
    })),
    sistUtlost: r.sistUtlost || 0,
  }));
  saveDoc("rules", { list: clean });
  return clean;
}

export function logEvent(entry) {
  const db = logDoc();
  db.list.unshift({ id: randomUUID(), tid: Date.now(), ...entry });
  db.list = db.list.slice(0, 500);
  saveDoc("rule-log", db);
  return db.list[0];
}

function topicMatches(pattern, topic) {
  if (!pattern || pattern === topic) return pattern === topic;
  const p = pattern.split("/");
  const t = topic.split("/");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "#") return true;
    if (p[i] === "+") continue;
    if (p[i] !== t[i]) return false;
  }
  return p.length === t.length;
}

function conditionMet(rule, value, previous) {
  const num = Number(value);
  const target = Number(rule.verdi);
  switch (rule.operator) {
    case "over":
      return Number.isFinite(num) && Number.isFinite(target) && num > target;
    case "under":
      return Number.isFinite(num) && Number.isFinite(target) && num < target;
    case "lik":
      return String(value) === String(rule.verdi);
    case "endres":
      return previous != null && String(previous) !== String(value);
    default:
      return false;
  }
}

/**
 * Kjører alle regler for én måling.
 * `deps`: { publish(emne,payload), notify(tekst) }
 */
export async function evaluate({ topic, value, previous }, deps = {}) {
  const db = rulesDoc();
  const fired = [];
  for (const rule of db.list) {
    if (!rule.aktiv || !topicMatches(rule.emne, topic)) continue;
    if (!conditionMet(rule, value, previous)) continue;
    if (Date.now() - (rule.sistUtlost || 0) < (rule.pauseSek || 0) * 1000) continue;
    rule.sistUtlost = Date.now();
    fired.push(rule.navn);
    for (const h of rule.handlinger) {
      const text = fill(h.tekst || h.payload || "", { emne: topic, verdi: value, regel: rule.navn });
      try {
        if (h.type === "mqtt" && deps.publish) await deps.publish(h.emne || topic, fill(h.payload, { emne: topic, verdi: value, regel: rule.navn }));
        else if (h.type === "telegram" && deps.notify) await deps.notify(text || `${rule.navn}: ${topic} = ${value}`);
        logEvent({ regel: rule.navn, emne: topic, verdi: value, handling: h.type, tekst: text });
      } catch (e) {
        logEvent({ regel: rule.navn, emne: topic, verdi: value, handling: h.type, feil: String(e?.message || e) });
      }
    }
  }
  if (fired.length) saveDoc("rules", db);
  return fired;
}

function fill(tpl, vars) {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** Statuslinje til HUD-en. */
export function rulesStatus() {
  const list = rulesDoc().list;
  return {
    antall: list.length,
    aktive: list.filter((r) => r.aktiv).length,
    sisteHendelser: logDoc().list.slice(0, 20),
    kjenteEmner: [...latest.keys()].length,
  };
}
