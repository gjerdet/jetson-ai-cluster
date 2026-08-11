import { useEffect, useState } from "react";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { WorldMap } from "./WorldMap";
import {
  LAYERS,
  LAYER_COLOR,
  fetchWorldEvents,
  type LayerId,
  type WorldEvent,
} from "@/lib/world-events";

const SOURCE_URL =
  "https://www.worldmonitor.app/dashboard?lat=20.0000&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=conflicts%2Chotspots%2Cweather%2Cprotests%2Cnatural%2Cfires%2CucdpEvents%2Cdisplacement%2Cclimate";

const ALL = LAYERS.map((l) => l.id);

export function WorldMonitor() {
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [active, setActive] = useState<LayerId[]>(ALL);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<24 | 72 | 168>(168);

  const load = () => {
    setLoading(true);
    fetchWorldEvents()
      .then(setEvents)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    const r = setInterval(load, 5 * 60 * 1000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);

  const toggle = (id: LayerId) =>
    setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const cutoff = Date.now() - range * 3600 * 1000;
  const q = query.trim().toLowerCase();
  const shown = events.filter(
    (e) =>
      active.includes(e.layer) &&
      new Date(e.time).getTime() >= cutoff &&
      (!q || e.title.toLowerCase().includes(q)),
  );
  const count = (id: LayerId) => events.filter((e) => e.layer === id).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="hud-title flex flex-wrap gap-1 text-[9px]">
          {LAYERS.map((l) => {
            const on = active.includes(l.id);
            return (
              <button
                key={l.id}
                onClick={() => toggle(l.id)}
                style={on ? { borderColor: LAYER_COLOR[l.id], color: LAYER_COLOR[l.id] } : undefined}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors ${
                  on ? "bg-primary/10" : "border-primary/15 text-muted-foreground"
                }`}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: on ? LAYER_COLOR[l.id] : "transparent", boxShadow: on ? `0 0 6px ${LAYER_COLOR[l.id]}` : undefined, border: `1px solid ${LAYER_COLOR[l.id]}` }}
                />
                {l.label}
                <span className="opacity-60">{count(l.id)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => setActive(active.length === ALL.length ? [] : ALL)}
            className="hud-title rounded border border-primary/25 px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-primary"
          >
            {active.length === ALL.length ? "ingen" : "alle"}
          </button>
          <button
            onClick={load}
            aria-label="Oppdater"
            className="rounded p-1 text-muted-foreground hover:text-primary"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="søk i hendelser…"
          className="hud-input min-w-0 flex-1"
        />
        <div className="hud-title flex gap-1 text-[9px]">
          {([24, 72, 168] as const).map((h) => (
            <button
              key={h}
              onClick={() => setRange(h)}
              className={`rounded border px-1.5 py-1 transition-colors ${
                range === h
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-primary/20 text-muted-foreground hover:text-primary"
              }`}
            >
              {h === 168 ? "7d" : `${h}t`}
            </button>
          ))}
        </div>
      </div>

      <WorldMap events={shown} />

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {loading ? (
            <span className="flex items-center gap-1 text-primary">
              <Loader2 className="size-3 animate-spin" /> henter…
            </span>
          ) : (
            `${shown.length} hendelser · ${range === 168 ? "7 døgn" : `${range} timer`}`
          )}
        </span>
        <span className="font-mono">
          UTC{" "}
          {now
            ? new Intl.DateTimeFormat("nb-NO", {
                timeZone: "UTC",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(now)
            : "--:--:--"}
        </span>
      </div>

      <div className="min-h-24 flex-1 space-y-1 overflow-auto pr-1">
        {shown.slice(0, 200).map((e) => (
          <a
            key={e.id}
            href={e.url ?? SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-start justify-between gap-2 rounded border border-primary/15 bg-primary/[0.03] px-2 py-1 hover:border-primary/40"
          >
            <div className="min-w-0">
              <p
                className="hud-title text-[9px]"
                style={{ color: LAYER_COLOR[e.layer] }}
              >
                {LAYERS.find((l) => l.id === e.layer)?.label}
                {e.magnitude ? ` · M${e.magnitude.toFixed(1)}` : ""}
              </p>
              <p className="truncate text-[11px] text-foreground/85">{e.title}</p>
            </div>
            <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
              {new Intl.DateTimeFormat("nb-NO", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(e.time))}
            </span>
          </a>
        ))}
      </div>

      <a
        href={SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className="hud-title flex items-center gap-1 text-[9px] text-muted-foreground hover:text-primary"
      >
        <ExternalLink className="size-3" /> worldmonitor.app – full visning
      </a>
    </div>
  );
}
