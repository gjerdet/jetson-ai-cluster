import { useMemo } from "react";
import { Activity, RefreshCw, Trash2 } from "lucide-react";
import { useHealth, useHealthMonitor, checkNodes, clearSelfEvents } from "@/lib/health";
import { useMqtt } from "@/lib/mqtt-bridge";
import { useWorldFeed } from "@/lib/world-feed";
import { Sparkline } from "./Sparkline";
import type { HudConfig } from "@/lib/hud-store";

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function HealthPanel({ config }: { config: HudConfig }) {
  useHealthMonitor(config, 60);
  const health = useHealth();
  const mqtt = useMqtt();
  const feed = useWorldFeed();

  const nodes = useMemo(
    () => config.nodes.map((n) => health.nodes[n.id]).filter(Boolean),
    [config.nodes, health.nodes],
  );

  const integrations = (config.integrations ?? []).filter((i) => i.enabled);
  const devices = (config.devices ?? []).filter((d) => d.enabled);
  const online = nodes.filter((n) => n!.last != null).length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto pr-1 text-xs">
      <div className="flex items-center justify-between">
        <p className="hud-title text-[10px] text-primary/80">
          <Activity className="mr-1 inline size-3" />
          {online}/{nodes.length} noder oppe ·{" "}
          {health.lastCheck ? new Date(health.lastCheck).toLocaleTimeString("nb-NO") : "venter"}
        </p>
        <button
          onClick={() => void checkNodes(config.nodes.filter((n) => n.enabled))}
          disabled={health.checking}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] text-primary"
        >
          <RefreshCw className={`mr-1 inline size-3 ${health.checking ? "animate-spin" : ""}`} />
          mål nå
        </button>
      </div>

      <section className="space-y-2">
        <p className="hud-title text-[9px] text-muted-foreground">NODER</p>
        {nodes.length === 0 ? (
          <p className="text-muted-foreground">Ingen aktive noder å overvåke.</p>
        ) : null}
        {nodes.map((n) => (
          <div key={n!.id} className="rounded border border-primary/15 p-2">
            <div className="flex items-baseline justify-between">
              <span className="hud-title text-[10px] text-primary/90">{n!.name}</span>
              <span className={n!.last == null ? "text-destructive" : "text-primary"}>
                {n!.last == null ? "nede" : `${n!.last} ms`}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {n!.model} · {n!.role} · snitt {n!.avg ?? "–"} ms · oppetid {pct(n!.uptime)}
            </p>
            <Sparkline
              data={n!.samples.map((s) => ({ t: s.t, v: s.ms ?? 0 }))}
              height={28}
            />
          </div>
        ))}
      </section>

      <section className="space-y-1">
        <p className="hud-title text-[9px] text-muted-foreground">TILKOBLINGER</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-primary/15 p-2">
            <p className="hud-title text-[9px] text-primary/80">MQTT</p>
            <p className={mqtt.status === "online" ? "text-primary" : "text-muted-foreground"}>
              {mqtt.status}
              {mqtt.pingMs != null ? ` · ${mqtt.pingMs} ms` : ""}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {Object.keys(mqtt.topics).length} emner · {mqtt.reconnects} reconnects
            </p>
          </div>
          <div className="rounded border border-primary/15 p-2">
            <p className="hud-title text-[9px] text-primary/80">WORLD MONITOR</p>
            <p className="text-primary">{feed.events.length} hendelser</p>
            <p className="text-[10px] text-muted-foreground">
              {feed.updated ? feed.updated.toLocaleTimeString("nb-NO") : "ikke hentet"}
            </p>
          </div>
          <div className="rounded border border-primary/15 p-2">
            <p className="hud-title text-[9px] text-primary/80">LOKALE SYSTEMER</p>
            <p className="text-primary">{integrations.length} aktive</p>
            <p className="text-[10px] text-muted-foreground">
              {integrations.map((i) => i.name).join(", ") || "ingen"}
            </p>
          </div>
          <div className="rounded border border-primary/15 p-2">
            <p className="hud-title text-[9px] text-primary/80">ENHETER</p>
            <p className="text-primary">{devices.length} registrert</p>
            <p className="text-[10px] text-muted-foreground">
              {(config.rules ?? []).filter((r) => r.enabled).length} aktive regler
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="hud-title text-[9px] text-muted-foreground">HENDELSESLOGG</p>
          <button
            onClick={clearSelfEvents}
            className="hud-title text-[9px] text-muted-foreground hover:text-primary"
          >
            <Trash2 className="mr-1 inline size-3" />
            tøm
          </button>
        </div>
        {health.events.length === 0 ? (
          <p className="text-muted-foreground">Ingen avvik registrert.</p>
        ) : (
          health.events.slice(0, 40).map((e) => (
            <p
              key={e.id}
              className={
                e.level === "crit"
                  ? "text-destructive"
                  : e.level === "warn"
                    ? "text-amber-300"
                    : "text-foreground/70"
              }
            >
              <span className="text-muted-foreground">
                {new Date(e.time).toLocaleTimeString("nb-NO")}{" "}
              </span>
              {e.text}
            </p>
          ))
        )}
      </section>
    </div>
  );
}
