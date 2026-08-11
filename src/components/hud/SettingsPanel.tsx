import { useState } from "react";
import { Plus, Trash2, Sparkles, Puzzle, Sliders, Cpu } from "lucide-react";
import {
  defaultConfig,
  newPlugin,
  newTalent,
  type HudConfig,
  type Plugin,
  type Talent,
} from "@/lib/hud-store";

type Tab = "system" | "modeller" | "evner" | "plugins";

const TABS: { id: Tab; label: string; icon: typeof Sliders }[] = [
  { id: "system", label: "SYSTEM", icon: Sliders },
  { id: "modeller", label: "MODELLER", icon: Cpu },
  { id: "evner", label: "EVNER", icon: Sparkles },
  { id: "plugins", label: "PLUGINS", icon: Puzzle },
];

export function SettingsPanel({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const [tab, setTab] = useState<Tab>("system");

  const patchTalent = (id: string, p: Partial<Talent>) =>
    update({ ...config, talents: config.talents.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  const patchPlugin = (id: string, p: Partial<Plugin>) =>
    update({ ...config, plugins: config.plugins.map((x) => (x.id === id ? { ...x, ...p } : x)) });

  return (
    <div className="flex h-full flex-col gap-3 text-xs">
      <div className="hud-title flex gap-1 text-[9px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1 rounded border px-2 py-1 transition-colors ${
              tab === t.id
                ? "border-primary/60 bg-primary/20 text-primary"
                : "border-primary/20 text-muted-foreground hover:text-primary"
            }`}
          >
            <t.icon className="size-3" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {tab === "system" ? (
          <>
            <Field label="Kallesignal">
              <input
                value={config.callsign}
                onChange={(e) => update({ ...config, callsign: e.target.value })}
                className="hud-input w-full"
              />
            </Field>
            <Field label="Personlighet / systemprompt">
              <textarea
                value={config.persona}
                onChange={(e) => update({ ...config, persona: e.target.value })}
                rows={3}
                className="hud-input w-full resize-none"
              />
            </Field>
            <Field label={`Kreativitet (temperatur) – ${config.temperature.toFixed(2)}`}>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={config.temperature}
                onChange={(e) => update({ ...config, temperature: Number(e.target.value) })}
                className="w-full accent-[oklch(0.78_0.13_200)]"
              />
            </Field>
            <Field label={`Panelfyll (lavere = mer gjennomsiktig) – ${config.transparency}%`}>
              <input
                type="range"
                min={5}
                max={70}
                step={1}
                value={config.transparency}
                onChange={(e) => update({ ...config, transparency: Number(e.target.value) })}
                className="w-full accent-[oklch(0.78_0.13_200)]"
              />
            </Field>
            <label className="flex items-center gap-2 text-foreground/80">
              <input
                type="checkbox"
                checked={config.collaboration}
                onChange={(e) => update({ ...config, collaboration: e.target.checked })}
                className="accent-[oklch(0.78_0.13_200)]"
              />
              Samarbeidsmodus
            </label>
            <button
              onClick={() => update(defaultConfig)}
              className="rounded border border-destructive/50 px-3 py-1.5 text-[11px] text-destructive hover:bg-destructive/10"
            >
              Tilbakestill konfigurasjon
            </button>
          </>
        ) : null}

        {tab === "modeller" ? (
          <>
            <p className="text-[10px] text-muted-foreground">
              Tilkoblede modeller. Rediger noder i NODER-vinduet.
            </p>
            {config.nodes.map((n) => (
              <div
                key={n.id}
                className="flex items-center justify-between rounded border border-primary/20 bg-primary/[0.04] px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="hud-title text-[10px] text-primary/85">{n.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {n.model} · {n.baseUrl}
                  </p>
                </div>
                <span
                  className={`hud-title shrink-0 text-[9px] ${
                    n.enabled ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {n.enabled ? n.role : "av"}
                </span>
              </div>
            ))}
          </>
        ) : null}

        {tab === "evner" ? (
          <>
            <p className="text-[10px] text-muted-foreground">
              Aktive evner legges automatisk inn i systemprompten til modellene.
            </p>
            {config.talents.map((t) => (
              <div key={t.id} className="rounded border border-primary/25 bg-primary/[0.04] p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    value={t.name}
                    onChange={(e) => patchTalent(t.id, { name: e.target.value })}
                    className="hud-input hud-title flex-1 text-[10px] text-primary"
                  />
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={(e) => patchTalent(t.id, { enabled: e.target.checked })}
                      className="accent-[oklch(0.78_0.13_200)]"
                    />
                    aktiv
                  </label>
                  <button
                    onClick={() =>
                      update({ ...config, talents: config.talents.filter((x) => x.id !== t.id) })
                    }
                    aria-label="Slett evne"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <input
                  value={t.description}
                  onChange={(e) => patchTalent(t.id, { description: e.target.value })}
                  placeholder="kort beskrivelse"
                  className="hud-input mb-1.5 w-full"
                />
                <textarea
                  value={t.prompt}
                  onChange={(e) => patchTalent(t.id, { prompt: e.target.value })}
                  rows={2}
                  placeholder="instruksjon som lærer modellen evnen"
                  className="hud-input w-full resize-none"
                />
              </div>
            ))}
            <button
              onClick={() => update({ ...config, talents: [...config.talents, newTalent()] })}
              className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-primary/40 py-2 text-[11px] text-primary hover:bg-primary/10"
            >
              <Plus className="size-3.5" /> lær ny evne
            </button>
          </>
        ) : null}

        {tab === "plugins" ? (
          <>
            <p className="text-[10px] text-muted-foreground">
              Plugins kobler systemet til eksterne tjenester via HTTP-endepunkter.
            </p>
            {config.plugins.map((p) => (
              <div key={p.id} className="rounded border border-primary/25 bg-primary/[0.04] p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    value={p.name}
                    onChange={(e) => patchPlugin(p.id, { name: e.target.value })}
                    className="hud-input hud-title flex-1 text-[10px] text-primary"
                  />
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => patchPlugin(p.id, { enabled: e.target.checked })}
                      className="accent-[oklch(0.78_0.13_200)]"
                    />
                    på
                  </label>
                  <button
                    onClick={() =>
                      update({ ...config, plugins: config.plugins.filter((x) => x.id !== p.id) })
                    }
                    aria-label="Slett plugin"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={p.kind}
                    onChange={(e) => patchPlugin(p.id, { kind: e.target.value as Plugin["kind"] })}
                    className="hud-input"
                  >
                    <option value="http">http</option>
                    <option value="webhook">webhook</option>
                    <option value="telegram">telegram</option>
                  </select>
                  <input
                    value={p.endpoint}
                    onChange={(e) => patchPlugin(p.id, { endpoint: e.target.value })}
                    placeholder="endepunkt / URL"
                    className="hud-input col-span-2"
                  />
                </div>
              </div>
            ))}
            <button
              onClick={() => update({ ...config, plugins: [...config.plugins, newPlugin()] })}
              className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-primary/40 py-2 text-[11px] text-primary hover:bg-primary/10"
            >
              <Plus className="size-3.5" /> legg til plugin
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="hud-title mb-1 text-[10px] text-primary/80">{label}</p>
      {children}
    </div>
  );
}
