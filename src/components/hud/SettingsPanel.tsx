import { useState } from "react";
import {
  Plus,
  Trash2,
  Sparkles,
  Puzzle,
  Sliders,
  Cpu,
  Network,
  Brain,
  Pin,
  HardDrive,
} from "lucide-react";
import {
  defaultConfig,
  newNode,
  newIntegration,
  newMemory,
  newDevice,
  newPlugin,
  newTalent,
  INTEGRATION_PRESETS,
  DEVICE_KIND_LABEL,
  type HudConfig,
  type MemoryItem,
  type Device,
  type DeviceKind,
  type ModelNode,
  type Plugin,
  type Talent,
  type Integration,
  type IntegrationKind,
} from "@/lib/hud-store";

type Tab = "system" | "modeller" | "enheter" | "minne" | "evner" | "koblinger" | "plugins";

const TABS: { id: Tab; label: string; icon: typeof Sliders }[] = [
  { id: "system", label: "SYSTEM", icon: Sliders },
  { id: "modeller", label: "MODELLER", icon: Cpu },
  { id: "enheter", label: "ENHETER", icon: HardDrive },
  { id: "minne", label: "MINNE", icon: Brain },
  { id: "evner", label: "EVNER", icon: Sparkles },
  { id: "koblinger", label: "KOBLINGER", icon: Network },
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

  const patchNode = (id: string, p: Partial<ModelNode>) =>
    update({ ...config, nodes: config.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) });
  const patchTalent = (id: string, p: Partial<Talent>) =>
    update({ ...config, talents: config.talents.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  const integrations = config.integrations ?? [];
  const patchIntegration = (id: string, p: Partial<Integration>) =>
    update({
      ...config,
      integrations: integrations.map((x) => (x.id === id ? { ...x, ...p } : x)),
    });
  const memories = config.memories ?? [];
  const devices = config.devices ?? [];
  const patchMemory = (id: string, p: Partial<MemoryItem>) =>
    update({ ...config, memories: memories.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const patchDevice = (id: string, p: Partial<Device>) =>
    update({ ...config, devices: devices.map((d) => (d.id === id ? { ...d, ...p } : d)) });
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
            <Field label="Telegram-varsler (chat-ID)">
              <div className="flex items-center gap-2">
                <input
                  value={config.telegram?.chatId ?? ""}
                  onChange={(e) =>
                    update({
                      ...config,
                      telegram: { ...(config.telegram ?? { enabled: false, chatId: "" }), chatId: e.target.value },
                    })
                  }
                  placeholder="f.eks. 123456789"
                  className="hud-input flex-1"
                />
                <label className="hud-title flex items-center gap-1 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={config.telegram?.enabled ?? false}
                    onChange={(e) =>
                      update({
                        ...config,
                        telegram: { ...(config.telegram ?? { chatId: "" }), enabled: e.target.checked },
                      })
                    }
                    className="accent-primary"
                  />
                  på
                </label>
              </div>
            </Field>
            <Field label="Bekreft MQTT-kommandoer fra AI (tørrkjøring)">
              <label className="hud-title flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={config.confirmCommands !== false}
                  onChange={(e) => update({ ...config, confirmCommands: e.target.checked })}
                  className="accent-primary"
                />
                krev bekreftelse før risikable kommandoer publiseres
              </label>
            </Field>
            <Field label={`Panelfyll (lavere = mer gjennomsiktig) – ${config.transparency}%`}>
              <input
                type="range"
                min={2}
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
              Legg til eller fjern modeller systemet skal kobles mot.
            </p>
            {config.nodes.map((n) => (
              <div key={n.id} className="rounded border border-primary/25 bg-primary/[0.03] p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    value={n.name}
                    onChange={(e) => patchNode(n.id, { name: e.target.value })}
                    className="hud-input hud-title flex-1 text-[10px] text-primary"
                  />
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={n.enabled}
                      onChange={(e) => patchNode(n.id, { enabled: e.target.checked })}
                      className="accent-[oklch(0.78_0.13_200)]"
                    />
                    på
                  </label>
                  <button
                    onClick={() =>
                      update({ ...config, nodes: config.nodes.filter((x) => x.id !== n.id) })
                    }
                    aria-label="Fjern modell"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={n.baseUrl}
                    onChange={(e) => patchNode(n.id, { baseUrl: e.target.value })}
                    placeholder="http://ip:11434/v1"
                    className="hud-input col-span-2"
                  />
                  <input
                    value={n.model}
                    onChange={(e) => patchNode(n.id, { model: e.target.value })}
                    placeholder="modell"
                    className="hud-input"
                  />
                  <select
                    value={n.role}
                    onChange={(e) =>
                      patchNode(n.id, { role: e.target.value as ModelNode["role"] })
                    }
                    className="hud-select h-6"
                  >
                    <option value="primary">primær</option>
                    <option value="worker">arbeider</option>
                    <option value="observer">observatør</option>
                  </select>
                  <input
                    value={n.apiKey ?? ""}
                    onChange={(e) => patchNode(n.id, { apiKey: e.target.value })}
                    placeholder="api-nøkkel (valgfri)"
                    className="hud-input col-span-2"
                  />
                </div>
              </div>
            ))}
            <button
              onClick={() => update({ ...config, nodes: [...config.nodes, newNode()] })}
              className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-primary/40 py-2 text-[11px] text-primary hover:bg-primary/10"
            >
              <Plus className="size-3.5" /> legg til modell
            </button>
          </>
        ) : null}

        {tab === "enheter" ? (
          <>
            <p className="text-[10px] text-muted-foreground">
              Registeret over smarthus-enheter (ESP32, ESP8266, Raspberry Pi, sensorer). Aktive
              enheter legges inn i systemprompten, slik at {config.callsign} kjenner navn, rom,
              protokoll og MQTT-emner – og kan generere oppsett for nye enheter i samme mønster.
            </p>
            {devices.length === 0 ? (
              <p className="hud-title text-[10px] text-primary/60">Ingen enheter registrert.</p>
            ) : null}
            {devices.map((d) => (
              <div key={d.id} className="rounded border border-primary/25 bg-primary/[0.04] p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    value={d.name}
                    onChange={(e) => patchDevice(d.id, { name: e.target.value })}
                    className="hud-input hud-title flex-1 text-[11px] text-primary"
                  />
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => patchDevice(d.id, { enabled: e.target.checked })}
                      className="accent-[oklch(0.8_0.13_200)]"
                    />
                    aktiv
                  </label>
                  <button
                    onClick={() =>
                      update({ ...config, devices: devices.filter((x) => x.id !== d.id) })
                    }
                    aria-label="Fjern enhet"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={d.kind}
                    onChange={(e) => patchDevice(d.id, { kind: e.target.value as DeviceKind })}
                    className="hud-select h-6"
                  >
                    {(Object.keys(DEVICE_KIND_LABEL) as DeviceKind[]).map((k) => (
                      <option key={k} value={k} className="bg-background">
                        {DEVICE_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={d.room}
                    onChange={(e) => patchDevice(d.id, { room: e.target.value })}
                    placeholder="rom / plassering"
                    className="hud-input text-[11px]"
                  />
                  <input
                    value={d.host}
                    onChange={(e) => patchDevice(d.id, { host: e.target.value })}
                    placeholder="vertsnavn eller IP"
                    className="hud-input text-[11px]"
                  />
                  <select
                    value={d.protocol}
                    onChange={(e) =>
                      patchDevice(d.id, { protocol: e.target.value as Device["protocol"] })
                    }
                    className="hud-select h-6"
                  >
                    <option value="mqtt" className="bg-background">
                      MQTT
                    </option>
                    <option value="http" className="bg-background">
                      HTTP
                    </option>
                    <option value="websocket" className="bg-background">
                      WebSocket
                    </option>
                  </select>
                  <input
                    value={d.topic ?? ""}
                    onChange={(e) => patchDevice(d.id, { topic: e.target.value })}
                    placeholder="mqtt-emne, f.eks. hjem/stue/lys"
                    className="hud-input text-[11px]"
                  />
                  <input
                    value={d.firmware}
                    onChange={(e) => patchDevice(d.id, { firmware: e.target.value })}
                    placeholder="firmware (ESPHome, Arduino…)"
                    className="hud-input text-[11px]"
                  />
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <input
                    value={d.lat ?? ""}
                    onChange={(e) =>
                      patchDevice(d.id, {
                        lat: Number(e.target.value) || 0,
                      })
                    }
                    placeholder="breddegrad (kart)"
                    className="hud-input text-[11px]"
                  />
                  <input
                    value={d.lon ?? ""}
                    onChange={(e) =>
                      patchDevice(d.id, {
                        lon: Number(e.target.value) || 0,
                      })
                    }
                    placeholder="lengdegrad (kart)"
                    className="hud-input text-[11px]"
                  />
                </div>
                <input
                  value={d.capabilities}
                  onChange={(e) => patchDevice(d.id, { capabilities: e.target.value })}
                  placeholder="kapabiliteter: temperatur, relé, bevegelse…"
                  className="hud-input mt-1.5 w-full text-[11px]"
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {(["esp32", "esp32-cam", "esp8266", "raspberrypi", "sensor"] as DeviceKind[]).map(
                (k) => (
                  <button
                    key={k}
                    onClick={() => update({ ...config, devices: [...devices, newDevice(k)] })}
                    className="flex items-center gap-1.5 rounded border border-dashed border-primary/40 px-3 py-1.5 text-[11px] text-primary hover:bg-primary/10"
                  >
                    <Plus className="size-3.5" /> {DEVICE_KIND_LABEL[k]}
                  </button>
                ),
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Tips: bruk enhet-knappen i KOMMANDO-vinduet for å be {config.callsign} sette opp en ny
              ESP – du får ferdig ESPHome-YAML eller Arduino-kode tilpasset enhetene du allerede
              har.
            </p>
          </>
        ) : null}


        {tab === "minne" ? (
          <>
            <p className="text-[10px] text-muted-foreground">
              Langtidsminne lagres lokalt i nettleseren og legges inn i systemprompten ved hver
              melding. Du kan skrive «husk: …» i chatten for å legge til automatisk.
            </p>
            {memories.length === 0 ? (
              <p className="hud-title text-[10px] text-primary/60">Minnet er tomt.</p>
            ) : null}
            {memories.map((m) => (
              <div key={m.id} className="rounded border border-primary/25 bg-primary/[0.04] p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    value={m.tag}
                    onChange={(e) => patchMemory(m.id, { tag: e.target.value })}
                    placeholder="merkelapp"
                    className="hud-input hud-title w-32 text-[10px] text-primary"
                  />
                  <span className="flex-1 text-[9px] text-muted-foreground">
                    {new Date(m.created).toLocaleString("nb-NO")}
                  </span>
                  <button
                    onClick={() => patchMemory(m.id, { pinned: !m.pinned })}
                    aria-label="Marker som viktig"
                    className={`rounded p-1 ${m.pinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                  >
                    <Pin className="size-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      update({ ...config, memories: memories.filter((x) => x.id !== m.id) })
                    }
                    aria-label="Slett minne"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <textarea
                  value={m.text}
                  onChange={(e) => patchMemory(m.id, { text: e.target.value })}
                  rows={2}
                  placeholder="hva systemet skal huske"
                  className="hud-input w-full resize-none"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                onClick={() => update({ ...config, memories: [...memories, newMemory()] })}
                className="flex flex-1 items-center justify-center gap-2 rounded border border-dashed border-primary/40 py-2 text-[11px] text-primary hover:bg-primary/10"
              >
                <Plus className="size-3.5" /> legg til minne
              </button>
              <button
                onClick={() => update({ ...config, memories: memories.filter((m) => m.pinned) })}
                className="rounded border border-destructive/50 px-3 py-1.5 text-[11px] text-destructive hover:bg-destructive/10"
              >
                Tøm (behold viktige)
              </button>
            </div>
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

        {tab === "koblinger" ? (
          <>
            <p className="text-[10px] text-muted-foreground">
              Koblinger gir systemet tilgang til dine egne tjenester. Verdiene lagres lokalt i
              nettleseren og brukes av HUD-en når den snakker med enhetene.
            </p>
            <div className="flex flex-wrap gap-1">
              {INTEGRATION_PRESETS.map((preset) => (
                <button
                  key={preset.kind}
                  onClick={() =>
                    update({
                      ...config,
                      integrations: [...integrations, newIntegration(preset.kind)],
                    })
                  }
                  className="hud-title hud-btn hud-btn-hoverable !py-0.5 text-[9px]"
                >
                  <Plus className="size-3" /> {preset.name}
                </button>
              ))}
            </div>
            {integrations.map((i) => {
              const hint = INTEGRATION_PRESETS.find((p) => p.kind === i.kind)?.hint;
              return (
                <div key={i.id} className="rounded border border-primary/25 bg-primary/[0.04] p-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <input
                      value={i.name}
                      onChange={(e) => patchIntegration(i.id, { name: e.target.value })}
                      className="hud-input hud-title flex-1 text-[10px] text-primary"
                    />
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={i.enabled}
                        onChange={(e) => patchIntegration(i.id, { enabled: e.target.checked })}
                        className="accent-[oklch(0.78_0.13_200)]"
                      />
                      på
                    </label>
                    <button
                      onClick={() =>
                        update({
                          ...config,
                          integrations: integrations.filter((x) => x.id !== i.id),
                        })
                      }
                      aria-label="Slett kobling"
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={i.kind}
                      onChange={(e) =>
                        patchIntegration(i.id, { kind: e.target.value as IntegrationKind })
                      }
                      className="hud-select h-6"
                    >
                      {INTEGRATION_PRESETS.map((p) => (
                        <option key={p.kind} value={p.kind}>
                          {p.kind}
                        </option>
                      ))}
                    </select>
                    <input
                      value={i.baseUrl}
                      onChange={(e) => patchIntegration(i.id, { baseUrl: e.target.value })}
                      placeholder="https://vert/api"
                      className="hud-input col-span-2"
                    />
                    <input
                      value={i.username ?? ""}
                      onChange={(e) => patchIntegration(i.id, { username: e.target.value })}
                      placeholder="bruker (valgfri)"
                      className="hud-input"
                    />
                    <input
                      value={i.token ?? ""}
                      onChange={(e) => patchIntegration(i.id, { token: e.target.value })}
                      placeholder="API-nøkkel / token"
                      type="password"
                      className="hud-input col-span-2"
                    />
                  </div>
                  {hint ? <p className="mt-1 text-[9px] text-muted-foreground">{hint}</p> : null}
                </div>
              );
            })}
            <button
              onClick={() =>
                update({ ...config, integrations: [...integrations, newIntegration("custom")] })
              }
              className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-primary/40 py-2 text-[11px] text-primary hover:bg-primary/10"
            >
              <Plus className="size-3.5" /> legg til egen kobling
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
                    className="hud-select h-6"
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
