import { useEffect, useState } from "react";

const REGIONS = [
  { name: "OSLO", tz: "Europe/Oslo", x: 51, y: 26 },
  { name: "NEW YORK", tz: "America/New_York", x: 27, y: 37 },
  { name: "LONDON", tz: "Europe/London", x: 48, y: 29 },
  { name: "TOKYO", tz: "Asia/Tokyo", x: 84, y: 39 },
  { name: "SYDNEY", tz: "Australia/Sydney", x: 88, y: 74 },
  { name: "SÃO PAULO", tz: "America/Sao_Paulo", x: 34, y: 68 },
];

export function WorldMonitor() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative aspect-[2/1] w-full overflow-hidden rounded border border-primary/25 bg-primary/5">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.78 0.13 200 / 0.18) 1px, transparent 1px), linear-gradient(90deg, oklch(0.78 0.13 200 / 0.18) 1px, transparent 1px)",
            backgroundSize: "8.33% 12.5%",
          }}
        />
        <svg viewBox="0 0 100 50" className="absolute inset-0 size-full">
          <ellipse
            cx="50"
            cy="25"
            rx="48"
            ry="23"
            fill="none"
            stroke="oklch(0.78 0.13 200 / 0.35)"
            strokeWidth="0.3"
          />
          <ellipse
            cx="50"
            cy="25"
            rx="24"
            ry="23"
            fill="none"
            stroke="oklch(0.78 0.13 200 / 0.2)"
            strokeWidth="0.25"
          />
          <line
            x1="2"
            y1="25"
            x2="98"
            y2="25"
            stroke="oklch(0.78 0.13 200 / 0.25)"
            strokeWidth="0.25"
          />
        </svg>
        {REGIONS.map((r) => (
          <div
            key={r.name}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${r.x}%`, top: `${r.y}%` }}
          >
            <span className="block size-1.5 animate-ping rounded-full bg-primary" />
            <span className="absolute left-1/2 top-1/2 block size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {REGIONS.map((r) => (
          <div
            key={r.name}
            className="flex items-center justify-between rounded border border-primary/20 bg-primary/5 px-2 py-1"
          >
            <span className="hud-title text-[10px] text-primary/80">{r.name}</span>
            <span className="font-mono text-[11px] text-foreground/80">
              {now
                ? new Intl.DateTimeFormat("nb-NO", {
                    timeZone: r.tz,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(now)
                : "--:--:--"}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded border border-primary/20 bg-primary/5 p-2">
        <p className="hud-title mb-1 text-[10px] text-primary/80">UTC</p>
        <p className="font-mono text-lg text-foreground">
          {now
            ? new Intl.DateTimeFormat("nb-NO", {
                timeZone: "UTC",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(now)
            : "--:--:--"}
        </p>
      </div>
    </div>
  );
}
