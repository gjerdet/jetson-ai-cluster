import { MessageSquare, Cpu, Globe2, Settings2, Power } from "lucide-react";
import { ReactorCore } from "./ReactorCore";

export type WinId = "chat" | "nodes" | "world" | "settings";

const ITEMS: { id: WinId; label: string; icon: typeof Cpu; angle: number }[] = [
  { id: "chat", label: "KOMMANDO", icon: MessageSquare, angle: -90 },
  { id: "nodes", label: "NODER", icon: Cpu, angle: -18 },
  { id: "world", label: "WORLD", icon: Globe2, angle: 54 },
  { id: "settings", label: "SYSTEM", icon: Settings2, angle: 126 },
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
  const radius = 130;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <ReactorCore active={activeNodes > 0} />

      <div className="pointer-events-none relative">
        <button
          onClick={() => setOpen(!open)}
          aria-label="Åpne meny"
          aria-expanded={open}
          className="hud-core pointer-events-auto relative grid size-24 place-items-center rounded-full border border-primary/50 bg-primary/10 text-primary backdrop-blur-sm transition-transform hover:scale-105"
        >
          <span className="hud-core-glow" />
          <Power className={`size-6 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="hud-title absolute -bottom-6 text-[9px] text-primary/70">
            {open ? "lukk" : "meny"}
          </span>
        </button>

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
              className={`hud-title absolute left-1/2 top-1/2 flex size-20 flex-col items-center justify-center gap-1 rounded-full border text-[8px] transition-all duration-300 ${
                open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
              } ${
                active.includes(it.id)
                  ? "border-primary/70 bg-primary/20 text-primary"
                  : "border-primary/30 bg-background/20 text-muted-foreground hover:border-primary/60 hover:text-primary"
              } backdrop-blur-md`}
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
