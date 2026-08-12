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
    /\b(kjører|hardware|maskinvare|cpu|gpu|minne|ram|disk|operativsystem|os|plattform|modell|hostname|vertsnavn|ip|nettverk|subnett|gateway|dns|port|prosess|tjeneste|status|temperatur|last|oppetid|installert|tilkoblet)\b/.test(
      normalized,
    );

  return localReference && observableState;
}
