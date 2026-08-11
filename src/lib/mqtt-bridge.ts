import { useSyncExternalStore } from "react";
import type { MqttClient } from "mqtt";
import type { AlertRule, Device, MqttConfig } from "./hud-store";

export type MqttStatus = "off" | "connecting" | "online" | "error";

export type TopicState = { topic: string; value: string; time: number };
export type LogLine = { id: string; dir: "in" | "out" | "sys"; text: string; time: number };
export type Sample = { t: number; v: number };
export type Discovered = {
  topic: string;
  value: string;
  time: number;
  count: number;
  /** navn fra Home Assistant-discovery, hvis funnet */
  name?: string;
  kind?: string;
  known: boolean;
};
export type AlertItem = {
  id: string;
  ruleId: string;
  text: string;
  level: "warn" | "crit";
  time: number;
};

export type PubLine = { topic: string; payload: string; time: number; ok: boolean };
export type ErrLine = { text: string; time: number };

type State = {
  status: MqttStatus;
  error: string;
  topics: Record<string, TopicState>;
  log: LogLine[];
  history: Record<string, Sample[]>;
  discovered: Record<string, Discovered>;
  alerts: AlertItem[];
  /** diagnostikk */
  subscriptions: string[];
  published: PubLine[];
  errors: ErrLine[];
  reconnects: number;
  connectedAt: number;
  lastRx: number;
  pingMs: number | null;
  pingAt: number;
  url: string;
};

const HIST_KEY = "hud.mqtt.history.v1";
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_POINTS = 720;
const PING_TOPIC = "jarvis/hud/ping";

let state: State = {
  status: "off",
  error: "",
  topics: {},
  log: [],
  history: {},
  discovered: {},
  alerts: [],
  subscriptions: [],
  published: [],
  errors: [],
  reconnects: 0,
  connectedAt: 0,
  lastRx: 0,
  pingMs: null,
  pingAt: 0,
  url: "",
};
let client: MqttClient | null = null;
let rules: AlertRule[] = [];
let knownTopics: string[] = [];
let staleTimer: ReturnType<typeof setInterval> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let telegramChat = "";
let pingSent = 0;
const lastFired: Record<string, number> = {};
/** når betingelsen først ble sann per regel (for varighetskrav) */
const pendingSince: Record<string, number> = {};
const subs = new Set<() => void>();

const emit = () => subs.forEach((f) => f());
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  emit();
};

const log = (dir: LogLine["dir"], text: string) =>
  set({
    log: [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, dir, text, time: Date.now() },
      ...state.log,
    ].slice(0, 200),
  });

export function useMqtt(): State {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
    () => state,
  );
}

/* ---------------- historikk ---------------- */

function loadHistory() {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Sample[]>;
    const cut = Date.now() - WINDOW_MS;
    const clean: Record<string, Sample[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const pts = (v ?? []).filter((p) => p.t > cut);
      if (pts.length) clean[k] = pts;
    }
    state = { ...state, history: clean };
  } catch {
    /* ignore */
  }
}
loadHistory();

function saveHistory() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(state.history));
    } catch {
      /* ignore */
    }
  }, 5000);
}

/** Trekker ut første tall i en nyttelast (også fra JSON). */
export function numericValue(raw: string): number | null {
  const t = raw.trim();
  if (/^(on|true|åpen|open)$/i.test(t)) return 1;
  if (/^(off|false|lukket|closed)$/i.test(t)) return 0;
  const m = /-?\d+(\.\d+)?/.exec(t);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function record(topic: string, value: string) {
  const n = numericValue(value);
  if (n === null) return;
  const cut = Date.now() - WINDOW_MS;
  const prev = state.history[topic] ?? [];
  const next = [...prev, { t: Date.now(), v: n }].filter((p) => p.t > cut).slice(-MAX_POINTS);
  set({ history: { ...state.history, [topic]: next } });
  saveHistory();
}

export function historyFor(topic: string): Sample[] {
  const base = topic.replace(/\/#$/, "");
  const keys = Object.keys(state.history).filter((k) => k === base || k.startsWith(`${base}/`));
  if (!keys.length) return [];
  const best = keys.sort(
    (a, b) => (state.history[b]?.length ?? 0) - (state.history[a]?.length ?? 0),
  )[0]!;
  return state.history[best] ?? [];
}

/** Alle loggede emner under et enhetsemne. */
export function historyTopics(topic: string): string[] {
  const base = topic.replace(/\/#$/, "");
  return Object.keys(state.history)
    .filter((k) => k === base || k.startsWith(`${base}/`))
    .sort();
}

export function clearHistory() {
  set({ history: {} });
  try {
    localStorage.removeItem(HIST_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------------- oppdagelse ---------------- */

function isKnown(topic: string) {
  return knownTopics.some((k) => topic === k || topic.startsWith(`${k}/`));
}

function noteDiscovery(topic: string, value: string) {
  const prev = state.discovered[topic];
  let name: string | undefined = prev?.name;
  let kind: string | undefined = prev?.kind;
  // Home Assistant MQTT discovery: homeassistant/<komponent>/<id>/config
  const ha = /^homeassistant\/([^/]+)\/(.+)\/config$/.exec(topic);
  if (ha) {
    kind = ha[1];
    try {
      const cfg = JSON.parse(value) as { name?: string; state_topic?: string };
      name = cfg.name ?? ha[2];
      if (cfg.state_topic) {
        set({
          discovered: {
            ...state.discovered,
            [cfg.state_topic]: {
              topic: cfg.state_topic,
              value: "",
              time: Date.now(),
              count: 1,
              ...(name ? { name } : {}),
              ...(kind ? { kind } : {}),
              known: isKnown(cfg.state_topic),
            },
          },
        });
      }
    } catch {
      name = ha[2];
    }
  }
  set({
    discovered: {
      ...state.discovered,
      [topic]: {
        topic,
        value,
        time: Date.now(),
        count: (prev?.count ?? 0) + 1,
        ...(name ? { name } : {}),
        ...(kind ? { kind } : {}),
        known: isKnown(topic),
      },
    },
  });
}

/** Emner som ikke tilhører en registrert enhet. */
export function newDiscoveries(): Discovered[] {
  return Object.values(state.discovered)
    .filter((d) => !isKnown(d.topic) && !/\/config$/.test(d.topic))
    .sort((a, b) => b.time - a.time);
}

export function forgetDiscovery(topic: string) {
  const next = { ...state.discovered };
  delete next[topic];
  set({ discovered: next });
}

/* ---------------- regler / varsler ---------------- */

export function setRules(next: AlertRule[]) {
  rules = next ?? [];
}

/** Telegram-mottaker for regelhandlinger. */
export function setTelegramChat(chatId: string) {
  telegramChat = (chatId ?? "").trim();
}

function fill(tpl: string, ctx: { rule: string; topic: string; value: string }) {
  return (tpl || "")
    .replace(/\{regel\}/gi, ctx.rule)
    .replace(/\{emne\}/gi, ctx.topic)
    .replace(/\{verdi\}/gi, ctx.value);
}

/** Kjører handlingskjeden til en regel. */
function runActions(rule: AlertRule, topic: string, value: string) {
  const ctx = { rule: rule.name, topic, value };
  for (const a of rule.actions ?? []) {
    if (a.kind === "mqtt") {
      const ok = publishMqtt(fill(a.topic, ctx), fill(a.payload, ctx));
      log("sys", `HANDLING ${rule.name}: ${a.topic} ← ${a.payload}${ok ? "" : " (feilet)"}`);
    } else if (a.kind === "notify") {
      notify("JARVIS – handling", fill(a.text, ctx));
    } else if (a.kind === "telegram") {
      const text = fill(a.text, ctx);
      if (!telegramChat) {
        log("sys", `Telegram hoppet over (mangler chat-id): ${text}`);
        continue;
      }
      void import("./telegram.functions")
        .then(({ sendTelegram }) => sendTelegram({ data: { chatId: telegramChat, text } }))
        .then((r) =>
          log("sys", r.ok ? `Telegram sendt: ${text}` : `Telegram-feil: ${r.error}`),
        )
        .catch((e: unknown) =>
          log("sys", `Telegram-feil: ${e instanceof Error ? e.message : "ukjent"}`),
        );
    }
  }
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted")
      new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

function fire(
  rule: AlertRule,
  text: string,
  level: AlertItem["level"],
  ctx?: { topic: string; value: string },
) {
  const now = Date.now();
  const cooldown = Math.max(1, rule.cooldownMin ?? 10) * 60000;
  if (now - (lastFired[rule.id] ?? 0) < cooldown) return;
  lastFired[rule.id] = now;
  const item: AlertItem = {
    id: `${now}-${rule.id}`,
    ruleId: rule.id,
    text,
    level,
    time: now,
  };
  set({ alerts: [item, ...state.alerts].slice(0, 60) });
  log("sys", `VARSEL: ${text}`);
  notify("JARVIS – smarthusvarsel", text);
  runActions(rule, ctx?.topic ?? rule.topic, ctx?.value ?? "");
}

function matchTopic(pattern: string, topic: string) {
  const p = pattern.trim().replace(/\/#$/, "");
  if (!p) return false;
  return topic === p || topic.startsWith(`${p}/`);
}

/** Håndterer varighetskrav: returnerer true når betingelsen har holdt lenge nok. */
function sustained(rule: AlertRule, on: boolean) {
  const need = Math.max(0, rule.forMinutes ?? 0) * 60000;
  if (!on) {
    delete pendingSince[rule.id];
    return false;
  }
  if (!need) return true;
  const since = pendingSince[rule.id];
  if (!since) {
    pendingSince[rule.id] = Date.now();
    return false;
  }
  return Date.now() - since >= need;
}

function evaluateValue(topic: string, value: string) {
  const n = numericValue(value);
  for (const r of rules) {
    if (!r.enabled || r.kind === "stale" || !matchTopic(r.topic, topic)) continue;
    const level = r.level ?? "warn";
    if (r.kind === "equals") {
      const on = value.trim().toLowerCase() === String(r.value).trim().toLowerCase();
      if (sustained(r, on)) fire(r, `${r.name}: ${topic} = ${value}`, level, { topic, value });
      continue;
    }
    if (n === null) continue;
    const limit = Number(r.value);
    if (!Number.isFinite(limit)) continue;
    const on = r.kind === "above" ? n > limit : n < limit;
    const held = r.forMinutes ? ` i ${r.forMinutes} min` : "";
    if (sustained(r, on))
      fire(
        r,
        `${r.name}: ${topic} = ${n} (${r.kind === "above" ? "over" : "under"} ${limit}${held})`,
        level,
        { topic, value: String(n) },
      );
  }
}

function checkStale() {
  const now = Date.now();
  for (const r of rules) {
    if (!r.enabled || r.kind !== "stale") continue;
    const mins = Math.max(1, r.minutes ?? 15);
    const hits = Object.values(state.topics).filter((t) => matchTopic(r.topic, t.topic));
    const last = hits.sort((a, b) => b.time - a.time)[0];
    if (!last) continue;
    if (now - last.time > mins * 60000)
      fire(
        r,
        `${r.name}: ingen signal fra ${r.topic} på ${Math.round((now - last.time) / 60000)} min`,
        r.level ?? "crit",
      );
  }
}

export function clearAlerts() {
  set({ alerts: [] });
}

export async function askNotificationPermission() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default")
      await Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

/* ---------------- tilkobling ---------------- */

/** Alle emner broen skal lytte på: base + hvert enhetsemne. */
export function deviceTopics(devices: Device[], base: string): string[] {
  const list = devices
    .filter((d) => d.enabled && d.protocol === "mqtt" && d.topic?.trim())
    .map((d) => `${d.topic!.trim().replace(/\/#$/, "")}/#`);
  if (base.trim()) list.push(base.trim());
  return [...new Set(list)];
}

export async function connectMqtt(cfg: MqttConfig, devices: Device[]) {
  disconnectMqtt();
  if (!cfg.url.trim()) {
    set({ status: "error", error: "Mangler broker-URL" });
    return;
  }
  knownTopics = devices
    .filter((d) => d.protocol === "mqtt" && d.topic?.trim())
    .map((d) => d.topic!.trim().replace(/\/#$/, ""));
  set({ status: "connecting", error: "" });
  try {
    const mqtt = (await import("mqtt")).default;
    const c = mqtt.connect(cfg.url.trim(), {
      ...(cfg.username ? { username: cfg.username } : {}),
      ...(cfg.password ? { password: cfg.password } : {}),
      clientId: `jarvis-hud-${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
      clean: true,
    });
    client = c;

    c.on("connect", () => {
      set({ status: "online", error: "" });
      const topics = deviceTopics(devices, cfg.baseTopic);
      if (cfg.discovery !== false) {
        topics.push("homeassistant/#");
        if (cfg.discoveryTopic?.trim()) topics.push(cfg.discoveryTopic.trim());
      }
      const uniq = [...new Set(topics)];
      if (uniq.length) c.subscribe(uniq, { qos: 0 });
      log("sys", `Tilkoblet ${cfg.url} · abonnerer på ${uniq.join(", ") || "ingenting"}`);
    });
    c.on("reconnect", () => set({ status: "connecting" }));
    c.on("close", () => set({ status: state.status === "error" ? "error" : "off" }));
    c.on("error", (err: Error) => {
      set({ status: "error", error: err.message });
      log("sys", `Feil: ${err.message}`);
    });
    c.on("message", (topic: string, payload: Uint8Array) => {
      const value = new TextDecoder().decode(payload).slice(0, 400);
      set({ topics: { ...state.topics, [topic]: { topic, value, time: Date.now() } } });
      record(topic, value);
      noteDiscovery(topic, value);
      evaluateValue(topic, value);
      log("in", `${topic} → ${value}`);
    });

    if (!staleTimer) staleTimer = setInterval(checkStale, 30000);
  } catch (err) {
    set({ status: "error", error: err instanceof Error ? err.message : "Ukjent feil" });
  }
}

export function disconnectMqtt() {
  if (client) {
    client.end(true);
    client = null;
  }
  if (staleTimer) {
    clearInterval(staleTimer);
    staleTimer = null;
  }
  set({ status: "off" });
}

export function publishMqtt(topic: string, payload: string) {
  if (!client || state.status !== "online") return false;
  client.publish(topic, payload, { qos: 0 });
  log("out", `${topic} ← ${payload}`);
  return true;
}

export function mqttOnline() {
  return state.status === "online";
}

/* ---------------- kommandoer ---------------- */

export type CommandKind = "switch" | "dim" | "fan" | "threshold" | "raw";

/** Utleder tilgjengelige kommandoer fra enhetens capabilities-tekst. */
export function commandsFor(capabilities: string): CommandKind[] {
  const c = (capabilities ?? "").toLowerCase();
  const out: CommandKind[] = [];
  if (!c || /(lys|light|switch|bryter|rele|relay|plug|stikk|on\/off)/.test(c)) out.push("switch");
  if (/(dim|bright|lysstyrke)/.test(c)) out.push("dim");
  if (/(vifte|fan|hastighet|speed)/.test(c)) out.push("fan");
  if (/(terskel|threshold|setpoint|settpunkt|target|temp)/.test(c)) out.push("threshold");
  return out.length ? out : ["switch"];
}

export const COMMAND_TOPIC: Record<Exclude<CommandKind, "raw">, string> = {
  switch: "set",
  dim: "brightness/set",
  fan: "speed/set",
  threshold: "threshold/set",
};

export function sendCommand(baseTopic: string, kind: CommandKind, payload: string) {
  const base = baseTopic.replace(/\/#$/, "");
  if (!base) return false;
  const suffix = kind === "raw" ? "" : COMMAND_TOPIC[kind];
  return publishMqtt(suffix ? `${base}/${suffix}` : base, payload);
}

/* ---------------- AI-integrasjon ---------------- */

/** Kompakt sanntidsstatus til systemprompten/AI-en. */
export function mqttBrief(): string {
  const rows = Object.values(state.topics)
    .sort((a, b) => b.time - a.time)
    .slice(0, 40)
    .map((t) => `- ${t.topic} = ${t.value} (${new Date(t.time).toLocaleTimeString("nb-NO")})`);
  const alerts = state.alerts
    .slice(0, 8)
    .map((a) => `- [${a.level}] ${a.text} (${new Date(a.time).toLocaleTimeString("nb-NO")})`);
  const parts: string[] = [];
  if (rows.length) parts.push(`Sanntidsdata fra MQTT-broker:\n${rows.join("\n")}`);
  if (alerts.length) parts.push(`Aktive smarthusvarsler:\n${alerts.join("\n")}`);
  return parts.join("\n");
}

/** Instruksjon som lar modellen selv styre MQTT. */
export const MQTT_TOOL_PROMPT = `Du kan styre smarthuset direkte. For å sende en MQTT-kommando skriver du en egen linje på formen:
MQTT: <emne> = <nyttelast>
Eksempel: MQTT: hjem/stue/lys/set = ON
Bruk kun emner som finnes i enhetslisten eller sanntidsdataene, sett /set (eller /brightness/set, /speed/set, /threshold/set) på slutten, og skriv én linje per kommando. Forklar kort i vanlig tekst hva du gjorde.`;

const CMD_LINE = /^\s*MQTT:\s*([^\s=]+)\s*=\s*(.+?)\s*$/gim;

/** Finner og utfører MQTT-kommandoer i et AI-svar. */
export function executeAiCommands(text: string): { topic: string; payload: string; ok: boolean }[] {
  const out: { topic: string; payload: string; ok: boolean }[] = [];
  CMD_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CMD_LINE.exec(text))) {
    const topic = (m[1] ?? "").trim();
    const payload = (m[2] ?? "").trim();
    if (!topic) continue;
    out.push({ topic, payload, ok: publishMqtt(topic, payload) });
  }
  return out;
}
