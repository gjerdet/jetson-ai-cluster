import { useEffect, useMemo, useRef, useState } from "react";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import { Minus, Plus, Maximize } from "lucide-react";
import { LAYER_COLOR, type WorldEvent } from "@/lib/world-events";

const W = 720;
const H = 360;
const MIN_Z = 1;
const MAX_Z = 12;

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

export function WorldMap({
  events,
  onSelect,
  dayNight = false,
}: {
  events: WorldEvent[];
  onSelect?: (e: WorldEvent) => void;
  dayNight?: boolean;
}) {

  const [land, setLand] = useState<FeatureCollection<Geometry> | null>(cache);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stateRef = useRef({ zoom, offset });
  stateRef.current = { zoom, offset };

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

  // begrens panorering slik at kartet ikke forsvinner
  const clampOffset = (o: { x: number; y: number }, z: number) => {
    const mx = (W * (z - 1)) / z;
    const my = (H * (z - 1)) / z;
    return { x: clamp(o.x, -mx, 0), y: clamp(o.y, -my, 0) };
  };

  const zoomAt = (px: number, py: number, next: number) => {
    const { zoom: z, offset: o } = stateRef.current;
    const nz = clamp(next, MIN_Z, MAX_Z);
    if (nz === z) return;
    // punkt i kartkoordinater
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
      const rect = el.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomAt(px, py, stateRef.current.zoom * Math.exp(-dy * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const { path, projection } = useMemo(() => {
    const p = geoEquirectangular().fitSize([W, H], { type: "Sphere" });
    return { path: geoPath(p), projection: p };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    pan.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = ((e.clientX - p.x) / rect.width) * W;
    const sy = ((e.clientY - p.y) / rect.height) * H;
    setOffset(clampOffset({ x: p.ox + sx / zoom, y: p.oy + sy / zoom }, zoom));
  };
  const onPointerUp = () => {
    pan.current = null;
  };

  const btn = "hud-btn hud-btn-hoverable size-6 !p-0";

  return (
    <div
      ref={boxRef}
      className="relative w-full touch-none overflow-hidden rounded border border-primary/20 bg-primary/[0.02]"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block size-full cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect width={W} height={H} fill="oklch(0.2 0.04 235 / 0.25)" />
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

          {events.map((e) => {
            const pt = projection([e.lon, e.lat]);
            if (!pt) return null;
            const color = LAYER_COLOR[e.layer];
            return (
              <g
                key={e.id}
                transform={`translate(${pt[0]}, ${pt[1]}) scale(${1 / zoom})`}
                className="cursor-pointer"
                onClick={() => onSelect?.(e)}
              >
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
                <title>{e.title}</title>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="hud-radar-sweep pointer-events-none absolute inset-0" />
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button className={btn} aria-label="Zoom inn" onClick={() => zoomAt(W / 2, H / 2, zoom * 1.5)}>
          <Plus className="size-3" />
        </button>
        <button className={btn} aria-label="Zoom ut" onClick={() => zoomAt(W / 2, H / 2, zoom / 1.5)}>
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
