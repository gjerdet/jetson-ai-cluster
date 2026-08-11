import { createServerFn } from "@tanstack/react-start";
import type { DefconReading, WorldEvent } from "./world-events";

export const getBaseEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorldEvent[]> => {
    const { loadBaseEvents } = await import("./world-events.server");
    return await loadBaseEvents();
  },
);

export const getNewsBatch = createServerFn({ method: "GET" })
  .inputValidator((input: { index: number }) => ({ index: Math.max(0, Math.floor(input.index)) }))
  .handler(async ({ data }): Promise<{ events: WorldEvent[]; done: boolean }> => {
    const mod = await import("./world-events.server");
    const size = 3;
    const events = await mod.loadNewsBatch(data.index, size);
    const done = (data.index + 1) * size >= mod.NEWS_LAYERS.length;
    return { events, done };
  });

export const getDefcon = createServerFn({ method: "GET" }).handler(
  async (): Promise<DefconReading> => {
    const { loadDefcon } = await import("./world-events.server");
    return await loadDefcon();
  },
);
