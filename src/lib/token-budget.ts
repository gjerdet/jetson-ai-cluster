/**
 * Token-budsjett for eskalering til betalte noder (OpenRouter/Hermes).
 *
 * Alt lagres lokalt i nettleseren – ingen sky. Budsjettet er per dag, både
 * totalt og per «konsept» (emne), slik at f.eks. nettverksspørsmål ikke kan
 * spise hele dagsbudsjettet når Hermes er ustabil.
 */

const KEY = "jarvis.token-budsjett.bruk";

export type Konsept =
  | "nettverk"
  | "kode"
  | "infrastruktur"
  | "smarthus"
  | "kunnskap"
  | "annet";

export const KONSEPTER: Konsept[] = [
  "nettverk",
  "kode",
  "infrastruktur",
  "smarthus",
  "kunnskap",
  "annet",
];

export type TokenBudsjett = {
  /** slå budsjettet av/på */
  aktiv: boolean;
  /** maks estimerte tokens mot betalte noder per dag (0 = ubegrenset) */
  dagligTokens: number;
  /** maks antall eskaleringer per dag (0 = ubegrenset) */
  dagligEskaleringer: number;
  /** maks estimerte tokens per konsept per dag (0 = ubegrenset) */
  perKonsept: Partial<Record<Konsept, number>>;
};

export const standardBudsjett: TokenBudsjett = {
  aktiv: true,
  dagligTokens: 20000,
  dagligEskaleringer: 40,
  perKonsept: {
    nettverk: 6000,
    kode: 8000,
    infrastruktur: 6000,
    smarthus: 3000,
    kunnskap: 6000,
    annet: 4000,
  },
};

export type Bruk = {
  dag: string;
  tokens: number;
  eskaleringer: number;
  perKonsept: Partial<Record<Konsept, number>>;
};

const MONSTER: [Konsept, RegExp][] = [
  ["nettverk", /(nettverk|subnett|subnet|ip\b|vlan|dns|dhcp|unifi|juniper|switch|router|brannmur|firewall|nmap|ping|port)/i],
  ["kode", /(```|kode|skript|script|python|bash|regex|sql|typescript|javascript|stack ?trace|traceback|exception|kompiler)/i],
  ["infrastruktur", /(proxmox|truenas|docker|kubernetes|zfs|server|systemd|backup|disk|raid|virtuell|vm\b|ubuntu)/i],
  ["smarthus", /(homey|mqtt|smarthus|lys|termostat|sensor|automasjon|z-wave|zigbee)/i],
  ["kunnskap", /(hva er|hvem|hvor mange|forklar|historie|definisjon|lær meg|hvordan fungerer)/i],
];

/** Grov emne-klassifisering av et spørsmål. */
export function konseptFor(text: string): Konsept {
  for (const [k, re] of MONSTER) if (re.test(text)) return k;
  return "annet";
}

/** Grovt token-estimat: ~4 tegn per token. */
export function estimerTokens(...deler: string[]): number {
  return Math.ceil(deler.join(" ").length / 4);
}

function idag(): string {
  return new Date().toISOString().slice(0, 10);
}

function tom(): Bruk {
  return { dag: idag(), tokens: 0, eskaleringer: 0, perKonsept: {} };
}

/** Dagens forbruk. Nullstilles automatisk ved døgnskifte. */
export function lesBruk(): Bruk {
  if (typeof localStorage === "undefined") return tom();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return tom();
    const b = JSON.parse(raw) as Bruk;
    if (!b || b.dag !== idag()) return tom();
    return { ...tom(), ...b, perKonsept: b.perKonsept ?? {} };
  } catch {
    return tom();
  }
}

function skriv(b: Bruk) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
    window.dispatchEvent(new CustomEvent("jarvis:budsjett"));
  } catch {
    /* ignorer full localStorage */
  }
}

export type BudsjettSvar = { tillatt: boolean; grunn: string };

/**
 * Kan vi eskalere dette spørsmålet til en betalt node nå?
 * `anslag` er estimert token-kostnad for eskaleringen.
 */
export function kanEskalere(
  budsjett: TokenBudsjett | undefined,
  konsept: Konsept,
  anslag: number,
): BudsjettSvar {
  const b = budsjett ?? standardBudsjett;
  if (!b.aktiv) return { tillatt: true, grunn: "budsjett er av" };
  const bruk = lesBruk();

  if (b.dagligEskaleringer > 0 && bruk.eskaleringer >= b.dagligEskaleringer)
    return {
      tillatt: false,
      grunn: `dagsgrensen på ${b.dagligEskaleringer} eskaleringer er brukt opp`,
    };

  if (b.dagligTokens > 0 && bruk.tokens + anslag > b.dagligTokens)
    return {
      tillatt: false,
      grunn: `dagsbudsjettet (${bruk.tokens}/${b.dagligTokens} tokens) dekker ikke ~${anslag} tokens til`,
    };

  const tak = b.perKonsept?.[konsept] ?? 0;
  const brukt = bruk.perKonsept[konsept] ?? 0;
  if (tak > 0 && brukt + anslag > tak)
    return {
      tillatt: false,
      grunn: `konseptet «${konsept}» har brukt ${brukt}/${tak} tokens i dag`,
    };

  return {
    tillatt: true,
    grunn: `innenfor budsjett (${bruk.tokens}${b.dagligTokens ? `/${b.dagligTokens}` : ""} tokens brukt i dag)`,
  };
}

/** Bokfør faktisk forbruk etter en eskalering. */
export function bokfor(konsept: Konsept, tokens: number) {
  const b = lesBruk();
  b.tokens += Math.max(0, Math.round(tokens));
  b.eskaleringer += 1;
  b.perKonsept[konsept] = (b.perKonsept[konsept] ?? 0) + Math.max(0, Math.round(tokens));
  skriv(b);
}

/** Nullstill dagens forbruk manuelt. */
export function nullstillBruk() {
  skriv(tom());
}
