import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { backend, safe, type MqttHealth } from "@/lib/backend";

const label = "text-[9px] uppercase tracking-[0.25em] text-foreground/40";
const btn =
  "flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-primary/80 transition hover:bg-primary/15";

const klokke = (t?: number | null) => (t ? new Date(t).toLocaleTimeString("nb-NO") : "–");

/** Sanntids helsebilde for MQTT: status, årsak, flapping og oppetid. */
export function MqttHealthSection() {
  const [h, setH] = useState<MqttHealth | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  const last = useCallback(async () => {
    const r = await safe(() => backend.hentMqttHelse());
    if (r.error) setFeil(r.error.message);
    else {
      setFeil(null);
      setH(r.data);
    }
  }, []);

  useEffect(() => {
    void last();
    const t = setInterval(() => void last(), 10_000);
    return () => clearInterval(t);
  }, [last]);

  const tone = !h?.tilkoblet
    ? "border-destructive/30 bg-destructive/[0.06] text-destructive"
    : h.flapper
      ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-200"
      : "border-primary/25 bg-primary/[0.06] text-primary";

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className={label}>MQTT-HELSE</div>
        <button className={btn} onClick={() => void last()}>
          <RefreshCw className="size-3" /> oppdater
        </button>
      </div>

      {feil ? <div className="text-[10px] text-destructive/80">{feil}</div> : null}
      {!h ? (
        <div className="text-[10px] text-foreground/40">Henter status …</div>
      ) : (
        <>
          <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-[10px] ${tone}`}>
            <Activity className="size-3.5" />
            {h.tilkoblet ? (h.flapper ? "Tilkoblet, men forbindelsen flapper" : "Tilkoblet og stabil") : "Frakoblet"}
            {h.sisteArsak && !h.tilkoblet ? ` · ${h.sisteArsak}` : ""}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
            <Stat k="OPPETID" v={`${h.oppetidProsent}%`} />
            <Stat k="MELDINGER" v={String(h.meldinger)} />
            <Stat k="FALL I VINDU" v={String(h.frakoblingerIVindu)} />
            <Stat k="FALL TOTALT" v={String(h.frakoblingerTotalt)} />
            <Stat k="SIST OPP" v={klokke(h.sisteTilkobling)} />
            <Stat k="SIST NED" v={klokke(h.sisteFrakobling)} />
            <Stat k="SISTE ÅRSAK" v={h.sisteArsak ?? "–"} />
            <Stat k="EMNER" v={String(h.kjente ?? 0)} />
          </div>

          {h.hendelser?.length ? (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {h.hendelser.map((e) => (
                <div
                  key={`${e.tid}-${e.tekst}`}
                  className="rounded-xl border border-primary/10 bg-primary/[0.03] px-3 py-1.5 text-[10px] text-foreground/60"
                >
                  <span className="text-primary/70">{klokke(e.tid)}</span> ·{" "}
                  <span
                    className={
                      e.type === "ned" ? "text-destructive/80" : e.type === "flapping" ? "text-amber-300/80" : "text-primary/70"
                    }
                  >
                    {e.type}
                  </span>{" "}
                  · {e.tekst}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-2xl border border-primary/10 bg-primary/[0.03] px-3 py-2">
    <div className="text-[8px] uppercase tracking-[0.25em] text-foreground/35">{k}</div>
    <div className="truncate text-primary/80" title={v}>
      {v}
    </div>
  </div>
);
