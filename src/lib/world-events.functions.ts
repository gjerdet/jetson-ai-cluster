import { createServerFn } from "@tanstack/react-start";
import type { WorldEvent } from "./world-events";

let cache: { at: number; data: WorldEvent[] } | null = null;
let inflight: Promise<WorldEvent[]> | null = null;

const TTL = 10 * 60 * 1000;

function refresh(): Promise<WorldEvent[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { loadWorldEvents } = await import("./world-events.server");
    const data = await loadWorldEvents();
    if (data.length) cache = { at: Date.now(), data };
    return data;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export const getWorldEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorldEvent[]> => {
    if (cache) {
      // serverer siste kjente data med en gang, og oppdaterer i bakgrunnen
      if (Date.now() - cache.at > TTL) void refresh().catch(() => undefined);
      return cache.data;
    }
    return await refresh();
  },
);
