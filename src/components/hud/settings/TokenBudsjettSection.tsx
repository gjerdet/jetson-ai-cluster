import { useEffect, useState } from "react";
import { Coins, RotateCcw } from "lucide-react";
import type { HudConfig } from "@/lib/hud-store";
import {
  KONSEPTER,
  lesBruk,
  nullstillBruk,
  standardBudsjett,
  type Bruk,
  type Konsept,
  type TokenBudsjett,
} from "@/lib/token-budget";

/** Daglig token-budsjett for eskalering til betalte noder. */
export function TokenBudsjettSection({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const b: TokenBudsjett = { ...standardBudsjett, ...(config.tokenBudsjett ?? {}) };
  const [bruk, setBruk] = useState<Bruk>(() => lesBruk());

  useEffect(() => {
    const oppdater = () => setBruk(lesBruk());
    window.addEventListener("jarvis:budsjett", oppdater);
    const t = setInterval(oppdater, 15000);
    return () => {
      window.removeEventListener("jarvis:budsjett", oppdater);
      clearInterval(t);
    };
  }, []);

  const sett = (patch: Partial<TokenBudsjett>) =>
    update({ ...config, tokenBudsjett: { ...b, ...patch } });

  const tall = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  return (
    <div className="space-y-3 rounded-md border border-[oklch(0.78_0.13_200/0.25)] p-3">
      <div className="flex items-center gap-2 text-[oklch(0.85_0.12_200)]">
        <Coins className="h-4 w-4" />
        <span className="text-xs tracking-widest">TOKEN-BUDSJETT (BETALTE NODER)</span>
      </div>

      <label className="flex items-center gap-2 text-foreground/80">
        <input
          type="checkbox"
          checked={b.aktiv}
          onChange={(e) => sett({ aktiv: e.target.checked })}
          className="accent-[oklch(0.78_0.13_200)]"
        />
        Håndhev daglig budsjett før eskalering til OpenRouter/Hermes
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-foreground/80">
          Tokens per dag (0 = fri)
          <input
            type="number"
            min={0}
            value={b.dagligTokens}
            onChange={(e) => sett({ dagligTokens: tall(e.target.value) })}
            className="hud-input"
            disabled={!b.aktiv}
          />
        </label>
        <label className="flex flex-col gap-1 text-foreground/80">
          Eskaleringer per dag (0 = fri)
          <input
            type="number"
            min={0}
            value={b.dagligEskaleringer}
            onChange={(e) => sett({ dagligEskaleringer: tall(e.target.value) })}
            className="hud-input"
            disabled={!b.aktiv}
          />
        </label>
      </div>

      <div className="space-y-1">
        <div className="text-[11px] tracking-widest text-muted-foreground">
          TAK PER KONSEPT (TOKENS/DAG)
        </div>
        <div className="grid grid-cols-2 gap-2">
          {KONSEPTER.map((k: Konsept) => (
            <label key={k} className="flex items-center justify-between gap-2 text-foreground/80">
              <span className="capitalize">{k}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {bruk.perKonsept[k] ?? 0} brukt
                </span>
                <input
                  type="number"
                  min={0}
                  value={b.perKonsept?.[k] ?? 0}
                  onChange={(e) => sett({ perKonsept: { ...b.perKonsept, [k]: tall(e.target.value) } })}
                  className="hud-input w-20"
                  disabled={!b.aktiv}
                />
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          I dag: ~{bruk.tokens} tokens · {bruk.eskaleringer} eskaleringer
          {b.dagligTokens ? ` av ${b.dagligTokens}` : ""}
        </span>
        <button
          type="button"
          className="hud-btn flex items-center gap-1"
          onClick={() => {
            nullstillBruk();
            setBruk(lesBruk());
          }}
        >
          <RotateCcw className="h-3 w-3" /> Nullstill dagen
        </button>
      </div>
    </div>
  );
}
