/**
 * Klient mot den lokale Jarvis-backend-en på Jetson (agent/server.mjs → /api).
 * Alt går direkte til din egen maskin – ingen sky involvert.
 */

const LS_URL = "jarvis.backend.url";
const LS_TOKEN = "jarvis.backend.token";

export type BackendUser = { id: string; email: string; role: string; created?: number };

export type BackendStatus = {
  ok: boolean;
  versjon: string;
  vert: string;
  oppetidSek: number;
  brukere: number;
  trengerOppsett: boolean;
  mqtt: { tilkoblet: boolean; url?: string; aktiv?: boolean; emner?: string[]; kjente?: number };
  regler: { antall: number; aktive: number; sisteHendelser: RuleEvent[] };
  emner: number;
};

export type RuleAction = { type: "mqtt" | "telegram" | "logg"; emne?: string; payload?: string; tekst?: string };
export type BackendRule = {
  id?: string;
  navn: string;
  aktiv: boolean;
  emne: string;
  operator: "over" | "under" | "lik" | "endres";
  verdi: string | number;
  pauseSek: number;
  handlinger: RuleAction[];
  sistUtlost?: number;
};
export type RuleEvent = {
  id: string;
  tid: number;
  regel: string;
  emne: string;
  verdi: unknown;
  handling: string;
  tekst?: string;
  feil?: string;
};
export type Sample = { t: number; e: string; v?: number; s?: string };
export type SampleSummary = { emne: string; antall: number; min: number; maks: number; snitt: number; siste: number; tid: number };

export const backendUrl = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem(LS_URL)) || "http://127.0.0.1:8787";
export const backendToken = () => (typeof localStorage !== "undefined" ? localStorage.getItem(LS_TOKEN) : null);
export const setBackendUrl = (url: string) => localStorage.setItem(LS_URL, url.replace(/\/+$/, ""));
export const setBackendToken = (token: string | null) =>
  token ? localStorage.setItem(LS_TOKEN, token) : localStorage.removeItem(LS_TOKEN);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = backendToken();
  const res = await fetch(`${backendUrl()}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401) setBackendToken(null);
    throw new Error(data.error || `Backend svarte ${res.status}`);
  }
  return data as T;
}

export const backend = {
  status: () => call<BackendStatus>("/status"),

  login: async (epost: string, passord: string) => {
    const r = await call<{ token: string; user: BackendUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ epost, passord }),
    });
    setBackendToken(r.token);
    return r.user;
  },

  register: async (epost: string, passord: string, rolle?: string) => {
    const r = await call<{ token?: string; user: BackendUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ epost, passord, rolle }),
    });
    if (r.token) setBackendToken(r.token);
    return r.user;
  },

  me: () => call<{ user: BackendUser }>("/auth/me").then((r) => r.user),
  logout: async () => {
    try {
      await call("/auth/logout", { method: "POST" });
    } finally {
      setBackendToken(null);
    }
  },
  brukere: () => call<{ brukere: BackendUser[] }>("/brukere").then((r) => r.brukere),
  slettBruker: (id: string) => call(`/brukere/${encodeURIComponent(id)}`, { method: "DELETE" }),
  byttPassord: (passord: string, brukerId?: string) =>
    call("/auth/passord", { method: "POST", body: JSON.stringify({ passord, brukerId }) }),

  hentConfig: () => call<{ versjon: number; data: unknown; oppdatert?: number }>("/config"),
  lagreConfig: (data: unknown) => call("/config", { method: "PUT", body: JSON.stringify({ data }) }),

  hentAi: () => call<{ baseUrl: string; model: string; apiKey: string; system: string }>("/ai"),
  lagreAi: (v: Record<string, unknown>) => call("/ai", { method: "PUT", body: JSON.stringify(v) }),

  maalinger: (p: { emne?: string; fra?: number; til?: number; maks?: number } = {}) => {
    const q = new URLSearchParams();
    if (p.emne) q.set("emne", p.emne);
    if (p.fra) q.set("fra", String(p.fra));
    if (p.til) q.set("til", String(p.til));
    if (p.maks) q.set("maks", String(p.maks));
    return call<{ antall: number; rader: Sample[]; oppsummering: SampleSummary[] }>(`/maalinger?${q}`);
  },
  loggMaaling: (emne: string, verdi: unknown) =>
    call("/maalinger", { method: "POST", body: JSON.stringify({ emne, verdi }) }),
  sisteMaalinger: () =>
    call<{ emner: Record<string, { value: unknown; time: number }> }>("/maalinger/siste").then((r) => r.emner),

  hentRegler: () => call<{ regler: BackendRule[]; status: BackendStatus["regler"] }>("/regler"),
  lagreRegler: (regler: BackendRule[]) => call("/regler", { method: "PUT", body: JSON.stringify({ regler }) }),
  reglerLogg: () => call<{ hendelser: RuleEvent[] }>("/regler/logg").then((r) => r.hendelser),

  hentMqtt: () => call<{ url: string; topics: string[]; enabled: boolean }>("/mqtt"),
  lagreMqtt: (v: { url?: string; topics?: string[]; enabled?: boolean }) =>
    call("/mqtt", { method: "PUT", body: JSON.stringify(v) }),
  publiser: (emne: string, payload: string) =>
    call("/mqtt/publiser", { method: "POST", body: JSON.stringify({ emne, payload }) }),

  hentTelegram: () =>
    call<{ enabled: boolean; token: string; chatIds: number[]; allowlist: boolean }>("/telegram"),
  lagreTelegram: (v: Record<string, unknown>) => call("/telegram", { method: "PUT", body: JSON.stringify(v) }),
  testTelegram: (tekst: string, chatId?: number) =>
    call("/telegram/test", { method: "POST", body: JSON.stringify({ tekst, chatId }) }),

  samtaler: () =>
    call<{ samtaler: { id: string; tittel: string; oppdatert: number; antall: number }[] }>("/samtaler").then(
      (r) => r.samtaler,
    ),
  lagreSamtale: (t: { id?: string; tittel: string; meldinger: unknown[] }) =>
    call("/samtaler", { method: "POST", body: JSON.stringify(t) }),
  hentSamtale: (id: string) => call<{ samtale: { id: string; meldinger: unknown[] } }>(`/samtaler/${id}`),
  slettSamtale: (id: string) => call(`/samtaler/${id}`, { method: "DELETE" }),
};
