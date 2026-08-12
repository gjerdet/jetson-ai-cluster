import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HudWindow } from "@/components/hud/HudWindow";
import { AmbientField } from "@/components/hud/AmbientField";
import { CenterMenu, type WinId } from "@/components/hud/CenterMenu";
import { ChatPanel } from "@/components/hud/ChatPanel";
import { NodesPanel } from "@/components/hud/NodesPanel";
import { WorldMonitor } from "@/components/hud/WorldMonitor";
import { SmartHomePanel } from "@/components/hud/SmartHomePanel";
import { SettingsPanel } from "@/components/hud/SettingsPanel";
import { DashboardPanel } from "@/components/hud/DashboardPanel";
import { HealthPanel } from "@/components/hud/HealthPanel";
import { PoolPanel } from "@/components/hud/PoolPanel";
import { LogsPanel } from "@/components/hud/LogsPanel";
import { BackendStatusBadge } from "@/components/hud/BackendStatusBadge";
import { useHudConfig } from "@/lib/hud-store";
import { useSession } from "@/lib/session";
import { usePreviewSession } from "@/lib/preview-session";
import { setRules, setTelegramChat } from "@/lib/mqtt-bridge";

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
  world: { x: 420, y: 110, w: 780, h: 640 },
  home: { x: 80, y: 140, w: 460, h: 520 },
  dash: { x: 120, y: 120, w: 640, h: 560 },
  health: { x: 160, y: 130, w: 460, h: 560 },
  pool: { x: 200, y: 150, w: 480, h: 540 },
  logs: { x: 140, y: 110, w: 720, h: 560 },
  settings: { x: 0, y: 0, w: 0, h: 0 },
};

const TITLES: Record<WinId, { title: string; subtitle: string }> = {
  chat: { title: "KOMMANDO", subtitle: "direkte dialog med primærnode" },
  nodes: { title: "NODER", subtitle: "modeller og tilkoblinger" },
  world: { title: "WORLD MONITOR", subtitle: "global telemetri" },
  home: { title: "SMARTHUS", subtitle: "MQTT-bro mot ESP32 og Pi" },
  dash: { title: "GRAFER", subtitle: "moduler for alt som er tilkoblet" },
  health: { title: "HELSE", subtitle: "selvovervåking av noder og tjenester" },
  pool: { title: "POOL", subtitle: "lastbalansering og valgt node per forespørsel" },
  logs: { title: "LOGGER", subtitle: "sanntidslogg fra oppsett og tjenester" },
  settings: { title: "SYSTEM", subtitle: "innstillinger, evner og plugins" },
};

function Index() {
  const { config, update, loaded } = useHudConfig();
  const navigate = useNavigate();
  const { state, user, loggUt } = useSession();
  const { isPreview, unlocked } = usePreviewSession();
  const [open, setOpen] = useState<WinId[]>([]);
  const [order, setOrder] = useState<WinId[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  // ingen økt mot den lokale agenten → send brukeren til innloggingen
  // unntatt i Lovable-preview, der preview-passordet er tilstrekkelig for å se UI-et
  useEffect(() => {
    if (state === "ute" && !(isPreview && unlocked)) {
      void navigate({ to: "/logg-inn", replace: true });
    }
  }, [state, isPreview, unlocked, navigate]);



  // regler skal gjelde selv om SMARTHUS-vinduet er lukket
  useEffect(() => {
    setRules(config.rules ?? []);
  }, [config.rules]);

  useEffect(() => {
    setTelegramChat(config.telegram?.enabled ? (config.telegram?.chatId ?? "") : "");
  }, [config.telegram]);

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

      <header className="relative z-50 flex items-center justify-end gap-3 px-5 py-4">
        <BackendStatusBadge />
        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-[0.2em] text-foreground/40">
              {user.email}
            </span>
            <button
              className="rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-primary/80 transition hover:bg-primary/15"
              onClick={() => void loggUt()}
            >
              LOGG UT
            </button>
          </div>
        ) : null}
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
              solid={id === "world" || id === "settings"}
              onFocus={() => focus(id)}
              onClose={() => toggle(id)}
            >
              {id === "chat" ? <ChatPanel config={config} update={update} /> : null}
              {id === "nodes" ? <NodesPanel config={config} update={update} /> : null}
              {id === "world" ? <WorldMonitor config={config} update={update} /> : null}
              {id === "home" ? <SmartHomePanel config={config} update={update} /> : null}
              {id === "dash" ? <DashboardPanel config={config} update={update} /> : null}
              {id === "health" ? <HealthPanel config={config} /> : null}
              {id === "pool" ? <PoolPanel config={config} /> : null}
              {id === "logs" ? <LogsPanel /> : null}
              {id === "settings" ? <SettingsPanel config={config} update={update} /> : null}
            </HudWindow>
          ))
        : null}
    </main>
  );
}
