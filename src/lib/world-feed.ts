import { useEffect, useState } from "react";
import type { DefconReading, WorldEvent } from "./world-events";
import { getBaseEvents, getDefcon, getNewsBatch } from "./world-events.functions";

type FeedState = {
  events: WorldEvent[];
  defcon: DefconReading | null;
  loading: boolean;
  progress: number; // 0..1
  updated: Date | null;
};

let state: FeedState = { events: [], defcon: null, loading: false, progress: 0, updated: null };
const listeners = new Set<(s: FeedState) => void>();
let running = false;

function set(patch: Partial<FeedState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

function merge(incoming: WorldEvent[]) {
  const map = new Map(state.events.map((e) => [e.id, e]));
  for (const e of incoming) map.set(e.id, e);
  set({ events: [...map.values()].sort((a, b) => (a.time < b.time ? 1 : -1)), updated: new Date() });
}

export async function refreshFeed() {
  if (running) return;
  running = true;
  set({ loading: true, progress: 0 });
  const deadline = Date.now() + 45_000;
  try {
    merge(await getBaseEvents());
    set({ progress: 0.2 });
    getDefcon()
      .then((d) => set({ defcon: d }))
      .catch(() => undefined);

    for (let i = 0; ; i++) {
      const res = await getNewsBatch({ data: { index: i } });
      merge(res.events);
      set({ progress: Math.min(0.99, 0.2 + (i + 1) * 0.12) });
      if (res.done) break;
      if (i > 12) break;
      if (Date.now() > deadline) break;
    }
    set({ progress: 1 });
  } catch {
    /* behold det vi har */
  } finally {
    set({ loading: false });
    running = false;
  }
}


export function useWorldFeed() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    if (!state.events.length && !running) void refreshFeed();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/** Nåværende hendelser uten React – brukes av chat-briefingen. */
export function snapshot(): FeedState {
  return state;
}

export function topEvents(limit = 10): WorldEvent[] {
  const weight: Record<string, number> = {
    war: 10,
    armedconflict: 10,
    terror: 9,
    nuclear: 9,
    radiation: 8,
    military: 7,
    cii: 7,
    internet: 6,
    cyber: 6,
    gps: 6,
    sanctions: 6,
    displacement: 6,
    disease: 6,
    protest: 5,
    quake: 5,
    nws: 4,
    fuel: 4,
    ship: 4,
    aviation: 4,
    volcano: 4,
    storm: 3,
    flood: 3,
    fire: 3,
    climate: 3,
  };
  const now = Date.now();
  return [...state.events]
    .filter((e) => weight[e.layer] !== undefined)
    .map((e) => {
      const ageH = Math.max(0, (now - new Date(e.time).getTime()) / 3600000);
      // demp skjelv-dominans: bare uvanlig kraftige skjelv får bonus
      const mag = e.magnitude && e.magnitude > 5.5 ? (e.magnitude - 5.5) * 1.5 : 0;
      const news = e.url ? 1.5 : 0;
      return { e, score: (weight[e.layer] ?? 1) + mag + news - ageH * 0.05 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}

export function briefingText(limit = 10): string {
  const s = state;
  const list = topEvents(limit)
    .map((e, i) => {
      const t = new Date(e.time).toLocaleString("nb-NO");
      return `${i + 1}. [${e.layer}] ${e.title} (${t})${e.url ? ` – ${e.url}` : ""}`;
    })
    .join("\n");
  const defcon = s.defcon
    ? `Pentagon Pizza Index (proxy): nivå ${s.defcon.level} – ${s.defcon.label} (score ${s.defcon.score}/100). ${s.defcon.signals.map((x) => `${x.name}: ${x.value}`).join("; ")}`
    : "Pentagon Pizza Index: ikke tilgjengelig.";
  return `WORLD MONITOR – topp ${limit} hendelser (${new Date().toLocaleString("nb-NO")}):\n${list}\n\n${defcon}`;
}

/** Søk i World Monitor-hendelsene på fritekst og/eller lag. Brukes av chat-verktøyet world_sok. */
export function searchEvents(q: string, opts: { lag?: string; antall?: number } = {}): WorldEvent[] {
  const needle = q.trim().toLowerCase();
  const lag = (opts.lag ?? "").trim().toLowerCase();
  const n = Math.max(1, Math.min(opts.antall ?? 10, 40));
  return state.events
    .filter((e) => (!lag || e.layer.toLowerCase() === lag) &&
      (!needle ||
        e.title.toLowerCase().includes(needle) ||
        (e.detail ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, n);
}

/** Tekstlig svar til chat: søketreff formatert med tid, lag og kilde. */
export function searchText(q: string, opts: { lag?: string; antall?: number } = {}): string {
  const treff = searchEvents(q, opts);
  if (!treff.length) return `Ingen treff i World Monitor for «${q}»${opts.lag ? ` i laget ${opts.lag}` : ""}.`;
  return treff
    .map((e, i) => {
      const t = new Date(e.time).toLocaleString("nb-NO");
      return `${i + 1}. [${e.layer}] ${e.title} (${t})${e.url ? ` – ${e.url}` : ""}`;
    })
    .join("\n");
}
