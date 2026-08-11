import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { HudWindow } from "@/components/hud/HudWindow";
import { AmbientField } from "@/components/hud/AmbientField";
import { CenterMenu, type WinId } from "@/components/hud/CenterMenu";
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

const LAYOUT: Record<WinId, { x: number; y: number; w: number; h: number }> = {
  chat: { x: 40, y: 100, w: 420, h: 460 },
  nodes: { x: 500, y: 80, w: 400, h: 500 },
  world: { x: 620, y: 200, w: 460, h: 520 },
  settings: { x: 0, y: 0, w: 0, h: 0 },
};

const TITLES: Record<WinId, { title: string; subtitle: string }> = {
  chat: { title: "KOMMANDO", subtitle: "direkte dialog med primærnode" },
  nodes: { title: "NODER", subtitle: "modeller og tilkoblinger" },
  world: { title: "WORLD MONITOR", subtitle: "global telemetri" },
  settings: { title: "SYSTEM", subtitle: "innstillinger, evner og plugins" },
};

function Index() {
  const { config, update, loaded } = useHudConfig();
  const [open, setOpen] = useState<WinId[]>([]);
  const [order, setOrder] = useState<WinId[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

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
            SAMARBEID <span className="text-primary">{config.collaboration ? "PÅ" : "AV"}</span>
          </span>
        </div>
      </header>

      <CenterMenu
        open={menuOpen}
        setOpen={setMenuOpen}
        active={open}
        activeNodes={activeNodes}
        onSelect={(id) => {
          toggle(id);
          setMenuOpen(false);
        }}
      />

      {loaded
        ? open.map((id) => (
            <HudWindow
              key={id}
              title={TITLES[id].title}
              subtitle={TITLES[id].subtitle}
              initial={LAYOUT[id]}
              z={60 + order.indexOf(id)}
              fullscreen={id === "settings"}
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
    </main>
  );
}
