/**
 * Konfigdistribusjon til klyngen.
 *
 * Sender gjeldende konfig-pakke til alle noder som har en egen Jarvis-agent,
 * og verifiserer etterpå at nodens egen eksport har nøyaktig samme sjekksum.
 * Kan kjøres manuelt, eller automatisk hver gang konfigen oppdateres her.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { backend, safe, type DistributeResult } from "@/lib/backend";

const btn =
  "rounded-full border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary/90 transition hover:bg-primary/20 disabled:opacity-40";

const AUTO_NOKKEL = "jarvis.konfig.autodistribusjon";

export function lesAutoDistribusjon() {
  try {
    return localStorage.getItem(AUTO_NOKKEL) !== "av";
  } catch {
    return true;
  }
}

export function DistributeSection({
  trigger = 0,
  modus = "flett",
}: {
  /** Økes av VERSJON & KONFIG etter en import – utløser automatisk utrulling. */
  trigger?: number;
  modus?: "flett" | "erstatt";
}) {
  const [resultat, setResultat] = useState<DistributeResult | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(lesAutoDistribusjon());
  const forrigeTrigger = useRef(trigger);

  const distribuer = useCallback(
    async (automatisk = false) => {
      setBusy(true);
      setMelding(null);
      const { data, error } = await safe(() => backend.distribuerKonfig({ modus }));
      setBusy(false);
      if (!data) {
        setMelding(`Distribusjon feilet: ${error?.message ?? "ukjent feil"}`);
        return;
      }
      setResultat(data);
      const feilet = data.resultater.filter((r) => !r.verifisert).length;
      setMelding(
        `${automatisk ? "Automatisk utrulling" : "Utrulling"}: ${data.verifisert}/${data.sendt} noder verifisert` +
          (feilet ? ` · ${feilet} med avvik` : "") +
          (data.hoppetOver.length ? ` · hoppet over ${data.hoppetOver.join(", ")} (mangler agent-adresse)` : ""),
      );
    },
    [modus],
  );

  useEffect(() => {
    if (trigger !== forrigeTrigger.current) {
      forrigeTrigger.current = trigger;
      if (trigger > 0 && auto) void distribuer(true);
    }
  }, [trigger, auto, distribuer]);

  const settAuto = (v: boolean) => {
    setAuto(v);
    try {
      localStorage.setItem(AUTO_NOKKEL, v ? "på" : "av");
    } catch {
      /* ignorer */
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-primary/15 bg-background/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="hud-title mr-auto text-[9px] text-primary/80">Distribusjon til klyngen</span>
        <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <input type="checkbox" checked={auto} onChange={(e) => settAuto(e.target.checked)} />
          rull ut automatisk ved endring
        </label>
        <button className={btn} onClick={() => void distribuer()} disabled={busy}>
          {busy ? "Ruller ut …" : "Rull ut nå"}
        </button>
      </div>

      {resultat ? (
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground">
            sjekksum {resultat.sjekksum} · {resultat.dokumenter.length} dokumenter · modus {resultat.modus}
          </p>
          {resultat.resultater.map((r) => (
            <div
              key={r.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 text-[9px] ${
                r.verifisert
                  ? "border-primary/25 text-primary/85"
                  : r.ok
                    ? "border-yellow-400/30 text-yellow-400/90"
                    : "border-destructive/40 text-destructive"
              }`}
            >
              <span className="hud-wrap flex-1">{r.navn}</span>
              <span>{r.verifisert ? "verifisert" : r.ok ? "sendt, ikke verifisert" : "feilet"}</span>
              <span className="text-muted-foreground">{r.msek} ms</span>
              {r.feil ? <span className="hud-wrap w-full opacity-90">{r.feil}</span> : null}
            </div>
          ))}
          {!resultat.resultater.length ? (
            <p className="hud-wrap text-[9px] text-muted-foreground">
              Ingen noder har agent-adresse ennå. Legg inn «Agent-adresse» på nodene under NODER for å kunne rulle ut
              konfigen automatisk.
            </p>
          ) : null}
        </div>
      ) : null}

      {melding ? <p className="hud-wrap text-[9px] text-foreground/70">{melding}</p> : null}
    </div>
  );
}
