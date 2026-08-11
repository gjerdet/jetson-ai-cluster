import { useMemo, useState } from "react";
import { Loader2, RefreshCw, ExternalLink, Pizza, X } from "lucide-react";
import { WorldMap, type MapMarker } from "./WorldMap";
import { DEVICE_KIND_LABEL, type HudConfig } from "@/lib/hud-store";
import {
  GROUP_LABEL,
  LAYERS,
  LAYER_COLOR,
  type LayerGroup,
  type LayerId,
} from "@/lib/world-events";
import { refreshFeed, topEvents, useWorldFeed } from "@/lib/world-feed";
import type { WorldEvent } from "@/lib/world-events";
import { DeviceDetailDialog } from "./DeviceDetailDialog";

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

export function WorldMonitor({ config, update }: { config?: HudConfig; update?: (c: HudConfig) => void }) {
  const { events, defcon, loading, progress, updated } = useWorldFeed();
  const saved = config?.worldView;
  const [active, setActiveRaw] = useState<LayerId[]>((saved?.activeLayers as LayerId[] | undefined) ?? DEFAULT_ON);
  const [query, setQueryRaw] = useState(saved?.query ?? "");
  const [range, setRangeRaw] = useState<24 | 72 | 168 | 720>(saved?.range ?? 168);
  const [group, setGroupRaw] = useState<LayerGroup>(saved?.group ?? "sikkerhet");
  const [showTop, setShowTop] = useState(false);
  const [showDevices, setShowDevicesRaw] = useState(saved?.showDevices ?? true);
  const [devQuery, setDevQueryRaw] = useState(saved?.deviceQuery ?? "");
  const [pickedDevice, setPickedDevice] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorldEvent | null>(null);
  const [showDefcon, setShowDefcon] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const persist = (p: Partial<NonNullable<HudConfig["worldView"]>>) => config && update?.({ ...config, worldView: { activeLayers: active, query, deviceQuery: devQuery, range, group, showDevices, ...p } });
  const setActive = (v: LayerId[] | ((a: LayerId[]) => LayerId[])) => setActiveRaw((a) => { const n = typeof v === "function" ? v(a) : v; persist({ activeLayers: n }); return n; });

  const devices = useMemo(() => (config?.devices ?? []).filter((d) => d.enabled), [config?.devices]);
  const devMatches = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    if (!q) return [];
    return devices.filter((d) => `${d.name} ${d.topic ?? ""} ${d.host ?? ""}`.toLowerCase().includes(q)).slice(0, 8);
  }, [devices, devQuery]);
  const markers: MapMarker[] = useMemo(
    () =>
      showDevices
        ? devices
            .filter((d) => typeof d.lat === "number" && typeof d.lon === "number")
            .map((d) => ({
              id: d.id,
              name: d.name,
              lat: d.lat as number,
              lon: d.lon as number,
              detail: `${DEVICE_KIND_LABEL[d.kind]} · ${d.topic ?? d.host ?? ""}`,
            }))
        : [],
    [devices, showDevices],
  );

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

  // nyhets-/live-hendelser først, statiske markører krøller ikke listen
  const feedList = useMemo(() => {
    const live = shown.filter((e) => LAYERS.find((l) => l.id === e.layer)?.kind === "live");
    return (live.length ? live : shown).slice(0, 200);
  }, [shown]);

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
            onClick={() => { setGroupRaw(g); persist({ group: g }); }}
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
            onClick={() => { const n = h as 24 | 72 | 168 | 720; setRangeRaw(n); persist({ range: n }); }}
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

      {/* kartlag: linjer + egne enheter */}
      <div className="hud-title flex flex-wrap items-center gap-1 text-[9px]">
        <span className="text-muted-foreground">KART:</span>
        {(["cable", "pipeline", "trade"] as LayerId[]).map((id) => {
          const l = LAYERS.find((x) => x.id === id)!;
          const on = active.includes(id);
          return (
            <button
              key={id}
              onClick={() => toggle(id)}
              style={on ? { borderColor: l.color, color: l.color } : undefined}
              className={`hud-btn hud-btn-hoverable !py-0.5 text-[9px] ${on ? "hud-btn-on" : ""}`}
            >
              {l.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowDevicesRaw((v) => { persist({ showDevices: !v }); return !v; })}
          className={`hud-btn hud-btn-hoverable !py-0.5 text-[9px] ${showDevices ? "hud-btn-on text-primary" : ""}`}
        >
          enheter ({markers.length})
        </button>
        <input
          value={devQuery}
          onChange={(e) => { setDevQueryRaw(e.target.value); persist({ deviceQuery: e.target.value }); }}
          placeholder="finn enhet…"
          className="hud-input h-6 w-40 text-[11px]"
        />
        {devMatches.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setShowDevices(true);
              setPickedDevice(d.id);
            }}
            className={`hud-btn hud-btn-hoverable !py-0.5 text-[9px] ${pickedDevice === d.id ? "hud-btn-on text-primary" : ""}`}
          >
            {d.name}
            {typeof d.lat === "number" ? "" : " (mangler posisjon)"}
          </button>
        ))}
      </div>

      {/* defcon + søk */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="hud-title flex items-center gap-2 rounded-full border px-2 py-0.5 text-[9px]"
          style={{
            borderColor: defcon && defcon.level <= 3 ? "oklch(0.7 0.2 25)" : "oklch(0.8 0.13 200 / 0.3)",
            color: defcon && defcon.level <= 3 ? "oklch(0.75 0.2 25)" : undefined,
          }}
          title={defcon?.note ?? "Beregnes…"}
          onClick={() => setShowDefcon(true)}
        >
          <Pizza className="size-3" />
          PENTAGON PIZZA INDEX
          <span className="text-primary">
            {defcon ? `DEFCON ${defcon.level} · ${defcon.label} · ${defcon.score}/100` : "beregner…"}
          </span>
        </button>
        <input
          value={query}
          onChange={(e) => { setQueryRaw(e.target.value); persist({ query: e.target.value }); }}
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

      <WorldMap events={shown} dayNight={dayNight} fill markers={markers} highlightId={pickedDevice} onSelect={setSelected} onMarkerSelect={setPickedDevice} onRouteSelect={setSelectedRoute} />

      {selected || selectedRoute ? <div className="absolute inset-x-3 bottom-24 z-20 rounded border border-primary/30 bg-background/90 p-3 text-xs shadow-xl"><button className="absolute right-2 top-2" onClick={() => { setSelected(null); setSelectedRoute(null); }} aria-label="Lukk detalj"><X className="size-4" /></button><p className="hud-title pr-6 text-[10px] text-primary">{selected?.title ?? selectedRoute}</p>{selected?.detail ? <p className="mt-1 text-muted-foreground">{selected.detail}</p> : null}{selected ? <p className="mt-1 text-muted-foreground">{new Date(selected.time).toLocaleString("nb-NO")}</p> : null}{selected?.url ? <a className="mt-2 inline-flex items-center gap-1 text-primary hover:underline" href={selected.url} target="_blank" rel="noreferrer">åpne artikkel <ExternalLink className="size-3" /></a> : <p className="mt-2 text-muted-foreground">Ingen ekstern artikkel er tilgjengelig for dette datapunktet.</p>}</div> : null}

      <div className="max-h-[32%] shrink-0 overflow-auto pr-1" style={{ minHeight: 96 }}>
        {showTop ? (
          <ol className="space-y-1">
            {top.map((e, i) => (
              <li key={e.id} className="flex cursor-pointer gap-2 text-[11px] hover:text-primary" onClick={() => setSelected(e)}>
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
                    <button onClick={() => setSelected(e)}>{e.title}</button>
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
            {feedList.map((e) => (
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
      <DeviceDetailDialog device={(config?.devices ?? []).find((d) => d.id === pickedDevice) ?? null} onClose={() => setPickedDevice(null)} />
      {showDefcon ? <div className="absolute inset-4 z-30 overflow-auto rounded border border-primary/30 bg-background/95 p-5"><button className="absolute right-3 top-3" onClick={() => setShowDefcon(false)} aria-label="Lukk Pentagon Pizza Index"><X className="size-4" /></button><h3 className="hud-title text-sm text-primary">PENTAGON PIZZA INDEX</h3>{defcon ? <><p className="mt-2 text-2xl text-primary">DEFCON {defcon.level} · {defcon.score}/100</p><p className="text-sm">{defcon.label}</p><div className="mt-4 space-y-2">{defcon.signals.map((s) => <div key={s.name} className="border-b border-primary/15 pb-2"><p className="hud-title text-[9px] text-muted-foreground">{s.name} · vekt {s.weight}</p><p>{s.value}</p></div>)}</div><p className="mt-4 text-xs text-muted-foreground">{defcon.note}</p><p className="mt-2 text-[10px] text-muted-foreground">Oppdatert {new Date(defcon.updated).toLocaleString("nb-NO")}</p></> : <p className="mt-3 text-muted-foreground">Indeksen beregnes fortsatt. Prøv oppdater igjen.</p>}</div> : null}
    </div>
  );
}
