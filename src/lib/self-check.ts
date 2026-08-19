import type { ChatMsg } from "./hud-client";
import { callTracked } from "./balancer";
import { nodeKlasse } from "./model-router";
import type { HudConfig, ModelNode } from "./hud-store";

/**
 * Lokal-først med selvsjekk.
 *
 * Målet er å bruke minst mulig betalte tokens: den lokale Jetson-modellen
 * svarer først, vurderer sitt eget svar lokalt (gratis), og bare hvis svaret
 * åpenbart ikke holder mål eskaleres spørsmålet til en tung node
 * (Hermes/OpenRouter).
 */

export const STANDARD_TERSKEL = 6;

export type Selvsjekk = {
  poeng: number;
  grunn: string;
  eskaler: boolean;
  /** true når konklusjonen kom fra billige regler og ikke et modellkall */
  heuristisk: boolean;
};

/** Klare tegn på at et svar ikke løste oppgaven. */
const OPPGIR =
  /(jeg (vet|kan) ikke|har ikke (nok )?(kunnskap|informasjon)|kan dessverre ikke|beklager, (men )?jeg)/i;
const TOMPRAT = /^(ok(ei)?|javisst|forstått|gjerne)[.!]?$/i;

/** Billige regler som avgjør uten å bruke et eneste token. */
export function heuristisk(question: string, answer: string): Selvsjekk | null {
  const a = answer.trim();
  if (!a || a.length < 12)
    return { poeng: 1, grunn: "tomt eller nesten tomt svar", eskaler: true, heuristisk: true };
  if (TOMPRAT.test(a))
    return { poeng: 2, grunn: "svaret er innholdsløst", eskaler: true, heuristisk: true };
  if (OPPGIR.test(a))
    return { poeng: 3, grunn: "modellen gir opp uten å levere et svar", eskaler: true, heuristisk: true };
  if (question.trim().length <= 40 && a.length > 30)
    return { poeng: 9, grunn: "kort spørsmål besvart lokalt", eskaler: false, heuristisk: true };
  return null;
}

const SYS = `Du er en streng, men billig kvalitetskontroll. Du får et spørsmål og et svar fra en liten lokal modell.
Vurder KUN om svaret faktisk løser oppgaven (riktig, konkret, ikke bortforklaring).
Svar nøyaktig slik, uten annen tekst:
POENG: <0-10>
GRUNN: <maks én setning>`;

/**
 * Kjører selvsjekk på svaret. Bruker heuristikk først, deretter et kort
 * kall til den lokale noden selv (aldri en betalt node).
 */
export async function selvsjekk(opts: {
  question: string;
  answer: string;
  lokalNode?: ModelNode;
  terskel?: number;
}): Promise<Selvsjekk> {
  const terskel = opts.terskel ?? STANDARD_TERSKEL;
  const h = heuristisk(opts.question, opts.answer);
  if (h) return h;
  if (!opts.lokalNode)
    return { poeng: 10, grunn: "ingen lokal node å vurdere med", eskaler: false, heuristisk: true };
  try {
    const raw = await callTracked(opts.lokalNode, [
      { role: "system", content: SYS },
      {
        role: "user",
        content: `SPØRSMÅL:\n${opts.question}\n\nSVAR:\n${opts.answer.slice(0, 4000)}`,
      },
    ] as ChatMsg[]);
    const poeng = Number(/POENG\s*:\s*(\d{1,2})/i.exec(raw)?.[1] ?? NaN);
    const grunn = (/GRUNN\s*:\s*(.+)/i.exec(raw)?.[1] ?? "").trim();
    if (!Number.isFinite(poeng))
      return { poeng: 10, grunn: "selvsjekk ga ikke poeng – beholder lokalt svar", eskaler: false, heuristisk: false };
    const p = Math.max(0, Math.min(10, poeng));
    return {
      poeng: p,
      grunn: grunn || "ingen begrunnelse oppgitt",
      eskaler: p < terskel,
      heuristisk: false,
    };
  } catch {
    return { poeng: 10, grunn: "selvsjekk feilet – beholder lokalt svar", eskaler: false, heuristisk: true };
  }
}

/** Første tunge node som kan overta ved eskalering. */
export function tungNode(config: HudConfig, unntatt?: ModelNode): ModelNode | undefined {
  return config.nodes.find(
    (n) => n.enabled && n.id !== unntatt?.id && nodeKlasse(n) === "tung",
  );
}

/** Er dette svaret levert av en lokal (gratis) node? */
export function erLokaltSvar(config: HudConfig, nodeNavn: string): boolean {
  const rent = nodeNavn.replace(/^BACKEND · /, "").replace(/ · direkte$/, "");
  const node = config.nodes.find((n) => n.name === rent || rent.includes(n.name));
  if (!node) return !/openrouter|openai|anthropic|groq|mistral|deepseek/i.test(rent);
  return nodeKlasse(node) === "lokal";
}
