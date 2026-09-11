/**
 * Klient mot den lokale Jarvis-backend-en på Jetson (agent/server.mjs → /api).
 * Alt går direkte til din egen maskin – ingen sky involvert.
 *
 * Robusthet: tidsavbrudd, automatisk gjenforsøk på nettverksfeil,
 * maskinlesbare feilkoder og norske brukertekster fra den delte kontrakten.
 */
import { isPreviewHostname } from "@/lib/preview-hosts";
import {
  DEFAULTS,
  ERROR_CODES,
  ERROR_TEXTS,
  ROUTES,
  codeFromStatus,
  type AiConfig,
  type BackendRule,
  type BackupFile,
  type BackendStatus,
  type BackendUser,
  type ErrorCode,
  type KnowledgeDoc,
  type KnowledgeHit,
  type ClusterHealth,
  type DistributeResult,
  type HealthLevel,
  type NodeHealth,
  type LogSource,
  type LogTail,
  type RagConfig,
  type BackendSettings,
  type ClusterNode,
  type MqttConfig,
  type MqttHealth,
  type MqttStatus,
  type SettingsGroup,
  type RuleEvent,
  type Sample,
  type SampleSummary,
  type TelegramConfig,
  type ThreadSummary,
  type AiChatReply,
  type PoolStatus,
  type ProvisionJob,
  type TtsConfig,
  type VoiceClipStats,
  type VoiceClipVerify,
  type TrainingJob,
  type TrainingQueue,
  type TrainingPlan,
  type TrainingResult,
  type TrainingNodes,
  type TrainingDistribution,
  type PiperSelftest,
  type PiperPreflight,
  type VoiceClip,
  type MemoryItem,
  type Plan,
  type Evaluation,
  type InitiativeSuggestion,
  type GeneratedTool,
  type InitiativeStatus,
  type MemoryStats,
} from "@/lib/contract";

export type {
  VoiceClipStats,
  VoiceClipVerify,
  TrainingJob,
  TrainingQueue,
  TrainingPlan,
  TrainingResult,
  TrainingNodes,
  TrainingDistribution,
  PiperSelftest,
  PiperPreflight,
  AiConfig,
  KnowledgeDoc,
  KnowledgeHit,
  ClusterHealth,
  DistributeResult,
  HealthLevel,
  NodeHealth,
  LogSource,
  LogTail,
  RagConfig,
  BackendSettings,
  ClusterNode,
  MqttHealth,
  SettingsGroup,
  BackendRule,
  BackupFile,
  BackendStatus,
  BackendUser,
  ErrorCode,
  MqttConfig,
  MqttStatus,
  RuleEvent,
  Sample,
  SampleSummary,
  TelegramConfig,
  ThreadSummary,
  AiChatReply,
  PoolStatus,
  ProvisionJob,
  TtsConfig,
  VoiceClip,
  MemoryItem,
  Plan,
  Evaluation,
  InitiativeSuggestion,
  GeneratedTool,
  InitiativeStatus,
  MemoryStats,
};

/** En kjent enhet i brukerens nett (TrueNAS, Proxmox, UniFi, Homey, Jetson …). */
export interface Utstyr {
  id: string;
  navn: string;
  type: string;
  ip: string;
  mac: string;
  vertsnavn: string;
  rolle: string;
  notat: string;
  porter: unknown[];
  fakta: string[];
  sistSett: number;
  opprettet: number;
  kilde: string;
}

export interface UtstyrStats {
  antall: number;
  identifisert: number;
  perType: Record<string, number>;
}

export interface RefleksjonVerktoyStat {
  navn: string;
  kall: number;
  ok: number;
  feil: number;
  treffrate: number;
  snittMs: number;
  sisteFeil: string;
  sistBrukt: number;
}

export interface VerktoyStatsSvar {
  verktoy: RefleksjonVerktoyStat[];
  antallKall: number;
  ustabile: RefleksjonVerktoyStat[];
  laerdommer: { tid: number; tekst: string; kilde: string }[];
}

export interface Refleksjon {
  gikkBra: string;
  gikkDaarlig: string;
  regel: string;
  faktum: string;
  lagret: string[];
}


export interface UpdateStatus {
  aktiv: boolean;
  status: string;
  logg: string;
  klar?: boolean;
  mangler?: string[];
  rettelse?: string | null;
  oppdatert: number;
}

export type BackendToolResult = {
  ok?: boolean;
  code?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  ms?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};

const LS_URL = "jarvis.backend.url";
const LS_TOKEN = "jarvis.backend.token";
export const DEFAULT_BACKEND_URL = "https://192.168.12.5:8443";

/**
 * Innloggingstokenet ligger i minnet + sessionStorage – aldri i localStorage.
 * Da forsvinner det når fanen lukkes, og et eventuelt XSS-script kan ikke
 * hente det ut av varig lagring.
 */
let memToken: string | null = null;

const ss = () => (typeof sessionStorage !== "undefined" ? sessionStorage : null);

/**
 * Standardadressen til agenten når ingenting er lagret.
 *
 * Kjører HUD-en fra agenten selv (f.eks. https://<jetson>:8443, som proxer
 * GUI-et), bruker vi samme opphav. Da slipper vi feil port, blandet innhold
 * (http fra en https-side) og sertifikatspørsmål. Ellers faller vi tilbake til
 * den første Jetson-noden; lagret adresse i GUI-et vinner alltid.
 */
export const standardBackendUrl = (loc?: { hostname?: string; origin?: string }) => {
  const w = typeof window !== "undefined" ? window.location : undefined;
  const hostname = loc?.hostname ?? w?.hostname;
  const origin = loc?.origin ?? w?.origin;
  if (origin && hostname && !isPreviewHostname(hostname)) return origin.replace(/\/+$/, "");
  return DEFAULT_BACKEND_URL;
};

export const backendUrl = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem(LS_URL)) || standardBackendUrl();


export const backendToken = () => {
  if (memToken) return memToken;
  // Rydd bort tokens fra tidligere versjoner som lagret dem varig.
  if (typeof localStorage !== "undefined" && localStorage.getItem(LS_TOKEN)) {
    memToken = localStorage.getItem(LS_TOKEN);
    localStorage.removeItem(LS_TOKEN);
    if (memToken) ss()?.setItem(LS_TOKEN, memToken);
    return memToken;
  }
  memToken = ss()?.getItem(LS_TOKEN) ?? null;
  return memToken;
};

export const setBackendUrl = (url: string) => localStorage.setItem(LS_URL, url.trim().replace(/\/+$/, ""));
export const setBackendToken = (token: string | null) => {
  memToken = token;
  if (token) ss()?.setItem(LS_TOKEN, token);
  else {
    ss()?.removeItem(LS_TOKEN);
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_TOKEN);
  }
};


/** Feil fra backend-en med kode og ferdig norsk tekst. */
export class BackendError extends Error {
  code: ErrorCode;
  status: number;
  detalj: string | undefined;

  /** Sekunder til neste forsøk (kun ved rate-limit). */
  retryAfter: number | undefined;

  constructor(code: ErrorCode, detalj?: string, status = 0, retryAfter?: number) {
    super(detalj?.trim() || ERROR_TEXTS[code] || "Ukjent feil mot backend-en.");
    this.name = "BackendError";
    this.code = code;
    this.status = status;
    this.detalj = detalj;
    this.retryAfter = retryAfter;
  }

  /** Kort forklaring + hva brukeren kan gjøre. */
  get raad(): string {
    switch (this.code) {
      case ERROR_CODES.NETWORK:
        return `Sjekk at agenten kjører (${backendUrl()}) og at maskinen er på samme nett.`;
      case ERROR_CODES.TLS:
        return `Åpne ${backendUrl()}/api/status i en ny fane og godta sertifikatet.`;
      case ERROR_CODES.UNAUTHORIZED:
        return "Logg inn på nytt i BACKEND-fanen.";
      case ERROR_CODES.TIMEOUT:
        return "Prøv igjen – backend-en kan være opptatt eller nettet tregt.";
      case ERROR_CODES.RATE_LIMIT:
        return `Vent ${this.retryAfter ?? 60} sekunder – agenten begrenser antall forespørsler per IP.`;
      case ERROR_CODES.FORBIDDEN:
        return "Har du riktig rolle? Domenet må også stå i AGENT_ORIGINS på agenten.";
      default:
        return "";
    }
  }
}

/** Hendelse andre deler av HUD-en kan lytte på for å vise varsel ved frakobling. */
type Listener = (state: { online: boolean; error: BackendError | null }) => void;
const listeners = new Set<Listener>();
let lastOnline = true;

export function onBackendState(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(online: boolean, error: BackendError | null) {
  if (online === lastOnline && !error) return;
  lastOnline = online;
  listeners.forEach((l) => l({ online, error }));
}

const RETRYABLE: ErrorCode[] = [
  ERROR_CODES.NETWORK,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.SERVER,
  ERROR_CODES.RATE_LIMIT,
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tidspunkt for siste vellykkede kall – brukes til å skille TLS fra avbrutt kall. */
let sisteOkTid = 0;

function networkError(e: unknown): BackendError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return new BackendError(ERROR_CODES.TIMEOUT, undefined, 0);
  // Har backend-en svart oss de siste 10 minuttene, er sertifikatet allerede
  // godtatt i denne nettleseren. Da er dette et avbrutt/feilet enkeltkall –
  // typisk at agenten brukte for lang tid eller lukket forbindelsen.
  if (Date.now() - sisteOkTid < 600_000) {
    return new BackendError(
      ERROR_CODES.NETWORK,
      "Agenten brøt forbindelsen midt i kallet (den svarte fint like før). Sjekk LOGG-panelet eller «journalctl -u jarvis-agent -n 50» på Jetson – ofte tok AI-svaret for lang tid.",
      0,
    );
  }
  if (backendUrl().startsWith("https://")) return new BackendError(ERROR_CODES.TLS, undefined, 0);
  return new BackendError(ERROR_CODES.NETWORK, undefined, 0);
}


async function call<T>(
  path: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const retries = opts.retries ?? 2;
  let siste: BackendError | null = null;

  for (let forsok = 0; forsok <= retries; forsok++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const token = backendToken();
      const res = await fetch(`${backendUrl()}/api${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      if (text) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          if (!res.ok) throw new BackendError(codeFromStatus(res.status), text.slice(0, 200), res.status);
          throw new BackendError(ERROR_CODES.SERVER, "Backend-en svarte med ugyldig JSON.", res.status);
        }
      }
      if (!res.ok) {
        const retryAfter = Number(res.headers.get("retry-after")) || undefined;
        const err = new BackendError(
          codeFromStatus(res.status),
          String(data["error"] ?? ""),
          res.status,
          retryAfter,
        );
        if (err.code === ERROR_CODES.UNAUTHORIZED) setBackendToken(null);
        throw err;
      }
      sisteOkTid = Date.now();
      emit(true, null);
      return data as T;
    } catch (e) {
      const err = e instanceof BackendError ? e : networkError(e);
      siste = err;
      if (!RETRYABLE.includes(err.code) || forsok === retries) break;
      // Ved rate-limit venter vi det agenten ber om (maks 10 s her).
      const vent =
        err.code === ERROR_CODES.RATE_LIMIT
          ? Math.min((err.retryAfter ?? 5) * 1000, 10_000)
          : 400 * 2 ** forsok;
      await sleep(vent);
    } finally {
      clearTimeout(timer);
    }
  }

  emit(false, siste);
  throw siste ?? new BackendError(ERROR_CODES.SERVER);
}

/** Kjør et backend-kall og få `{ data }` eller `{ error }` – uten try/catch i UI-et. */
export async function safe<T>(fn: () => Promise<T>): Promise<{ data: T; error: null } | { data: null; error: BackendError }> {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof BackendError ? e : new BackendError(ERROR_CODES.SERVER, String(e)) };
  }
}

export const backend = {
  status: () => call<BackendStatus>(ROUTES.status!, {}, { timeoutMs: 6000, retries: 1 }),

  login: async (epost: string, passord: string) => {
    const r = await call<{ token: string; user: BackendUser }>(ROUTES.login!, {
      method: "POST",
      body: JSON.stringify({ epost, passord }),
    }, { retries: 0 });
    setBackendToken(r.token);
    return r.user;
  },

  register: async (epost: string, passord: string, rolle?: string) => {
    const r = await call<{ token?: string; user: BackendUser }>(ROUTES.register!, {
      method: "POST",
      body: JSON.stringify({ epost, passord, rolle }),
    }, { retries: 0 });
    if (r.token) setBackendToken(r.token);
    return r.user;
  },

  me: () => call<{ user: BackendUser }>(ROUTES.me!).then((r) => r.user),
  logout: async () => {
    try {
      await call(ROUTES.logout!, { method: "POST" }, { retries: 0 });
    } finally {
      setBackendToken(null);
    }
  },
  nettSjekk: (subnett = "") =>
    call<BackendToolResult>(
      "/verktoy/nett-sjekk",
      { method: "POST", body: JSON.stringify({ subnett }) },
      { timeoutMs: 70_000, retries: 0 },
    ),
  nettSkann: (subnett = "", porter = false) =>
    call<BackendToolResult>(
      "/verktoy/nett-skann",
      { method: "POST", body: JSON.stringify({ subnett, porter }) },
      { timeoutMs: porter ? 190_000 : 100_000, retries: 0 },
    ),
  ping: (host: string, antall = 2, timeout = 5) =>
    call<BackendToolResult>(
      "/verktoy/ping",
      { method: "POST", body: JSON.stringify({ host, antall, timeout }) },
      { timeoutMs: 20_000, retries: 0 },
    ),
  brukere: () => call<{ brukere: BackendUser[] }>(ROUTES.users!).then((r) => r.brukere),
  slettBruker: (id: string) => call(`${ROUTES.users}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  byttPassord: (passord: string, brukerId?: string) =>
    call(ROUTES.password!, { method: "POST", body: JSON.stringify({ passord, brukerId }) }),

  hentConfig: () => call<{ versjon: number; data: unknown; oppdatert?: number }>(ROUTES.config!),
  lagreConfig: (data: unknown) => call(ROUTES.config!, { method: "PUT", body: JSON.stringify({ data }) }),

  hentAi: () => call<AiConfig>(ROUTES.ai!),
  /** Lar backend-en (agenten) snakke med AI-noden – samme vei som Telegram-boten. */
  /** Helsen til AI-poolen slik backend-en ser den (lastbalansering). */
  aiPool: (oppgave = "chat") =>
    call<PoolStatus>(`${ROUTES.aiPool}?oppgave=${encodeURIComponent(oppgave)}`, {}, { timeoutMs: 10_000 }),
  aiChat: (
    meldinger: { role: string; content: string }[],
    o: { baseUrl?: string; model?: string; nodeId?: string; oppgave?: string; apiKey?: string } = {},
  ) =>
    call<AiChatReply>(
      ROUTES.aiChat!,
      { method: "POST", body: JSON.stringify({ meldinger, ...o }) },
      { timeoutMs: 330_000, retries: 0 },
    ),
  /** Tester én AI-node: adresse, nøkkel, modell og at den faktisk svarer. */
  testAi: (o: { baseUrl?: string; model?: string; apiKey?: string } = {}) =>
    call<{
      ok: boolean;
      endpoint?: string;
      model?: string;
      byttetModell?: boolean;
      svar?: string;
      modeller?: string[];
      ms?: number;
      error?: string;
    }>(ROUTES.aiTest!, { method: "POST", body: JSON.stringify(o) }, { timeoutMs: 60_000, retries: 0 }),

  lagreAi: (v: Partial<AiConfig>) => call(ROUTES.ai!, { method: "PUT", body: JSON.stringify(v) }),

  maalinger: (p: { emne?: string; fra?: number; til?: number; maks?: number } = {}) => {
    const q = new URLSearchParams();
    if (p.emne) q.set("emne", p.emne);
    if (p.fra) q.set("fra", String(p.fra));
    if (p.til) q.set("til", String(p.til));
    if (p.maks) q.set("maks", String(p.maks));
    return call<{ antall: number; rader: Sample[]; oppsummering: SampleSummary[] }>(
      `${ROUTES.samples}?${q}`,
      {},
      { timeoutMs: 20_000 },
    );
  },
  loggMaaling: (emne: string, verdi: unknown) =>
    call(ROUTES.samples!, { method: "POST", body: JSON.stringify({ emne, verdi }) }),
  sisteMaalinger: () =>
    call<{ emner: Record<string, { value: unknown; time: number }> }>(ROUTES.samplesLatest!).then((r) => r.emner),

  evaluering: (sporsmal: string, svar: string, verktoy: string[] = []) =>
    call<{ evaluering: any }>("/evalueringer", {
      method: "POST",
      body: JSON.stringify({ sporsmal, svar, verktoy }),
    }),
  hentRegler: () => call<{ regler: BackendRule[]; status: BackendStatus["regler"] }>(ROUTES.rules!),
  lagreRegler: (regler: BackendRule[]) =>
    call<{ regler: BackendRule[] }>(ROUTES.rules!, { method: "PUT", body: JSON.stringify({ regler }) }, { retries: 0 }),
  reglerLogg: () => call<{ hendelser: RuleEvent[] }>(ROUTES.rulesLog!).then((r) => r.hendelser),

  hentMqtt: () => call<MqttConfig & { status?: MqttStatus }>(ROUTES.mqtt!),
  lagreMqtt: (v: Partial<MqttConfig>) => call(ROUTES.mqtt!, { method: "PUT", body: JSON.stringify(v) }, { retries: 0 }),
  publiser: (emne: string, payload: string) =>
    call(ROUTES.mqttPublish!, { method: "POST", body: JSON.stringify({ emne, payload }) }, { retries: 0 }),

  hentMqttHelse: () => call<MqttHealth>(ROUTES.mqttHealth!),

  hentNoder: () =>
    call<{ noder: ClusterNode[]; innstillinger: BackendSettings }>(ROUTES.nodes!),
  lagreNoder: (noder: ClusterNode[]) =>
    call<{ noder: ClusterNode[] }>(ROUTES.nodes!, { method: "PUT", body: JSON.stringify({ noder }) }, { retries: 0 }),
  lagreNode: (node: ClusterNode) =>
    call<{ node: ClusterNode; noder: ClusterNode[] }>(ROUTES.nodes!, { method: "POST", body: JSON.stringify({ node }) }, { retries: 0 }),
  /** Ruller ut nye maskiner over SSH: IP + brukernavn + passord er nok. */
  provisjoner: (v: {
    verter: string[];
    bruker: string;
    passord: string;
    modeller?: string[];
    rolle?: string;
    oppgaver?: string[];
    navnPrefiks?: string;
    master?: string;
    parallelt?: number;
  }) =>
    call<{ jobber: ProvisionJob[] }>(
      ROUTES.provision!,
      { method: "POST", body: JSON.stringify(v) },
      { retries: 0, timeoutMs: 30_000 },
    ),
  provisjonJobber: () => call<{ jobber: ProvisionJob[] }>(ROUTES.provision!).then((r) => r.jobber),

  slettNode: (id: string) =>
    call<{ noder: ClusterNode[] }>(`${ROUTES.nodes}/${encodeURIComponent(id)}`, { method: "DELETE" }, { retries: 0 }),

  hentSkjema: () =>
    call<{ skjema: SettingsGroup[]; verdier: BackendSettings }>(ROUTES.settingsSchema!),
  hentInnstillinger: () => call<{ verdier: BackendSettings }>(ROUTES.settings!),
  lagreInnstillinger: (verdier: BackendSettings) =>
    call<{ verdier: BackendSettings; mqttOmstartet: boolean }>(
      ROUTES.settings!,
      { method: "PUT", body: JSON.stringify({ verdier }) },
      { retries: 0 },
    ),

  hentTelegram: () => call<TelegramConfig>(ROUTES.telegram!),
  lagreTelegram: (v: Partial<TelegramConfig> & { chatIds?: unknown }) =>
    call(ROUTES.telegram!, { method: "PUT", body: JSON.stringify(v) }, { retries: 0 }),
  testTelegram: (tekst: string, chatId?: number) =>
    call(ROUTES.telegramTest!, { method: "POST", body: JSON.stringify({ tekst, chatId }) }, { retries: 0 }),

  hentVersjon: () => call<VersionInfo>(ROUTES.version!, {}, { timeoutMs: 10_000 }),
  hentOppdateringsstatus: () => call<UpdateStatus>(ROUTES.updateStatus!, {}, { timeoutMs: 10_000, retries: 0 }),
  startOppdatering: (ref = "main") =>
    call<{ ok: boolean; ref: string; melding: string }>(
      ROUTES.update!,
      { method: "POST", body: JSON.stringify({ ref }) },
      { timeoutMs: 15_000, retries: 0 },
    ),
  eksporterKonfig: (bare?: string[]) =>
    call<ConfigBundle>(
      bare?.length ? `${ROUTES.configExport}?bare=${encodeURIComponent(bare.join(","))}` : ROUTES.configExport!,
      {},
      { timeoutMs: 30_000 },
    ),
  sjekkKonfig: (pakke: ConfigBundle) =>
    call<ConfigInspect>(
      ROUTES.configImport!,
      { method: "POST", body: JSON.stringify({ pakke, kunSjekk: true }) },
      { retries: 0 },
    ),
  importerKonfig: (pakke: ConfigBundle, o: { modus?: "flett" | "erstatt"; bare?: string[] } = {}) =>
    call<{ ok: boolean; skrevet: string[]; hoppetOver: string[]; sjekksumOk: boolean | null }>(
      ROUTES.configImport!,
      { method: "POST", body: JSON.stringify({ pakke, ...o }) },
      { timeoutMs: 30_000, retries: 0 },
    ),

  hentBackuper: () => call<{ kopier: BackupFile[] }>(ROUTES.backup!).then((r) => r.kopier),
  taBackup: () => call<{ ok: boolean; navn: string }>(ROUTES.backup!, { method: "POST" }, { timeoutMs: 30_000, retries: 0 }),

  // ---- kunnskapsbase (RAG) ----
  hentKunnskap: () =>
    call<{ dokumenter: KnowledgeDoc[]; statistikk: { dokumenter: number; biter: number; vektorer: number; model?: string; feil?: string } }>(
      ROUTES.knowledge!,
    ),
  leggTilKunnskap: (d: { tittel: string; tekst: string; kilde?: string; type?: string }) =>
    call<{ dokument: KnowledgeDoc; biter: number; embedFeil: string | null }>(
      ROUTES.knowledge!,
      { method: "POST", body: JSON.stringify(d) },
      { timeoutMs: 180_000, retries: 0 },
    ),
  slettKunnskap: (id: string) =>
    call<{ ok: boolean }>(`${ROUTES.knowledge}/dok/${encodeURIComponent(id)}`, { method: "DELETE" }, { retries: 0 }),
  sokKunnskap: (sporsmal: string, topK?: number) =>
    call<{ treff: KnowledgeHit[]; metode: string }>(
      ROUTES.knowledgeSearch!,
      { method: "POST", body: JSON.stringify({ sporsmal, topK }) },
      { timeoutMs: 8_000, retries: 0 },
    ),
  hentRagConfig: () =>
    call<{ config: RagConfig; statistikk: { dokumenter: number; biter: number; vektorer: number } }>(
      ROUTES.knowledgeConfig!,
    ),
  lagreRagConfig: (v: Partial<RagConfig>) =>
    call<{ config: RagConfig }>(ROUTES.knowledgeConfig!, { method: "PUT", body: JSON.stringify(v) }, { retries: 0 }),
  // ---- selvlæring: søk på nettet og lær ----
  sokWeb: (sporsmal: string, antall = 5) =>
    call<{ sporsmal: string; treff: { tittel: string; url: string }[] }>(
      ROUTES.knowledgeWebSearch!,
      { method: "POST", body: JSON.stringify({ sporsmal, antall }) },
      { timeoutMs: 30_000, retries: 0 },
    ),
  hentNettsideTilKunnskap: (url: string) =>
    call<{ url: string; tittel: string; tekst: string }>(
      ROUTES.knowledgeFetchUrl!,
      { method: "POST", body: JSON.stringify({ url }) },
      { timeoutMs: 40_000, retries: 0 },
    ),
  laerOm: (tema: string, o: { urler?: string[]; antall?: number } = {}) =>
    call<{
      ok: boolean;
      tema: string;
      laerte: number;
      sokte: boolean;
      kilder: { url: string; tittel: string; tegn: number; biter: number; dokId: string; utdrag: string; feil?: string }[];
      treff: KnowledgeHit[];
    }>(ROUTES.knowledgeLearn!, { method: "POST", body: JSON.stringify({ tema, ...o }) }, { timeoutMs: 240_000, retries: 0 }),

  reindekserKunnskap: () =>
    call<{ oppdatert: number; totalt: number; model: string }>(
      ROUTES.knowledgeReindex!,
      { method: "POST" },
      { timeoutMs: 300_000, retries: 0 },
    ),

  // ---- tale (TTS) ----
  hentTtsConfig: () => call<{ config: TtsConfig }>(ROUTES.ttsConfig!).then((r) => r.config),
  lagreTtsConfig: (v: Partial<TtsConfig>) =>
    call<{ config: TtsConfig }>(ROUTES.ttsConfig!, { method: "PUT", body: JSON.stringify(v) }, { retries: 0 }).then(
      (r) => r.config,
    ),
  hentTtsStemmer: () => call<{ stemmer: string[] }>(ROUTES.ttsVoices!).then((r) => r.stemmer),
  hentKlipp: () => call<{ klipp: VoiceClip[]; statistikk: VoiceClipStats }>(ROUTES.ttsClips!),
  verifiserKlipp: () => call<VoiceClipVerify>(ROUTES.ttsClipsVerify!),
  oppdaterKlipp: (id: string, endring: { tekst?: string; pauset?: boolean }) =>
    call<{ klipp: VoiceClip; statistikk: VoiceClipStats }>(
      `${ROUTES.ttsClips}/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(endring) },
      { retries: 0 },
    ),
  transkriberKlipp: (id: string, overskriv = false) =>
    call<{ klipp: VoiceClip; hoppetOver: boolean }>(
      `${ROUTES.ttsClips}/${encodeURIComponent(id)}/transkriber`,
      { method: "POST", body: JSON.stringify({ overskriv }) },
      { timeoutMs: 180_000, retries: 0 },
    ),
  transkriberAlle: (overskriv = false) =>
    call<{ forsokt: number; ok: number; feilet: number; feil: string[]; statistikk: VoiceClipStats }>(
      ROUTES.ttsClipsTranscribeAll!,
      { method: "POST", body: JSON.stringify({ overskriv }) },
      { timeoutMs: 600_000, retries: 0 },
    ),
  /** Syntetiserer tale og gir tilbake lyden som Blob (for å prøvelytte en modell). */
  taleLyd: async (tekst: string, modell?: string) => {
    const token = backendToken();
    const res = await fetch(`${backendUrl()}/api${ROUTES.tts}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ tekst, modell }),
    });
    if (!res.ok)
      throw new BackendError(ERROR_CODES.SERVER, `Backend svarte ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
    return res.blob();
  },
  treningsko: () => call<TrainingQueue>(ROUTES.ttsTraining!),
  /** Forhåndsviser stier, presets og miljøsjekk før trening startes. */
  treningPlan: (o: { navn?: string; preset?: string } = {}) =>
    call<TrainingPlan>(
      `${ROUTES.ttsTrainingPlan}?navn=${encodeURIComponent(o.navn || "")}&preset=${encodeURIComponent(o.preset || "")}`,
      {},
      { timeoutMs: 40_000, retries: 0 },
    ),
  /** Ber agenten installere Piper-treningsmiljøet på seg selv. */
  installerPiper: () =>
    call<{ jobb: TrainingJob }>(ROUTES.ttsTrainingInstall!, { method: "POST" }, { timeoutMs: 30_000, retries: 0 }),
  /** Kjører automatisert systemtest av Piper-miljøet (venv, stier, piper_train). */
  piperSystemtest: () =>
    call<PiperSelftest>(ROUTES.ttsTrainingSelftest!, { method: "POST" }, { timeoutMs: 120_000, retries: 0 }),
  /** Sjekker JetPack, CUDA og NVIDIA PyTorch før Piper installeres. */
  piperPreflight: () =>
    call<PiperPreflight>(ROUTES.ttsTrainingPreflight!, {}, { timeoutMs: 60_000, retries: 0 }),
  /** Installerer NVIDIA PyTorch for riktig JetPack-versjon som jobb med logg. */
  installerPytorch: () =>
    call<{ jobb: TrainingJob }>(ROUTES.ttsTrainingPytorch!, { method: "POST" }, { timeoutMs: 30_000, retries: 0 }),
  /** Resultatsammendrag per treningsjobb (skår, epoketid, CPU/CUDA). */
  treningResultater: () =>
    call<{ resultater: TrainingResult[] }>(ROUTES.ttsTrainingResults!, {}, { timeoutMs: 30_000, retries: 0 }),
  /** Alle koblede Jetson-noder med JetPack-versjon og treningsstatus. */
  treningNoder: () => call<TrainingNodes>(ROUTES.ttsTrainingNodes!, {}, { timeoutMs: 60_000, retries: 0 }),
  /** Jobbmodus «fordel»: starter samme trening på flere noder samtidig. */
  fordelTrening: (v: { navn?: string; kommando?: string; noder?: string[] }) =>
    call<TrainingDistribution>(
      ROUTES.ttsTrainingDistribute!,
      { method: "POST", body: JSON.stringify(v) },
      { timeoutMs: 120_000, retries: 0 },
    ),
  startTrening: (v: { navn?: string; kommando?: string }) =>
    call<{ jobb: TrainingJob }>(ROUTES.ttsTraining!, { method: "POST", body: JSON.stringify(v) }, { retries: 0 }),
  avbrytTrening: (id: string) =>
    call<{ ok: boolean }>(`${ROUTES.ttsTraining}/${encodeURIComponent(id)}`, { method: "POST" }, { retries: 0 }),
  slettTrening: (id: string) =>
    call<TrainingQueue>(`${ROUTES.ttsTraining}/${encodeURIComponent(id)}`, { method: "DELETE" }, { retries: 0 }),
  publiserTrening: (id: string, modell?: string) =>
    call<{ modell: string }>(
      `${ROUTES.ttsTraining}/${encodeURIComponent(id)}/publiser`,
      { method: "POST", body: JSON.stringify({ modell }) },
      { retries: 0 },
    ),
  leggTilKlipp: (k: { navn: string; tekst: string; lydBase64: string; mime: string; sekunder?: number }) =>
    call<{ klipp: VoiceClip }>(ROUTES.ttsClips!, { method: "POST", body: JSON.stringify(k) }, { timeoutMs: 120_000, retries: 0 }),
  slettKlipp: (id: string) =>
    call<{ ok: boolean }>(`${ROUTES.ttsClips}/${encodeURIComponent(id)}`, { method: "DELETE" }, { retries: 0 }),
  hentTreningssett: () =>
    call<{ manifest: string; mappe: string; statistikk: { antall: number; sekunder: number } }>(ROUTES.ttsManifest!),

  samtaler: () => call<{ samtaler: ThreadSummary[] }>(ROUTES.threads!).then((r) => r.samtaler),
  lagreSamtale: (t: { id?: string; tittel: string; meldinger: unknown[] }) =>
    call(ROUTES.threads!, { method: "POST", body: JSON.stringify(t) }),
  hentSamtale: (id: string) => call<{ samtale: { id: string; meldinger: unknown[] } }>(`${ROUTES.threads}/${id}`),
  slettSamtale: (id: string) => call(`${ROUTES.threads}/${id}`, { method: "DELETE" }),

  /** Klyngehelse: GPU, modeller og tjenester per node. */
  klyngeHelse: (frisk = false) =>
    call<ClusterHealth>(`${ROUTES.clusterHealth}${frisk ? "?frisk=1" : ""}`, {}, { timeoutMs: 25_000 }),

  /** Sender konfig-pakken til alle noder og verifiserer resultatet på hver. */
  distribuerKonfig: (opts: { modus?: "flett" | "erstatt"; bare?: string[]; pakke?: unknown } = {}) =>
    call<DistributeResult>(
      ROUTES.configDistribute!,
      { method: "POST", body: JSON.stringify(opts) },
      { retries: 0, timeoutMs: 60_000 },
    ),

  /** Loggkilder (systemd-tjenester + oppsett.sh/helsesjekk-logger). */
  loggKilder: () => call<{ kilder: LogSource[] }>(ROUTES.logSources!).then((r) => r.kilder),
  hentLogg: (kilde: string, linjer = 300) =>
    call<LogTail>(
      `${ROUTES.logs}?kilde=${encodeURIComponent(kilde)}&linjer=${linjer}`,
      {},
      { timeoutMs: 20_000 },
    ),

  // ---- AGI / autonomi ----
  hentMinneStatistikk: () => call<MemoryStats>(ROUTES.memory!),
  lagreMinne: (m: Partial<MemoryItem>) => call<{ minne: MemoryItem }>(ROUTES.memory!, { method: "POST", body: JSON.stringify(m) }),
  hentMinne: (id: string) => call<{ minne: MemoryItem }>(`${ROUTES.memory}/${id}`),
  slettMinne: (id: string) => call(`${ROUTES.memory}/${id}`, { method: "DELETE" }),
  sokMinne: (q: string, topK = 5) =>
    call<{ treff: MemoryItem[] }>(ROUTES.memoryRecall!, { method: "POST", body: JSON.stringify({ query: q, topK }) }),
  minneTidslinje: (o: { maks?: number; type?: string } = {}) =>
    call<{ minner: MemoryItem[] }>(
      `${ROUTES.memoryTimeline}?maks=${o.maks ?? 50}${o.type ? `&type=${encodeURIComponent(o.type)}` : ""}`,
    ),
  konsoliderMinne: () => call<{ fjernet: number; gjenstaende: number }>(ROUTES.memoryConsolidate!, { method: "POST" }),

  // ---- Utstyrsregister ----
  hentUtstyr: (o: { type?: string; sok?: string } = {}) =>
    call<{ utstyr: Utstyr[]; stats: UtstyrStats }>(
      `${ROUTES.equipment}?${new URLSearchParams({ ...(o.type ? { type: o.type } : {}), ...(o.sok ? { sok: o.sok } : {}) })}`,
    ),
  lagreUtstyr: (e: Partial<Utstyr>) => call<{ enhet: Utstyr }>(ROUTES.equipment!, { method: "POST", body: JSON.stringify(e) }),
  slettUtstyr: (id: string) => call<{ fjernet: number }>(`${ROUTES.equipment}/${id}`, { method: "DELETE" }),
  utstyrFraSkann: (verter: unknown[]) =>
    call<{ nye: number; oppdatert: number; enheter: Utstyr[] }>(ROUTES.equipmentFromScan!, {
      method: "POST",
      body: JSON.stringify({ verter }),
    }),

  // ---- Refleksjon ----
  hentVerktoyStats: () => call<VerktoyStatsSvar>(ROUTES.reflection!),
  reflekter: (b: { oppgave: string; svar?: string; verktoy?: unknown[]; utfall?: string }) =>
    call<Refleksjon>(ROUTES.reflection!, { method: "POST", body: JSON.stringify(b) }, { timeoutMs: 120_000, retries: 0 }),
  registrerUtfall: (b: { oppgave?: string; verktoy?: unknown[]; svar?: string; ok?: boolean }) =>
    call<{ registrert: boolean; nyeRegler: string[] }>(ROUTES.reflectionOutcome!, { method: "POST", body: JSON.stringify(b) }),



  hentPlaner: (aktiv = false) => call<{ planer: Plan[] }>(`${ROUTES.plans}?aktiv=${aktiv ? 1 : 0}`),
  lagPlan: (mål: string, kontekst?: string) =>
    call<{ plan: Plan }>(ROUTES.plans!, { method: "POST", body: JSON.stringify({ mål, kontekst }) }),
  hentPlan: (id: string) => call<{ plan: Plan }>(`${ROUTES.plans}/${id}`),
  avbrytPlan: (id: string) => call<{ plan: Plan }>(`${ROUTES.plans}/${id}`, { method: "DELETE" }),
  gjenopptaPlan: (id: string) => call<{ plan: Plan }>(`${ROUTES.plans}/${id}`, { method: "PATCH", body: JSON.stringify({ status: "aktiv" }) }),
  markerPlanFerdig: (id: string, oppsummering?: string) =>
    call<{ plan: Plan }>(`${ROUTES.plans}/${id}`, { method: "PATCH", body: JSON.stringify({ status: "fullført", oppsummering }) }),
  oppdaterPlanSteg: (planId: string, stegId: string, status: string, resultat?: string) =>
    call<{ plan: Plan }>(ROUTES.planSteps!, {
      method: "POST",
      body: JSON.stringify({ planId, stegId, status, resultat }),
    }),

  hentEvalueringer: () => call<{ evalueringer: Evaluation[]; statistikk: { antall: number; snitt: number; underTerskel: number } }>(ROUTES.evaluations!),
  evaluerSvar: (spørsmål: string, svar: string, verktøy?: unknown[]) =>
    call<{ evaluering: Evaluation }>(ROUTES.evaluations!, {
      method: "POST",
      body: JSON.stringify({ spørsmål, svar, verktøy }),
    }),

  hentInitiativStatus: () => call<InitiativeStatus>(ROUTES.initiative!),
  settInitiativAktiv: (aktiv: boolean) =>
    call<InitiativeStatus>(ROUTES.initiative!, { method: "POST", body: JSON.stringify({ aktiv }) }),
  hentInitiativForslag: () => call<{ forslag: InitiativeSuggestion[] }>(ROUTES.initiativeSuggestions!),
  godkjennForslag: (id: string) =>
    call<{ forslag: InitiativeSuggestion }>(ROUTES.initiativeSuggestions!, {
      method: "POST",
      body: JSON.stringify({ id, godkjenn: true }),
    }),
  avvisForslag: (id: string) =>
    call<{ forslag: InitiativeSuggestion }>(ROUTES.initiativeSuggestions!, {
      method: "POST",
      body: JSON.stringify({ id, avvis: true }),
    }),
  kjorInitiativ: () => call<InitiativeStatus>("/initiativ/kjor", { method: "POST" }),
  hentInitiativAudit: () => call<{ audit: { tid: number; hendelse: string; risiko: string; godkjent: boolean; auto: boolean }[] }>("/initiativ/audit"),

  hentGenererteVerktoy: () => call<{ verktoy: GeneratedTool[] }>(ROUTES.generatedTools!),
  genererVerktoy: (beskrivelse: string) =>
    call<{ verktoy: GeneratedTool }>(ROUTES.generatedTools!, { method: "POST", body: JSON.stringify({ beskrivelse }) }),
  slettGenerertVerktoy: (id: string) => call(`${ROUTES.generatedTools}/${id}`, { method: "DELETE" }),
  aktiverGenerertVerktoy: (id: string, enabled: boolean) =>
    call<{ verktoy: GeneratedTool }>(`${ROUTES.generatedTools}/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  testGenerertVerktoy: (id: string, args: Record<string, unknown> = {}) =>
    call<{ ok: boolean; resultat?: unknown; feil?: string }>(ROUTES.generatedToolTest!, {
      method: "POST",
      body: JSON.stringify({ id, args }),
    }),

  planleggOppgave: (mål: string, kontekst?: string) =>
    call<{ plan: unknown }>("/oppgave/planlegg", {
      method: "POST",
      body: JSON.stringify({ mål, kontekst }),
    }),
  kjorOppgave: (planId: string, maks?: number) =>
    call<{ ok: boolean; resultater: unknown[]; plan: unknown }>("/oppgave/kjor", {
      method: "POST",
      body: JSON.stringify({ planId, maks }),
    }),
  hentOppgaveStatus: (planId: string) =>
    call<{ plan: unknown }>(`/oppgave/status/${encodeURIComponent(planId)}`),
  hentOppgaveListe: () =>
    call<{ planer: unknown[] }>("/oppgave/liste"),
  hentModeller: () =>
    call<{ modeller: string[]; baseUrl: string }>("/modeller"),
  velgModell: (model: string) =>
    call<{ ok: boolean }>("/ai/test", {
      method: "POST",
      body: JSON.stringify({ model }),
    }),
  koeOppgave: (planId: string, prioritet = 0, concurrency = 2) =>
    call<{ queued: boolean; queue: unknown[] }>("/oppgave/koe", {
      method: "POST",
      body: JSON.stringify({ planId, prioritet, concurrency }),
    }),
  hentOppgaveKoe: () =>
    call<{ ko: { items: unknown[]; active: unknown[] } }>("/oppgave/koe"),
  fjernFraKoe: (planId: string) =>
    call<{ fjernet: number }>(`/oppgave/koe/${encodeURIComponent(planId)}`, { method: "DELETE" }),

  // ---- maskin-ID-kort ----
  hentIdentitet: (frisk = false) =>
    call<{ kort: MaskinKort; tekst: string }>(`${ROUTES.identity}${frisk ? "?frisk=1" : ""}`, {}, { timeoutMs: 20_000 }),
  identitetSelvtest: () =>
    call<{ ok: boolean; avvik: string[]; kort: MaskinKort }>(ROUTES.identitySelftest!, { method: "POST" }, { timeoutMs: 25_000, retries: 0 }),

  // ---- kolleger ----
  hentKollegaer: () => call<{ kollegaer: Kollega[] }>(ROUTES.colleagues!).then((r) => r.kollegaer),
  diagnoserKollega: (id = "") =>
    call<{ resultater: KollegaDiagnose[] }>(
      ROUTES.colleagueDiagnose!,
      { method: "POST", body: JSON.stringify({ id }) },
      { timeoutMs: 120_000, retries: 0 },
    ).then((r) => r.resultater),
  delegerTilKollega: (v: { node?: string; oppgave: string; kontekst?: string; runder?: number }) =>
    call<{ ok: boolean; kollega?: string; svar?: string; feil?: string; utveksling: { fra: string; tekst: string; ms?: number }[] }>(
      ROUTES.colleagueDelegate!,
      { method: "POST", body: JSON.stringify(v) },
      { timeoutMs: 300_000, retries: 0 },
    ),

  // ---- utvikling / selvforbedring ----
  hentUtvikling: () => call<Utvikling>(ROUTES.initiative!, {}, { timeoutMs: 20_000 }),
  settUtviklingAktiv: (aktiv: boolean) =>
    call<{ aktiv: boolean }>(ROUTES.initiative!, { method: "PUT", body: JSON.stringify({ aktiv }) }, { retries: 0 }),
  leggIUtviklingsko: (v: { type: string; tekst: string; prioritet?: number; data?: Record<string, unknown> }) =>
    call<{ jobb: KoJobb }>(ROUTES.initiativeQueue!, { method: "POST", body: JSON.stringify(v) }, { retries: 0 }),
  kjorUtvikling: () =>
    call<{ resultat: unknown }>(ROUTES.initiativeRun!, { method: "POST" }, { timeoutMs: 300_000, retries: 0 }),
  rullTilbakeRevisjon: (id: string) =>
    call<{ revisjon: Revisjon }>(ROUTES.initiativeRollback!, { method: "POST", body: JSON.stringify({ id }) }, { retries: 0 }),
  laerRegel: (tekst: string, hvorfor?: string) =>
    call<{ regel: { id: string; tekst: string } | null; duplikat: boolean }>(
      ROUTES.initiativeLearn!,
      { method: "POST", body: JSON.stringify({ tekst, hvorfor }) },
      { retries: 0 },
    ),

  // ---- verktøybibliotek ----
  hentVerktoybibliotek: () =>
    call<{ verktoy: GeneratedTool[]; statistikk: VerktoyStat[] }>(ROUTES.generatedTools!, {}, { timeoutMs: 20_000 }),
  byggVerktoy: (beskrivelse: string, runder = 3) =>
    call<{ ok: boolean; verktoy: GeneratedTool; historikk: { runde: number; ok: boolean; detalj: unknown }[] }>(
      ROUTES.generatedTools!,
      { method: "POST", body: JSON.stringify({ beskrivelse, runder }) },
      { timeoutMs: 600_000, retries: 0 },
    ),
  kjorGenerertVerktoy: (navn: string, args: Record<string, unknown> = {}) =>
    call<{ resultat: unknown }>(
      ROUTES.generatedToolRun!,
      { method: "POST", body: JSON.stringify({ navn, args }) },
      { timeoutMs: 60_000, retries: 0 },
    ),
  /** Kjører et bibliotek-verktøy på en annen Jetson-node via dens agent. */
  kjorVerktoyPaaNode: (nodeId: string, navn: string, args: Record<string, unknown> = {}) =>
    call<{ node: string; via: string; resultat?: unknown }>(
      ROUTES.generatedToolRunNode!,
      { method: "POST", body: JSON.stringify({ nodeId, navn, args }) },
      { retries: 0, timeoutMs: 30_000 },
    ),
  rullTilbakeVerktoy: (id: string) =>
    call<{ verktoy: GeneratedTool }>(ROUTES.generatedToolRollback!, { method: "POST", body: JSON.stringify({ id }) }, { retries: 0 }),
  settVerktoyAktiv: (id: string, aktiv: boolean) =>
    call<{ verktoy: GeneratedTool }>(ROUTES.generatedToolEnable!, { method: "POST", body: JSON.stringify({ id, aktiv }) }, { retries: 0 }),
};

export type MaskinKort = {
  tid: number;
  vert: string;
  modell: string;
  os: string;
  kjerner: number;
  minneMb: number;
  fritt_minne_mb: number;
  oppetidSek: number;
  last: number;
  nett: { grensesnitt: string; ip: string; maske: string; cidr: string; mac: string }[];
  primaerIp: string;
  subnett: string;
  gpu: unknown;
  tjenester: Record<string, unknown> | null;
  modeller: string[];
  lastedeModeller: string[];
  klynge: { id: string; navn?: string; baseUrl: string }[];
};

export type Kollega = {
  id: string;
  navn: string;
  baseUrl: string;
  model: string;
  profil: { snittMs?: number; feil?: number; sistOk?: number; sisteFeiltekst?: string } | null;
};

export type KollegaDiagnose = {
  ok: boolean;
  kollega?: string;
  steg: { navn: string; ok: boolean | null; detalj: string }[];
};

export type KoJobb = {
  id: string;
  tid: number;
  type: string;
  tekst: string;
  prioritet: number;
  status: string;
  resultat?: string;
};

export type Revisjon = {
  id: string;
  tid: number;
  hva: string;
  hvorfor: string;
  resultat: string;
  type: string;
  ref: string;
  tilbakerullet: boolean;
};

export type VerktoyStat = {
  navn: string;
  kall: number;
  feil: number;
  feilrate: number;
  snittMs: number;
  sisteFeil: string;
  sist: number;
};

export type Utvikling = {
  status: {
    aktiv: boolean;
    ledig: boolean;
    sisteChat: number;
    jobberNa: string | null;
    ko: number;
    revisjoner: number;
  };
  ko: KoJobb[];
  revisjoner: Revisjon[];
  regler: { id: string; tid: number; tekst: string }[];
  forslag: InitiativeSuggestion[];
  audit: { tid: number; hendelse: string; risiko: string; godkjent: boolean; auto: boolean }[];
};

export type VersionInfo = {
  agent: string;
  api: string;
  konfigpakke: number;
  konfigVersjon: number;
  konfigOppdatert: number | null;
  node: string;
  vert: string;
  plattform: string;
  oppetidSek: number;
};

export type ConfigBundle = {
  type: string;
  pakkeversjon: number;
  agent?: string;
  api?: string;
  laget?: string;
  vert?: string;
  dokumenter: Record<string, unknown>;
  sjekksum?: string;
};

export type ConfigInspect = {
  dokumenter: string[];
  ukjente: string[];
  sjekksumOk: boolean | null;
  laget: string | null;
  agent: string | null;
};
