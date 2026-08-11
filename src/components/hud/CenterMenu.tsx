import { MessageSquare, Cpu, Globe2, Settings2, Home, LineChart, Activity } from "lucide-react";
import { ReactorCore } from "./ReactorCore";

export type WinId = "chat" | "nodes" | "world" | "home" | "dash" | "health" | "settings";

const ITEMS: { id: WinId; label: string; icon: typeof Cpu; angle: number }[] = [
  { id: "chat", label: "KOMMANDO", icon: MessageSquare, angle: -90 },
  { id: "nodes", label: "NODER", icon: Cpu, angle: -38 },
  { id: "world", label: "WORLD", icon: Globe2, angle: 14 },
  { id: "home", label: "SMARTHUS", icon: Home, angle: 66 },
  { id: "dash", label: "GRAFER", icon: LineChart, angle: 118 },
  { id: "health", label: "HELSE", icon: Activity, angle: 170 },
  { id: "settings", label: "SYSTEM", icon: Settings2, angle: 222 },
];

export function CenterMenu({
  open,
  setOpen,
  active,
  onSelect,
  activeNodes,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  active: WinId[];
  onSelect: (id: WinId) => void;
  activeNodes: number;
}) {
  const radius = 150;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <ReactorCore active={activeNodes > 0} />

      <div className="pointer-events-none relative">
        {/* usynlig utløser midt i hologrammet */}
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Lukk meny" : "Åpne meny"}
          aria-expanded={open}
          className="pointer-events-auto size-40 rounded-full bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        />

        {ITEMS.map((it, i) => {
          const rad = (it.angle * Math.PI) / 180;
          const x = Math.cos(rad) * radius;
          const y = Math.sin(rad) * radius;
          return (
            <button
              key={it.id}
              onClick={() => onSelect(it.id)}
              tabIndex={open ? 0 : -1}
              style={{
                transform: open
                  ? `translate(-50%, -50%) translate(${x}px, ${y}px)`
                  : "translate(-50%, -50%) scale(0.4)",
                transitionDelay: `${i * 45}ms`,
              }}
              className={`hud-title absolute left-1/2 top-1/2 flex size-20 flex-col items-center justify-center gap-1 rounded-full bg-transparent text-[8px] transition-all duration-300 hover:text-primary/90 ${
                open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
              } ${active.includes(it.id) ? "text-primary/90" : "text-muted-foreground/70"}`}


            >
              <it.icon className="size-4" />
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
