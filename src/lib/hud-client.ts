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

/** Normaliserer adressen til en node. */
function normaliser(input: string): string {
  let base = String(input || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/^https?:\/\//i.test(base))
    base = `${/openrouter\.ai|openai\.com|anthropic\.com/i.test(base) ? "https" : "http"}://${base}`;
  if (/openrouter\.ai/i.test(base)) return "https://openrouter.ai/api/v1";
  if (/api\.openai\.com/i.test(base)) return "https://api.openai.com/v1";
  return base;
}

/** Kjente chat-stier i prøverekkefølge (Ollama, OpenAI-kompatibel, agent). */
export function chatEndepunkter(input: string): string[] {
  const base = normaliser(input);
  if (!base) return [];
  if (/\/(chat\/completions|api\/chat)$/i.test(base)) return [base];
  if (/\/chat$/i.test(base)) {
    const rot = base.replace(/\/chat$/i, "");
    return [base, `${rot}/v1/chat/completions`, `${rot}/api/chat`];
  }
  if (/\/v1$/i.test(base)) return [`${base}/chat/completions`];
  // Siste kandidat er Jarvis-agentens eget endepunkt (backend på 8443).
  return [`${base}/v1/chat/completions`, `${base}/api/chat`, `${base}/chat`, `${base}/api/ai/chat`];
}

function svarTekst(data: unknown): string {
  const d = data as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
    response?: string;
    content?: string;
    svar?: string;
    tekst?: string;
  };
  const verdi =
    d?.choices?.[0]?.message?.content ??
    d?.message?.content ??
    d?.response ??
    d?.svar ??
    d?.tekst ??
    d?.content;
  return typeof verdi === "string" ? verdi.trim() : "";

}

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
  const endepunkter = chatEndepunkter(node.baseUrl);
  if (!endepunkter.length) throw new Error(`${node.name}: adressen mangler.`);

  const feil: string[] = [];
  for (const url of endepunkter) {
    const ollama = /\/api\/chat$/i.test(url);
    let res: Response;
    try {
      res = await fetch(url, {
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
    } catch (e) {
      if (signal?.aborted) throw e;
      feil.push(`${url}: ${(e as Error).message}`);
      continue;
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        throw new Error(
          `${node.name}: nøkkelen ble avvist (HTTP ${res.status}). Sjekk at API-nøkkelen er gyldig og lagret under INNSTILLINGER → MODELLER.`,
        );
      const tekst = (await res.text().catch(() => "")).slice(0, 160);
      feil.push(`${url}: HTTP ${res.status}`);
      if (res.status !== 404 && !/<!DOCTYPE|<html/i.test(tekst)) {
        throw new Error(`${node.name}: HTTP ${res.status} ${tekst}`);
      }
      continue;
    }
    const data = await res.json().catch(() => null);
    const svar = svarTekst(data);
    if (svar) return svar;
    feil.push(`${url}: tomt svar${ollama ? " fra Ollama" : ""}`);
  }
  throw new Error(
    `${node.name}: fant ingen AI-tjeneste på ${normaliser(node.baseUrl)}. Sjekk adressen og at modelltjenesten kjører. (${feil.join(" | ")})`,
  );
}

export async function pingNode(node: ModelNode): Promise<number | null> {
  const t0 = performance.now();
  const rot = normaliser(node.baseUrl).replace(/\/(v1|api\/chat|chat\/completions|chat)$/i, "");
  if (!rot) return null;
  const nokkel = (node.apiKey || "").trim();
  for (const url of [`${rot}/v1/models`, `${rot}/api/tags`]) {
    try {
      const res = await fetch(url, {
        ...(nokkel ? { headers: { Authorization: `Bearer ${nokkel}` } } : {}),
      });
      if (res.ok) return Math.round(performance.now() - t0);
    } catch {
      /* prøv neste */
    }
  }
  return null;
}

