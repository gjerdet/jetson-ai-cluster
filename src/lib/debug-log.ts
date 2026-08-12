import { useEffect, useState } from "react";

/**
 * Feilsøkingsmodus: full sporing av hva Jarvis gjorde og hvorfor.
 *
 * Alt lagres lokalt (localStorage) – ingen sky. Loggen er gruppert i «turer»:
 * én tur = én melding fra deg til ferdig svar, med alle runder, verktøykall,
 * ruting og beslutninger imellom.
 */

export type DebugKind =
  | "melding"
  | "ruting"
  | "prompt"
  | "runde"
  | "beslutning"
  | "verktoy"
  | "dult"
  | "svar"
  | "feil";

export type DebugEntry = {
  t: number;
  turId: string;
  kind: DebugKind;
  title: string;
  /** hvorfor Jarvis gjorde dette – kjernen i feilsøkingen */
  why?: string;
  detail?: string;
  ms?: number;
  ok?: boolean;
};

const LS = "jarvis.debug.log";
const FLAG = "jarvis.debug.on";
const MAX = 400;

let log: DebugEntry[] = load();
let on = loadFlag();
const subs = new Set<() => void>();

function load(): DebugEntry[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS) : null;
    return raw ? (JSON.parse(raw) as DebugEntry[]) : [];
  } catch {
    return [];
  }
}

function loadFlag(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function persist() {
  try {
    localStorage?.setItem(LS, JSON.stringify(log.slice(0, MAX)));
  } catch {
    /* lagring er valgfri */
  }
  subs.forEach((f) => f());
}

export function debugOn() {
  return on;
}

export function setDebug(v: boolean) {
  on = v;
  try {
    localStorage?.setItem(FLAG, v ? "1" : "0");
  } catch {
    /* valgfritt */
  }
  subs.forEach((f) => f());
}

export function nyTur(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Skriv en linje i feilsøkingsloggen. Ignoreres når modusen er av. */
export function trace(e: Omit<DebugEntry, "t">) {
  if (!on) return;
  const kutt = (s?: string) => (s && s.length > 4000 ? `${s.slice(0, 4000)}\n… (kuttet)` : s);
  log = [
    {
      t: Date.now(),
      ...e,
      ...(e.detail ? { detail: kutt(e.detail)! } : {}),
      ...(e.why ? { why: kutt(e.why)! } : {}),
    },
    ...log,
  ].slice(0, MAX);
  persist();
}

export function clearDebug() {
  log = [];
  persist();
}

export function getDebug() {
  return log;
}

/** Grupper loggen i turer, nyeste først. */
export function groupDebug(entries: DebugEntry[]) {
  const order: string[] = [];
  const map = new Map<string, DebugEntry[]>();
  for (const e of entries) {
    if (!map.has(e.turId)) {
      map.set(e.turId, []);
      order.push(e.turId);
    }
    map.get(e.turId)!.push(e);
  }
  return order.map((id) => ({
    turId: id,
    entries: [...(map.get(id) ?? [])].sort((a, b) => a.t - b.t),
  }));
}

export function debugExport(): string {
  return JSON.stringify({ eksportert: new Date().toISOString(), linjer: log }, null, 2);
}

export function useDebugLog() {
  const [state, setState] = useState<{ entries: DebugEntry[]; on: boolean }>({
    entries: log,
    on,
  });
  useEffect(() => {
    const f = () => setState({ entries: log, on });
    subs.add(f);
    f();
    return () => {
      subs.delete(f);
    };
  }, []);
  return state;
}
