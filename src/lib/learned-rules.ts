/**
 * Adferdsregler agenten har lært av egne evalueringer i død tid.
 * Hentes fra backend (initiativ/læring) og legges inn i systemprompten,
 * slik at selvforbedringen faktisk endrer oppførselen i chat.
 */
import { backend } from "./backend";

let cache: string[] = [];
let hentet = 0;

export function learnedRulesPrompt(): string {
  if (!cache.length) return "";
  return [
    "LÆRTE REGLER (fra dine egne evalueringer – følg dem):",
    ...cache.slice(0, 10).map((r, i) => `L${i + 1}. ${r}`),
  ].join("\n");
}

/** Oppdaterer hurtigbufferet maks hvert 5. minutt. Feiler stille uten backend. */
export async function refreshLearnedRules(force = false): Promise<string[]> {
  if (!force && Date.now() - hentet < 5 * 60_000) return cache;
  hentet = Date.now();
  try {
    const u = await backend.hentUtvikling();
    cache = (u.regler ?? []).map((r) => r.tekst).filter(Boolean);
  } catch {
    /* uten lokal agent er det ingen lærte regler å hente */
  }
  return cache;
}
