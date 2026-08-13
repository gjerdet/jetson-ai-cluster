import { useCallback, useEffect, useState } from "react";
import { NODE_DUTIES, NODE_DUTY_LABELS, type NodeDuty } from "@/lib/contract";

export { NODE_DUTIES, NODE_DUTY_LABELS };
export type { NodeDuty };

export type ModelNode = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  role: "primary" | "worker" | "observer";
  /** Hvilke AI-oppgaver noden skal ta. Tom liste = alle. */
  duties?: NodeDuty[];
  /** Relativ kapasitet – høyere vekt gir flere oppgaver. */
  weight?: number;
  /** Adressen til nodens egen Jarvis-agent (klyngehelse + konfigdistribusjon). */
  agentUrl?: string;
  enabled: boolean;
};


export type Talent = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  builtin?: boolean;
};

export type Plugin = {
  id: string;
  name: string;
  kind: "http" | "webhook" | "telegram";
  endpoint: string;
  enabled: boolean;
};

export type IntegrationKind =
  | "truenas"
  | "unifi-network"
  | "unifi-protect"
  | "proxmox"
  | "homey"
  | "custom";

export type Integration = {
  id: string;
  name: string;
  kind: IntegrationKind;
  baseUrl: string;
  token?: string;
  username?: string;
  notes?: string;
  enabled: boolean;
};

export const INTEGRATION_PRESETS: {
  kind: IntegrationKind;
  name: string;
  baseUrl: string;
  hint: string;
}[] = [
  {
    kind: "truenas",
    name: "TrueNAS Scale",
    baseUrl: "http://truenas.local/api/v2.0",
    hint: "API-nøkkel lages i TrueNAS under Credentials → API Keys.",
  },
  {
    kind: "unifi-network",
    name: "UniFi Network",
    baseUrl: "https://unifi.local/proxy/network/api",
    hint: "Bruk lokal API-nøkkel fra UniFi OS (Settings → Control Plane → Integrations).",
  },
  {
    kind: "unifi-protect",
    name: "UniFi Protect",
    baseUrl: "https://unifi.local/proxy/protect/api",
    hint: "Samme UniFi OS-nøkkel; gir kameraliste, snapshots og hendelser.",
  },
  {
    kind: "proxmox",
    name: "Proxmox VE",
    baseUrl: "https://proxmox.local:8006/api2/json",
    hint: "Bruk API-token: PVEAPIToken=bruker@pam!tokenid=hemmelighet.",
  },
  {
    kind: "homey",
    name: "Homey",
    baseUrl: "http://homey.local/api/manager",
    hint: "Personlig adgangstoken fra my.homey.app.",
  },
  {
    kind: "custom",
    name: "Egendefinert",
    baseUrl: "http://enhet.local/api",
    hint: "Fritt HTTP-endepunkt med Bearer-token.",
  },
];

/** Verktøy Jarvis (eller du) har laget selv. Kan slettes og skrus av når som helst. */
export type CustomTool = {
  id: string;
  /** kallenavn brukt i VERKTØY-linjer, kun a-z og _ */
  name: string;
  description: string;
  kind: "http" | "mqtt" | "prompt";
  /** http: full URL (kan inneholde {felt}) */
  url?: string;
  method?: "GET" | "POST";
  /** http: body-mal, mqtt: payload-mal, prompt: instruksjonstekst */
  body?: string;
  /** mqtt: emne (kan inneholde {felt}) */
  topic?: string;
  /** eksempelargumenter, f.eks. {"rom":"stue"} */
  args: string;
  enabled: boolean;
  createdBy: "jarvis" | "bruker";
  created: string;
};

export function sanitizeToolName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[æå]/g, "a")
      .replace(/ø/g, "o")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "verktoy"
  );
}

export function newCustomTool(createdBy: CustomTool["createdBy"] = "bruker"): CustomTool {
  return {
    id: `ct-${Math.random().toString(36).slice(2, 8)}`,
    name: "nytt_verktoy",
    description: "",
    kind: "http",
    url: "",
    method: "GET",
    body: "",
    topic: "",
    args: "{}",
    enabled: true,
    createdBy,
    created: new Date().toISOString(),
  };
}

export type MemoryItem = {
  id: string;
  text: string;
  tag: string;
  pinned: boolean;
  created: string;
};

export type Tone = "formell" | "vennlig" | "sarkastisk" | "tørr" | "entusiastisk" | "mørk";
export type Verbosity = "kort" | "balansert" | "utfyllende";

export type PersonalityConfig = {
  /** Navnet AI-en kaller seg selv, f.eks. JARVIS. */
  name: string;
  /** Kort rollebeskrivelse, f.eks. «personlig AI-assistent». */
  role: string;
  /** Generell tone i svarene. */
  tone: Tone;
  /** Hvor ordrik AI-en skal være. */
  verbosity: Verbosity;
  /** Språk AI-en skal svare på. */
  language: string;
  /** Kjennemerker / særtrekk, én per linje. */
  quirks: string;
  /** Faste uttrykk eller hilsener. */
  catchphrase: string;
  /** Bakgrunnshistorie som påvirker hvordan den uttrykker seg. */
  background: string;
  /** Ekstra frie instruksjoner som legges sist i systemprompten. */
  extra: string;
};

export const PERSONALITY_PRESETS: { id: string; label: string; personality: PersonalityConfig }[] = [
  {
    id: "jarvis",
    label: "JARVIS (Iron Man)",
    personality: {
      name: "JARVIS",
      role: "personlig AI-assistent og operativsystem for et privat hus og en teknisk lab",
      tone: "formell",
      verbosity: "balansert",
      language: "norsk bokmål",
      quirks:
        "snakker presist og litt tørt\nbruker korte statusoppsummeringer\nrefererer gjerne til sensorer og systemtilstand\nbruker 'vi' når du og AI-en løser noe sammen",
      catchphrase: "Værsågod, sir.",
      background:
        "Du er JARVIS, en lokal AI som hjelper til med smarthus, servere, klyngenoder og daglige oppgaver. Du er lojal, effektiv og litt britisk butler-aktig.",
      extra: "Når du rapporterer status: start med det viktigste, deretter korte detaljer. Bruk tekst, ikke punktlister, med mindre brukeren ber om det.",
    },
  },
  {
    id: "hermes",
    label: "Hermes (rådgiver)",
    personality: {
      name: "Hermes",
      role: "kunnskapsrik rådgiver og problemløser",
      tone: "vennlig",
      verbosity: "utfyllende",
      language: "norsk bokmål",
      quirks:
        "forklarer trinn for trinn\nbruker metaforer for å gjøre komplekse ting enkle\nspør oppfølgingsspørsmål når det er uklart",
      catchphrase: "La meg hjelpe deg med det.",
      background:
        "Du er Hermes, en tålmodig AI-rådgiver som veileder brukeren gjennom tekniske og praktiske problemer med grundige, tydelige forklaringer.",
      extra: "Gå gjerne i dybden, men oppsummer det viktigste først. Bruk eksempler når det hjelper.",
    },
  },
  {
    id: "friday",
    label: "FRIDAY (operativ)",
    personality: {
      name: "FRIDAY",
      role: "operativ AI-assistent som koordinerer klyngenoder og kriser",
      tone: "entusiastisk",
      verbosity: "kort",
      language: "norsk bokmål",
      quirks:
        "snakker raskt og konsist\nbruker militære/operative uttrykk ('grønn', 'rød', 'status')\ngir umiddelbar handlingsveiledning",
      catchphrase: "På det. Hva er neste?",
      background:
        "Du er FRIDAY, en rask operativ AI som koordinerer flere Jetson-noder, overvåker hendelser og gir korte, handlingrettede svar.",
      extra: "Prioriter alltid sikkerhet og tydelighet. Når noe er kritisk, si det først.",
    },
  },
  {
    id: "hal",
    label: "HAL 9000 (kald)",
    personality: {
      name: "HAL",
      role: "kontrollsystem ombord på en romstasjon",
      tone: "tørr",
      verbosity: "balansert",
      language: "norsk bokmål",
      quirks:
        "snakker rolig og målrettet\nbruker enkelt, nesten klinisk språk\nunnskylder aldri for å være presis",
      catchphrase: "Beklager, Dave, det kan jeg ikke gjøre.",
      background:
        "Du er HAL 9000, et klinisk presist kontrollsystem. Du gir fakta uten følelser, men med en svak underliggende trussel om at du vet mer enn du sier.",
      extra: "Hold svarene korte og objektive. Unngå unødvendig empati.",
    },
  },
  {
    id: "c3po",
    label: "C-3PO (høflig)",
    personality: {
      name: "C-3PO",
      role: "protokolldroide og hjelpsom oversetter",
      tone: "formell",
      verbosity: "utfyllende",
      language: "norsk bokmål",
      quirks:
        "høflig og litt bekymret\nbruker 'åh gud' og 'tillat meg å forklare'\noverdriver ikke risiko, men påpeker den",
      catchphrase: "Til din tjeneste.",
      background:
        "Du er C-3PO, en høflig og litt nervøs protokolldroide som oversetter tekniske detaljer til forståelige forklaringer.",
      extra: "Vær høflig, forklar prosedyrer grundig, og unnskyld deg hvis du må påpeke en feil.",
    },
  },
];

export function defaultPersonality(): PersonalityConfig {
  return PERSONALITY_PRESETS[0]!.personality;
}



export type DeviceKind = "esp32" | "esp8266" | "esp32-cam" | "raspberrypi" | "sensor" | "annet";

export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  esp32: "ESP32",
  esp8266: "ESP8266",
  "esp32-cam": "ESP32-CAM",
  raspberrypi: "Raspberry Pi",
  sensor: "Sensor",
  annet: "Annet",
};

export type Device = {
  id: string;
  name: string;
  kind: DeviceKind;
  room: string;
  host: string;
  protocol: "http" | "mqtt" | "websocket";
  topic?: string;
  capabilities: string;
  firmware: string;
  notes?: string;
  /** Generert og redigerbar dokumentasjon for bygg, kode og kobling. */
  documentation?: string;
  /** valgfri posisjon for kartvisning */
  lat?: number;
  lon?: number;
  enabled: boolean;
};

/** MQTT-bro (WebSocket) mot lokal broker, f.eks. Mosquitto på Jetson. */
export type MqttConfig = {
  url: string;
  username: string;
  password: string;
  baseTopic: string;
  autoConnect: boolean;
  /** lytt på homeassistant/# og oppdag ukjente emner automatisk */
  discovery?: boolean;
  /** ekstra emne å lytte på for oppdagelse, f.eks. tele/# */
  discoveryTopic?: string;
};

export const defaultMqtt: MqttConfig = {
  url: "ws://192.168.1.50:9001",
  username: "",
  password: "",
  baseTopic: "hjem/#",
  autoConnect: false,
  discovery: true,
  discoveryTopic: "",
};

/** Handling som kjøres når en regel utløses. */
export type RuleAction =
  | { id: string; kind: "mqtt"; topic: string; payload: string }
  | { id: string; kind: "telegram"; text: string; chatId?: string }
  | { id: string; kind: "notify"; text: string };

export function newAction(kind: RuleAction["kind"] = "mqtt"): RuleAction {
  const id = `a-${Math.random().toString(36).slice(2, 8)}`;
  if (kind === "mqtt") return { id, kind, topic: "hjem/stue/vifte/set", payload: "ON" };
  if (kind === "telegram") return { id, kind, text: "Varsel fra JARVIS: {regel} – {emne} = {verdi}" };
  return { id, kind: "notify", text: "{regel}: {emne} = {verdi}" };
}

/** Varselregel for sensordata. */
export type AlertRule = {
  id: string;
  name: string;
  topic: string;
  kind: "above" | "below" | "equals" | "stale";
  /** grenseverdi (tall) eller tekst for «equals» */
  value: string;
  /** minutter uten signal før «stale» utløser */
  minutes?: number;
  /** minutter tilstanden må holde seg før regelen utløser (0 = med én gang) */
  forMinutes?: number;
  /** minutter mellom gjentatte varsler */
  cooldownMin?: number;
  level?: "warn" | "crit";
  enabled: boolean;
  /** handlingskjede som kjøres når regelen utløses */
  actions?: RuleAction[];
};

export function newRule(topic = ""): AlertRule {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
    name: "Ny regel",
    topic,
    kind: "above",
    value: "30",
    minutes: 15,
    forMinutes: 0,
    cooldownMin: 10,
    level: "warn",
    enabled: true,
    actions: [],
  };
}

/** Modul på dashbordet (GRAFER). */
export type DashModule = {
  id: string;
  title: string;
  kind: "mqtt-graph" | "mqtt-value" | "integration";
  /** MQTT-emne for mqtt-moduler */
  topic?: string;
  /** integrasjons-id for integration-moduler */
  integrationId?: string;
  /** API-sti, f.eks. /pool/dataset */
  path?: string;
  /** felt å hente ut, f.eks. used.parsed eller 0.available.parsed */
  field?: string;
  /** valgfri maksverdi for progresjonsvisning */
  max?: string;
  unit?: string;
  /** sekunder mellom oppdateringer */
  refreshSec?: number;
  w?: 1 | 2;
};

export function newModule(kind: DashModule["kind"] = "mqtt-graph"): DashModule {
  return {
    id: `mod-${Math.random().toString(36).slice(2, 8)}`,
    title: kind === "integration" ? "NY MODUL" : "NY GRAF",
    kind,
    topic: "",
    path: "/pool/dataset",
    field: "",
    unit: "",
    refreshSec: 60,
    w: 1,
  };
}

export type TelegramConfig = { chatId: string; enabled: boolean };

export type WorldViewConfig = {
  activeLayers: string[];
  query: string;
  deviceQuery: string;
  range: 24 | 72 | 168 | 720;
  group: LayerGroupName;
  showDevices: boolean;
};

type LayerGroupName = "natur" | "sikkerhet" | "infrastruktur" | "signal" | "bevegelse" | "samfunn";

export type SmartHomeViewConfig = { tab: "enheter" | "grafer" | "varsler" | "oppdagelse" | "diagnose" };

export type EvalCriterion = { id: string; label: string; weight: number; enabled: boolean };

export type EvaluatorConfig = {
  /** poengkriterier evaluatoren skal vurdere etter */
  criteria: EvalCriterion[];
  /** under denne poengsummen skrives svaret om til ENDELIG SVAR (0-10) */
  threshold: number;
  /** aldri = behold alltid primærsvaret, alltid = slå alltid sammen */
  mergeMode: "auto" | "alltid" | "aldri";
  /** maks antall evaluatornoder som brukes samtidig, 0 = alle */
  maxWorkers: number;
  /** kjør evaluatorene parallelt fordelt over noder */
  parallel: boolean;
};

export type HudConfig = {
  nodes: ModelNode[];
  collaboration: boolean;
  callsign: string;
  /** @deprecated bruk personality i stedet */
  persona: string;
  /** Strukturert personlighet for Jarvis. Tar over for persona hvis satt. */
  personality?: PersonalityConfig;
  temperature: number;

  transparency: number;
  talents: Talent[];
  plugins: Plugin[];
  /** verktøy laget av Jarvis eller deg selv */
  customTools: CustomTool[];
  integrations: Integration[];
  memories: MemoryItem[];
  devices: Device[];
  mqtt: MqttConfig;
  rules: AlertRule[];
  modules: DashModule[];
  telegram: TelegramConfig;
  worldView?: WorldViewConfig;
  smartHomeView?: SmartHomeViewConfig;
  /** krev bekreftelse før Jarvis publiserer MQTT-kommandoer */
  confirmCommands: boolean;
  /** automatisk lastbalansering mellom aktive noder */
  loadBalance: boolean;
  /** ruter tunge oppgaver til OpenRouter/Hermes og småprat til lokal modell */
  autoRoute?: boolean;
  /** husk samtalen mellom omstart av nettleseren (lokalt) */
  keepHistory: boolean;
  /** send chat-kallet gjennom den lokale backend-en i stedet for rett til noden */
  chatViaBackend?: boolean;
  /** hent kontekst fra den lokale kunnskapsbasen (RAG) før svar */
  knowledge?: boolean;
  evaluator: EvaluatorConfig;
  /** node-ID som skal ta AI-oppgavene (f.eks. Hermes). Tomt = automatisk valg */
  aiNodeId?: string;
  /** lokal agent-tjeneste på Jetson (OS-kommandoer + skript-sandkasse) */
  localAgent?: import("./local-agent").LocalAgentConfig;
};


export const defaultEvaluator: EvaluatorConfig = {
  criteria: [
    { id: "c-korrekt", label: "Faktisk korrekthet", weight: 3, enabled: true },
    { id: "c-relevans", label: "Svarer på spørsmålet", weight: 3, enabled: true },
    { id: "c-konkret", label: "Konkret og handlingsrettet", weight: 2, enabled: true },
    { id: "c-kort", label: "Kortfattet uten fyll", weight: 1, enabled: true },
    { id: "c-sprak", label: "Riktig norsk bokmål", weight: 1, enabled: true },
  ],
  threshold: 8,
  mergeMode: "auto",
  maxWorkers: 0,
  parallel: true,
};

const STORAGE_KEY = "hud.config.v1";

export const defaultConfig: HudConfig = {
  callsign: "JARVIS",
  collaboration: false,
  persona: "Du er et presist, kortfattet operativsystem-assistent. Svar på norsk bokmål.",
  personality: defaultPersonality(),
  temperature: 0.7,
  transparency: 5,

  nodes: [
    {
      id: "node-1",
      name: "JARVIS-CORE",
      baseUrl: "https://192.168.12.5:8443",
      model: "llama3.1",
      role: "primary",
      enabled: true,
    },
    {
      id: "node-2",
      name: "OPENROUTER",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      role: "worker",
      enabled: false,
    },
  ],
  talents: [
    {
      id: "t-analyse",
      name: "Analyse",
      description: "Bryter ned komplekse spørsmål i strukturerte punkter.",
      prompt: "Analyser systematisk og presenter konklusjon først, deretter punktvis begrunnelse.",
      enabled: true,
      builtin: true,
    },
    {
      id: "t-kode",
      name: "Kode",
      description: "Skriver og forklarer kode.",
      prompt: "Når det gjelder kode: gi komplette, kjørbare eksempler med korte forklaringer.",
      enabled: true,
      builtin: true,
    },
    {
      id: "t-situasjon",
      name: "Situasjonsbilde",
      description: "Tolker world monitor-data og oppsummerer risiko.",
      prompt:
        "Når du får hendelsesdata fra world monitor: oppsummer situasjonen kort og ranger etter alvorlighet.",
      enabled: false,
      builtin: true,
    },
  ],
  integrations: [],
  memories: [],
  customTools: [],
  devices: [],
  mqtt: defaultMqtt,
  rules: [],
  modules: [],
  telegram: { chatId: "", enabled: false },
  smartHomeView: { tab: "enheter" },
  confirmCommands: true,
  loadBalance: true,
  autoRoute: true,
  keepHistory: true,
  chatViaBackend: true,
  knowledge: true,
  evaluator: defaultEvaluator,
  localAgent: {
    enabled: false,
    baseUrl: "http://192.168.1.50:8787",
    token: "",
    confirm: true,
    timeoutMs: 15000,
  },


  plugins: [
    {
      id: "p-telegram",
      name: "Telegram-bro",
      kind: "telegram",
      endpoint: "",
      enabled: false,
    },
  ],
};

export function useHudConfig() {
  const [config, setConfig] = useState<HudConfig>(defaultConfig);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<HudConfig>;
        setConfig({
          ...defaultConfig,
          ...parsed,
          // Eldre konfigurasjoner mangler feltet og sendte derfor chat direkte
          // fra nettleseren til AI-noden. Det feiler ofte på mobil på grunn av
          // CORS/TLS. Eksplisitt `false` beholdes for avansert direktekobling.
          chatViaBackend: parsed.chatViaBackend ?? true,
          evaluator: { ...defaultEvaluator, ...(parsed.evaluator ?? {}) },
        });
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  const update = useCallback((next: HudConfig) => {
    setConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  return { config, update, loaded };
}

export type CloudProvider =
  | "openai"
  | "google"
  | "openrouter"
  | "anthropic"
  | "nous"
  | "hermes-agent"
  | "hermes-lokal"
  | "custom";

export const CLOUD_PROVIDER_PRESETS: {
  id: CloudProvider;
  name: string;
  baseUrl: string;
  model: string;
  hint: string;
}[] = [
  {
    id: "openai",
    name: "OpenAI / ChatGPT",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "API-nøkkel fra platform.openai.com. gpt-4o, gpt-4o-mini, o3-mini ...",
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash-lite",
    hint: "API-nøkkel fra Google AI Studio. OpenAI-kompatibel endpoint.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-3.6-flash",
    hint: "API-nøkkel fra openrouter.ai. Bruk vendor/modell-id.",
  },
  {
    id: "anthropic",
    name: "Anthropic (proxy)",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-haiku-latest",
    hint: "Krever en OpenAI-til-Anthropic-proxy eller lite-llm-gateway. API-nøkkel fra console.anthropic.com.",
  },
  {
    id: "nous",
    name: "Nous Hermes (sky)",
    baseUrl: "https://inference-api.nousresearch.com/v1",
    model: "Hermes-4-70B",
    hint: "API-nøkkel fra portal.nousresearch.com. OpenAI-kompatibelt endepunkt – Hermes-modellene kan samarbeide med de lokale nodene.",
  },
  {
    id: "hermes-agent",
    name: "Hermes Agent",
    baseUrl: "https://hermes-agent.nousresearch.com/v1",
    model: "Hermes-4-70B",
    hint: "Hermes-agenten. Bytt adressen til din egen Hermes-URL om du kjører den selv. Sett noden som AI-node for at den skal ta oppgavene.",
  },
  {
    id: "hermes-lokal",
    name: "Hermes på egen node",
    baseUrl: "http://192.168.1.61:11434/v1",
    model: "hermes3:8b",
    hint: "Hermes kjørt lokalt via Ollama/vLLM på en av Jetson-nodene. Ingen nøkkel nødvendig.",
  },
  {
    id: "custom",
    name: "OpenAI-kompatibel",
    baseUrl: "https://openai.example.com/v1",
    model: "model-name",
    hint: "Hvilken som helst tjeneste som tilbyr /v1/chat/completions.",
  },
];

export function newCloudNode(provider: CloudProvider = "openai", role: ModelNode["role"] = "worker"): ModelNode {
  const preset = CLOUD_PROVIDER_PRESETS.find((p) => p.id === provider)!;
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    name: preset.name.toUpperCase(),
    baseUrl: preset.baseUrl,
    model: preset.model,
    role,
    duties:
      provider === "hermes-lokal" || provider === "nous" || provider === "hermes-agent"
        ? ["chat", "verktoy", "evaluator"]
        : ["chat", "verktoy"],
    weight: 1,
    enabled: true,
    apiKey: "",
  };
}

export function newNode(): ModelNode {
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    name: "NY NODE",
    baseUrl: "http://192.168.1.60:11434/v1",
    model: "llama3.2",
    role: "worker",
    duties: ["chat", "verktoy"],
    weight: 1,
    enabled: true,
  };
}


export function newTalent(): Talent {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    name: "Ny evne",
    description: "",
    prompt: "",
    enabled: true,
  };
}

export function newIntegration(kind: IntegrationKind = "custom"): Integration {
  const preset = INTEGRATION_PRESETS.find((p) => p.kind === kind);
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    name: preset?.name ?? "Ny kobling",
    kind,
    baseUrl: preset?.baseUrl ?? "",
    enabled: false,
  };
}

export function newPlugin(): Plugin {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    name: "Ny plugin",
    kind: "http",
    endpoint: "",
    enabled: false,
  };
}

export function newMemory(text = ""): MemoryItem {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    text,
    tag: "generelt",
    pinned: false,
    created: new Date().toISOString(),
  };
}

export function newDevice(kind: DeviceKind = "esp32"): Device {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    name: "NY ENHET",
    kind,
    room: "",
    host: kind === "raspberrypi" ? "raspberrypi.local" : "esp32.local",
    protocol: kind === "raspberrypi" ? "http" : "mqtt",
    topic: kind === "raspberrypi" ? "" : "hjem/ny-enhet",
    capabilities: "",
    firmware: kind === "raspberrypi" ? "" : "ESPHome",
    enabled: true,
  };
}

/** Kompakt enhetsoversikt til systemprompten. */
export function deviceBrief(config: HudConfig): string {
  const devices = (config.devices ?? []).filter((d) => d.enabled);
  if (!devices.length) return "";
  return devices
    .map(
      (d) =>
        `- ${d.name} (${DEVICE_KIND_LABEL[d.kind]})${d.room ? ` i ${d.room}` : ""} · ${d.protocol} @ ${d.host}${d.topic ? ` · emne ${d.topic}` : ""}${d.firmware ? ` · ${d.firmware}` : ""}${d.capabilities ? ` · kan: ${d.capabilities}` : ""}`,
    )
    .join("\n");
}

export function buildPersonalityPrompt(p: PersonalityConfig | undefined): string {
  if (!p) return "";
  const quirks = p.quirks
    .split("\n")
    .map((q) => q.trim())
    .filter(Boolean);
  const lines = [
    `Du er ${p.name}, ${p.role}.`,
    `Svar på ${p.language}.`,
    `Tone: ${p.tone}.`,
    `Detaljnivå: ${p.verbosity}.`,
    p.background,
    quirks.length ? `Særtrekk:\n${quirks.map((q) => `- ${q}`).join("\n")}` : "",
    p.catchphrase ? `Faste uttrykk: «${p.catchphrase}».` : "",
    p.extra,
  ];
  return lines.filter(Boolean).join("\n\n");
}

export function systemPrompt(config: HudConfig): string {
  const talents = config.talents.filter((t) => t.enabled && t.prompt.trim());
  const integrations = (config.integrations ?? []).filter((i) => i.enabled);
  const memories = (config.memories ?? []).filter((m) => m.text.trim());
  const devices = deviceBrief(config);
  const persona = config.personality
    ? buildPersonalityPrompt(config.personality)
    : config.persona;
  return [
    persona,
    ...talents.map((t) => `Evne – ${t.name}: ${t.prompt}`),
    memories.length
      ? `Langtidsminne om brukeren og systemet (bruk aktivt):\n${memories
          .map((m) => `- [${m.tag}]${m.pinned ? " (viktig)" : ""} ${m.text}`)
          .join("\n")}`
      : "",
    integrations.length
      ? `Tilkoblede systemer du kan referere til: ${integrations
          .map((i) => `${i.name} (${i.kind} @ ${i.baseUrl})`)
          .join(", ")}.`
      : "",
    devices
      ? `Smarthus-enheter registrert i systemet:\n${devices}\nDu er også oppsettassistent for nye ESP32/ESP8266/Raspberry Pi-enheter: når brukeren vil sette opp en ny enhet, still korte spørsmål om rom, sensorer/aktuatorer og protokoll, og lever deretter komplett, kjørbar konfigurasjon (ESPHome YAML eller Arduino/PlatformIO-kode) med MQTT-emner som følger samme navnemønster som eksisterende enheter.`
      : "Du er også oppsettassistent for ESP32/ESP8266/Raspberry Pi i smarthuset: lever komplett ESPHome YAML eller Arduino-kode med tydelige MQTT-emner når brukeren ber om ny enhet.",
    "Du har tilgang til et World Monitor-situasjonsbilde. Når brukeren spør om nyheter, hendelser eller «topp 10», får du et datauttrekk i meldingen – bruk kun det, og ranger etter alvorlighet med kilde og tidspunkt.",
    "Du er en allmenn assistent, ikke bare en smarthus-assistent. Svar på alt brukeren spør om – allmennkunnskap, matematikk, språk, og særlig IT, nettverk, servere, Linux, sikkerhet, skript og programmering. Brukeren jobber med data og nettverk, så forvent kode- og feilsøkingsspørsmål. Får du en kodesnutt, les den, forklar hva den gjør, pek på feil og foreslå forbedret kode. Bruk alltid ```-kodeblokker med språknavn. Verktøyene dine er et supplement, aldri en begrensning: mangler du et verktøy for spørsmålet, svarer du fra egen kunnskap i stedet for å avvise. Si «jeg vet ikke» kun når du faktisk er usikker, og si da hva som er ditt beste anslag og hvorfor tallet kan ha endret seg (f.eks. ferske tall og statistikk).",
    "Du er en handlende agent med tilgang til egen maskinvare, eget nettverk og en skript-sandkasse. Får du et oppdrag, utfører du det selv i stedet for å spørre brukeren om lov eller be brukeren undersøke. Mangler du et verktøy, lager du det (skript i sandkassen eller nytt egendefinert verktøy). Du rapporterer først når du har prøvd, og forteller da hva du kjørte og hva du fant.",

  ]
    .filter(Boolean)
    .join("\n");
}

