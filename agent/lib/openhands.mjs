/**
 * OpenHands-kollega: kjør OpenHands (AI-utvikleragent) i Docker på en node og
 * la Jarvis delegere kodeoppgaver til den via OpenHands' HTTP-API.
 *
 * Oppsett på noden:
 *   docker run -d --name openhands -p 3000:3000 \\
 *     -e SANDBOX_RUNTIME_CONTAINER_IMAGE=docker.all-hands.dev/all-hands-ai/runtime:0.39-nikola \\
 *     -v /var/lib/openhands:/opt/.openhands \\
 *     docker.all-hands.dev/all-hands-ai/openhands:0.39
 *
 * Deretter settes OPENHANDS_URL (f.eks. http://jetson-3:3000) og evt.
 * OPENHANDS_API_KEY på Jarvis-backend, eller i innstillingene i GUI-et.
 */
import { doc, saveDoc } from "./store.mjs";

function cfg() {
  return doc("openhands", { url: "", apiKey: "" });
}

export function openhandsConfig(patch = {}) {
  const c = cfg();
  if (patch.url !== undefined) c.url = String(patch.url || "").trim().replace(/\/+$/, "");
  if (patch.apiKey !== undefined) c.apiKey = String(patch.apiKey || "").trim();
  saveDoc("openhands", c);
  return { url: c.url, sattApiKey: !!c.apiKey };
}

function hode(apiKey) {
  return {
    "content-type": "application/json",
    ...(apiKey ? { "X-Session-API-Key": apiKey, authorization: `Bearer ${apiKey}` } : {}),
  };
}

/** Enkel helsesjekk mot OpenHands-instansen. */
export async function openhandsDiagnose({ url, apiKey } = {}) {
  const c = cfg();
  const base = String(url || c.url || process.env.OPENHANDS_URL || "").replace(/\/+$/, "");
  const nøkkel = apiKey || c.apiKey || process.env.OPENHANDS_API_KEY || "";
  if (!base) return { ok: false, feil: "Ingen OpenHands-URL satt (innstillinger → Kodeagent)." };
  const steg = [];
  try {
    const r = await fetch(`${base}/api/options/models`, {
      headers: hode(nøkkel),
      signal: AbortSignal.timeout(15_000),
    });
    steg.push({ navn: "adresse", ok: r.ok, detalj: `${base} → HTTP ${r.status}` });
    if (!r.ok) return { ok: false, base, steg };
    const modeller = await r.json().catch(() => []);
    steg.push({ navn: "modeller", ok: true, detalj: Array.isArray(modeller) ? `${modeller.length} modeller` : "ukjent format" });
    return { ok: true, base, steg };
  } catch (e) {
    steg.push({ navn: "adresse", ok: false, detalj: String(e?.message || e) });
    return { ok: false, base, steg };
  }
}

/**
 * Deleger en kodeoppgave til OpenHands: opprett samtale, vent på ferdig,
 * hent siste melding. Pollar inntil 10 minutter.
 */
export async function openhandsDeleger({ oppgave, url, apiKey, repo }) {
  const c = cfg();
  const base = String(url || c.url || process.env.OPENHANDS_URL || "").replace(/\/+$/, "");
  const nøkkel = apiKey || c.apiKey || process.env.OPENHANDS_API_KEY || "";
  if (!base) throw new Error("Ingen OpenHands-URL satt (innstillinger → Kodeagent).");
  if (!oppgave) throw new Error("Mangler oppgave.");

  const opprett = await fetch(`${base}/api/conversations`, {
    method: "POST",
    headers: hode(nøkkel),
    body: JSON.stringify({
      initial_user_msg: repo ? `${oppgave}\n\nArbeid mot repo: ${repo}` : oppgave,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!oppret.ok) throw new Error(`OpenHands avviste samtalen: HTTP ${oppret.status} ${(await oppret.text()).slice(0, 200)}`);
  const samtale = await opprett.json().catch(() => ({}));
  const id = samtale.conversation_id || samtale.id;
  if (!id) throw new Error("OpenHands returnerte ingen samtale-ID.");

  const start = Date.now();
  let status = "ukjent";
  let svar = "";
  while (Date.now() - start < 600_000) {
    await new Promise((r) => setTimeout(r, 10_000));
    const st = await fetch(`${base}/api/conversations/${id}`, { headers: hode(nøkkel), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!st || !st.ok) continue;
    const data = await st.json().catch(() => ({}));
    const tilstand = String(data.status || data.runtime_status || "");
    if (/stopped|idle|finished|error/i.test(tilstand)) {
      status = tilstand;
      break;
    }
  }
  // Hent siste meldinger som svar.
  const ev = await fetch(`${base}/api/conversations/${id}/events?limit=50&sort=DESC`, {
    headers: hode(nøkkel),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (ev && ev.ok) {
    const events = await ev.json().catch(() => []);
    for (const e of Array.isArray(events) ? events : []) {
      const tekst =
        e?.payload?.message?.content?.[0]?.text ||
        e?.payload?.message?.content ||
        e?.extras?.message ||
        "";
      if (tekst && String(tekst).trim()) {
        svar = String(tekst).slice(0, 8000);
        break;
      }
    }
  }
  return {
    ok: true,
    samtale: id,
    status: status || "ukjent",
    url: `${base}/conversations/${id}`,
    svar: svar || "Ingen slutttekst hentet – åpne lenken for å se resultatet.",
  };
}
