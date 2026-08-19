import type { HudConfig, ModelNode } from "./hud-store";

/**
 * Automatisk modell-ruting.
 *
 * Tunge oppgaver (kode, feilsøking, planlegging, verktøykjøring, lange
 * meldinger) rutes til en «tung» node – typisk OpenRouter eller Hermes.
 * Småprat og korte rutinespørsmål går til den lokale modellen på Jetson.
 */

export type Vekt = "lett" | "tung";
export type NodeKlasse = "lokal" | "tung";

export type Rute = {
  node?: ModelNode;
  vekt: Vekt;
  /** hvorfor akkurat denne noden ble valgt – vises i feilsøkingsloggen */
  grunn: string;
};

const TUNG_ORD =
  /(kode|kod\b|skript|script|python|bash|debug|feilsøk|analyser|planlegg|arkitekt|refaktor|optimaliser|skann|scan|nettverk|subnett|nmap|docker|kubernetes|regex|sql|stack ?trace|exception|traceback|hvorfor|forklar hvordan|sammenlign|utred|lag et|sett opp|installer|konfigurer|diagnos)/i;
const LETT_ORD =
  /^(hei|hallo|halla|heisann|yo|hey|hi|god\s*(morgen|kveld|dag)|takk|ok(ei)?|status|hvordan går det|er du der|test|klokka|hva heter du)\b/i;

const SKY_VERT = /(openrouter|openai\.com|anthropic|groq|together|mistral|deepseek|fireworks|azure)/i;
const HERMES = /hermes/i;

/** Klassifiser en node som lokal Jetson-modell eller tung modell. */
export function nodeKlasse(node: ModelNode): NodeKlasse {
  const url = (node.baseUrl || "").toLowerCase();
  if (SKY_VERT.test(url) || (node.apiKey && !/^https?:\/\/(127\.|10\.|192\.168\.|172\.|localhost)/.test(url)))
    return "tung";
  if (HERMES.test(node.name) || HERMES.test(node.model)) return "tung";
  return "lokal";
}

/** Er meldingen en tung oppgave? */
export function klassifiser(text: string, opts?: { verktoyrunde?: boolean }): {
  vekt: Vekt;
  grunn: string;
} {
  if (opts?.verktoyrunde) return { vekt: "tung", grunn: "verktøyrunde krever presis modell" };
  const t = text.trim();
  if (t.length <= 40 && LETT_ORD.test(t)) return { vekt: "lett", grunn: "kort småprat" };
  if (/```/.test(t)) return { vekt: "tung", grunn: "meldingen inneholder kode" };
  if (t.length > 400) return { vekt: "tung", grunn: "lang melding (>400 tegn)" };
  if (TUNG_ORD.test(t)) return { vekt: "tung", grunn: "oppgaveord som krever resonnement" };
  if (t.length < 80) return { vekt: "lett", grunn: "kort rutinespørsmål" };
  return { vekt: "tung", grunn: "standard: tung modell gir bedre svar" };
}

/** Velg node ut fra klassifisering. Låst node i innstillingene vinner alltid. */
export function velgRute(
  config: HudConfig,
  text: string,
  opts?: { verktoyrunde?: boolean },
): Rute {
  const aktive = config.nodes.filter((n) => n.enabled);
  const primary = aktive.find((n) => n.role === "primary") ?? aktive[0];
  const laast = config.aiNodeId ? aktive.find((n) => n.id === config.aiNodeId) : undefined;
  const { vekt, grunn } = klassifiser(text, opts);

  if (laast)
    return { ...(laast ? { node: laast } : {}), vekt, grunn: `låst node i innstillingene (${laast.name})` };
  if (config.autoRoute === false)
    return { ...(primary ? { node: primary } : {}), vekt, grunn: "automatisk ruting er av – bruker primærnode" };

  const tunge = aktive.filter((n) => nodeKlasse(n) === "tung");
  const lokale = aktive.filter((n) => nodeKlasse(n) === "lokal");
  const passer = (n: ModelNode) => !n.duties?.length || n.duties.includes(opts?.verktoyrunde ? "verktoy" : "chat");

  // Lokal-først: den lokale modellen prøver alltid selv først for å spare
  // betalte tokens. Tung node brukes kun hvis selvsjekken underkjenner svaret.
  const lokalForst = config.lokalForst !== false && lokale.length > 0;
  const kandidater = vekt === "tung" && !lokalForst ? [...tunge, ...lokale] : [...lokale, ...tunge];
  const valgt = kandidater.find(passer) ?? kandidater[0] ?? primary;
  if (!valgt) return { vekt, grunn: "ingen aktive noder" };
  const klasse = nodeKlasse(valgt);
  return {
    node: valgt,
    vekt,
    grunn:
      `${vekt} oppgave (${grunn}) → ${klasse === "tung" ? "tung" : "lokal"} node ${valgt.name}` +
      (lokalForst && vekt === "tung" && klasse === "lokal"
        ? " · lokal-først: eskalerer bare hvis selvsjekken underkjenner svaret"
        : ""),
  };
}
