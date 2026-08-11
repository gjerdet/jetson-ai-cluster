import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { backend, safe, type BackendSettings, type SettingsGroup } from "@/lib/backend";

const field =
  "w-full rounded-full border border-primary/20 bg-primary/[0.04] px-4 py-2 text-xs text-foreground/90 outline-none transition focus:border-primary/50";
const btn =
  "flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-primary/80 transition hover:bg-primary/15 disabled:opacity-40";
const label = "text-[9px] uppercase tracking-[0.25em] text-foreground/40";

/**
 * Skjemadrevne backend-innstillinger.
 * Skjemaet kommer fra den delte kontrakten, valideres likt i nettleser og
 * på agenten, og tas i bruk med én gang – ingen omstart av serveren.
 */
export function SettingsFormSection() {
  const [skjema, setSkjema] = useState<SettingsGroup[]>([]);
  const [verdier, setVerdier] = useState<BackendSettings>({});
  const [utkast, setUtkast] = useState<BackendSettings>({});
  const [feil, setFeil] = useState<string[]>([]);
  const [melding, setMelding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const last = useCallback(async () => {
    const r = await safe(() => backend.hentSkjema());
    if (r.error) {
      setFeil([r.error.message]);
      return;
    }
    setSkjema(r.data.skjema);
    setVerdier(r.data.verdier);
    setUtkast(r.data.verdier);
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  const felter = useMemo(() => skjema.flatMap((g) => g.felter), [skjema]);

  /** Samme regler som backend – brukeren ser feilen før lagring. */
  const valider = useCallback(
    (v: BackendSettings) => {
      const ut: string[] = [];
      for (const f of felter) {
        const raw = v[f.id];
        if (f.type === "number") {
          const n = Number(raw);
          if (!Number.isFinite(n) || n < (f.min ?? -Infinity) || n > (f.maks ?? Infinity))
            ut.push(`${f.etikett} må være et tall mellom ${f.min} og ${f.maks}.`);
        } else if (f.type === "text") {
          const t = String(raw ?? "").trim();
          if (t.length > (f.maks ?? 500)) ut.push(`${f.etikett} er for lang.`);
          else if (t && f.monster && !new RegExp(f.monster).test(t))
            ut.push(`${f.etikett} har ugyldig format.`);
        }
      }
      return ut;
    },
    [felter],
  );

  const endret = JSON.stringify(utkast) !== JSON.stringify(verdier);
  const feilNaa = valider(utkast);

  const lagre = async () => {
    setBusy(true);
    setMelding(null);
    const r = await safe(() => backend.lagreInnstillinger(utkast));
    setBusy(false);
    if (r.error) {
      setFeil([r.error.message]);
      return;
    }
    setFeil([]);
    setVerdier(r.data.verdier);
    setUtkast(r.data.verdier);
    setMelding(r.data.mqttOmstartet ? "Lagret. MQTT ble koblet opp på nytt." : "Lagret og tatt i bruk.");
  };

  if (!skjema.length)
    return (
      <section className="space-y-2">
        <div className={label}>INNSTILLINGER</div>
        <div className="text-[10px] text-foreground/40">
          {feil.length ? feil.join(" ") : "Henter skjema fra backend …"}
        </div>
      </section>
    );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className={label}>INNSTILLINGER (UTEN OMSTART)</div>
        <div className="flex gap-2">
          <button className={btn} onClick={() => void last()}>
            <RefreshCw className="size-3" /> hent
          </button>
          <button className={btn} disabled={!endret || busy || feilNaa.length > 0} onClick={() => void lagre()}>
            <Save className="size-3" /> lagre
          </button>
        </div>
      </div>

      {skjema.map((g) => (
        <div key={g.gruppe} className="space-y-2 rounded-2xl border border-primary/10 bg-primary/[0.02] p-3">
          <div className="text-[9px] uppercase tracking-[0.25em] text-primary/60">{g.gruppe}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.felter.map((f) => (
              <label key={f.id} className="space-y-1">
                <span className="block text-[10px] text-foreground/60">{f.etikett}</span>
                {f.type === "boolean" ? (
                  <button
                    onClick={() => setUtkast((u) => ({ ...u, [f.id]: !u[f.id] }))}
                    className={`w-full rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.2em] transition ${
                      utkast[f.id]
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-primary/15 bg-primary/[0.03] text-foreground/40"
                    }`}
                  >
                    {utkast[f.id] ? "på" : "av"}
                  </button>
                ) : (
                  <input
                    className={field}
                    type={f.type === "number" ? "number" : "text"}
                    min={f.min}
                    max={f.maks}
                    value={String(utkast[f.id] ?? "")}
                    onChange={(e) =>
                      setUtkast((u) => ({
                        ...u,
                        [f.id]: f.type === "number" ? Number(e.target.value) : e.target.value,
                      }))
                    }
                  />
                )}
                {f.hjelp ? <span className="block text-[9px] text-foreground/35">{f.hjelp}</span> : null}
              </label>
            ))}
          </div>
        </div>
      ))}

      {feilNaa.length ? (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-[10px] text-destructive">
          {feilNaa.join(" ")}
        </div>
      ) : null}
      {feil.length ? <div className="text-[10px] text-destructive/80">{feil.join(" ")}</div> : null}
      {melding ? <div className="text-[10px] text-primary/70">{melding}</div> : null}
    </section>
  );
}
