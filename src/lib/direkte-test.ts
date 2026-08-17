/** Direkte test fra nettleseren – reserve når backend-agenten ikke er tilgjengelig. */

export function normaliserBase(input: string): string {
  let base = String(input || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) {
    const sky = /openrouter\.ai|openai\.com|anthropic\.com/i.test(base);
    base = `${sky ? "https" : "http"}://${base}`;
  }
  if (/openrouter\.ai/i.test(base)) return "https://openrouter.ai/api/v1";
  if (/api\.openai\.com/i.test(base)) return "https://api.openai.com/v1";
  return base;
}

function chatUrl(base: string): string {
  if (/\/(chat\/completions|api\/chat)$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export type DirekteResultat = {
  ok: boolean;
  ms?: number;
  model?: string;
  endpoint?: string;
  svar?: string;
  modeller?: string[];
  error?: string;
};

/**
 * Tester en AI-adresse rett fra nettleseren.
 * Fungerer for skytjenester (OpenRouter/OpenAI) som tillater CORS.
 */
export async function testAiDirekte(o: {
  baseUrl: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<DirekteResultat> {
  const base = normaliserBase(o.baseUrl);
  if (!base) return { ok: false, error: "AI-adressen mangler." };
  const endpoint = chatUrl(base);
  const model = /openrouter\.ai/i.test(endpoint)
    ? (o.model || "").trim().toLowerCase()
    : (o.model || "").trim();
  if (!model) return { ok: false, error: "Modellnavn mangler." };

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.apiKey) headers["authorization"] = `Bearer ${o.apiKey}`;
  if (/openrouter\.ai/i.test(endpoint)) {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "Jarvis";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 45_000);
  const t0 = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: "Svar kun med ordet OK." }],
      }),
    });
    const tekst = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        endpoint,
        error: `HTTP ${res.status}${tekst ? ` – ${tekst.slice(0, 200)}` : ""}`,
      };
    }
    let svar = "";
    try {
      const data = JSON.parse(tekst) as {
        choices?: { message?: { content?: string } }[];
        message?: { content?: string };
      };
      svar = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
    } catch {
      svar = tekst.slice(0, 120);
    }
    return { ok: true, ms: Math.round(performance.now() - t0), model, endpoint, svar: svar.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      endpoint,
      error: /abort/i.test(msg)
        ? "Tidsavbrudd – tjenesten svarte ikke."
        : `Nettleseren nådde ikke ${endpoint} (${msg}). Lokale noder må testes fra agenten.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
