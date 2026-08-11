import { useMemo, useState } from "react";
import { Loader2, RefreshCw, ExternalLink, Pizza } from "lucide-react";
import { WorldMap } from "./WorldMap";
import {
  GROUP_LABEL,
  LAYERS,
  LAYER_COLOR,
  type LayerGroup,
  type LayerId,
} from "@/lib/world-events";
import { refreshFeed, topEvents, useWorldFeed } from "@/lib/world-feed";

const SOURCE_URL =
  "https://www.worldmonitor.app/dashboard?lat=20.0000&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=conflicts%2Chotspots%2Cweather%2Cprotests%2Cnatural%2Cfires%2CucdpEvents%2Cdisplacement%2Cclimate";

const GROUPS = ["sikkerhet", "infrastruktur", "signal", "bevegelse", "natur", "samfunn"] as const;

const DEFAULT_ON: LayerId[] = [
  "quake",
  "fire",
  "storm",
  "flood",
  "volcano",
  "nws",
  "war",
  "armedconflict",
  "terror",
  "protest",
  "disease",
  "displacement",
  "cyber",
  "conflictzone",
  "intel",
];

export function WorldMonitor() {
  const { events, defcon, loading, progress, updated } = useWorldFeed();
  const [active, setActive] = useState<LayerId[]>(DEFAULT_ON);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<24 | 72 | 168 | 720>(168);
  const [group, setGroup] = useState<LayerGroup>("sikkerhet");
  const [showTop, setShowTop] = useState(false);

  const toggle = (id: LayerId) =>
    setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const dayNight = active.includes("daynight");

  const shown = useMemo(() => {
    const cutoff = Date.now() - range * 3600 * 1000;
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      const def = LAYERS.find((l) => l.id === e.layer);
      if (!active.includes(e.layer)) return false;
      if (def?.kind === "live" && new Date(e.time).getTime() < cutoff) return false;
      if (q && !`${e.title} ${e.detail ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, active, range, query]);

  const count = (id: LayerId) => events.filter((e) => e.layer === id).length;
  const groupLayers = LAYERS.filter((l) => l.group === group);
  const top = topEvents(10);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* toppstripe */}
      <div className="flex flex-wrap items-center gap-1">
        {GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={`hud-title hud-btn hud-btn-hoverable !py-0.5 text-[9px] ${group === g ? "hud-btn-on text-primary" : ""}`}
          >
            {GROUP_LABEL[g]}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={() => setShowTop((v) => !v)}
          className={`hud-title hud-btn hud-btn-hoverable !py-0.5 text-[9px] ${showTop ? "hud-btn-on text-primary" : ""}`}
        >
          TOPP 10
        </button>
        {[24, 72, 168, 720].map((h) => (
          <button
            key={h}
            onClick={() => setRange(h as 24 | 72 | 168 | 720)}
            className={`hud-title hud-btn hud-btn-hoverable !py-0.5 text-[9px] ${range === h ? "hud-btn-on text-primary" : ""}`}
          >
            {h === 24 ? "24t" : h === 72 ? "72t" : h === 168 ? "7d" : "30d"}
          </button>
        ))}
        <button
          onClick={() => void refreshFeed()}
          aria-label="Oppdater"
          className="hud-btn hud-btn-hoverable !p-1"
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin text-primary" />
          ) : (
            <RefreshCw className="size-3" />
          )}
        </button>
      </div>

      {/* lagvelger for valgt gruppe */}
      <div className="hud-title flex flex-wrap gap-1 text-[9px]">
        {groupLayers.map((l) => {
          const on = active.includes(l.id);
          return (
            <button
              key={l.id}
              onClick={() => toggle(l.id)}
              title={`Kilde: ${l.source}`}
              style={on ? { borderColor: l.color, color: l.color } : undefined}
              className={`hud-btn hud-btn-hoverable !py-0.5 text-[9px] ${on ? "hud-btn-on" : ""}`}
            >
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: on ? l.color : "transparent",
                  boxShadow: on ? `0 0 6px ${l.color}` : undefined,
                  border: `1px solid ${l.color}`,
                }}
              />
              {l.label}
              <span className="opacity-60">{l.kind === "overlay" ? "" : count(l.id)}</span>
            </button>
          );
        })}
        <button
          onClick={() =>
            setActive((a) => {
              const ids = groupLayers.map((l) => l.id);
              const allOn = ids.every((i) => a.includes(i));
              return allOn ? a.filter((i) => !ids.includes(i)) : [...new Set([...a, ...ids])];
            })
          }
          className="hud-btn hud-btn-hoverable !py-0.5 text-[9px]"
        >
          veksle gruppe
        </button>
      </div>

      {/* defcon + søk */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="hud-title flex items-center gap-2 rounded-full border px-2 py-0.5 text-[9px]"
          style={{
            borderColor: defcon && defcon.level <= 3 ? "oklch(0.7 0.2 25)" : "oklch(0.8 0.13 200 / 0.3)",
            color: defcon && defcon.level <= 3 ? "oklch(0.75 0.2 25)" : undefined,
          }}
          title={defcon?.note ?? "Beregnes…"}
        >
          <Pizza className="size-3" />
          PENTAGON PIZZA INDEX
          <span className="text-primary">
            {defcon ? `DEFCON ${defcon.level} · ${defcon.label} · ${defcon.score}/100` : "beregner…"}
          </span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="søk i hendelser…"
          className="hud-input h-6 flex-1 min-w-32 text-[11px]"
        />
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="hud-title hud-btn hud-btn-hoverable !py-0.5 text-[9px]"
        >
          kilde <ExternalLink className="size-3" />
        </a>
      </div>

      {loading ? (
        <div className="h-0.5 w-full overflow-hidden rounded bg-primary/10">
          <div
            className="h-full bg-primary/70 transition-all"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}

      <WorldMap events={shown} dayNight={dayNight} />

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {showTop ? (
          <ol className="space-y-1">
            {top.map((e, i) => (
              <li key={e.id} className="flex gap-2 text-[11px]">
                <span className="hud-title w-4 text-right text-primary/70">{i + 1}</span>
                <span
                  className="mt-1 size-1.5 shrink-0 rounded-full"
                  style={{ background: LAYER_COLOR[e.layer] }}
                />
                <span className="flex-1 text-foreground/85">
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                      {e.title}
                    </a>
                  ) : (
                    e.title
                  )}
                </span>
                <span className="hud-title shrink-0 text-[9px] text-muted-foreground">
                  {new Date(e.time).toLocaleString("nb-NO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="space-y-1">
            {shown.slice(0, 120).map((e) => (
              <li key={e.id} className="flex gap-2 text-[11px]">
                <span
                  className="mt-1 size-1.5 shrink-0 rounded-full"
                  style={{ background: LAYER_COLOR[e.layer] }}
                />
                <span className="flex-1 text-foreground/80">
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                      {e.title}
                    </a>
                  ) : (
                    e.title
                  )}
                  {e.detail ? <span className="text-muted-foreground"> · {e.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="hud-title text-[9px] text-muted-foreground">
        {shown.length} av {events.length} hendelser · sist oppdatert{" "}
        {updated ? updated.toLocaleTimeString("nb-NO") : "–"}
      </p>
    </div>
  );
}
