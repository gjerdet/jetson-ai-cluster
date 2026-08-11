import { type ChatMsg } from "./hud-client";
import { callTracked, dutyPool, mapOverPool } from "./balancer";
import { defaultEvaluator, type EvaluatorConfig, type ModelNode } from "./hud-store";

export type CriterionScore = { label: string; score: number };

export type Review = {
  node: string;
  score: number;
  critique: string;
  improved: string;
  criteria: CriterionScore[];
};

export type Evaluation = {
  reviews: Review[];
  /** endelig svar etter sammenslåing */
  final: string;
  /** navnet på noden som leverte det endelige svaret */
  source: string;
  bestScore: number;
  /** ble svaret skrevet om? */
  rewritten: boolean;
};

function reviewPrompt(cfg: EvaluatorConfig): string {
  const active = cfg.criteria.filter((c) => c.enabled);
  const lines = active.map((c) => `- ${c.label} (vekt ${c.weight})`).join("\n");
  const fields = active.map((c) => `${c.label.toUpperCase()}: <0-10>`).join("\n");
  return `Du er evaluator. Du får et spørsmål og et utkast til svar fra en annen modell.
Vurder utkastet etter disse kriteriene:
${lines || "- Generell kvalitet"}

Svar NØYAKTIG i dette formatet, uten annen tekst:

${fields}
POENG: <heltall 0-10, samlet vurdering>
KRITIKK: <maks to setninger om hva som mangler eller er feil>
FORBEDRET:
<ditt forbedrede svar i sin helhet, på norsk bokmål>`;
}

function parseReview(text: string, node: string, cfg: EvaluatorConfig): Review {
  const active = cfg.criteria.filter((c) => c.enabled);
  const criteria: CriterionScore[] = [];
  for (const c of active) {
    const re = new RegExp(`${c.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(\\d{1,2})`, "i");
    const v = Number(re.exec(text)?.[1] ?? NaN);
    if (Number.isFinite(v)) criteria.push({ label: c.label, score: Math.max(0, Math.min(10, v)) });
  }
  const declared = Number(/POENG\s*:\s*(\d{1,2})/i.exec(text)?.[1] ?? NaN);
  // vektet snitt av kriteriene har forrang, ellers modellens egen samlede poengsum
  let score = Number.isFinite(declared) ? declared : 5;
  if (criteria.length) {
    let sum = 0;
    let w = 0;
    for (const c of criteria) {
      const weight = active.find((a) => a.label === c.label)?.weight ?? 1;
      sum += c.score * weight;
      w += weight;
    }
    if (w > 0) score = Math.round(sum / w);
  }
  const critique = (/KRITIKK\s*:\s*([\s\S]*?)(?=\nFORBEDRET\s*:|$)/i.exec(text)?.[1] ?? "").trim();
  const improved = (/FORBEDRET\s*:\s*([\s\S]*)$/i.exec(text)?.[1] ?? "").trim();
  return {
    node,
    score: Math.max(0, Math.min(10, score)),
    critique: critique || "(ingen kritikk oppgitt)",
    improved: improved || text.trim(),
    criteria,
  };
}

/**
 * Kjører arbeidernodene som evaluatorer av primærsvaret og velger/slår sammen
 * til ett endelig svar etter brukerens kriterier og terskel.
 */
export async function evaluate(opts: {
  question: string;
  answer: string;
  primary: ModelNode;
  workers: ModelNode[];
  settings?: EvaluatorConfig;
}): Promise<Evaluation> {
  const { question, answer, primary } = opts;
  const cfg = { ...defaultEvaluator, ...(opts.settings ?? {}) };
  // Bare noder som har fått evaluator-ansvar deltar i vurderingen.
  const kandidater = dutyPool(opts.workers, "evaluator");
  const limit = cfg.maxWorkers > 0 ? cfg.maxWorkers : kandidater.length;
  const workers = kandidater.slice(0, limit);
  const sys = reviewPrompt(cfg);
  const user = `SPØRSMÅL:\n${question}\n\nUTKAST FRA ${primary.name}:\n${answer}`;

  const runOne = async (w: ModelNode): Promise<Review> => {
    try {
      const raw = await callTracked(w, [
        { role: "system", content: sys },
        { role: "user", content: user },
      ] as ChatMsg[]);
      return parseReview(raw, w.name, cfg);
    } catch (e) {
      return {
        node: w.name,
        score: 0,
        critique: e instanceof Error ? e.message : "Noden svarte ikke",
        improved: "",
        criteria: [],
      };
    }
  };

  const reviews: Review[] = cfg.parallel
    ? await mapOverPool(workers, workers, (w) => runOne(w))
    : await (async () => {
        const out: Review[] = [];
        for (const w of workers) out.push(await runOne(w));
        return out;
      })();

  const usable = reviews.filter((r) => r.improved.trim());
  const best = usable.slice().sort((a, b) => b.score - a.score)[0];
  const bestScore = best?.score ?? 10;

  const shouldMerge =
    cfg.mergeMode === "alltid"
      ? usable.length > 0
      : cfg.mergeMode === "aldri"
        ? false
        : Boolean(best) && bestScore < cfg.threshold;

  if (!shouldMerge) {
    return { reviews, final: answer, source: primary.name, bestScore, rewritten: false };
  }

  try {
    const merged = await callTracked(primary, [
      {
        role: "system",
        content:
          "Du er redaktør. Du får ditt eget utkast og andre modellers kritikk og forbedringer. " +
          "Skriv ETT endelig svar på norsk bokmål som tar med det beste fra alle. Ingen metatekst.",
      },
      {
        role: "user",
        content: [
          `SPØRSMÅL:\n${question}`,
          `DITT UTKAST:\n${answer}`,
          ...usable.map(
            (r) => `FRA ${r.node} (${r.score}/10):\nKritikk: ${r.critique}\nForslag:\n${r.improved}`,
          ),
        ].join("\n\n"),
      },
    ] as ChatMsg[]);
    return {
      reviews,
      final: merged.trim() || answer,
      source: `${primary.name} + evaluator`,
      bestScore,
      rewritten: true,
    };
  } catch {
    /* faller tilbake til beste forbedring */
  }

  return {
    reviews,
    final: best?.improved ?? answer,
    source: best?.node ?? primary.name,
    bestScore,
    rewritten: Boolean(best),
  };
}
