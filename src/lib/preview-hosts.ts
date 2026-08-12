/**
 * Felles gjenkjenning av Lovable-forhåndsvisningsdomener.
 * Brukes både på klienten (preview-session.ts) og på serveren
 * (preview-gate.functions.ts) slik at reglene aldri kommer i utakt.
 */

/** Domener som alltid regnes som forhåndsvisning/utvikling. */
const PREVIEW_SUFFIXES = [
  ".lovable.app",
  ".lovableproject.com",
  ".lovable.dev",
  ".lovable.host",
  ".lovable.build",
  ".sandbox.lovable.dev",
  ".localhost",
  ".local",
];

const PREVIEW_EXACT = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "lovable.app",
  "lovable.dev",
  "lovableproject.com",
]);

/** Normaliser: fjern port, klammer rundt IPv6 og store bokstaver. */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  let host = raw.trim().toLowerCase();
  // Fjern eventuelt skjema og sti (hvis vi får en full URL/origin).
  host = host.replace(/^[a-z]+:\/\//, "").split("/")[0] ?? "";
  // IPv6 i klammer beholdes, ellers strippes port.
  if (!host.startsWith("[")) host = host.split(":")[0] ?? "";
  return host;
}

export function isPreviewHostname(raw: string | null | undefined): boolean {
  const host = normalizeHost(raw);
  if (!host) return false;
  if (PREVIEW_EXACT.has(host)) return true;
  if (PREVIEW_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // Fanger opp alle nåværende og framtidige Lovable-subdomener,
  // f.eks. id-preview--<uuid>.lovable.app eller *.preview.lovable.xyz
  if (/(^|\.)lovable(project)?\.[a-z]{2,}$/.test(host)) return true;
  return false;
}

/**
 * Klientside-sjekk. Tar også hensyn til at HUD-en kan kjøre i en iframe
 * inne i Lovable-editoren (da er selve dokumentet på et preview-domene,
 * men vi sjekker foreldre-origin som ekstra fallback).
 */
export function detectPreviewEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  if (isPreviewHostname(window.location.hostname)) return true;

  try {
    const ancestors = (window.location as unknown as { ancestorOrigins?: DOMStringList })
      .ancestorOrigins;
    if (ancestors) {
      for (let i = 0; i < ancestors.length; i++) {
        if (isPreviewHostname(ancestors[i])) return true;
      }
    }
  } catch {
    /* ignorert */
  }

  try {
    if (window.parent !== window && document.referrer && isPreviewHostname(document.referrer)) {
      return true;
    }
  } catch {
    /* ignorert */
  }

  return false;
}
