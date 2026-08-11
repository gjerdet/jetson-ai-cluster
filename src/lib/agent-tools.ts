import type { CustomTool, HudConfig } from "./hud-store";
import { deviceBrief, newCustomTool, newMemory, sanitizeToolName } from "./hud-store";
import { historyFor, numericValue, mqttOnline, publishMqtt } from "./mqtt-bridge";
import { fetchIntegration } from "./integrations.functions";
import { briefingText, refreshFeed, snapshot } from "./world-feed";
import { pingNode } from "./hud-client";
import {
  agentCfg,
  agentDeleteScript,
  agentExec,
  agentHealth,
  agentReadScript,
  agentRun,
  agentScripts,
  agentWriteScript,
  formatResult,
} from "./local-agent";


export type ToolCall = { name: string; args: Record<string, unknown>; raw: string };

export type ToolContext = {
  config: HudConfig;
  update?: (c: HudConfig) => void;
  /** siste kjente MQTT-verdier */
  topics: Record<string, { value: string; time: number }>;
};

export type ToolSpec = {
  name: string;
  category: "smarthus" | "system" | "verden" | "minne" | "verktoy";
  summary: string;
  args: string;
  builtin: true;
};

/** Innebygde verktøy Jarvis kan kalle i verktøy-loopen. */
export const TOOL_CATALOG: ToolSpec[] = [
  {
    name: "mqtt_les",
    category: "smarthus",
    summary: "Leser siste målte verdi på et MQTT-emne (eller alle kjente emner).",
    args: '{"emne": "hjem/stue/temp"}',
    builtin: true,
  },
  {
    name: "mqtt_historikk",
    category: "smarthus",
    summary: "Min/maks/snitt for et emne siste 24 timer.",
    args: '{"emne": "hjem/stue/temp"}',
    builtin: true,
  },
  {
    name: "enheter",
    category: "smarthus",
    summary: "Lister alle registrerte ESP32/Pi-enheter med emner og evner.",
    args: "{}",
    builtin: true,
  },
  {
    name: "noder",
    category: "system",
    summary: "Status og svartid for alle AI-noder.",
    args: "{}",
    builtin: true,
  },
  {
    name: "system_hent",
    category: "system",
    summary: "Henter data fra et tilkoblet lokalt system (TrueNAS, Proxmox, UniFi, Homey).",
    args: '{"navn": "TrueNAS", "sti": "/pool/dataset"}',
    builtin: true,
  },
  {
    name: "world_brief",
    category: "verden",
    summary: "Topp hendelser fra World Monitor.",
    args: '{"antall": 10}',
    builtin: true,
  },
  {
    name: "minne_lagre",
    category: "minne",
    summary: "Lagrer et varig faktum i lokalt minne.",
    args: '{"tekst": "..."}',
    builtin: true,
  },
  {
    name: "verktoy_liste",
    category: "verktoy",
    summary: "Lister alle egendefinerte verktøy som er laget.",
    args: "{}",
    builtin: true,
  },
  {
    name: "verktoy_lag",
    category: "verktoy",
    summary:
      "Lager et nytt egendefinert verktøy (http, mqtt eller prompt). Krever godkjenning i SYSTEM → AGENTER.",
    args: '{"navn": "hent_vaer", "type": "http", "beskrivelse": "...", "url": "http://...", "metode": "GET", "args": "{\\"sted\\":\\"Oslo\\"}"}',
    builtin: true,
  },
  {
    name: "verktoy_slett",
    category: "verktoy",
    summary: "Sletter et egendefinert verktøy du har laget.",
    args: '{"navn": "hent_vaer"}',
    builtin: true,
  },
];

export const TOOL_NAMES = TOOL_CATALOG.map((t) => t.name);

export const TOOL_PROMPT = `Du har verktøy du kan bruke for å hente ekte data før du svarer.
Skriv verktøykall på egen linje, nøyaktig slik:
VERKTØY: navn {"felt": "verdi"}

Tilgjengelige verktøy:
- mqtt_les {"emne": "hjem/stue/temp"} – siste målte verdi. Uten emne: alle kjente emner.
- mqtt_historikk {"emne": "hjem/stue/temp"} – min/maks/snitt siste 24 timer.
- enheter {} – alle registrerte ESP32/Pi-enheter med emner og evner.
- noder {} – status og svartid for alle AI-noder.
- system_hent {"navn": "TrueNAS", "sti": "/pool/dataset"} – henter data fra et tilkoblet lokalt system.
- world_brief {"antall": 10} – topp hendelser fra World Monitor.
- minne_lagre {"tekst": "..."} – lagrer et varig faktum.
- verktoy_liste {} – dine egendefinerte verktøy.
- verktoy_lag {"navn": "hent_vaer", "type": "http", "beskrivelse": "...", "url": "http://...", "metode": "GET"} – lag nytt verktøy. Typer: http, mqtt (krever "emne" og "payload"), prompt (krever "tekst").
- verktoy_slett {"navn": "hent_vaer"} – slett et verktøy du har laget.

Regler: kall bare verktøy når du faktisk trenger dataene. Du får resultatet tilbake og skal
deretter svare brukeren på norsk bokmål. Ikke finn på verdier du ikke har hentet.
Du har ikke tilgang til operativsystemet, filsystemet eller shell – bare verktøyene over.
Lag nye verktøy kun når brukeren ber om det, og fortell alltid hva du laget.`;

/** Prompt-tillegg som beskriver de egendefinerte verktøyene som er slått på. */
export function customToolPrompt(config: HudConfig): string {
  const list = (config.customTools ?? []).filter((t) => t.enabled);
  if (!list.length) return "";
  return [
    "Egendefinerte verktøy (laget lokalt, kalles på samme måte):",
    ...list.map((t) => `- ${t.name} ${t.args || "{}"} – ${t.description || t.kind}`),
  ].join("\n");
}

export function customToolNames(config: HudConfig): string[] {
  return (config.customTools ?? []).filter((t) => t.enabled).map((t) => t.name);
}

const CALL_RE = /^\s*(?:VERKT[ØO]Y|TOOL)\s*:\s*([a-z0-9_]+)\s*(\{[\s\S]*?\})?\s*$/gim;

export function parseToolCalls(text: string, extraNames: string[] = []): ToolCall[] {
  const allowed = new Set<string>([...TOOL_NAMES, ...extraNames]);
  const out: ToolCall[] = [];
  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(text))) {
    const name = (m[1] ?? "").toLowerCase();
    if (!allowed.has(name)) continue;
    let args: Record<string, unknown> = {};
    try {
      if (m[2]) args = JSON.parse(m[2]) as Record<string, unknown>;
    } catch {
      /* tolererer ugyldig JSON */
    }
    out.push({ name, args, raw: m[0].trim() });
  }
  return out;
}

/** Fjerner verktøylinjene fra et svar slik at brukeren bare ser teksten. */
export function stripToolCalls(text: string): string {
  return text.replace(CALL_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const { config, topics } = ctx;

  if (call.name === "mqtt_les") {
    const topic = str(call.args["emne"] ?? call.args["topic"]);
    const entries = Object.entries(topics);
    if (!entries.length) return "Ingen MQTT-data tilgjengelig (broker er ikke tilkoblet).";
    if (!topic)
      return entries
        .slice(0, 40)
        .map(([t, s]) => `${t} = ${s.value}`)
        .join("\n");
    const hit = entries.filter(([t]) => t.includes(topic));
    if (!hit.length) return `Fant ingen emner som matcher «${topic}».`;
    return hit.map(([t, s]) => `${t} = ${s.value} (${new Date(s.time).toLocaleTimeString("nb-NO")})`).join("\n");
  }

  if (call.name === "mqtt_historikk") {
    const topic = str(call.args["emne"] ?? call.args["topic"]);
    const pts = historyFor(topic);
    if (!pts.length) return `Ingen historikk lagret for «${topic}».`;
    const vals = pts.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return `${topic}: ${pts.length} målinger siste 24 t – min ${min}, maks ${max}, snitt ${avg.toFixed(2)}, siste ${vals[vals.length - 1]}.`;
  }

  if (call.name === "enheter") {
    return deviceBrief(config) || "Ingen enheter registrert.";
  }

  if (call.name === "noder") {
    const nodes = config.nodes.filter((n) => n.enabled);
    if (!nodes.length) return "Ingen aktive noder.";
    const res = await Promise.all(
      nodes.map(async (n) => {
        const ms = await pingNode(n);
        return `${n.name} (${n.model}, ${n.role}) – ${ms == null ? "ikke svar" : `${ms} ms`}`;
      }),
    );
    return res.join("\n");
  }

  if (call.name === "system_hent") {
    const name = str(call.args["navn"] ?? call.args["name"]).toLowerCase();
    const path = str(call.args["sti"] ?? call.args["path"]) || "/";
    const list = (config.integrations ?? []).filter((i) => i.enabled);
    const target =
      list.find((i) => i.name.toLowerCase().includes(name) || i.kind.includes(name)) ?? list[0];
    if (!target) return "Ingen aktive lokale systemer er konfigurert under SYSTEM → KOBLINGER.";
    const r = await fetchIntegration({
      data: {
        baseUrl: target.baseUrl,
        path,
        ...(target.token ? { token: target.token } : {}),
        kind: target.kind,
      },
    });
    return r.ok ? `${target.name}${path}:\n${r.body.slice(0, 2500)}` : `${target.name}: ${r.error}`;
  }

  if (call.name === "world_brief") {
    const n = Number(call.args["antall"] ?? 10) || 10;
    if (!snapshot().events.length) await refreshFeed();
    return briefingText(Math.min(n, 20));
  }

  if (call.name === "minne_lagre") {
    const text = str(call.args["tekst"] ?? call.args["text"]).trim();
    if (!text) return "Tomt minne – ingenting lagret.";
    if (!ctx.update) return "Minnet er skrivebeskyttet akkurat nå.";
    ctx.update({ ...config, memories: [...(config.memories ?? []), newMemory(text)] });
    return `Lagret i langtidsminnet: «${text}».`;
  }

  if (call.name === "verktoy_liste") {
    const list = config.customTools ?? [];
    if (!list.length) return "Ingen egendefinerte verktøy er laget enda.";
    return list
      .map(
        (t) =>
          `${t.name} (${t.kind}${t.enabled ? "" : ", avslått"}, laget av ${t.createdBy}) – ${t.description || "ingen beskrivelse"}`,
      )
      .join("\n");
  }

  if (call.name === "verktoy_lag") {
    if (!ctx.update) return "Kan ikke lage verktøy akkurat nå (skrivebeskyttet).";
    const name = sanitizeToolName(str(call.args["navn"] ?? call.args["name"]));
    if (!name) return "Mangler navn på verktøyet.";
    if ((TOOL_NAMES as readonly string[]).includes(name))
      return `«${name}» er navnet på et innebygd verktøy. Velg et annet navn.`;
    const existing = config.customTools ?? [];
    if (existing.some((t) => t.name === name)) return `Verktøyet «${name}» finnes allerede.`;
    const rawKind = str(call.args["type"] ?? call.args["kind"]).toLowerCase();
    const kind: CustomTool["kind"] =
      rawKind === "mqtt" ? "mqtt" : rawKind === "prompt" ? "prompt" : "http";
    const tool: CustomTool = {
      ...newCustomTool("jarvis"),
      name,
      kind,
      description: str(call.args["beskrivelse"] ?? call.args["description"]),
      url: str(call.args["url"]),
      method: str(call.args["metode"] ?? call.args["method"]).toUpperCase() === "POST" ? "POST" : "GET",
      topic: str(call.args["emne"] ?? call.args["topic"]),
      body: str(call.args["payload"] ?? call.args["body"] ?? call.args["tekst"]),
      args: str(call.args["args"]) || "{}",
    };
    ctx.update({ ...config, customTools: [...existing, tool] });
    return `Laget verktøyet «${name}» (${kind}). Det kan slås av eller slettes under SYSTEM → AGENTER.`;
  }

  if (call.name === "verktoy_slett") {
    if (!ctx.update) return "Kan ikke slette verktøy akkurat nå (skrivebeskyttet).";
    const name = sanitizeToolName(str(call.args["navn"] ?? call.args["name"]));
    const existing = config.customTools ?? [];
    if (!existing.some((t) => t.name === name)) return `Fant ingen verktøy som heter «${name}».`;
    ctx.update({ ...config, customTools: existing.filter((t) => t.name !== name) });
    return `Slettet verktøyet «${name}».`;
  }

  const custom = (config.customTools ?? []).find((t) => t.enabled && t.name === call.name);
  if (custom) return runCustomTool(custom, call.args);

  return `Ukjent verktøy: ${call.name}`;
}

function fill(tpl: string, args: Record<string, unknown>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => str(args[k]));
}

async function runCustomTool(tool: CustomTool, args: Record<string, unknown>): Promise<string> {
  if (tool.kind === "prompt") {
    return fill(tool.body ?? "", args) || tool.description || "Tomt verktøy.";
  }

  if (tool.kind === "mqtt") {
    if (!mqttOnline()) return "MQTT-broker er ikke tilkoblet.";
    const topic = fill(tool.topic ?? "", args);
    if (!topic) return "Verktøyet mangler MQTT-emne.";
    publishMqtt(topic, fill(tool.body ?? "", args));
    return `Sendte MQTT til ${topic}.`;
  }

  const url = fill(tool.url ?? "", args);
  if (!url) return "Verktøyet mangler URL.";
  try {
    const init: RequestInit = { method: tool.method ?? "GET" };
    if ((tool.method ?? "GET") === "POST") {
      init.headers = { "content-type": "application/json" };
      init.body = fill(tool.body || "{}", args);
    }
    const r = await fetch(url, init);
    const text = await r.text();
    return `${r.status} ${r.statusText}\n${text.slice(0, 2500)}`;
  } catch (e) {
    return `Kall feilet: ${e instanceof Error ? e.message : "ukjent feil"}`;
  }
}

/** Kort sammendrag av hva som faktisk er tilgjengelig – hjelper modellen å velge riktig verktøy. */
export function toolAvailability(config: HudConfig, topicCount: number): string {
  const ints = (config.integrations ?? []).filter((i) => i.enabled).map((i) => i.name);
  return [
    `Tilgjengelig nå: ${topicCount} MQTT-emner`,
    `${(config.devices ?? []).filter((d) => d.enabled).length} enheter`,
    ints.length ? `lokale systemer: ${ints.join(", ")}` : "ingen lokale systemer koblet",
  ].join(" · ");
}

export { numericValue };
