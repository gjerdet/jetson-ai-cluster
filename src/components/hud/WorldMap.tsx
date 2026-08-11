import { useEffect, useMemo, useState } from "react";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import { LAYER_COLOR, type WorldEvent } from "@/lib/world-events";

const W = 720;
const H = 360;

let cache: FeatureCollection<Geometry> | null = null;

export function WorldMap({
  events,
  onSelect,
}: {
  events: WorldEvent[];
  onSelect?: (e: WorldEvent) => void;
}) {
  const [land, setLand] = useState<FeatureCollection<Geometry> | null>(cache);

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

  const { path, projection } = useMemo(() => {
    const p = geoEquirectangular().fitSize([W, H], { type: "Sphere" });
    return { path: geoPath(p), projection: p };
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded border border-primary/20 bg-primary/[0.02]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block size-full">
        <rect width={W} height={H} fill="oklch(0.2 0.04 235 / 0.25)" />
        {land?.features.map((f, i) => (
          <path
            key={i}
            d={path(f) ?? undefined}
            fill="oklch(0.78 0.13 200 / 0.10)"
            stroke="oklch(0.78 0.13 200 / 0.45)"
            strokeWidth={0.5}
          />
        ))}
        <g stroke="oklch(0.78 0.13 200 / 0.12)" strokeWidth={0.4}>
          {[-60, -30, 0, 30, 60].map((lat) => {
            const y = projection([0, lat])?.[1] ?? 0;
            return <line key={lat} x1={0} y1={y} x2={W} y2={y} />;
          })}
          {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => {
            const x = projection([lon, 0])?.[0] ?? 0;
            return <line key={lon} x1={x} y1={0} x2={x} y2={H} />;
          })}
        </g>
        {events.map((e) => {
          const pt = projection([e.lon, e.lat]);
          if (!pt) return null;
          const color = LAYER_COLOR[e.layer];
          return (
            <g
              key={e.id}
              transform={`translate(${pt[0]}, ${pt[1]})`}
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
      </svg>
      <div className="hud-radar-sweep pointer-events-none absolute inset-0" />
    </div>
  );
}
