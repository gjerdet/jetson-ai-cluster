/**
 * Delt kontrakt mellom Jarvis-backend (agent/) og HUD-en (src/).
 * Ren JavaScript uten avhengigheter slik at både Node og nettleseren kan bruke den.
 * Typene ligger i contract.d.ts og deles av frontend via src/lib/contract.ts.
 */

export const API_VERSION = "2.0.0";

export const RULE_OPERATORS = ["over", "under", "lik", "endres"];
export const RULE_ACTION_TYPES = ["mqtt", "telegram", "logg"];
export const USER_ROLES = ["admin", "bruker"];

/** Alle API-ruter på ett sted, slik at frontend og backend ikke kan gå fra hverandre. */
export const ROUTES = {
  status: "/status",
  login: "/auth/login",
  register: "/auth/register",
  me: "/auth/me",
  logout: "/auth/logout",
  password: "/auth/passord",
  users: "/brukere",
  config: "/config",
  ai: "/ai",
  samples: "/maalinger",
  samplesLatest: "/maalinger/siste",
  samplesPrune: "/maalinger/rydd",
  devices: "/enheter",
  rules: "/regler",
  rulesLog: "/regler/logg",
  mqtt: "/mqtt",
  mqttPublish: "/mqtt/publiser",
  threads: "/samtaler",
  telegram: "/telegram",
  telegramTest: "/telegram/test",
  backup: "/backup",
};

/** Maskinlesbare feilkoder – frontend kan gi brukeren en presis melding. */
export const ERROR_CODES = {
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  VALIDATION: "validation",
  UNAVAILABLE: "unavailable",
  RATE_LIMIT: "rate_limit",
  NETWORK: "network",
  TIMEOUT: "timeout",
  TLS: "tls",
  SERVER: "server",
};

/** Brukervennlige tekster på norsk for hver feilkode. */
export const ERROR_TEXTS = {
  unauthorized: "Du er ikke innlogget mot backend-en. Logg inn på nytt.",
  forbidden: "Kontoen din mangler rettigheter til denne handlingen.",
  not_found: "Fant ikke ressursen på backend-en.",
  validation: "Ugyldige verdier ble sendt til backend-en.",
  unavailable: "Tjenesten er ikke tilgjengelig akkurat nå (f.eks. MQTT nede).",
  rate_limit: "For mange forespørsler mot backend-en. Vent litt og prøv igjen.",
  network: "Får ikke kontakt med backend-en. Sjekk at agenten kjører og at adressen stemmer.",
  timeout: "Backend-en svarte ikke i tide.",
  tls: "TLS-feil. Godkjenn sertifikatet i nettleseren ved å åpne backend-adressen direkte.",
  server: "Backend-en svarte med en uventet feil.",
};

export const DEFAULTS = {
  port: 8787,
  mqttUrl: "mqtt://127.0.0.1:1883",
  aiBaseUrl: "http://127.0.0.1:11434/v1",
  aiModel: "llama3.1",
  retentionDays: 90,
  rulePauseSek: 300,
};

/** Normaliserer og validerer en regel. Kaster ved ugyldige verdier. */
export function validateRule(rule) {
  if (!rule || typeof rule !== "object") throw new Error("Regelen mangler innhold.");
  const navn = String(rule.navn ?? "").trim();
  if (!navn) throw new Error("Regelen må ha et navn.");
  const emne = String(rule.emne ?? "").trim();
  if (!emne) throw new Error(`Regelen «${navn}» mangler MQTT-emne.`);
  const operator = RULE_OPERATORS.includes(rule.operator) ? rule.operator : "over";
  if ((operator === "over" || operator === "under") && !Number.isFinite(Number(rule.verdi)))
    throw new Error(`Regelen «${navn}» må ha en tallverdi for «${operator}».`);
  const handlinger = Array.isArray(rule.handlinger) ? rule.handlinger : [];
  for (const h of handlinger) {
    if (!RULE_ACTION_TYPES.includes(h?.type)) throw new Error(`Ukjent handlingstype i «${navn}».`);
    if (h.type === "mqtt" && !String(h.emne ?? "").trim())
      throw new Error(`MQTT-handlingen i «${navn}» mangler emne.`);
  }
  return {
    id: rule.id,
    navn,
    aktiv: rule.aktiv !== false,
    emne,
    operator,
    verdi: rule.verdi ?? "",
    pauseSek: Number.isFinite(Number(rule.pauseSek)) ? Number(rule.pauseSek) : DEFAULTS.rulePauseSek,
    handlinger: handlinger.map((h) => ({
      type: h.type,
      emne: String(h.emne ?? ""),
      payload: String(h.payload ?? ""),
      tekst: String(h.tekst ?? ""),
    })),
    sistUtlost: Number(rule.sistUtlost) || 0,
  };
}

/** Enkel validering av e-post og passord ved registrering. */
export function validateCredentials(epost, passord) {
  const email = String(epost ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Ugyldig e-postadresse.");
  if (String(passord ?? "").length < 8) throw new Error("Passordet må ha minst 8 tegn.");
  return { email, password: String(passord) };
}

/** HTTP-status → feilkode. */
export function codeFromStatus(status) {
  if (status === 401) return ERROR_CODES.UNAUTHORIZED;
  if (status === 403) return ERROR_CODES.FORBIDDEN;
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 400 || status === 422) return ERROR_CODES.VALIDATION;
  if (status === 429) return ERROR_CODES.RATE_LIMIT;
  if (status === 503) return ERROR_CODES.UNAVAILABLE;
  return ERROR_CODES.SERVER;
}
