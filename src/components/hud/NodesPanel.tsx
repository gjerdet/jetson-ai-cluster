import { useState } from "react";
import { Plus, Trash2, Activity } from "lucide-react";
import { pingNode } from "@/lib/hud-client";
import { newNode, type HudConfig, type ModelNode } from "@/lib/hud-store";

export function NodesPanel({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const [latency, setLatency] = useState<Record<string, number | null>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const patch = (id: string, p: Partial<ModelNode>) =>
    update({ ...config, nodes: config.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) });

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-foreground/80">
        <input
          type="checkbox"
          checked={config.collaboration}
          onChange={(e) => update({ ...config, collaboration: e.target.checked })}
          className="accent-[oklch(0.78_0.13_200)]"
        />
        Samarbeidsmodus (la andre modeller vurdere primærsvaret)
      </label>

      {config.nodes.map((n) => (
        <div key={n.id} className="rounded border border-primary/25 bg-primary/5 p-2">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={n.name}
              onChange={(e) => patch(n.id, { name: e.target.value })}
              className="hud-input hud-title flex-1 text-[11px] text-primary"
            />
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={n.enabled}
                onChange={(e) => patch(n.id, { enabled: e.target.checked })}
                className="accent-[oklch(0.78_0.13_200)]"
              />
              aktiv
            </label>
            <button
              onClick={() =>
                update({ ...config, nodes: config.nodes.filter((x) => x.id !== n.id) })
              }
              aria-label="Slett node"
              className="rounded p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={n.baseUrl}
              onChange={(e) => patch(n.id, { baseUrl: e.target.value })}
              placeholder="http://ip:11434/v1"
              className="hud-input col-span-2"
            />
            <input
              value={n.model}
              onChange={(e) => patch(n.id, { model: e.target.value })}
              placeholder="modell"
              className="hud-input"
            />
            <select
              value={n.role}
              onChange={(e) => patch(n.id, { role: e.target.value as ModelNode["role"] })}
              className="hud-select h-6"
            >
              <option value="primary">primær</option>
              <option value="worker">arbeider</option>
              <option value="observer">observatør</option>
            </select>
            <input
              value={n.apiKey ?? ""}
              onChange={(e) => patch(n.id, { apiKey: e.target.value })}
              placeholder="API-nøkkel (valgfritt)"
              className="hud-input col-span-2"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={async () => {
                setTesting(n.id);
                const ms = await pingNode(n);
                setLatency((l) => ({ ...l, [n.id]: ms }));
                setTesting(null);
              }}
              className="flex items-center gap-1 rounded border border-primary/40 px-2 py-1 text-[10px] text-primary hover:bg-primary/15"
            >
              <Activity className="size-3" /> test
            </button>
            <span className="text-[10px] text-muted-foreground">
              {testing === n.id
                ? "tester…"
                : latency[n.id] === undefined
                  ? "ukjent"
                  : latency[n.id] === null
                    ? "ingen kontakt"
                    : `${latency[n.id]} ms`}
            </span>
          </div>
        </div>
      ))}

      <button
        onClick={() => update({ ...config, nodes: [...config.nodes, newNode()] })}
        className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-primary/40 py-2 text-[11px] text-primary hover:bg-primary/10"
      >
        <Plus className="size-3.5" /> legg til node
      </button>
    </div>
  );
}
