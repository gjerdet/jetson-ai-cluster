import { useEffect, useState, useSyncExternalStore } from "react";
import { pingNode } from "./hud-client";
import type { HudConfig, ModelNode } from "./hud-store";

export type HealthSample = { t: number; ms: number | null };

export type NodeHealth = {
  id: string;
  name: string;
  model: string;
  role: string;
  last: number | null;
  avg: number | null;
  uptime: number; // 0..1 andel vellykkede målinger
  samples: HealthSample[];
};

export type SelfEvent = { id: string; time: number; level: "info" | "warn" | "crit"; text: string };

type HealthState = {
  nodes: Record<string, NodeHealth>;
  events: SelfEvent[];
  lastCheck: number;
  checking: boolean;
};

const KEY = "hud.health.v1";
const WINDOW = 6 * 60 * 60 * 1000;
const MAX = 240;

let state: HealthState = { nodes: {}, events: [], lastCheck: 0, checking: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (p: Partial<HealthState>) => {
  state = { ...state, ...p };
  emit();
};

function load() {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as HealthState;
    const cut = Date.now() - WINDOW;
    const nodes: Record<string, NodeHealth> = {};
    for (const [k, v] of Object.entries(parsed.nodes ?? {})) {
      nodes[k] = { ...v, samples: (v.samples ?? []).filter((s) => s.t > cut) };
    }
    state = { ...state, nodes, events: (parsed.events ?? []).slice(0, 100) };
  } catch {
    /* ignore */
  }
}
load();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, 3000);
}

export function logSelfEvent(level: SelfEvent["level"], text: string) {
  set({
    events: [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, time: Date.now(), level, text },
      ...state.events,
    ].slice(0, 100),
  });
  save();
}

export function clearSelfEvents() {
  set({ events: [] });
  save();
}

function summarize(samples: HealthSample[]): Pick<NodeHealth, "last" | "avg" | "uptime"> {
  const ok = samples.filter((s) => s.ms != null) as { t: number; ms: number }[];
  return {
    last: samples[samples.length - 1]?.ms ?? null,
    avg: ok.length ? Math.round(ok.reduce((a, b) => a + b.ms, 0) / ok.length) : null,
    uptime: samples.length ? ok.length / samples.length : 0,
  };
}

export async function checkNodes(nodes: ModelNode[]) {
  if (state.checking) return;
  set({ checking: true });
  const cut = Date.now() - WINDOW;
  const next: Record<string, NodeHealth> = { ...state.nodes };
  await Promise.all(
    nodes.map(async (n) => {
      const ms = await pingNode(n);
      const prev = next[n.id];
      const samples = [...(prev?.samples ?? []).filter((s) => s.t > cut), { t: Date.now(), ms }].slice(-MAX);
      next[n.id] = {
        id: n.id,
        name: n.name,
        model: n.model,
        role: n.role,
        samples,
        ...summarize(samples),
      };
      const wasUp = prev?.last != null;
      if (ms == null && wasUp) logSelfEvent("crit", `${n.name} svarer ikke lenger`);
      if (ms != null && prev && !wasUp) logSelfEvent("info", `${n.name} er tilbake (${ms} ms)`);
      if (ms != null && prev?.avg && ms > prev.avg * 3 && ms > 1500)
        logSelfEvent("warn", `${n.name} er treg: ${ms} ms mot snitt ${prev.avg} ms`);
    }),
  );
  set({ nodes: next, lastCheck: Date.now(), checking: false });
  save();
}

export function useHealth(): HealthState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Starter periodisk selvovervåking så lenge komponenten lever. */
export function useHealthMonitor(config: HudConfig, intervalSec = 60) {
  const nodesRef = useRef(config.nodes);
  nodesRef.current = config.nodes;
  useEffect(() => {
    const run = () => {
      const active = nodesRef.current.filter((n) => n.enabled);
      if (active.length) void checkNodes(active);
    };
    run();
    const t = setInterval(run, intervalSec * 1000);
    return () => clearInterval(t);
  }, [intervalSec]);
}
