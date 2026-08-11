import { useEffect, useMemo, useState } from "react";
import {
  Plug,
  PlugZap,
  Send,
  RefreshCw,
  Bell,
  BellOff,
  Activity,
  Radar,
  Plus,
  Trash2,
  Sliders,
} from "lucide-react";
import {
  DEVICE_KIND_LABEL,
  newDevice,
  newRule,
  type AlertRule,
  type HudConfig,
} from "@/lib/hud-store";
import {
  askNotificationPermission,
  clearAlerts,
  clearHistory,
  commandsFor,
  connectMqtt,
  deviceTopics,
  disconnectMqtt,
  forgetDiscovery,
  historyFor,
  historyTopics,
  newDiscoveries,
  publishMqtt,
  sendCommand,
  setRules,
  useMqtt,
  type Sample,
} from "@/lib/mqtt-bridge";

const STATUS_LABEL = {
  off: "FRAKOBLET",
  connecting: "KOBLER TIL…",
  online: "TILKOBLET",
  error: "FEIL",
} as const;

type Tab = "enheter" | "grafer" | "varsler" | "oppdagelse";

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "enheter", label: "ENHETER", icon: Sliders },
  { id: "grafer", label: "GRAFER 24T", icon: Activity },
  { id: "varsler", label: "VARSLER", icon: Bell },
  { id: "oppdagelse", label: "OPPDAGELSE", icon: Radar },
];

/** Enkel 24-timers linjegraf. */
function Sparkline({ data, color = "oklch(0.85 0.13 200)" }: { data: Sample[]; color?: string }) {
  const w = 300;
  const h = 56;
  if (data.length < 2)
    return (
      <div className="hud-title flex h-14 items-center justify-center text-[9px] text-muted-foreground">
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
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-14 w-full">
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

export function SmartHomePanel({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const { status, error, topics, log, alerts, history } = useMqtt();
  const devices = (config.devices ?? []).filter((d) => d.enabled && d.protocol === "mqtt");
  const mqtt = config.mqtt;
  const rules = config.rules ?? [];
  const [tab, setTab] = useState<Tab>("enheter");
  const [manual, setManual] = useState({ topic: "", payload: "" });
  const [levels, setLevels] = useState<Record<string, number>>({});

  const patch = (p: Partial<HudConfig["mqtt"]>) =>
    update({ ...config, mqtt: { ...mqtt, ...p } });

  useEffect(() => {
    setRules(rules);
  }, [rules]);

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

  const setRule = (id: string, p: Partial<AlertRule>) =>
    update({ ...config, rules: rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });

  const discoveries = newDiscoveries();

  const addFromDiscovery = (topic: string, name?: string) => {
    const d = newDevice("esp32");
    const base = topic.replace(/\/(state|status|stat|tele)(\/.*)?$/i, "");
    update({
      ...config,
      devices: [
        ...(config.devices ?? []),
        {
          ...d,
          name: (name ?? base.split("/").slice(-1)[0] ?? "NY ENHET").toUpperCase(),
          topic: base,
          host: "",
          capabilities: "",
        },
      ],
    });
    forgetDiscovery(topic);
  };

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
        <label className="hud-title flex items-center gap-1 text-[9px] text-muted-foreground">
          <input
            type="checkbox"
            checked={mqtt.discovery !== false}
            onChange={(e) => patch({ discovery: e.target.checked })}
            className="accent-primary"
          />
          auto-oppdagelse
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

      {/* faner */}
      <div className="flex flex-wrap gap-1 border-b border-primary/15 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`hud-title flex items-center gap-1 rounded px-2 py-1 text-[9px] transition-colors ${
              tab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary/80"
            }`}
          >
            <t.icon className="size-3" />
            {t.label}
            {t.id === "varsler" && alerts.length ? (
              <span className="rounded-full bg-destructive/70 px-1 text-[8px] text-foreground">
                {alerts.length}
              </span>
            ) : null}
            {t.id === "oppdagelse" && discoveries.length ? (
              <span className="rounded-full bg-primary/40 px-1 text-[8px]">{discoveries.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {/* ENHETER */}
        {tab === "enheter" ? (
          <>
            {devices.length === 0 ? (
              <p className="hud-title text-[10px] text-primary/60">
                Ingen MQTT-enheter registrert – legg dem inn under SYSTEM → ENHETER, eller bruk
                OPPDAGELSE.
              </p>
            ) : null}
            {devices.map((d) => {
              const st = stateFor(d.topic);
              const base = (d.topic ?? "").replace(/\/#$/, "");
              const fresh = st && Date.now() - st.time < 120000;
              const cmds = commandsFor(d.capabilities);
              const lvl = (k: string, def: number) => levels[`${d.id}-${k}`] ?? def;
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
                    {cmds.includes("switch")
                      ? ["ON", "OFF", "toggle"].map((cmd) => (
                          <button
                            key={cmd}
                            disabled={!base || status !== "online"}
                            onClick={() => sendCommand(base, "switch", cmd)}
                            className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] disabled:opacity-40"
                          >
                            {cmd}
                          </button>
                        ))
                      : null}
                  </div>
                  {cmds.includes("dim") ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="hud-title w-16 text-[9px] text-muted-foreground">DIMMING</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={lvl("dim", 50)}
                        onChange={(e) =>
                          setLevels({ ...levels, [`${d.id}-dim`]: Number(e.target.value) })
                        }
                        onPointerUp={() => sendCommand(base, "dim", String(lvl("dim", 50)))}
                        disabled={!base || status !== "online"}
                        className="h-1 flex-1 accent-primary"
                      />
                      <span className="w-8 text-right text-[10px] text-primary">
                        {lvl("dim", 50)}%
                      </span>
                    </div>
                  ) : null}
                  {cmds.includes("fan") ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="hud-title w-16 text-[9px] text-muted-foreground">VIFTE</span>
                      {["0", "33", "66", "100"].map((s) => (
                        <button
                          key={s}
                          disabled={!base || status !== "online"}
                          onClick={() => sendCommand(base, "fan", s)}
                          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] disabled:opacity-40"
                        >
                          {s === "0" ? "AV" : `${s}%`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {cmds.includes("threshold") ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="hud-title w-16 text-[9px] text-muted-foreground">TERSKEL</span>
                      <input
                        type="number"
                        value={lvl("th", 22)}
                        onChange={(e) =>
                          setLevels({ ...levels, [`${d.id}-th`]: Number(e.target.value) })
                        }
                        className="hud-input h-6 w-20 text-[11px]"
                      />
                      <button
                        disabled={!base || status !== "online"}
                        onClick={() => sendCommand(base, "threshold", String(lvl("th", 22)))}
                        className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] disabled:opacity-40"
                      >
                        sett
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* manuell publisering */}
            <div className="flex items-center gap-1 pt-1">
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
          </>
        ) : null}

        {/* GRAFER */}
        {tab === "grafer" ? (
          <>
            <div className="flex items-center justify-between">
              <span className="hud-title text-[9px] text-muted-foreground">
                {Object.keys(history).length} loggede emner · siste 24 timer
              </span>
              <button
                onClick={clearHistory}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                <Trash2 className="size-3" /> tøm logg
              </button>
            </div>
            {Object.keys(history).length === 0 ? (
              <p className="hud-title text-[10px] text-primary/60">
                Ingen numeriske måleverdier logget ennå – koble til brokeren og vent på data.
              </p>
            ) : null}
            {devices.map((d) => {
              const tps = historyTopics(d.topic ?? "");
              if (!tps.length) return null;
              return (
                <div key={d.id} className="rounded border border-primary/15 bg-primary/[0.03] p-2">
                  <p className="hud-title text-[10px] text-primary">{d.name}</p>
                  {tps.slice(0, 6).map((t) => (
                    <div key={t}>
                      <p className="hud-title text-[9px] text-muted-foreground">
                        {t} · {history[t]?.length ?? 0} punkter
                      </p>
                      <Sparkline data={history[t] ?? []} />
                    </div>
                  ))}
                </div>
              );
            })}
            {Object.keys(history)
              .filter((t) => !devices.some((d) => historyTopics(d.topic ?? "").includes(t)))
              .slice(0, 12)
              .map((t) => (
                <div key={t} className="rounded border border-primary/10 p-2">
                  <p className="hud-title text-[9px] text-muted-foreground">{t}</p>
                  <Sparkline data={historyFor(t)} color="oklch(0.85 0.15 90)" />
                </div>
              ))}
          </>
        ) : null}

        {/* VARSLER */}
        {tab === "varsler" ? (
          <>
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() =>
                  update({ ...config, rules: [...rules, newRule(devices[0]?.topic ?? "")] })
                }
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                <Plus className="size-3" /> ny regel
              </button>
              <button
                onClick={() => void askNotificationPermission()}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                <Bell className="size-3" /> tillat systemvarsler
              </button>
              <button
                onClick={clearAlerts}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                <BellOff className="size-3" /> tøm varsler
              </button>
            </div>

            {alerts.length ? (
              <div className="space-y-1 rounded border border-destructive/30 bg-destructive/5 p-2">
                {alerts.slice(0, 8).map((a) => (
                  <p
                    key={a.id}
                    className={`text-[10px] ${a.level === "crit" ? "text-destructive" : "text-foreground/85"}`}
                  >
                    <span className="hud-title mr-1 text-[9px] text-muted-foreground">
                      {new Date(a.time).toLocaleTimeString("nb-NO")}
                    </span>
                    {a.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="hud-title text-[10px] text-muted-foreground">ingen aktive varsler</p>
            )}

            {rules.map((r) => (
              <div key={r.id} className="space-y-1 rounded border border-primary/15 p-2">
                <div className="flex items-center gap-1">
                  <input
                    value={r.name}
                    onChange={(e) => setRule(r.id, { name: e.target.value })}
                    className="hud-input h-6 flex-1 text-[11px]"
                  />
                  <label className="hud-title flex items-center gap-1 text-[9px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => setRule(r.id, { enabled: e.target.checked })}
                      className="accent-primary"
                    />
                    på
                  </label>
                  <button
                    onClick={() => update({ ...config, rules: rules.filter((x) => x.id !== r.id) })}
                    aria-label={`Slett ${r.name}`}
                    className="hud-btn hud-btn-hoverable !p-1"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <input
                    value={r.topic}
                    onChange={(e) => setRule(r.id, { topic: e.target.value })}
                    placeholder="emne, f.eks. hjem/stue/temp"
                    className="hud-input h-6 min-w-40 flex-1 text-[11px]"
                  />
                  <select
                    value={r.kind}
                    onChange={(e) => setRule(r.id, { kind: e.target.value as AlertRule["kind"] })}
                    className="hud-input h-6 text-[11px]"
                  >
                    <option value="above">over</option>
                    <option value="below">under</option>
                    <option value="equals">lik</option>
                    <option value="stale">signal stopper</option>
                  </select>
                  {r.kind === "stale" ? (
                    <input
                      type="number"
                      value={r.minutes ?? 15}
                      onChange={(e) => setRule(r.id, { minutes: Number(e.target.value) })}
                      className="hud-input h-6 w-16 text-[11px]"
                      aria-label="minutter uten signal"
                    />
                  ) : (
                    <input
                      value={r.value}
                      onChange={(e) => setRule(r.id, { value: e.target.value })}
                      className="hud-input h-6 w-20 text-[11px]"
                      aria-label="grenseverdi"
                    />
                  )}
                  <select
                    value={r.level ?? "warn"}
                    onChange={(e) => setRule(r.id, { level: e.target.value as "warn" | "crit" })}
                    className="hud-input h-6 text-[11px]"
                  >
                    <option value="warn">advarsel</option>
                    <option value="crit">kritisk</option>
                  </select>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {/* OPPDAGELSE */}
        {tab === "oppdagelse" ? (
          <>
            <div className="flex flex-wrap items-center gap-1">
              <input
                value={mqtt.discoveryTopic ?? ""}
                onChange={(e) => patch({ discoveryTopic: e.target.value })}
                placeholder="ekstra søkeemne, f.eks. tele/#"
                className="hud-input h-6 flex-1 text-[11px]"
              />
              <button
                onClick={() => void connectMqtt(mqtt, config.devices ?? [])}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                <RefreshCw className="size-3" /> skann på nytt
              </button>
            </div>
            <p className="hud-title text-[9px] text-muted-foreground">
              Lytter på homeassistant/# og {mqtt.baseTopic || "basisemnet"} og viser emner som ikke
              tilhører en registrert enhet.
            </p>
            {discoveries.length === 0 ? (
              <p className="hud-title text-[10px] text-primary/60">ingen nye enheter oppdaget</p>
            ) : null}
            {discoveries.slice(0, 40).map((d) => (
              <div
                key={d.topic}
                className="flex items-center gap-2 rounded border border-primary/15 p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="hud-title truncate text-[10px] text-primary">
                    {d.name ?? d.topic}
                    {d.kind ? <span className="ml-2 text-muted-foreground">{d.kind}</span> : null}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {d.topic} → {d.value || "—"} · {d.count} meldinger
                  </p>
                </div>
                <button
                  onClick={() => addFromDiscovery(d.topic, d.name)}
                  className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
                >
                  <Plus className="size-3" /> legg til
                </button>
                <button
                  onClick={() => forgetDiscovery(d.topic)}
                  aria-label={`Skjul ${d.topic}`}
                  className="hud-btn hud-btn-hoverable !p-1"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </>
        ) : null}
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
