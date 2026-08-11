import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquare, Cpu, Globe2, Settings2 } from "lucide-react";
import { HudWindow } from "@/components/hud/HudWindow";
import { ReactorCore } from "@/components/hud/ReactorCore";
import { AmbientField } from "@/components/hud/AmbientField";
import { ChatPanel } from "@/components/hud/ChatPanel";
import { NodesPanel } from "@/components/hud/NodesPanel";
import { WorldMonitor } from "@/components/hud/WorldMonitor";
import { SettingsPanel } from "@/components/hud/SettingsPanel";
import { useHudConfig } from "@/lib/hud-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Distribuert AI-HUD – Jarvis-grensesnitt for lokale noder" },
      {
        name: "description",
        content:
          "Minimalistisk Jarvis-inspirert HUD som kobler flere lokale AI-modeller og Jetson-noder sammen, med transparente popup-vinduer og world monitor.",
      },
      { property: "og:title", content: "Distribuert AI-HUD" },
      {
        property: "og:description",
        content:
          "Styr flere AI-noder fra ett transparent HUD med chat, nodehåndtering og world monitor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type WinId = "chat" | "nodes" | "world" | "settings";

const LAYOUT: Record<WinId, { x: number; y: number; w: number; h: number }> = {
  chat: { x: 40, y: 100, w: 420, h: 460 },
  nodes: { x: 500, y: 80, w: 400, h: 500 },
  world: { x: 620, y: 200, w: 440, h: 480 },
  settings: { x: 200, y: 180, w: 360, h: 380 },
};

const TITLES: Record<WinId, { title: string; subtitle: string }> = {
  chat: { title: "KOMMANDO", subtitle: "direkte dialog med primærnode" },
  nodes: { title: "NODER", subtitle: "modeller og tilkoblinger" },
  world: { title: "WORLD MONITOR", subtitle: "global telemetri" },
  settings: { title: "SYSTEM", subtitle: "innstillinger" },
};

function Index() {
  const { config, update, loaded } = useHudConfig();
  const [open, setOpen] = useState<WinId[]>(["chat"]);
  const [order, setOrder] = useState<WinId[]>(["chat"]);

  const toggle = (id: WinId) => {
    setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
    setOrder((o) => [...o.filter((x) => x !== id), id]);
  };
  const focus = (id: WinId) => setOrder((o) => [...o.filter((x) => x !== id), id]);

  const activeNodes = config.nodes.filter((n) => n.enabled).length;

  return (
    <main
      className="hud-root relative min-h-screen overflow-hidden"
      style={{ ["--hud-opacity" as string]: `${config.transparency}%` }}
    >
      <AmbientField />
      <div className="hud-grid pointer-events-none absolute inset-0" />
      <div className="hud-scan pointer-events-none absolute inset-0" />
      <ReactorCore active={activeNodes > 0} />


      <header className="relative z-50 flex items-center justify-between px-5 py-4">
        <div>
          <h1 className="hud-title text-sm tracking-[0.4em] text-primary">{config.callsign}</h1>
          <p className="text-[10px] tracking-[0.2em] text-muted-foreground">
            DISTRIBUERT NODENETTVERK
          </p>
        </div>
        <div className="hud-title flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>
            NODER <span className="text-primary">{activeNodes}</span>/{config.nodes.length}
          </span>
          <span>
            SAMARBEID{" "}
            <span className="text-primary">{config.collaboration ? "PÅ" : "AV"}</span>
          </span>
        </div>
      </header>

      {loaded
        ? open.map((id) => (
            <HudWindow
              key={id}
              title={TITLES[id].title}
              subtitle={TITLES[id].subtitle}
              initial={LAYOUT[id]}
              z={20 + order.indexOf(id)}
              onFocus={() => focus(id)}
              onClose={() => toggle(id)}
            >
              {id === "chat" ? <ChatPanel config={config} /> : null}
              {id === "nodes" ? <NodesPanel config={config} update={update} /> : null}
              {id === "world" ? <WorldMonitor /> : null}
              {id === "settings" ? <SettingsPanel config={config} update={update} /> : null}
            </HudWindow>
          ))
        : null}

      <nav className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/30 bg-background/40 px-2 py-1.5 backdrop-blur-md">
        <DockButton
          label="KOMMANDO"
          active={open.includes("chat")}
          onClick={() => toggle("chat")}
        >
          <MessageSquare className="size-4" />
        </DockButton>
        <DockButton label="NODER" active={open.includes("nodes")} onClick={() => toggle("nodes")}>
          <Cpu className="size-4" />
        </DockButton>
        <DockButton label="WORLD" active={open.includes("world")} onClick={() => toggle("world")}>
          <Globe2 className="size-4" />
        </DockButton>
        <DockButton
          label="SYSTEM"
          active={open.includes("settings")}
          onClick={() => toggle("settings")}
        >
          <Settings2 className="size-4" />
        </DockButton>
      </nav>
    </main>
  );
}

function DockButton({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`hud-title flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] transition-colors ${
        active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
      }`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
