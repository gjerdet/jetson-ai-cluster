/** Bygger aktuelle chat-endepunkter fra både base-URL-er og komplette URL-er. */
export function chatEndpoints(input) {
  const base = String(input || "").trim().replace(/\/+$/, "");
  if (!base) return [];
  if (/\/(chat\/completions|api\/chat)$/i.test(base)) return [base];
  if (/\/chat$/i.test(base)) {
    const root = base.replace(/\/chat$/i, "");
    return [base, `${root}/v1/chat/completions`, `${root}/api/chat`];
  }
  if (/\/v1$/i.test(base)) return [`${base}/chat/completions`];
  return [`${base}/v1/chat/completions`, `${base}/api/chat`, `${base}/chat`];
}

export function chatPayload(endpoint, { model, messages, temperature }) {
  if (/\/api\/chat$/i.test(endpoint)) {
    return { model, messages, stream: false, options: { temperature } };
  }
  return { model, messages, stream: false, temperature };
}

export function chatText(data) {
  const value =
    data?.choices?.[0]?.message?.content ??
    data?.message?.content ??
    data?.response ??
    data?.svar ??
    data?.content ??
    data?.text;
  return typeof value === "string" ? value.trim() : "";
}

/** Prøver kjente lokale API-formater i rekkefølge og gir en konkret feil. */
export async function callChatEndpoint({ baseUrl, model, messages, temperature, apiKey, signal }) {
  const endpoints = chatEndpoints(baseUrl);
  if (!endpoints.length) throw new Error("AI-adressen mangler.");
  const feil = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(chatPayload(endpoint, { model, messages, temperature })),
        signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 180);
        feil.push(`${endpoint}: HTTP ${response.status}${detail ? ` – ${detail}` : ""}`);
        continue;
      }
      const data = await response.json();
      const svar = chatText(data);
      if (!svar) {
        feil.push(`${endpoint}: svaret manglet tekst`);
        continue;
      }
      return { svar, endpoint };
    } catch (error) {
      if (signal?.aborted) throw error;
      feil.push(`${endpoint}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(feil.join(" | ").slice(0, 900));
}