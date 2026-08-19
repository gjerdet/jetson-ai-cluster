/**
 * Delt kontrakt mellom Jarvis-backend (agent/) og HUD-en (src/).
 * Ren JavaScript uten avhengigheter slik at både Node og nettleseren kan bruke den.
 * Typene ligger i contract.d.ts og deles av frontend via src/lib/contract.ts.
 */

export const API_VERSION = "2.3.0";

/** Versjon på konfig-pakkene som eksporteres/importeres mellom installasjoner. */
export const CONFIG_BUNDLE_VERSION = 1;

/** Dokumenter som kan flyttes mellom installasjoner (uten hemmeligheter). */
export const CONFIG_DOCS = [
  "ai",
  "nodes",
  "devices",
  "rules",
  "mqtt",
  "settings",
  "tts",
  "rag",
  "telegram",
  "config",
  "memory",
  "plans",
  "evaluations",
  "initiative",
  "generatedTools",
  "kollegaer",
  "laering",
];

export const RULE_OPERATORS = ["over", "under", "lik", "endres"];
export const RULE_ACTION_TYPES = ["mqtt", "telegram", "logg"];
export const USER_ROLES = ["admin", "bruker"];

/** Oppgavetyper en node i klyngen kan ta seg av. */
export const NODE_DUTIES = ["chat", "verktoy", "evaluator", "bakgrunn", "telegram"];

export const NODE_DUTY_LABELS = {
  chat: "Samtale",
  verktoy: "Verktøykall",
  evaluator: "Evaluator",
  bakgrunn: "Bakgrunnsjobber",
  telegram: "Telegram",
};

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
  aiChat: "/ai/chat",
  aiPool: "/ai/pool",
  aiTest: "/ai/test",
  samples: "/maalinger",
  samplesLatest: "/maalinger/siste",
  samplesPrune: "/maalinger/rydd",
  devices: "/enheter",
  rules: "/regler",
  rulesLog: "/regler/logg",
  mqtt: "/mqtt",
  mqttPublish: "/mqtt/publiser",
  mqttHealth: "/mqtt/helse",
  nodes: "/noder",
  nodesRegister: "/noder/registrer",
  settings: "/innstillinger",
  settingsSchema: "/innstillinger/skjema",
  threads: "/samtaler",
  telegram: "/telegram",
  telegramTest: "/telegram/test",
  backup: "/backup",
  version: "/versjon",
  update: "/versjon/oppdater",
  updateStatus: "/versjon/oppdater/status",
  configExport: "/config/eksport",
  configImport: "/config/import",
  knowledge: "/kunnskap",
  knowledgeSearch: "/kunnskap/sok",
  knowledgeConfig: "/kunnskap/config",
  knowledgeReindex: "/kunnskap/reindekser",
  knowledgeWebSearch: "/kunnskap/web-sok",
  knowledgeFetchUrl: "/kunnskap/hent-url",
  knowledgeLearn: "/kunnskap/laer",
  tts: "/tts/tale",
  ttsConfig: "/tts/config",
  ttsVoices: "/tts/stemmer",
  ttsClips: "/tts/klipp",
  ttsManifest: "/tts/treningssett",
  ttsClipsVerify: "/tts/klipp/verifiser",
  ttsClipsTranscribeAll: "/tts/klipp/transkriber-alle",
  ttsTraining: "/tts/trening",
  ttsTrainingPlan: "/tts/trening/plan",
  ttsTrainingInstall: "/tts/trening/installer",
  logs: "/logger",
  logSources: "/logger/kilder",
  clusterLocal: "/klynge/lokal",
  clusterHealth: "/klynge/helse",
  configDistribute: "/config/distribuer",
  provision: "/noder/provisjoner",

  // AGI / autonomi
  memory: "/minne",
  memoryRecall: "/minne/hent",
  memoryTimeline: "/minne/tidslinje",
  plans: "/planer",
  planSteps: "/planer/steg",
  evaluations: "/evalueringer",
  initiative: "/initiativ",
  initiativeSuggestions: "/initiativ/forslag",
  generatedTools: "/verktoy/genererte",
  generatedToolTest: "/verktoy/genererte/test",
  generatedToolRun: "/verktoy/genererte/kjor",
  generatedToolRunNode: "/verktoy/genererte/kjor-node",
  toolStorage: "/verktoy/lagring",
  toolIpCheck: "/verktoy/ip-sjekk",
  generatedToolRollback: "/verktoy/genererte/tilbake",
  generatedToolEnable: "/verktoy/genererte/aktiver",

  // identitet, kolleger og utvikling
  identity: "/identitet",
  identitySelftest: "/identitet/selvtest",
  colleagues: "/kollega",
  colleagueDiagnose: "/kollega/diagnose",
  colleagueDelegate: "/kollega/deleger",
  initiativeQueue: "/initiativ/ko",
  initiativeRun: "/initiativ/kjor",
  initiativeRollback: "/initiativ/tilbake",
  initiativeLearn: "/initiativ/regel",

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
  tls: "Fikk ikke sikker kontakt (HTTPS) med backend-en. Enten er det selvsignerte sertifikatet ikke godkjent i denne nettleseren, eller så svarer ikke agenten på adressen.",
  server: "Backend-en svarte med en uventet feil.",
};

export const DEFAULTS = {
  port: 8787,
  mqttUrl: "mqtt://127.0.0.1:1883",
  aiBaseUrl: "http://127.0.0.1:11434/v1",
  aiModel: "llama3.2:3b",
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

/** Bygger en systemprompt-del fra en strukturert personlighet. */
export function buildPersonalityPrompt(personality) {
  if (!personality || typeof personality !== "object") return "";
  const quirks = String(personality.quirks ?? "")
    .split("\n")
    .map((q) => q.trim())
    .filter(Boolean);
  const lines = [
    `Du er ${personality.name}, ${personality.role}.`,
    `Svar på ${personality.language}.`,
    `Tone: ${personality.tone}.`,
    `Detaljnivå: ${personality.verbosity}.`,
    personality.background,
    quirks.length ? `Særtrekk:\n${quirks.map((q) => `- ${q}`).join("\n")}` : "",
    personality.catchphrase ? `Faste uttrykk: «${personality.catchphrase}».` : "",
    personality.extra,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/* ------------------------- klyngenoder (Jetson m.fl.) ---------------------- */


/**
 * Normaliserer en node i klyngen. Noder kan registreres manuelt fra HUD-en
 * eller melde seg selv inn via POST /api/noder/registrer.
 */
export function validateNode(node) {
  if (!node || typeof node !== "object") throw new Error("Noden mangler innhold.");
  const navn = String(node.navn ?? node.name ?? "").trim();
  if (!navn) throw new Error("Noden må ha et navn.");
  const baseUrl = String(node.baseUrl ?? "").trim();
  if (!/^https?:\/\//i.test(baseUrl))
    throw new Error(`Noden «${navn}» må ha en adresse som starter med http:// eller https://.`);
  const duties = Array.isArray(node.oppgaver) ? node.oppgaver.filter((d) => NODE_DUTIES.includes(d)) : [];
  return {
    id: String(node.id || `node-${Math.random().toString(36).slice(2, 10)}`),
    navn,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    modell: String(node.modell ?? node.model ?? "").trim(),
    rolle: ["primary", "worker", "observer"].includes(node.rolle) ? node.rolle : "worker",
    oppgaver: duties.length ? duties : ["chat", "verktoy"],
    aktiv: node.aktiv !== false,
    vekt: Number.isFinite(Number(node.vekt)) ? Math.max(1, Math.min(10, Number(node.vekt))) : 1,
    sistSett: Number(node.sistSett) || Date.now(),
    agentUrl: /^https?:\/\//i.test(String(node.agentUrl ?? "").trim())
      ? String(node.agentUrl).trim().replace(/\/+$/, "")
      : "",
    agentToken: String(node.agentToken ?? "").slice(0, 300),
    kilde: node.kilde === "auto" ? "auto" : "manuell",
    notat: String(node.notat ?? "").slice(0, 500),
  };
}

/* --------------------- skjemadrevne backend-innstillinger ------------------ */

/**
 * Ett skjema som både backend og HUD bruker: HUD-en bygger skjemaet
 * automatisk, backend validerer med nøyaktig samme regler og tar verdiene
 * i bruk uten omstart.
 */
export const SETTINGS_SCHEMA = [
  {
    gruppe: "Lagring",
    felter: [
      {
        id: "retentionDays",
        etikett: "Oppbevaring av måledata (dager)",
        type: "number",
        min: 1,
        maks: 3650,
        standard: DEFAULTS.retentionDays,
        hjelp: "Eldre målinger ryddes bort automatisk.",
      },
      {
        id: "backupHours",
        etikett: "Sikkerhetskopi hver (timer)",
        type: "number",
        min: 1,
        maks: 168,
        standard: 24,
      },
    ],
  },
  {
    gruppe: "MQTT",
    felter: [
      { id: "mqttUrl", etikett: "Megler-adresse", type: "text", maks: 300, standard: DEFAULTS.mqttUrl, monster: "^mqtts?://", hjelp: "mqtt://bruker:passord@vert:1883" },
      { id: "mqttTopics", etikett: "Emner (komma­separert)", type: "text", maks: 500, standard: "#" },
      { id: "mqttEnabled", etikett: "MQTT aktiv", type: "boolean", standard: false },
      { id: "mqttFlapMinutter", etikett: "Flapping-vindu (minutter)", type: "number", min: 1, maks: 120, standard: 10 },
      { id: "mqttFlapGrense", etikett: "Frakoblinger før varsel", type: "number", min: 2, maks: 50, standard: 3 },
      { id: "mqttNedeSek", etikett: "Nede i sekunder før varsel", type: "number", min: 10, maks: 3600, standard: 120 },
      { id: "mqttVarsleTelegram", etikett: "Varsle på Telegram", type: "boolean", standard: true },
    ],
  },
  {
    gruppe: "Regelmotor",
    felter: [
      { id: "rulePauseSek", etikett: "Standard pause mellom utløsninger (sek)", type: "number", min: 0, maks: 86400, standard: DEFAULTS.rulePauseSek },
      { id: "reglerAktive", etikett: "Regelmotor aktiv", type: "boolean", standard: true },
    ],
  },
  {
    gruppe: "Klynge",
    felter: [
      { id: "autoRegistrering", etikett: "Tillat at noder melder seg inn selv", type: "boolean", standard: true },
      {
        id: "aiOppgaveNode",
        etikett: "Node som tar AI-oppgaver",
        type: "text",
        maks: 100,
        standard: "",
        hjelp: "Node-ID. Tomt = automatisk lastbalansering.",
      },
    ],
  },
];

export const SETTINGS_DEFAULTS = Object.fromEntries(
  SETTINGS_SCHEMA.flatMap((g) => g.felter.map((f) => [f.id, f.standard])),
);

/** Validerer et helt eller delvis innstillingsobjekt mot SETTINGS_SCHEMA. */
export function validateSettings(input, current = {}) {
  const felter = SETTINGS_SCHEMA.flatMap((g) => g.felter);
  const out = { ...SETTINGS_DEFAULTS, ...current };
  const feil = [];
  for (const f of felter) {
    if (!(f.id in (input ?? {}))) continue;
    const raw = input[f.id];
    if (f.type === "boolean") {
      out[f.id] = raw === true || raw === "true";
      continue;
    }
    if (f.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < f.min || n > f.maks) {
        feil.push(`${f.etikett} må være et tall mellom ${f.min} og ${f.maks}.`);
        continue;
      }
      out[f.id] = n;
      continue;
    }
    const t = String(raw ?? "").trim();
    if (t.length > (f.maks ?? 500)) {
      feil.push(`${f.etikett} er for lang (maks ${f.maks} tegn).`);
      continue;
    }
    if (t && f.monster && !new RegExp(f.monster).test(t)) {
      feil.push(`${f.etikett} har ugyldig format.`);
      continue;
    }
    out[f.id] = t;
  }
  if (feil.length) {
    const e = new Error(feil.join(" "));
    e.felter = feil;
    throw e;
  }
  return out;
}
