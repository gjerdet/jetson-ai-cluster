import { useEffect, useState } from "react";

/** Én chat-forespørsel slik lastbalansereren rutet den. */
export type RoutingEntry = {
  t: number;
  oppgave: string;
  nodeId?: string;
  nodeNavn: string;
  model?: string;
  ms?: number;
  hoppetOver?: { node: string; feil: string }[];
  feil?: string;
};

const LS = "jarvis.routing.log";
const MAX = 50;

let log: RoutingEntry[] = load();
const subs = new Set<() => void>();

function load(): RoutingEntry[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS) : null;
    return raw ? (JSON.parse(raw) as RoutingEntry[]) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage?.setItem(LS, JSON.stringify(log.slice(0, MAX)));
  } catch {
    /* lagring er valgfri */
  }
}

/** Registrer hvilken node som tok en forespørsel. */
export function logRouting(e: Omit<RoutingEntry, "t">) {
  log = [{ t: Date.now(), ...e }, ...log].slice(0, MAX);
  persist();
  subs.forEach((f) => f());
}

export function clearRouting() {
  log = [];
  persist();
  subs.forEach((f) => f());
}

export function getRouting() {
  return log;
}

/** Abonner på rutingsloggen i React. */
export function useRoutingLog() {
  const [state, setState] = useState<RoutingEntry[]>(log);
  useEffect(() => {
    const f = () => setState(log);
    subs.add(f);
    f();
    return () => {
      subs.delete(f);
    };
  }, []);
  return state;
}
