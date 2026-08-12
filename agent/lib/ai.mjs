/**
 * Tynn wrapper for AI-kall mot Ollama/LLM-noden.
 * Brukes internt av evaluator, planlegger, initiativ og verktøygenerering.
 */
import { decryptSecret } from "./secrets.mjs";
import { doc } from "./store.mjs";

const DEFAULT_CFG = { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2:3b", apiKey: "" };

function cfg() {
  const c = doc("ai", DEFAULT_CFG);
  return {
    baseUrl: String(c.baseUrl || DEFAULT_CFG.baseUrl).replace(/\/+$/, ""),
    model: String(c.model || DEFAULT_CFG.model),
    key: c.apiKey ? decryptSecret(c.apiKey) || "" : "",
    system: String(c.system || ""),
  };
}

/**
 * Send en enkelt prompt til AI-noden og returner ren tekst.
 * Brukes for interne, ikke-strømmende oppgaver (planlegging, evaluering, etc.).
 */
export async function askAi(prompt, opts = {}) {
  const { baseUrl, model, key, system } = cfg();
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: String(prompt).slice(0, 12000) });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60_000);
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: opts.model || model,
        messages,
        stream: false,
        temperature: Number(opts.temperature) || 0.5,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`AI-node svarte ${r.status}`);
    const data = await r.json();
    return String(data?.choices?.[0]?.message?.content || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Be om JSON-strukturert svar. Parser og returnerer objektet.
 */
export async function askJson(prompt, opts = {}) {
  const raw = await askAi(`${prompt}\n\nSvar KUN med gyldig JSON, uten markdown eller forklaringer.`, {
    ...opts,
    jsonMode: true,
  });
  try {
    return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
  } catch (e) {
    throw new Error(`AI-en returnerte ikke gyldig JSON: ${e.message}\n${raw.slice(0, 200)}`);
  }
}
