import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2, Loader2 } from "lucide-react";
import {
  newModule,
  type DashModule,
  type HudConfig,
  DEVICE_KIND_LABEL,
} from "@/lib/hud-store";
import { historyFor, useMqtt } from "@/lib/mqtt-bridge";
import { fetchIntegration } from "@/lib/integrations.functions";
import { Sparkline } from "./Sparkline";

/** Henter et felt fra JSON via punktsti, f.eks. "0.used.parsed". */
function pick(obj: unknown, path: string): unknown {
  if (!path.trim()) return obj;
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((acc, key) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) return acc[Number(key)];
      if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
}

const fmt = (n: number) => {
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} G`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(Math.round(n * 100) / 100);
};

function IntegrationModule({ mod, config }: { mod: DashModule; config: HudConfig }) {
  const integration = (config.integrations ?? []).find((i) => i.id === mod.integrationId);
  const [value, setValue] = useState<string>("—");
  const [raw, setRaw] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!integration) {
      setError("velg en kobling");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetchIntegration({
        data: {
          baseUrl: integration.baseUrl,
          path: mod.path ?? "/",
          ...(integration.token ? { token: integration.token } : {}),
          kind: integration.kind,
        },
      });
      if (!res.ok) {
        setError(res.error);
        setValue("—");
        return;
      }
      setRaw(res.body.slice(0, 1200));
      let parsed: unknown = res.body;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        /* rå tekst */
      }
      const v = pick(parsed, mod.field ?? "");
      setValue(typeof v === "number" ? fmt(v) : v == null ? "—" : String(v).slice(0, 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : "ukjent feil");
    } finally {
      setBusy(false);
    }
  }, [integration, mod.path, mod.field]);

  useEffect(() => {
    void load();
    const sec = Math.max(10, mod.refreshSec ?? 60);
    const t = setInterval(() => void load(), sec * 1000);
    return () => clearInterval(t);
  }, [load, mod.refreshSec]);

  const num = Number(String(value).replace(/[^\d.-]/g, ""));
  const max = Number(mod.max);
  const pct = Number.isFinite(num) && Number.isFinite(max) && max > 0 ? (num / max) * 100 : null;

  return (
    <div className="space-y-1">
      <p className="text-2xl text-primary">
        {busy ? <Loader2 className="size-4 animate-spin" /> : value}
        {mod.unit ? <span className="ml-1 text-[11px] text-muted-foreground">{mod.unit}</span> : null}
      </p>
      {pct !== null ? (
        <div className="h-1 w-full overflow-hidden rounded bg-primary/10">
          <div
            className="h-full bg-primary/70"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      ) : null}
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
      {!error && value === "—" && raw ? (
        <details>
          <summary className="hud-title cursor-pointer text-[9px] text-muted-foreground">
            se svar for å finne riktig felt
          </summary>
          <pre className="max-h-24 overflow-auto text-[9px] text-muted-foreground">{raw}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function DashboardPanel({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const { status, topics, pingMs } = useMqtt();
  const modules = config.modules ?? [];
  const [editing, setEditing] = useState<string | null>(null);

  const patch = (id: string, p: Partial<DashModule>) =>
    update({ ...config, modules: modules.map((m) => (m.id === id ? { ...m, ...p } : m)) });

  const add = (kind: DashModule["kind"]) => {
    const m = newModule(kind);
    update({ ...config, modules: [...modules, m] });
    setEditing(m.id);
  };

  const nodes = config.nodes.filter((n) => n.enabled);
  const integrations = (config.integrations ?? []).filter((i) => i.enabled);
  const devices = (config.devices ?? []).filter((d) => d.enabled);
  const topicSuggestions = [...new Set([
    ...Object.keys(topics),
    ...devices.flatMap((d) => d.topic ? [d.topic] : []),
  ])];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* oversikt over alt som er tilkoblet */}
      <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
        {[
          { label: "AI-NODER", value: `${nodes.length}`, sub: nodes.map((n) => n.name).join(", ") },
          {
            label: "MQTT",
            value: status === "online" ? `${pingMs ?? "–"} ms` : status.toUpperCase(),
            sub: `${Object.keys(topics).length} emner`,
          },
          {
            label: "KOBLINGER",
            value: `${integrations.length}`,
            sub: integrations.map((i) => i.name).join(", "),
          },
          {
            label: "ENHETER",
            value: `${devices.length}`,
            sub: devices.map((d) => `${d.name} (${DEVICE_KIND_LABEL[d.kind]})`).join(", "),
          },
        ].map((c) => (
          <div key={c.label} className="rounded border border-primary/15 bg-primary/[0.03] p-2">
            <p className="hud-title text-[9px] text-muted-foreground">{c.label}</p>
            <p className="text-lg text-primary">{c.value}</p>
            <p className="truncate text-[9px] text-muted-foreground" title={c.sub}>
              {c.sub || "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {topicSuggestions.slice(0, 6).map((topic) => <button key={topic} onClick={() => { const m = { ...newModule("mqtt-graph"), title: topic.split("/").slice(-2).join(" · ").toUpperCase(), topic }; update({ ...config, modules: [...modules, m] }); }} className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]">+ {topic}</button>)}
        <button
          onClick={() => add("mqtt-graph")}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
        >
          <Plus className="size-3" /> graf-modul
        </button>
        <button
          onClick={() => add("mqtt-value")}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
        >
          <Plus className="size-3" /> verdi-modul
        </button>
        <button
          onClick={() => add("integration")}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
        >
          <Plus className="size-3" /> system-modul (truenas m.fl.)
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto pr-1 md:grid-cols-2">
        {modules.length === 0 ? (
          <p className="hud-title text-[10px] text-primary/60">
            Ingen moduler ennå. Lag f.eks. en system-modul mot TrueNAS med sti
            <code className="mx-1">/pool/dataset</code>og felt
            <code className="mx-1">0.used.parsed</code>for diskbruk.
          </p>
        ) : null}
        {modules.map((m) => (
          <div
            key={m.id}
            className={`rounded border border-primary/15 bg-primary/[0.03] p-2 ${m.w === 2 ? "md:col-span-2" : ""}`}
          >
            <div className="flex items-center gap-1">
              <span className="hud-title flex-1 truncate text-[10px] text-primary">{m.title}</span>
              <button
                onClick={() => setEditing(editing === m.id ? null : m.id)}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                {editing === m.id ? "ferdig" : "endre"}
              </button>
              <button
                onClick={() => patch(m.id, { w: m.w === 2 ? 1 : 2 })}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                {m.w === 2 ? "smal" : "bred"}
              </button>
              <button
                onClick={() =>
                  update({ ...config, modules: modules.filter((x) => x.id !== m.id) })
                }
                aria-label={`Slett ${m.title}`}
                className="hud-btn hud-btn-hoverable !p-1"
              >
                <Trash2 className="size-3" />
              </button>
            </div>

            {editing === m.id ? (
              <div className="mt-1 space-y-1">
                <input
                  value={m.title}
                  onChange={(e) => patch(m.id, { title: e.target.value })}
                  placeholder="tittel"
                  className="hud-input h-6 w-full text-[11px]"
                />
                {m.kind === "integration" ? (
                  <>
                    <select
                      value={m.integrationId ?? ""}
                      onChange={(e) => patch(m.id, { integrationId: e.target.value })}
                      className="hud-select h-6"
                    >
                      <option value="">velg kobling</option>
                      {(config.integrations ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={m.path ?? ""}
                      onChange={(e) => patch(m.id, { path: e.target.value })}
                      placeholder="API-sti, f.eks. /pool/dataset"
                      className="hud-input h-6 w-full text-[11px]"
                    />
                    <input
                      value={m.field ?? ""}
                      onChange={(e) => patch(m.id, { field: e.target.value })}
                      placeholder="felt, f.eks. 0.used.parsed"
                      className="hud-input h-6 w-full text-[11px]"
                    />
                    <div className="flex gap-1">
                      <input
                        value={m.max ?? ""}
                        onChange={(e) => patch(m.id, { max: e.target.value })}
                        placeholder="maks (for søyle)"
                        className="hud-input h-6 flex-1 text-[11px]"
                      />
                      <input
                        value={m.unit ?? ""}
                        onChange={(e) => patch(m.id, { unit: e.target.value })}
                        placeholder="enhet"
                        className="hud-input h-6 w-20 text-[11px]"
                      />
                      <input
                        type="number"
                        value={m.refreshSec ?? 60}
                        onChange={(e) => patch(m.id, { refreshSec: Number(e.target.value) })}
                        aria-label="oppdatering (sek)"
                        className="hud-input h-6 w-20 text-[11px]"
                      />
                    </div>
                  </>
                ) : (
                  <>
                  <input
                    value={m.topic ?? ""}
                    onChange={(e) => patch(m.id, { topic: e.target.value })}
                    placeholder="MQTT-emne, f.eks. hjem/stue/temp"
                    className="hud-input h-6 w-full text-[11px]"
                    list={`topics-${m.id}`}
                  />
                  <datalist id={`topics-${m.id}`}>{topicSuggestions.map((topic) => <option key={topic} value={topic} />)}</datalist>
                  </>
                )}
              </div>
            ) : null}

            <div className="mt-1">
              {m.kind === "mqtt-graph" ? (
                <>
                  <p className="hud-title truncate text-[9px] text-muted-foreground">{m.topic}</p>
                  <Sparkline data={historyFor(m.topic ?? "")} height={m.w === 2 ? 90 : 56} />
                </>
              ) : null}
              {m.kind === "mqtt-value" ? (
                <p className="text-2xl text-primary">
                  {topics[(m.topic ?? "").trim()]?.value ??
                    Object.values(topics)
                      .filter((t) => t.topic.startsWith((m.topic ?? "").replace(/\/#$/, "")))
                      .sort((a, b) => b.time - a.time)[0]?.value ??
                    "—"}
                </p>
              ) : null}
              {m.kind === "integration" ? <IntegrationModule mod={m} config={config} /> : null}
            </div>
          </div>
        ))}
      </div>

      <p className="hud-title flex items-center gap-1 text-[9px] text-muted-foreground">
        <RefreshCw className="size-3" /> system-moduler hentes via serveren, så lokale API-er uten
        CORS fungerer.
      </p>
    </div>
  );
}
