/**
 * Avgjør om et svar må forankres i ferske data fra den lokale installasjonen.
 * Dette er med vilje en generell evidensport, ikke en liste over enkeltspørsmål:
 * - "localReference" dekker at spørsmålet peker på DENNE installasjonen (pronomen,
 *   demonstrativer eller et konfigurert nodenavn) i stedet for en hardkodet liste
 *   av kjente enhetsnavn.
 * - "observableState" er avledet fra selve verktøykatalogen (TOOL_CATALOG), slik
 *   at nye verktøy automatisk utvider hvilke temaer som krever måling – uten at
 *   noen må huske å oppdatere en egen ordliste her.
 */
import { TOOL_CATALOG } from "./agent-tools";

const GENERIC_LOCAL_WORDS =
  /\b(du|deg|din|ditt|dine|dette|denne|disse|jarvis|agenten|noden|maskinen|systemet|serveren|enheten|installasjonen|lokal(?:e|t)?)\b/;

function wordsFrom(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9æøå]+/g, " ")
        .split(" ")
        .filter((w) => w.length >= 4),
    ),
  );
}

/** Stammer (min. 4 tegn) hentet fra navn/beskrivelse/kategori til alle innebygde verktøy. */
function catalogVocabulary(): string[] {
  return Array.from(
    new Set(
      TOOL_CATALOG.flatMap((t) => wordsFrom(`${t.name} ${t.summary} ${t.category}`)),
    ),
  );
}

export function requiresFreshLocalEvidence(text: string, nodeNames: string[] = []): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9æøå]+/g, " ");
  const nodeRef = nodeNames.some((n) => n && normalized.includes(n.toLowerCase()));
  const localReference = GENERIC_LOCAL_WORDS.test(normalized) || nodeRef;

  const questionWords = wordsFrom(text);
  const vocab = catalogVocabulary();
  // Fyrst-stavelse-match (stem-ish) mot verktøykatalogens ordforråd, slik at bøyde
  // former («temperaturen», «lagringsplassen») også treffer uten en manuelt
  // vedlikeholdt regex.
  const observableState = questionWords.some((w) =>
    vocab.some((v) => w.startsWith(v) || v.startsWith(w)),
  );

  return localReference && observableState;
}
