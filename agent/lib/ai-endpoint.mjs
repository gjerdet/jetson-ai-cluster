/** Retter opp vanlige skrivefeil i adressen til kjente skytjenester. */
export function normalizeBase(input) {
  let base = String(input || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `${/openrouter\.ai|openai\.com|anthropic\.com/i.test(base) ? "https" : "http"}://${base}`;
  if (/openrouter\.ai/i.test(base)) return "https://openrouter.ai/api/v1";
  if (/api\.openai\.com/i.test(base)) return "https://api.openai.com/v1";
  return base;
}

/** Ekstra hoder enkelte leverandører krever. */
export function providerHeaders(endpoint) {
  if (/openrouter\.ai/i.test(endpoint)) {
    return { "HTTP-Referer": "https://jarvis.local", "X-Title": "Jarvis" };
  }
  return {};
}

/** Bygger aktuelle chat-endepunkter fra både base-URL-er og komplette URL-er. */
export function chatEndpoints(input) {
  const base = normalizeBase(input);
  if (!base) return [];
  if (/\/(chat\/completions|api\/chat)$/i.test(base)) return [base];
  if (/\/chat$/i.test(base)) {
    const root = base.replace(/\/chat$/i, "");
    return [base, `${root}/v1/chat/completions`, `${root}/api/chat`];
  }
  if (/\/v1$/i.test(base)) return [`${base}/chat/completions`];
  return [`${base}/v1/chat/completions`, `${base}/api/chat`, `${base}/chat`];
}

/** Oversetter HTTP-status til et konkret råd på norsk. */
export function statusRaad(status, endpoint, detail = "") {
  const sky = /openrouter\.ai|openai\.com/i.test(endpoint);
  if (/is not available for the 'chat-completions' API/i.test(detail) || /openrouter:bash/i.test(detail)) {
    return "OpenRouter-presetet har verktøy (f.eks. «bash») som bare virker med Anthropic-API-et. Fjern verktøyene i presetet på openrouter.ai, eller bruk en vanlig modell-id i stedet for «@preset/…».";
  }
  if (status === 401 || status === 403) {
    return sky ? "API-nøkkelen mangler eller er ugyldig." : "Noden avviste nøkkelen (401/403).";
  }
  if (status === 402) return "Kontoen mangler kreditt hos leverandøren.";
  if (status === 400 && sky) return "Forespørselen ble avvist – sjekk modell-id (små bokstaver, «leverandør/modell»).";
  if (status === 404) return sky ? "Ukjent modellnavn – bruk formatet «leverandør/modell», f.eks. «openai/gpt-4o-mini»." : "Endepunktet finnes ikke på denne adressen.";
  if (status === 429) return sky ? "Modellen er midlertidig ratebegrenset hos leverandøren – vent litt, velg en annen modell, eller legg inn din egen leverandørnøkkel på openrouter.ai/settings/integrations." : "For mange forespørsler – vent litt og prøv igjen.";
  return "";
}



/** Henter tilgjengelige modeller fra en Ollama-node eller skytjeneste. */
export async function listModels(baseUrl, { apiKey, signal } = {}) {
  const root = normalizeBase(baseUrl).replace(/\/(v1|api\/chat|chat\/completions|chat)$/i, "");
  if (!root) return [];
  for (const url of [`${root}/v1/models`, `${root}/api/tags`]) {
    try {
      const r = await fetch(url, {
        headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...providerHeaders(url) },
        signal,
      });

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

/** OpenRouter-modeller er alltid «leverandør/modell» med små bokstaver. */
export function normalizeModel(endpoint, model) {
  const m = String(model || "").trim();
  if (!m) return m;
  return /openrouter\.ai/i.test(endpoint) ? m.toLowerCase() : m;
}

export function chatPayload(endpoint, { model, messages, temperature }) {
  const m = normalizeModel(endpoint, model);
  if (/\/api\/chat$/i.test(endpoint)) {
    return { model: m, messages, stream: false, options: { temperature } };
  }
  // Ingen tool_choice mot OpenRouter: flere modeller avviser feltet med HTTP 400
  // når det ikke følger med en tools-liste.
  return { model: m, messages, stream: false, temperature };
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
          ...providerHeaders(endpoint),
        },
        body: JSON.stringify(chatPayload(endpoint, { model, messages, temperature })),
        signal: ctrl.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 180);
        const raad = statusRaad(response.status, endpoint, detail);
        feil.push(`${endpoint}: HTTP ${response.status}${raad ? ` – ${raad}` : ""}${detail ? ` (${detail})` : ""}`);
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
      const tekst = `${error?.message || String(error)}${error?.cause?.code ? ` (${error.cause.code})` : ""}`;
      let raad = "";
      if (/self.signed|certificate|CERT_/i.test(tekst)) raad = " – selvsignert sertifikat; bruk http:// eller legg inn et gyldig sertifikat";
      else if (/ECONNREFUSED/i.test(tekst)) raad = " – ingen tjeneste svarer på porten";
      else if (/ENOTFOUND|EAI_AGAIN/i.test(tekst)) raad = " – vertsnavnet kan ikke slås opp";
      feil.push(
        tidsavbrudd
          ? `${endpoint}: modellen svarte ikke innen ${Math.round(timeoutMs / 1000)} s (den er trolig fortsatt i gang med å laste eller generere)`
          : `${endpoint}: ${tekst}${raad}`,
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