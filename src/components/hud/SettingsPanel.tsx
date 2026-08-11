import { defaultConfig, type HudConfig } from "@/lib/hud-store";

export function SettingsPanel({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  return (
    <div className="space-y-4 text-xs">
      <div>
        <p className="hud-title mb-1 text-[10px] text-primary/80">Kallesignal</p>
        <input
          value={config.callsign}
          onChange={(e) => update({ ...config, callsign: e.target.value })}
          className="hud-input w-full"
        />
      </div>
      <div>
        <p className="hud-title mb-1 text-[10px] text-primary/80">Status</p>
        <ul className="space-y-1 text-muted-foreground">
          <li>Noder totalt: {config.nodes.length}</li>
          <li>Aktive noder: {config.nodes.filter((n) => n.enabled).length}</li>
          <li>Samarbeidsmodus: {config.collaboration ? "på" : "av"}</li>
        </ul>
      </div>
      <button
        onClick={() => update(defaultConfig)}
        className="rounded border border-destructive/50 px-3 py-1.5 text-[11px] text-destructive hover:bg-destructive/10"
      >
        Tilbakestill konfigurasjon
      </button>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Nodene kalles direkte fra nettleseren via OpenAI-kompatible endepunkter. Sørg for at
        Jetson-noden tillater CORS fra dette domenet.
      </p>
    </div>
  );
}
