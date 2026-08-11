import type { HudConfig } from "./hud-store";
import { deviceBrief, newMemory } from "./hud-store";
import { historyFor, numericValue } from "./mqtt-bridge";
import { fetchIntegration } from "./integrations.functions";
import { briefingText, refreshFeed, snapshot } from "./world-feed";
import { pingNode } from "./hud-client";

export type ToolCall = { name: string; args: Record<string, unknown>; raw: string };

export type ToolContext = {
  config: HudConfig;
  update?: (c: HudConfig) => void;
  /** siste kjente MQTT-verdier */
  topics: Record<string, { value: string; time: number }>;
};

export const TOOL_NAMES = [
  "mqtt_les",
  "mqtt_historikk",
  "enheter",
  "noder",
  "system_hent",
  "world_brief",
  "minne_lagre",
] as const;

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

Regler: kall bare verktøy når du faktisk trenger dataene. Du får resultatet tilbake og skal
deretter svare brukeren på norsk bokmål. Ikke finn på verdier du ikke har hentet.`;

const CALL_RE = /^\s*(?:VERKT[ØO]Y|TOOL)\s*:\s*([a-z_]+)\s*(\{[\s\S]*?\})?\s*$/gim;

export function parseToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(text))) {
    const name = (m[1] ?? "").toLowerCase();
    if (!(TOOL_NAMES as readonly string[]).includes(name)) continue;
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

  return `Ukjent verktøy: ${call.name}`;
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
