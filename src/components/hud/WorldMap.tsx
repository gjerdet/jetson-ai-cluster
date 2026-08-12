import { useEffect, useMemo, useRef, useState } from "react";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import { Minus, Plus, Maximize, Expand, Shrink } from "lucide-react";
import { LAYER_COLOR, type WorldEvent } from "@/lib/world-events";
import { ROUTES } from "@/lib/world-static";


const W = 720;
const H = 360;
const MIN_Z = 1;
const MAX_Z = 24;

let cache: FeatureCollection<Geometry> | null = null;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Enkel subsolar-beregning for dag/natt-terminatoren. */
function nightPath(): string {
  const now = new Date();
  const day = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const sunLon = 180 - (utcMin / 1440) * 360;
  const pts: string[] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const h = ((lon - sunLon) * Math.PI) / 180;
    const lat =
      (Math.atan(-Math.cos(h) / Math.tan((decl * Math.PI) / 180)) * 180) / Math.PI;
    const x = ((lon + 180) / 360) * W;
    const y = ((90 - lat) / 180) * H;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const closeTop = decl > 0;
  return `M${pts.join(" L")} L${W},${closeTop ? 0 : H} L0,${closeTop ? 0 : H} Z`;
}

export type MapMarker = { id: string; name: string; lat: number; lon: number; detail?: string };

export function WorldMap({
  events,
  onSelect,
  dayNight = false,
  fill = false,
  markers = [],
  highlightId = null,
  onMarkerSelect,
  onRouteSelect,
}: {
  events: WorldEvent[];
  onSelect?: (e: WorldEvent) => void;
  dayNight?: boolean;
  /** fyller tilgjengelig høyde i stedet for fast 2:1-forhold */
  fill?: boolean;
  /** egne markører, f.eks. smarthus-enheter */
  markers?: MapMarker[];
  highlightId?: string | null;
  onMarkerSelect?: (id: string) => void;
  onRouteSelect?: (name: string) => void;
}) {
  const [land, setLand] = useState<FeatureCollection<Geometry> | null>(cache);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);
  const stateRef = useRef({ zoom, offset });
  stateRef.current = { zoom, offset };
  const slice = fill || expanded;
  const sliceRef = useRef(slice);
  sliceRef.current = slice;

  useEffect(() => {
    if (cache) return;
    let alive = true;
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json")
      .then((r) => r.json())
      .then((topo) => {
        const fc = feature(
          topo as never,
          (topo as { objects: { land: unknown } }).objects.land as never,
        ) as unknown as FeatureCollection<Geometry>;
        cache = fc;
        if (alive) setLand(fc);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** Faktisk synlig utsnitt av viewBox, gitt preserveAspectRatio-modus. */
  const view = () => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height)
      return { rect: null as DOMRect | null, s: 1, vw: W, vh: H, x0: 0, y0: 0 };
    const s = sliceRef.current
      ? Math.max(rect.width / W, rect.height / H)
      : Math.min(rect.width / W, rect.height / H);
    const vw = rect.width / s;
    const vh = rect.height / s;
    return { rect, s, vw, vh, x0: (W - vw) / 2, y0: (H - vh) / 2 };
  };

  // begrens panorering slik at kartet dekker det synlige utsnittet
  const clampOffset = (o: { x: number; y: number }, z: number) => {
    const { vw, vh, x0, y0 } = view();
    const axis = (v: number, start: number, size: number, world: number) => {
      const hi = start / z;
      const lo = (start + size) / z - world;
      if (lo > hi) return (start + size / 2) / z - world / 2; // kartet er mindre enn utsnittet → midtstill
      return clamp(v, lo, hi);
    };
    return { x: axis(o.x, x0, vw, W), y: axis(o.y, y0, vh, H) };
  };


  const zoomAt = (px: number, py: number, next: number) => {
    const { zoom: z, offset: o } = stateRef.current;
    const nz = clamp(next, MIN_Z, MAX_Z);
    if (nz === z) return;
    const wx = px / z - o.x;
    const wy = py / z - o.y;
    setZoom(nz);
    setOffset(clampOffset({ x: px / nz - wx, y: py / nz - wy }, nz));
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { rect, s, x0, y0 } = view();
      if (!rect) return;
      const px = x0 + (e.clientX - rect.left) / s;
      const py = y0 + (e.clientY - rect.top) / s;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomAt(px, py, stateRef.current.zoom * Math.exp(-dy * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const activeLayers = useMemo(() => new Set(events.map((e) => e.layer)), [events]);


  const { path, projection } = useMemo(() => {
    const p = geoEquirectangular().fitSize([W, H], { type: "Sphere" });
    return { path: geoPath(p), projection: p };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const { offset: o } = stateRef.current;
    pan.current = { x: e.clientX, y: e.clientY, ox: o.x, oy: o.y };
    moved.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const { rect, s } = view();
    if (!rect) return;
    const z = stateRef.current.zoom;
    const dx = (e.clientX - p.x) / s / z;
    const dy = (e.clientY - p.y) / s / z;
    if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 5) moved.current = true;
    setOffset(clampOffset({ x: p.ox + dx, y: p.oy + dy }, z));
  };
  const onPointerUp = () => {
    pan.current = null;
  };

  const btn = "hud-btn hud-btn-hoverable size-6 !p-0";
  const center = () => {
    const { x0, y0, vw, vh } = view();
    return [x0 + vw / 2, y0 + vh / 2] as const;
  };

  return (
    <div
      ref={boxRef}
      className={
        expanded
          ? "hud-panel hud-opaque fixed inset-3 z-[200] touch-none overflow-hidden rounded-lg border border-primary/25 md:inset-8"
          : `relative w-full touch-none overflow-hidden rounded border border-primary/20 bg-primary/[0.02] ${fill ? "min-h-0 flex-1" : ""}`
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio={slice ? "xMidYMid slice" : "xMidYMid meet"}
        className="block size-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x={-W} y={-H} width={W * 3} height={H * 3} fill={expanded ? "oklch(0.16 0.03 235)" : "oklch(0.2 0.04 235 / 0.25)"} />
        <g transform={`scale(${zoom}) translate(${offset.x}, ${offset.y})`}>
          {land?.features.map((f, i) => (
            <path
              key={i}
              d={path(f) ?? undefined}
              fill="oklch(0.78 0.13 200 / 0.10)"
              stroke="oklch(0.78 0.13 200 / 0.45)"
              strokeWidth={0.5 / zoom}
            />
          ))}
          <g stroke="oklch(0.78 0.13 200 / 0.12)" strokeWidth={0.4 / zoom}>
            {[-60, -30, 0, 30, 60].map((lat) => {
              const y = projection([0, lat])?.[1] ?? 0;
              return <line key={lat} x1={0} y1={y} x2={W} y2={y} />;
            })}
            {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => {
              const x = projection([lon, 0])?.[0] ?? 0;
              return <line key={lon} x1={x} y1={0} x2={x} y2={H} />;
            })}
          </g>
          {dayNight ? (
            <path d={nightPath()} fill="oklch(0.15 0.03 250 / 0.55)" pointerEvents="none" />
          ) : null}

          {ROUTES.filter((r) => activeLayers.has(r.layer)).map((r) => {
            const color = LAYER_COLOR[r.layer];
            const d = r.coords
              .map((c, i) => {
                const p = projection(c);
                return p ? `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : "";
              })
              .join(" ");
            if (!d) return null;
            return (
              <path
                key={r.id}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1.1 / zoom}
                strokeLinecap="round"
                opacity={0.75}
                className="cursor-pointer"
                pointerEvents="stroke"
                onClick={(event) => { event.stopPropagation(); if (!moved.current) onRouteSelect?.(r.name); }}
                strokeDasharray={r.layer === "trade" ? `${4 / zoom} ${3 / zoom}` : undefined}
              >
                <title>{r.name}</title>
              </path>
            );
          })}


          {events.map((e) => {
            const pt = projection([e.lon, e.lat]);
            if (!pt) return null;
            const color = LAYER_COLOR[e.layer];
            return (
              <g
                key={e.id}
                transform={`translate(${pt[0]}, ${pt[1]}) scale(${1 / zoom})`}
                className="cursor-pointer"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onSelect?.(e); }}
              >
                <circle r={8} fill="transparent" />
                <circle r={2.2} fill={color} />
                <circle r={3} fill="none" stroke={color} strokeWidth={0.6} opacity={0.7}>
                  <animate attributeName="r" values="2.5;9;2.5" dur="3.4s" repeatCount="indefinite" />
                  <animate
                    attributeName="opacity"
                    values="0.7;0;0.7"
                    dur="3.4s"
                    repeatCount="indefinite"
                  />
                </circle>
                {zoom >= 3 ? (
                  <text
                    x={4}
                    y={2.5}
                    fontSize={4}
                    fill={color}
                    opacity={0.9}
                    className="hud-title pointer-events-none"
                  >
                    {e.title.length > 42 ? `${e.title.slice(0, 42)}…` : e.title}
                  </text>
                ) : null}
                <title>{e.title}</title>
              </g>
            );
          })}

          {markers.map((m) => {
            const pt = projection([m.lon, m.lat]);
            if (!pt) return null;
            const on = highlightId === m.id;
            const color = on ? "oklch(0.85 0.18 90)" : "oklch(0.82 0.14 165)";
            return (
              <g key={m.id} transform={`translate(${pt[0]}, ${pt[1]}) scale(${1 / zoom})`} className="cursor-pointer" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onMarkerSelect?.(m.id); }}>
                <circle r={9} fill="transparent" />
                <rect x={-2.2} y={-2.2} width={4.4} height={4.4} fill={color} opacity={0.9} />
                <rect
                  x={-4}
                  y={-4}
                  width={8}
                  height={8}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.6}
                  opacity={on ? 1 : 0.5}
                >
                  {on ? (
                    <animate
                      attributeName="opacity"
                      values="1;0.15;1"
                      dur="1.4s"
                      repeatCount="indefinite"
                    />
                  ) : null}
                </rect>
                {zoom >= 2 || on ? (
                  <text x={5} y={2.5} fontSize={4} fill={color} className="hud-title pointer-events-none">
                    {m.name}
                  </text>
                ) : null}
                <title>{`${m.name}${m.detail ? ` — ${m.detail}` : ""}`}</title>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="hud-radar-sweep pointer-events-none absolute inset-0" />
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button
          className={btn}
          aria-label={expanded ? "Lukk stort kart" : "Vis stort kart"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <Shrink className="size-3" /> : <Expand className="size-3" />}
        </button>
        <button
          className={btn}
          aria-label="Zoom inn"
          onClick={() => {
            const [cx, cy] = center();
            zoomAt(cx, cy, zoom * 1.5);
          }}
        >
          <Plus className="size-3" />
        </button>
        <button
          className={btn}
          aria-label="Zoom ut"
          onClick={() => {
            const [cx, cy] = center();
            zoomAt(cx, cy, zoom / 1.5);
          }}
        >
          <Minus className="size-3" />
        </button>
        <button
          className={btn}
          aria-label="Nullstill visning"
          onClick={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
        >
          <Maximize className="size-3" />
        </button>
      </div>
      <span className="hud-title pointer-events-none absolute bottom-2 left-2 text-[9px] text-muted-foreground">
        {zoom.toFixed(1)}x
      </span>
    </div>
  );
}
