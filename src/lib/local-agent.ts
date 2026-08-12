import type { HudConfig } from "./hud-store";

/** Konfigurasjon for den lokale agent-tjenesten som kjører på Jetson/Pi. */
export type LocalAgentConfig = {
  enabled: boolean;
  baseUrl: string;
  token: string;
  /** krev bekreftelse før Jarvis kjører kommandoer/skript */
  confirm: boolean;
  /** maks kjøretid Jarvis får be om (ms) */
  timeoutMs: number;
};

export const defaultLocalAgent: LocalAgentConfig = {
  enabled: false,
  baseUrl: "http://192.168.1.50:8787",
  token: "",
  confirm: true,
  timeoutMs: 15000,
};

/**
 * Effektiv agent-konfigurasjon.
 *
 * Er ikke «LOKAL AGENT» satt opp eksplisitt, faller vi tilbake til backend-en
 * du allerede er logget inn på (samme tjeneste på Jetson kjører sandkassen).
 * Da virker nett_sjekk/nett_skann uten ekstra oppsett.
 */
export function agentCfg(config: HudConfig): LocalAgentConfig {
  const cfg = { ...defaultLocalAgent, ...(config.localAgent ?? {}) };
  if (cfg.enabled && cfg.baseUrl) return cfg;
  const url = backendUrl();
  const token = backendToken();
  if (url && token) return { ...cfg, enabled: true, baseUrl: url, token };
  return cfg;
}


export type AgentHealth = {
  ok: boolean;
  host?: string;
  platform?: string;
  uptimeSec?: number;
  loadavg?: number[];
  memFreeMb?: number;
  memTotalMb?: number;
  sandbox?: string;
  network?: boolean;
  maxTimeoutMs?: number;
  allowed?: string[];
};

export type ExecResult = {
  ok?: boolean;
  code?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  ms?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  script?: string;
  lang?: string;
};

export type ScriptFile = { name: string; bytes: number; modified: string };

async function call<T>(
  cfg: LocalAgentConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (cfg.token) headers["authorization"] = `Bearer ${cfg.token}`;
  if (init.body) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(Math.max(cfg.timeoutMs + 5000, 10000)),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Ugyldig svar fra agenten (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data as T;
}

export const agentHealth = (cfg: LocalAgentConfig) => call<AgentHealth>(cfg, "/health");

export const agentExec = (cfg: LocalAgentConfig, cmd: string, args: string[] = []) =>
  call<ExecResult>(cfg, "/exec", {
    method: "POST",
    body: JSON.stringify({ cmd, args, timeoutMs: cfg.timeoutMs }),
  });

export const agentScripts = (cfg: LocalAgentConfig) =>
  call<{ sandbox: string; files: ScriptFile[] }>(cfg, "/scripts");

export const agentReadScript = (cfg: LocalAgentConfig, name: string) =>
  call<{ name: string; content: string }>(cfg, `/scripts/${encodeURIComponent(name)}`);

export const agentWriteScript = (cfg: LocalAgentConfig, name: string, content: string) =>
  call<{ ok: boolean; name: string; bytes: number }>(cfg, "/scripts", {
    method: "POST",
    body: JSON.stringify({ name, content }),
  });

export const agentDeleteScript = (cfg: LocalAgentConfig, name: string) =>
  call<{ ok: boolean; name: string }>(cfg, `/scripts/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

export const agentRun = (
  cfg: LocalAgentConfig,
  opts: { lang: "bash" | "python" | "node"; name?: string; content?: string; args?: string[] },
) =>
  call<ExecResult>(cfg, "/run", {
    method: "POST",
    body: JSON.stringify({ ...opts, timeoutMs: cfg.timeoutMs }),
  });

/** Kompakt tekstform av et kjøreresultat, brukt i verktøysvar til modellen. */
export function formatResult(r: ExecResult): string {
  if (r.error) return `Feil: ${r.error}`;
  const lines = [
    `exit ${r.code ?? "?"}${r.timedOut ? " (tidsavbrudd)" : ""} · ${r.ms ?? 0} ms`,
  ];
  if (r.stdout?.trim()) lines.push(`stdout:\n${r.stdout.trim().slice(0, 4000)}`);
  if (r.stderr?.trim()) lines.push(`stderr:\n${r.stderr.trim().slice(0, 2000)}`);
  if (lines.length === 1) lines.push("(ingen output)");
  return lines.join("\n");
}
