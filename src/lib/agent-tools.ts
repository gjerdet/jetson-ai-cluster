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
import {
  SCRIPT_TEMPLATES,
  formatTemplateTest,
  installTemplate,
  templateById,
  testTemplate,
} from "./script-templates";



export type ToolCall = { name: string; args: Record<string, unknown>; raw: string };

export type ToolContext = {
  config: HudConfig;
  update?: (c: HudConfig) => void;
  /** siste kjente MQTT-verdier */
  topics: Record<string, { value: string; time: number }>;
};

export type ToolSpec = {
  name: string;
  category: "smarthus" | "system" | "verden" | "minne" | "verktoy" | "os";
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
  {
    name: "agent_status",
    category: "os",
    summary: "Status for den lokale agenten på Jetson: OS, last, minne, sandkasse og hviteliste.",
    args: "{}",
    builtin: true,
  },
  {
    name: "os_kjor",
    category: "os",
    summary: "Kjører en hvitelistet OS-kommando via lokal agent (f.eks. df, nvidia-smi, systemctl status).",
    args: '{"kommando": "df", "args": ["-h"]}',
    builtin: true,
  },
  {
    name: "skript_lag",
    category: "os",
    summary: "Skriver et skript til sandkassen på Jetson (bash, python eller node).",
    args: '{"navn": "test.py", "innhold": "print(1+1)"}',
    builtin: true,
  },
  {
    name: "skript_kjor",
    category: "os",
    summary: "Kjører et skript i sandkassen med tidsgrense og returnerer stdout/stderr.",
    args: '{"navn": "test.py", "sprak": "python", "args": []}',
    builtin: true,
  },
  {
    name: "skript_test",
    category: "os",
    summary: "Skriver og kjører et skript i sandkassen i én operasjon (rask test).",
    args: '{"sprak": "python", "innhold": "print(1+1)"}',
    builtin: true,
  },
  {
    name: "skript_liste",
    category: "os",
    summary: "Lister skript i sandkassen, eventuelt leser innholdet i ett av dem.",
    args: '{"navn": "test.py"}',
    builtin: true,
  },
  {
    name: "skript_slett",
    category: "os",
    summary: "Sletter et skript fra sandkassen.",
    args: '{"navn": "test.py"}',
    builtin: true,
  },
  {
    name: "mal_liste",
    category: "os",
    summary: "Lister innebygde skriptmaler (service-start, docker healthcheck, logg-innhenting m.fl.).",
    args: "{}",
    builtin: true,
  },
  {
    name: "mal_test",
    category: "os",
    summary:
      "Kjører malens innebygde selvtest i sandkassen og verifiserer grunnleggende forventninger før kjøring.",
    args: '{"mal": "docker-health", "parametre": {"container": "ollama"}}',
    builtin: true,
  },
  {
    name: "mal_installer",
    category: "os",
    summary: "Tester malen og lagrer den i sandkassen kun hvis alle forventninger holder.",
    args: '{"mal": "service-start", "parametre": {"tjeneste": "ollama"}}',
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
- agent_status {} – status for lokal agent på Jetson (OS, last, minne, sandkasse, hviteliste).
- os_kjor {"kommando": "df", "args": ["-h"]} – kjør hvitelistet OS-kommando via lokal agent.
- skript_lag {"navn": "test.py", "innhold": "..."} – lagre skript i sandkassen.
- skript_kjor {"navn": "test.py", "sprak": "python", "args": []} – kjør skript i sandkassen.
- skript_test {"sprak": "python", "innhold": "..."} – skriv og kjør skript i ett steg.
- skript_liste {} eller {"navn": "test.py"} – list eller les skript i sandkassen.
- skript_slett {"navn": "test.py"} – slett skript fra sandkassen.
- mal_liste {} – innebygde skriptmaler (service-start, docker-health, logg-innhenting, disk-varsel, gpu-telemetri, http-helsesjekk).
- mal_test {"mal": "docker-health", "parametre": {"container": "ollama"}} – kjører malens selvtest i sandkassen og verifiserer forventninger.
- mal_installer {"mal": "service-start", "parametre": {"tjeneste": "ollama"}} – tester og lagrer malen i sandkassen kun hvis testen består.

Regler: kall bare verktøy når du faktisk trenger dataene. Du får resultatet tilbake og skal
deretter svare brukeren på norsk bokmål. Ikke finn på verdier du ikke har hentet.
OS-tilgang går kun gjennom den lokale agenten: kun hvitelistede kommandoer, og skript kjøres
alltid i sandkassen med tidsgrense. Test alltid nye skript med skript_test før du foreslår dem.
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
    if (!snapshot().events.length) {
      // World Monitor kan bruke lang tid på alle lagene – vent maks 12 sekunder,
      // og svar med det vi har (eller en tydelig beskjed) i stedet for å henge.
      await Promise.race([
        refreshFeed().catch(() => undefined),
        new Promise((r) => setTimeout(r, 12_000)),
      ]);
    }
    if (!snapshot().events.length)
      return "World Monitor har ingen hendelser enda (feeden er treg eller utilgjengelig). Prøv igjen om litt, eller åpne WORLD MONITOR-panelet for å laste den.";
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

  if (
    call.name.startsWith("os_") ||
    call.name.startsWith("skript_") ||
    call.name.startsWith("mal_") ||
    call.name === "agent_status"
  ) {
    return runAgentTool(call, config);
  }



  const custom = (config.customTools ?? []).find((t) => t.enabled && t.name === call.name);
  if (custom) return runCustomTool(custom, call.args);

  return `Ukjent verktøy: ${call.name}`;
}

const LANGS = ["bash", "python", "node"] as const;
type Lang = (typeof LANGS)[number];

function langFor(raw: string, name: string): Lang {
  const v = raw.toLowerCase();
  if (v === "python" || v === "py") return "python";
  if (v === "node" || v === "js" || v === "javascript") return "node";
  if (v === "bash" || v === "sh") return "bash";
  if (name.endsWith(".py")) return "python";
  if (name.endsWith(".mjs") || name.endsWith(".js")) return "node";
  return "bash";
}

function approve(cfg: ReturnType<typeof agentCfg>, what: string): boolean {
  if (!cfg.confirm) return true;
  if (typeof window === "undefined") return false;
  return window.confirm(`Jarvis vil kjøre på Jetson:\n\n${what}\n\nGodkjenn?`);
}

/** Verktøy som går mot den lokale agent-tjenesten (OS-kommandoer og skript-sandkasse). */
async function runAgentTool(call: ToolCall, config: HudConfig): Promise<string> {
  const cfg = agentCfg(config);
  if (!cfg.enabled || !cfg.baseUrl)
    return "Lokal agent er ikke aktivert. Slå den på under SYSTEM → KOBLINGER → LOKAL AGENT (agent/server.mjs må kjøre på Jetson).";

  try {
    if (call.name === "agent_status") {
      const h = await agentHealth(cfg);
      return [
        `Agent: ${h.host ?? "?"} · ${h.platform ?? "?"}`,
        `Oppetid ${Math.round((h.uptimeSec ?? 0) / 3600)} t · last ${(h.loadavg ?? []).join(" / ")}`,
        `Minne ${h.memFreeMb ?? "?"} / ${h.memTotalMb ?? "?"} MB fritt`,
        `Sandkasse: ${h.sandbox ?? "?"} · nettverk ${h.network ? "på" : "av"}`,
        `Hvitelistede kommandoer: ${(h.allowed ?? []).join(", ")}`,
      ].join("\n");
    }

    if (call.name === "os_kjor") {
      const cmd = str(call.args["kommando"] ?? call.args["cmd"]).trim();
      if (!cmd) return "Mangler kommando.";
      const rawArgs = call.args["args"];
      const args = Array.isArray(rawArgs) ? rawArgs.map(str) : str(rawArgs) ? str(rawArgs).split(" ") : [];
      if (!approve(cfg, `${cmd} ${args.join(" ")}`)) return "Brukeren avslo kjøringen.";
      return formatResult(await agentExec(cfg, cmd, args));
    }

    if (call.name === "skript_lag") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      const content = str(call.args["innhold"] ?? call.args["content"]);
      if (!name || !content) return "Mangler navn eller innhold.";
      const r = await agentWriteScript(cfg, name, content);
      return `Lagret ${r.name} (${r.bytes} tegn) i sandkassen. Kjør det med skript_kjor.`;
    }

    if (call.name === "skript_kjor" || call.name === "skript_test") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      const content = str(call.args["innhold"] ?? call.args["content"]);
      if (call.name === "skript_test" && !content) return "Mangler innhold å teste.";
      if (call.name === "skript_kjor" && !name && !content) return "Mangler skriptnavn.";
      const lang = langFor(str(call.args["sprak"] ?? call.args["lang"]), name);
      const rawArgs = call.args["args"];
      const args = Array.isArray(rawArgs) ? rawArgs.map(str) : [];
      if (!approve(cfg, `${lang}-skript ${name || "(midlertidig)"} i sandkassen`))
        return "Brukeren avslo kjøringen.";
      const r = await agentRun(cfg, {
        lang,
        ...(name ? { name } : {}),
        ...(content ? { content } : {}),
        args,
      });
      return `Sandkasse (${lang}, ${r.script ?? "?"}):\n${formatResult(r)}`;
    }

    if (call.name === "skript_liste") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      if (name) {
        const f = await agentReadScript(cfg, name);
        return `${f.name}:\n${f.content.slice(0, 4000)}`;
      }
      const list = await agentScripts(cfg);
      if (!list.files.length) return `Sandkassen (${list.sandbox}) er tom.`;
      return list.files
        .map((f) => `${f.name} – ${f.bytes} B, endret ${new Date(f.modified).toLocaleString("nb-NO")}`)
        .join("\n");
    }

    if (call.name === "skript_slett") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      if (!name) return "Mangler navn.";
      await agentDeleteScript(cfg, name);
      return `Slettet ${name} fra sandkassen.`;
    }

    if (call.name === "mal_liste") {
      return SCRIPT_TEMPLATES.map(
        (t) =>
          `${t.id} (${t.lang}) – ${t.summary} Parametre: ${t.params.map((p) => `${p.key}=${p.value}`).join(", ") || "ingen"}`,
      ).join("\n");
    }

    if (call.name === "mal_test" || call.name === "mal_installer") {
      const id = str(call.args["mal"] ?? call.args["id"] ?? call.args["navn"]);
      const tpl = templateById(id);
      if (!tpl) return `Fant ingen mal med id «${id}». Bruk mal_liste for oversikt.`;
      const raw = call.args["parametre"] ?? call.args["params"];
      const overrides: Record<string, string> = {};
      if (raw && typeof raw === "object")
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) overrides[k] = str(v);
      if (!approve(cfg, `selvtest av malen «${tpl.name}» i sandkassen`))
        return "Brukeren avslo kjøringen.";
      if (call.name === "mal_test") {
        return formatTemplateTest(tpl, await testTemplate(config, tpl, overrides));
      }
      const r = await installTemplate(config, tpl, overrides);
      return `${formatTemplateTest(tpl, r.test)}\n${
        r.saved ? `Lagret som ${r.saved} i sandkassen.` : "Ikke lagret – testen må bestå først."
      }`;
    }



    return `Ukjent agent-verktøy: ${call.name}`;
  } catch (e) {
    return `Lokal agent svarte ikke: ${e instanceof Error ? e.message : "ukjent feil"}`;
  }
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
