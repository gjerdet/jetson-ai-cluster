import { callNode, type ChatMsg } from "./hud-client";
import type { ModelNode } from "./hud-store";

export type Review = {
  node: string;
  score: number;
  critique: string;
  improved: string;
};

export type Evaluation = {
  reviews: Review[];
  /** endelig svar etter sammenslåing */
  final: string;
  /** navnet på noden som leverte det endelige svaret */
  source: string;
  bestScore: number;
};

const REVIEW_PROMPT = `Du er evaluator. Du får et spørsmål og et utkast til svar fra en annen modell.
Svar NØYAKTIG i dette formatet, uten annen tekst:

POENG: <heltall 0-10 for hvor godt utkastet besvarer spørsmålet>
KRITIKK: <maks to setninger om hva som mangler eller er feil>
FORBEDRET:
<ditt forbedrede svar i sin helhet, på norsk bokmål>`;

function parseReview(text: string, node: string): Review {
  const score = Number(/POENG\s*:\s*(\d{1,2})/i.exec(text)?.[1] ?? NaN);
  const critique = (/KRITIKK\s*:\s*([\s\S]*?)(?=\nFORBEDRET\s*:|$)/i.exec(text)?.[1] ?? "").trim();
  const improved = (/FORBEDRET\s*:\s*([\s\S]*)$/i.exec(text)?.[1] ?? "").trim();
  return {
    node,
    score: Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : 5,
    critique: critique || "(ingen kritikk oppgitt)",
    improved: improved || text.trim(),
  };
}

/**
 * Kjører alle arbeidernoder som evaluatorer av primærsvaret, og velger/slår sammen
 * til ett endelig svar. Returnerer både delresultatene og konklusjonen.
 */
export async function evaluate(opts: {
  question: string;
  answer: string;
  primary: ModelNode;
  workers: ModelNode[];
  /** slå sammen til ett endelig svar via primærnoden når kritikken er vesentlig */
  merge?: boolean;
}): Promise<Evaluation> {
  const { question, answer, primary, workers } = opts;
  const reviews: Review[] = [];

  for (const w of workers) {
    try {
      const raw = await callNode(w, [
        { role: "system", content: REVIEW_PROMPT },
        { role: "user", content: `SPØRSMÅL:\n${question}\n\nUTKAST FRA ${primary.name}:\n${answer}` },
      ] as ChatMsg[]);
      reviews.push(parseReview(raw, w.name));
    } catch (e) {
      reviews.push({
        node: w.name,
        score: 0,
        critique: e instanceof Error ? e.message : "Noden svarte ikke",
        improved: "",
      });
    }
  }

  const usable = reviews.filter((r) => r.improved.trim());
  const best = usable.slice().sort((a, b) => b.score - a.score)[0];
  const bestScore = best?.score ?? 10;

  // Enig og fornøyd → behold primærsvaret.
  if (!best || bestScore >= 8) {
    return { reviews, final: answer, source: primary.name, bestScore };
  }

  if (opts.merge !== false && usable.length) {
    try {
      const merged = await callNode(primary, [
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
            ...usable.map((r) => `FRA ${r.node} (${r.score}/10):\nKritikk: ${r.critique}\nForslag:\n${r.improved}`),
          ].join("\n\n"),
        },
      ] as ChatMsg[]);
      return { reviews, final: merged.trim() || answer, source: `${primary.name} + evaluator`, bestScore };
    } catch {
      /* faller tilbake til beste forbedring */
    }
  }

  return { reviews, final: best.improved, source: best.node, bestScore };
}
