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

/** Henter installerte modeller fra en Ollama-node. */
export async function listModels(baseUrl, { apiKey, signal } = {}) {
  const root = String(baseUrl || "").trim().replace(/\/+$/, "").replace(/\/(v1|api\/chat|chat\/completions|chat)$/i, "");
  if (!root) return [];
  for (const url of [`${root}/api/tags`, `${root}/v1/models`]) {
    try {
      const r = await fetch(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal });
      if (!r.ok) continue;
      const d = await r.json();
      const navn = (d?.models || d?.data || []).map((m) => m?.name || m?.id).filter(Boolean);
      if (navn.length) return navn;
    } catch { /* prøv neste */ }
  }
  return [];
}

/** Sant når feilteksten tyder på at modellen ikke finnes på noden. */
export function erModellMangler(tekst) {
  return /model .*not found|no such model|pull the model/i.test(String(tekst || ""));
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
export async function callChatEndpoint(input) {
  const { baseUrl, model, messages, temperature, apiKey, signal } = input || {};
  const timeoutMs = Math.max(5_000, Number(input?.timeoutMs) || 300_000);
  const endpoints = chatEndpoints(baseUrl);
  if (!endpoints.length) throw new Error("AI-adressen mangler.");
  const feil = [];
  for (const endpoint of endpoints) {
    // Egen tidsgrense per endepunkt, slik at ett tregt forsøk ikke spiser hele budsjettet.
    const ctrl = new AbortController();
    const avbrytt = () => ctrl.abort();
    signal?.addEventListener?.("abort", avbrytt);
    const timer = setTimeout(avbrytt, timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(chatPayload(endpoint, { model, messages, temperature })),
        signal: ctrl.signal,
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
      const tidsavbrudd = ctrl.signal.aborted || /abort/i.test(error?.message || "");
      feil.push(
        tidsavbrudd
          ? `${endpoint}: modellen svarte ikke innen ${Math.round(timeoutMs / 1000)} s (den er trolig fortsatt i gang med å laste eller generere)`
          : `${endpoint}: ${error?.message || String(error)}`,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", avbrytt);
    }
  }

  const samlet = feil.join(" | ");
  if (erModellMangler(samlet) && !input?._retry) {
    const modeller = await listModels(baseUrl, { apiKey, signal });
    const alternativ = modeller.find((m) => m !== model);
    if (alternativ) {
      const res = await callChatEndpoint({
        baseUrl, model: alternativ, messages, temperature, apiKey, signal, timeoutMs, _retry: true,
      });
      return { ...res, model: alternativ, byttetModell: true };
    }
    throw new Error(
      `Modellen «${model}» finnes ikke på AI-noden${modeller.length ? `. Tilgjengelige: ${modeller.join(", ")}` : ". Ingen modeller er installert – kjør «ollama pull llama3.2:3b» på noden"}.`
    );
  }
  throw new Error(samlet.slice(0, 900));
}