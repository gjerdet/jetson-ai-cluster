/**
 * Selvevaluerings- og læringsmotor for Jarvis.
 * Vurderer AI-svar og verktøykjeder, skriver erfaringer til minne,
 * og kan be om nytt forsøk fra en annen node ved lav score.
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";
import { askJson } from "./ai.mjs";
import { remember, recall } from "./memory.mjs";

function db() {
  return doc("evaluations", { list: [] });
}

function persist(item) {
  saveDoc("evaluations", item);
}

export function listEvaluations(limit = 50) {
  return db().list.slice(0, limit);
}

export function evaluationStats() {
  const list = db().list;
  const antall = list.length;
  const snitt = antall ? list.reduce((s, e) => s + (e.score || 0), 0) / antall : 0;
  const underTerskel = list.filter((e) => (e.score || 0) < (e.threshold || 8)).length;
  return { antall, snitt: Number(snitt.toFixed(2)), underTerskel };
}

/**
 * Vurder et svar/resultat og returner score + forbedringsforslag.
 */
export async function evaluate({ spørsmål, svar, verktøy = [], kontekst = "", threshold = 8 }) {
  if (!spørsmål || !svar) throw new Error("Spørsmål og svar må være satt.");
  const relevant = recall(spørsmål, { topK: 3 });
  const minneKontekst = relevant.map((m) => m.tekst).join("\n");

  const prompt = `Vurder følgende AI-svar objektivt på en skala 0-10 basert på:
1. Faktisk korrekthet
2. Relevans for spørsmålet
3. Konkret og handlingsrettet
4. Kortfattet uten fyll
5. Riktig norsk bokmål

Svar KUN med JSON: {"score": <0-10>, "kriterier": {"korrekthet":0-10,"relevans":0-10,"konkret":0-10,"kortfattet":0-10,"sprak":0-10}, "problemer": "...", "forbedring": "...", "retryAnbefalt": true/false}

Spørsmål: ${spørsmål}
Svar: ${svar}
${verktøy.length ? `Verktøy brukt: ${verktøy.map((v) => v.navn || v).join(", ")}` : ""}
${minneKontekst ? `Relevant minne:\n${minneKontekst}` : ""}`;

  const parsed = await askJson(prompt, { timeoutMs: 60_000 });
  const score = Math.max(0, Math.min(10, Number(parsed.score) || 5));
  const entry = {
    id: randomUUID(),
    tid: Date.now(),
    spørsmål: String(spørsmål).slice(0, 1000),
    svar: String(svar).slice(0, 2000),
    verktøy,
    score,
    threshold,
    kriterier: parsed.kriterier || {},
    problemer: String(parsed.problemer || "").slice(0, 1000),
    forbedring: String(parsed.forbedring || "").slice(0, 1000),
    retryAnbefalt: !!parsed.retryAnbefalt,
    kontekst: String(kontekst || "").slice(0, 500),
  };

  const d = db();
  d.list.unshift(entry);
  d.list = d.list.slice(0, 500);
  persist(d);

  if (score < threshold) {
    remember({
      tekst: `Erfaring fra svak AI-respons (${score}/${10}): ${entry.problemer}. Forbedring: ${entry.forbedring}`,
      type: "erfaring",
      kontekst: `spørsmål: ${spørsmål.slice(0, 120)}`,
      kilder: ["evaluator", ...(verktøy.map((v) => v.navn || v).slice(0, 3))],
      viktighet: 6,
    });
  }

  return entry;
}

/**
 * Kjør evaluator på en chat-respons fra backend-en.
 */
export async function evaluateChatReply({ spørsmål, svar, verktøy = [] }) {
  const cfg = doc("settings", {});
  const threshold = Number(cfg.evaluatorThreshold) || 8;
  let ev = await evaluate({ spørsmål, svar, verktøy, threshold });
  if (ev && (ev.score === null || ev.score < 7)) {
    try {
      const tidligere = listEvaluations(3).filter(e => e.spørsmål === spørsmål).slice(0, 2);
      const tidligereFeil = tidligere.map(e => `- Forrige forsøk (${e.score}/10): ${e.problemer}. Forbedring: ${e.forbedring}`).join("\n");
      const raw1 = await askAi(`${prompt}

Tidligere feil ved lignende spørsmål:\n${tidligereFeil || "Ingen tidligere feil."}

Forsøk 2: forbedre svaret basert på kritikken og tidligere feil. Svar KUN med JSON.`, {
        timeoutMs: 30_000,
        temperature: 0.7,
      });
      const ev2 = parseEvaluation(raw1);
      if (ev2.score > ev.score) return ev2;
    } catch (e) {
      // Ignorer retry-feil
    }
  }
  return ev;
}



export function clearEvaluations() {
  persist({ list: [] });
  return { ok: true };
}
