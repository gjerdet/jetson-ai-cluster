import type { Sample } from "@/lib/mqtt-bridge";

/** Enkel 24-timers linjegraf. */
export function Sparkline({
  data,
  color = "oklch(0.85 0.13 200)",
  height = 56,
}: {
  data: Sample[];
  color?: string;
  height?: number;
}) {
  const w = 300;
  const h = height;
  if (data.length < 2)
    return (
      <div
        className="hud-title flex items-center justify-center text-[9px] text-muted-foreground"
        style={{ height: h }}
      >
        for lite data
      </div>
    );
  const t0 = Date.now() - 24 * 3600 * 1000;
  const t1 = Date.now();
  const vs = data.map((d) => d.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const pts = data.map((d) => {
    const x = ((d.t - t0) / (t1 - t0)) * w;
    const y = h - 4 - ((d.v - min) / span) * (h - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={`0,${h} ${pts.join(" ")} ${w},${h}`}
        fill={color}
        opacity={0.08}
        stroke="none"
      />
      <text x={2} y={9} fontSize={8} fill="currentColor" className="text-muted-foreground">
        {max.toFixed(1)}
      </text>
      <text x={2} y={h - 2} fontSize={8} fill="currentColor" className="text-muted-foreground">
        {min.toFixed(1)}
      </text>
    </svg>
  );
}
