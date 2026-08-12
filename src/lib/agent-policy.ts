/**
 * Avgjør om et svar må forankres i ferske data fra den lokale installasjonen.
 * Dette er med vilje en generell evidensport, ikke en liste over enkelspørsmål.
 */
export function requiresFreshLocalEvidence(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9æøå]+/g, " ");
  const localReference =
    /\b(du|deg|din|ditt|dine|jarvis|agenten|noden|maskinen|systemet|serveren|lokal(?:e|t)?)\b/.test(
      normalized,
    );
  const observableState =
    /\b(kjører|hardware|maskinvare\w*|cpu|gpu|minne\w*|ram|disk\w*|operativsystem\w*|os|plattform\w*|modell\w*|hostname|vertsnavn\w*|ip|nettverk\w*|subnett\w*|gateway\w*|dns|port\w*|prosess\w*|tjenest\w*|status|temperatur\w*|last|oppetid|installert\w*|tilkoblet\w*)\b/.test(
      normalized,
    );

  return localReference && observableState;
}
