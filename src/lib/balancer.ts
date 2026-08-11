import { callNode, type ChatMsg } from "./hud-client";
import type { ModelNode, NodeDuty } from "./hud-store";
import { healthSnapshot, logSelfEvent } from "./health";

/**
 * Automatisk lastbalansering mellom noder.
 * Ingen manuell konfigurasjon: noder som er aktivert blir automatisk
 * med i poolen, og oppgaver rutes til den noden som er minst belastet
 * og raskest akkurat nå.
 */

const inflight = new Map<string, number>();
const lastMs = new Map<string, number>();
const failures = new Map<string, { count: number; until: number }>();

const COOLDOWN = 60_000;

export function poolStatus(nodes: ModelNode[]) {
  const health = healthSnapshot();
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    inflight: inflight.get(n.id) ?? 0,
    lastMs: lastMs.get(n.id) ?? null,
    avgMs: health.nodes[n.id]?.avg ?? null,
    cooling: (failures.get(n.id)?.until ?? 0) > Date.now(),
  }));
}

/** Noder som er aktive og har fått ansvar for denne oppgavetypen. */
export function dutyPool(nodes: ModelNode[], duty?: NodeDuty): ModelNode[] {
  const active = nodes.filter((n) => n.enabled);
  if (!duty) return active;
  const matching = active.filter((n) => !n.duties?.length || n.duties.includes(duty));
  // Ingen node er satt opp for oppgaven? Da brukes alle, så ingenting stopper opp.
  return matching.length ? matching : active;
}

function cost(n: ModelNode): number {
  const busy = inflight.get(n.id) ?? 0;
  const weight = Math.max(1, n.weight ?? 1);
  const health = healthSnapshot().nodes[n.id];
  const latency = lastMs.get(n.id) ?? health?.avg ?? health?.last ?? 800;
  const penalty = (failures.get(n.id)?.until ?? 0) > Date.now() ? 100_000 : 0;
  return (busy * 10_000 + latency) / weight + penalty;
}

/** Velger den best egnede noden i poolen akkurat nå. */
export function pickNode(nodes: ModelNode[], duty?: NodeDuty): ModelNode | undefined {
  const pool = dutyPool(nodes, duty);
  if (!pool.length) return undefined;
  return pool.slice().sort((a, b) => cost(a) - cost(b))[0];
}

function markOk(node: ModelNode, ms: number) {
  lastMs.set(node.id, ms);
  failures.delete(node.id);
}

function markFail(node: ModelNode) {
  const prev = failures.get(node.id)?.count ?? 0;
  failures.set(node.id, { count: prev + 1, until: Date.now() + COOLDOWN });
  logSelfEvent("warn", `${node.name} feilet – tas ut av rotasjon i 60 s`);
}

/** Kjører ett kall på en gitt node med belastningstelling. */
export async function callTracked(node: ModelNode, messages: ChatMsg[]): Promise<string> {
  inflight.set(node.id, (inflight.get(node.id) ?? 0) + 1);
  const t0 = performance.now();
  try {
    const out = await callNode(node, messages);
    markOk(node, Math.round(performance.now() - t0));
    return out;
  } catch (e) {
    markFail(node);
    throw e;
  } finally {
    inflight.set(node.id, Math.max(0, (inflight.get(node.id) ?? 1) - 1));
  }
}

/**
 * Kjører et kall på den minst belastede noden, med automatisk failover
 * til neste node hvis en node svarer feil.
 */
export async function callBalanced(
  nodes: ModelNode[],
  messages: ChatMsg[],
  opts?: { prefer?: ModelNode; duty?: NodeDuty },
): Promise<{ text: string; node: ModelNode }> {
  const pool = dutyPool(nodes, opts?.duty);
  if (!pool.length) throw new Error("Ingen aktive noder");
  const order: ModelNode[] = [];
  if (opts?.prefer && opts.prefer.enabled) order.push(opts.prefer);
  for (const n of pool.slice().sort((a, b) => cost(a) - cost(b))) {
    if (!order.some((o) => o.id === n.id)) order.push(n);
  }
  let lastErr: unknown;
  for (const node of order) {
    try {
      const text = await callTracked(node, messages);
      return { text, node };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Alle noder feilet");
}

/**
 * Fordeler en liste oppgaver utover alle tilgjengelige noder samtidig.
 * Hver node tar en ny oppgave så snart den er ledig.
 */
export async function mapOverPool<T, R>(
  nodes: ModelNode[],
  items: T[],
  run: (item: T, node: ModelNode) => Promise<R>,
): Promise<R[]> {
  const pool = nodes.filter((n) => n.enabled);
  if (!pool.length) throw new Error("Ingen aktive noder");
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = pool.slice(0, Math.max(1, Math.min(pool.length, items.length))).map(
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index] as T;
        const node = pickNode(pool) ?? (pool[0] as ModelNode);
        inflight.set(node.id, (inflight.get(node.id) ?? 0) + 1);
        try {
          results[index] = await run(item, node);
        } finally {
          inflight.set(node.id, Math.max(0, (inflight.get(node.id) ?? 1) - 1));
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}
