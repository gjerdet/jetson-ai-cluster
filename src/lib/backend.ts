/**
 * Klient mot den lokale Jarvis-backend-en på Jetson (agent/server.mjs → /api).
 * Alt går direkte til din egen maskin – ingen sky involvert.
 *
 * Robusthet: tidsavbrudd, automatisk gjenforsøk på nettverksfeil,
 * maskinlesbare feilkoder og norske brukertekster fra den delte kontrakten.
 */
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
} from "@/lib/contract";

export type {
  AiConfig,
  KnowledgeDoc,
  KnowledgeHit,
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
};

const LS_URL = "jarvis.backend.url";
const LS_TOKEN = "jarvis.backend.token";

/**
 * Innloggingstokenet ligger i minnet + sessionStorage – aldri i localStorage.
 * Da forsvinner det når fanen lukkes, og et eventuelt XSS-script kan ikke
 * hente det ut av varig lagring.
 */
let memToken: string | null = null;

const ss = () => (typeof sessionStorage !== "undefined" ? sessionStorage : null);

export const backendUrl = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem(LS_URL)) || `http://127.0.0.1:${DEFAULTS.port}`;

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

function networkError(e: unknown): BackendError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return new BackendError(ERROR_CODES.TIMEOUT, undefined, 0);
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
    o: { baseUrl?: string; model?: string; nodeId?: string; oppgave?: string } = {},
  ) =>
    call<AiChatReply>(
      ROUTES.aiChat!,
      { method: "POST", body: JSON.stringify({ meldinger, ...o }) },
      { timeoutMs: 180_000, retries: 0 },
    ),
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
      { timeoutMs: 60_000, retries: 0 },
    ),
  hentRagConfig: () =>
    call<{ config: RagConfig; statistikk: { dokumenter: number; biter: number; vektorer: number } }>(
      ROUTES.knowledgeConfig!,
    ),
  lagreRagConfig: (v: Partial<RagConfig>) =>
    call<{ config: RagConfig }>(ROUTES.knowledgeConfig!, { method: "PUT", body: JSON.stringify(v) }, { retries: 0 }),
  reindekserKunnskap: () =>
    call<{ oppdatert: number; totalt: number; model: string }>(
      ROUTES.knowledgeReindex!,
      { method: "POST" },
      { timeoutMs: 300_000, retries: 0 },
    ),

  samtaler: () => call<{ samtaler: ThreadSummary[] }>(ROUTES.threads!).then((r) => r.samtaler),
  lagreSamtale: (t: { id?: string; tittel: string; meldinger: unknown[] }) =>
    call(ROUTES.threads!, { method: "POST", body: JSON.stringify(t) }),
  hentSamtale: (id: string) => call<{ samtale: { id: string; meldinger: unknown[] } }>(`${ROUTES.threads}/${id}`),
  slettSamtale: (id: string) => call(`${ROUTES.threads}/${id}`, { method: "DELETE" }),
};
