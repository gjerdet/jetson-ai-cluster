import { useEffect, useState } from "react";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";

type Event = {
  id: string;
  title: string;
  kind: "quake" | "fire" | "storm" | "flood" | "volcano" | "annet";
  lat: number;
  lon: number;
  time: string;
  magnitude?: number;
};

const KIND_LABEL: Record<Event["kind"], string> = {
  quake: "SKJELV",
  fire: "BRANN",
  storm: "STORM",
  flood: "FLOM",
  volcano: "VULKAN",
  annet: "ANNET",
};

const SOURCE_URL =
  "https://www.worldmonitor.app/dashboard?lat=20.0000&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=conflicts%2Chotspots%2Cweather%2Cprotests%2Cnatural%2Cfires%2CucdpEvents%2Cdisplacement%2Cclimate";

function categoryToKind(id: string): Event["kind"] {
  if (id.includes("wildfire")) return "fire";
  if (id.includes("severeStorms")) return "storm";
  if (id.includes("flood")) return "flood";
  if (id.includes("volcano")) return "volcano";
  return "annet";
}

async function fetchEvents(): Promise<Event[]> {
  const out: Event[] = [];

  const quakes = fetch(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const eonet = fetch("https://eonet.gsfc.nasa.gov/api/v3/events?days=7&status=open&limit=60")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const [q, e] = await Promise.all([quakes, eonet]);

  const qf = (q as { features?: unknown[] } | null)?.features ?? [];
  for (const raw of qf) {
    const f = raw as {
      id: string;
      properties: { title: string; mag: number; time: number };
      geometry: { coordinates: number[] };
    };
    out.push({
      id: `q-${f.id}`,
      title: f.properties.title,
      kind: "quake",
      lon: f.geometry.coordinates[0] ?? 0,
      lat: f.geometry.coordinates[1] ?? 0,
      time: new Date(f.properties.time).toISOString(),
      magnitude: f.properties.mag,
    });
  }

  const ee = (e as { events?: unknown[] } | null)?.events ?? [];
  for (const raw of ee) {
    const ev = raw as {
      id: string;
      title: string;
      categories: { id: string }[];
      geometry: { date: string; coordinates: number[] | number[][] }[];
    };
    const g = ev.geometry?.[ev.geometry.length - 1];
    const c = g?.coordinates;
    const point = Array.isArray(c?.[0]) ? (c as number[][])[0] : (c as number[] | undefined);
    if (!point) continue;
    out.push({
      id: `e-${ev.id}`,
      title: ev.title,
      kind: categoryToKind(ev.categories?.[0]?.id ?? ""),
      lon: point[0] ?? 0,
      lat: point[1] ?? 0,
      time: g?.date ?? new Date().toISOString(),
    });
  }

  return out.sort((a, b) => (a.time < b.time ? 1 : -1));
}

export function WorldMonitor() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Event["kind"] | "alle">("alle");
  const [now, setNow] = useState<Date | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchEvents()
      .then((e) => {
        setEvents(e);
        if (e.length === 0) setError("Ingen hendelser mottatt");
      })
      .catch(() => setError("Fikk ikke kontakt med datakildene"))
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

  const shown = filter === "alle" ? events : events.filter((e) => e.kind === filter);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="hud-title flex flex-wrap gap-1 text-[9px]">
          {(["alle", "quake", "fire", "storm", "flood", "volcano"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded border px-1.5 py-0.5 transition-colors ${
                filter === k
                  ? "border-primary/60 bg-primary/20 text-primary"
                  : "border-primary/20 text-muted-foreground hover:text-primary"
              }`}
            >
              {k === "alle" ? "ALLE" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          aria-label="Oppdater"
          className="rounded p-1 text-muted-foreground hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="relative aspect-[2/1] w-full overflow-hidden rounded border border-primary/25 bg-primary/[0.03]">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.78 0.13 200 / 0.18) 1px, transparent 1px), linear-gradient(90deg, oklch(0.78 0.13 200 / 0.18) 1px, transparent 1px)",
            backgroundSize: "8.33% 12.5%",
          }}
        />
        <svg viewBox="0 0 360 180" className="absolute inset-0 size-full">
          <line
            x1="0"
            y1="90"
            x2="360"
            y2="90"
            stroke="oklch(0.78 0.13 200 / 0.3)"
            strokeWidth="0.5"
          />
          <line
            x1="180"
            y1="0"
            x2="180"
            y2="180"
            stroke="oklch(0.78 0.13 200 / 0.2)"
            strokeWidth="0.5"
          />
          {shown.map((e) => (
            <g key={e.id} transform={`translate(${e.lon + 180}, ${90 - e.lat})`}>
              <circle r="1.6" fill="oklch(0.78 0.13 200 / 0.9)" />
              <circle r="4" fill="none" stroke="oklch(0.78 0.13 200 / 0.4)" strokeWidth="0.4">
                <animate attributeName="r" values="2;7;2" dur="3s" repeatCount="indefinite" />
                <animate
                  attributeName="opacity"
                  values="0.8;0;0.8"
                  dur="3s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          ))}
        </svg>
        <div className="hud-radar-sweep absolute inset-0" />
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {loading ? (
            <span className="flex items-center gap-1 text-primary">
              <Loader2 className="size-3 animate-spin" /> henter…
            </span>
          ) : (
            `${shown.length} hendelser siste 7 døgn`
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

      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}

      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {shown.map((e) => (
          <div
            key={e.id}
            className="flex items-start justify-between gap-2 rounded border border-primary/15 bg-primary/[0.04] px-2 py-1"
          >
            <div className="min-w-0">
              <p className="hud-title text-[9px] text-primary/80">
                {KIND_LABEL[e.kind]}
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
          </div>
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
