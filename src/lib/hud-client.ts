import type { ModelNode } from "./hud-store";

/** logg for ett verktøykall Jarvis gjorde underveis */
export type ToolRun = {
  name: string;
  args: Record<string, unknown>;
  result: string;
  ms: number;
  time: number;
  ok: boolean;
};

export type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string;
  node?: string;
  /** verktøy som ble kjørt for å produsere dette svaret */
  runs?: ToolRun[];
  /** kilder fra kunnskapsbasen som svaret bygger på */
  sources?: { tittel: string; kilde: string; utdrag: string; poeng: number }[];
  /** poeng fra evaluatoren, når svaret er vurdert */
  scores?: { label: string; score: number }[];
  time?: number;
};

/** Tjenester som alltid krever en egen API-nøkkel. */
const KREVER_NOKKEL = /(openrouter|openai\.com|anthropic|groq|together|mistral|deepseek|fireworks|azure)/i;

export async function callNode(
  node: ModelNode,
  messages: ChatMsg[],
  signal?: AbortSignal,
): Promise<string> {
  const nokkel = (node.apiKey || "").trim();
  if (!nokkel && KREVER_NOKKEL.test(node.baseUrl || ""))
    throw new Error(
      `${node.name}: API-nøkkel mangler. Åpne INNSTILLINGER → MODELLER, lim inn nøkkelen for denne tjenesten og lagre.`,
    );
  const res = await fetch(`${node.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      "Content-Type": "application/json",
      ...(nokkel ? { Authorization: `Bearer ${nokkel}` } : {}),
    },
    body: JSON.stringify({
      model: node.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    }),
  });
  if (!res.ok) {
    const tekst = await res.text();
    if (res.status === 401 || res.status === 403)
      throw new Error(
        `${node.name}: nøkkelen ble avvist (HTTP ${res.status}). Sjekk at API-nøkkelen er gyldig og lagret under INNSTILLINGER → MODELLER.`,
      );
    throw new Error(`${node.name}: HTTP ${res.status} ${tekst}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "(tomt svar)";
}

export async function pingNode(node: ModelNode): Promise<number | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${node.baseUrl.replace(/\/$/, "")}/models`, {
      ...(node.apiKey ? { headers: { Authorization: `Bearer ${node.apiKey}` } } : {}),
    });
    if (!res.ok) return null;
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  }
}
