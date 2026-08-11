import { useEffect, useMemo, useState } from "react";
import { Plug, PlugZap, Send, RefreshCw } from "lucide-react";
import { DEVICE_KIND_LABEL, type HudConfig } from "@/lib/hud-store";
import {
  connectMqtt,
  deviceTopics,
  disconnectMqtt,
  publishMqtt,
  useMqtt,
} from "@/lib/mqtt-bridge";

const STATUS_LABEL = {
  off: "FRAKOBLET",
  connecting: "KOBLER TIL…",
  online: "TILKOBLET",
  error: "FEIL",
} as const;

export function SmartHomePanel({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const { status, error, topics, log } = useMqtt();
  const devices = (config.devices ?? []).filter((d) => d.enabled && d.protocol === "mqtt");
  const mqtt = config.mqtt;
  const [manual, setManual] = useState({ topic: "", payload: "" });

  const patch = (p: Partial<HudConfig["mqtt"]>) =>
    update({ ...config, mqtt: { ...mqtt, ...p } });

  useEffect(() => {
    if (mqtt.autoConnect && status === "off") void connectMqtt(mqtt, config.devices ?? []);
    // kun ved montering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subs = useMemo(
    () => deviceTopics(config.devices ?? [], mqtt.baseTopic),
    [config.devices, mqtt.baseTopic],
  );

  const stateFor = (topic?: string) => {
    if (!topic) return null;
    const base = topic.replace(/\/#$/, "");
    const hits = Object.values(topics).filter((t) => t.topic.startsWith(base));
    return hits.sort((a, b) => b.time - a.time)[0] ?? null;
  };

  const dot =
    status === "online"
      ? "oklch(0.8 0.17 150)"
      : status === "connecting"
        ? "oklch(0.85 0.15 90)"
        : status === "error"
          ? "oklch(0.7 0.2 25)"
          : "oklch(0.6 0.02 240)";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* broker */}
      <div className="flex flex-wrap items-center gap-1">
        <span
          className="hud-title flex items-center gap-2 rounded-full border border-primary/25 px-2 py-0.5 text-[9px]"
          style={{ color: dot }}
        >
          <span className="size-1.5 rounded-full" style={{ background: dot, boxShadow: `0 0 6px ${dot}` }} />
          {STATUS_LABEL[status]}
        </span>
        <input
          value={mqtt.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="ws://192.168.1.50:9001"
          className="hud-input h-6 min-w-44 flex-1 text-[11px]"
        />
        <input
          value={mqtt.baseTopic}
          onChange={(e) => patch({ baseTopic: e.target.value })}
          placeholder="hjem/#"
          className="hud-input h-6 w-28 text-[11px]"
        />
        <button
          onClick={() =>
            status === "off" || status === "error"
              ? void connectMqtt(mqtt, config.devices ?? [])
              : disconnectMqtt()
          }
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
        >
          {status === "off" || status === "error" ? (
            <>
              <Plug className="size-3" /> koble til
            </>
          ) : (
            <>
              <PlugZap className="size-3" /> koble fra
            </>
          )}
        </button>
        <button
          onClick={() => void connectMqtt(mqtt, config.devices ?? [])}
          aria-label="Koble til på nytt"
          className="hud-btn hud-btn-hoverable !p-1"
        >
          <RefreshCw className={`size-3 ${status === "connecting" ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={mqtt.username}
          onChange={(e) => patch({ username: e.target.value })}
          placeholder="bruker"
          className="hud-input h-6 w-24 text-[11px]"
        />
        <input
          type="password"
          value={mqtt.password}
          onChange={(e) => patch({ password: e.target.value })}
          placeholder="passord"
          className="hud-input h-6 w-24 text-[11px]"
        />
        <label className="hud-title flex items-center gap-1 text-[9px] text-muted-foreground">
          <input
            type="checkbox"
            checked={mqtt.autoConnect}
            onChange={(e) => patch({ autoConnect: e.target.checked })}
            className="accent-primary"
          />
          koble til automatisk
        </label>
        <span className="hud-title text-[9px] text-muted-foreground">
          {subs.length} abonnement
        </span>
      </div>

      {error ? (
        <p className="text-[10px] text-destructive">
          {error} · brokeren må ha WebSocket-lytter (Mosquitto: <code>listener 9001</code> +{" "}
          <code>protocol websockets</code>).
        </p>
      ) : null}

      {/* enheter */}
      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {devices.length === 0 ? (
          <p className="hud-title text-[10px] text-primary/60">
            Ingen MQTT-enheter registrert – legg dem inn under SYSTEM → ENHETER.
          </p>
        ) : null}
        {devices.map((d) => {
          const st = stateFor(d.topic);
          const base = (d.topic ?? "").replace(/\/#$/, "");
          const fresh = st && Date.now() - st.time < 120000;
          return (
            <div key={d.id} className="rounded border border-primary/15 bg-primary/[0.03] p-2">
              <div className="flex items-center gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background: fresh ? "oklch(0.8 0.17 150)" : "oklch(0.6 0.02 240)",
                    boxShadow: fresh ? "0 0 6px oklch(0.8 0.17 150)" : undefined,
                  }}
                />
                <span className="hud-title flex-1 truncate text-[10px] text-primary">
                  {d.name}
                  <span className="ml-2 text-muted-foreground">
                    {DEVICE_KIND_LABEL[d.kind]}
                    {d.room ? ` · ${d.room}` : ""}
                  </span>
                </span>
                <span className="text-[10px] text-foreground/80">
                  {st ? st.value : "ingen data"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="hud-title truncate text-[9px] text-muted-foreground">
                  {base || "mangler emne"}
                </span>
                <span className="flex-1" />
                {["ON", "OFF", "toggle"].map((cmd) => (
                  <button
                    key={cmd}
                    disabled={!base || status !== "online"}
                    onClick={() => publishMqtt(`${base}/set`, cmd)}
                    className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] disabled:opacity-40"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* manuell publisering */}
      <div className="flex items-center gap-1">
        <input
          value={manual.topic}
          onChange={(e) => setManual({ ...manual, topic: e.target.value })}
          placeholder="emne, f.eks. hjem/stue/lys/set"
          className="hud-input h-6 flex-1 text-[11px]"
        />
        <input
          value={manual.payload}
          onChange={(e) => setManual({ ...manual, payload: e.target.value })}
          placeholder="nyttelast"
          className="hud-input h-6 w-28 text-[11px]"
        />
        <button
          disabled={!manual.topic.trim() || status !== "online"}
          onClick={() => publishMqtt(manual.topic.trim(), manual.payload)}
          aria-label="Publiser"
          className="hud-btn hud-btn-hoverable !p-1 disabled:opacity-40"
        >
          <Send className="size-3" />
        </button>
      </div>

      {/* logg */}
      <div className="h-24 shrink-0 overflow-auto rounded border border-primary/10 bg-primary/[0.02] p-1">
        {log.length === 0 ? (
          <p className="hud-title text-[9px] text-muted-foreground">venter på trafikk…</p>
        ) : null}
        {log.map((l) => (
          <p
            key={l.id}
            className={`truncate text-[10px] ${
              l.dir === "out"
                ? "text-primary/85"
                : l.dir === "sys"
                  ? "text-muted-foreground"
                  : "text-foreground/75"
            }`}
          >
            <span className="hud-title mr-1 text-[9px] text-muted-foreground">
              {new Date(l.time).toLocaleTimeString("nb-NO")}
            </span>
            {l.text}
          </p>
        ))}
      </div>
    </div>
  );
}
