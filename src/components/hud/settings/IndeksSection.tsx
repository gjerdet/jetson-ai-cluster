import { useEffect, useState } from "react";
import { Gauge, Loader2, Play, RefreshCw, Square, Wrench } from "lucide-react";
import { backend, safe, type VectorIndexStatus } from "@/lib/backend";

const btnCls =
  "hud-title inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-[9px] text-primary/90 transition hover:bg-primary/15 disabled:opacity-40";

/**
 * Rask vektorindeks (turbovec). Er den ikke installert eller stoppet,
 * søker Jarvis som før – panelet sier bare hva som er aktivt.
 */
export function IndeksSection() {
  const [status, setStatus] = useState<VectorIndexStatus | null>(null);
  const [jobber, setJobber] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  const last = async () => {
    const { data, error } = await safe(() => backend.indeksStatus());
    if (data) setStatus(data);
    else if (error) setFeil(error.message);
  };

  useEffect(() => {
    void last();
    const t = setInterval(() => void last(), 10_000);
    return () => clearInterval(t);
  }, []);

  const kjor = async (navn: string, fn: () => Promise<unknown>) => {
    setFeil(null);
    setMelding(null);
    setJobber(navn);
    const { error } = await safe(fn);
    setJobber("");
    if (error) setFeil(error.message);
    else setMelding(`${navn} ferdig.`);
    await last();
  };

  return (
    <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
      <header className="flex flex-wrap items-center gap-2">
        <Gauge className="size-3.5 text-primary/80" />
        <p className="hud-title text-[9px] text-primary/80">RASK INDEKS (TURBOVEC)</p>
        <span className="hud-title rounded-full border border-primary/20 px-2 py-0.5 text-[8px] text-muted-foreground">
          {!status
            ? "henter status…"
            : !status.installert
              ? "ikke installert – bruker vanlig søk"
              : status.kjorer
                ? `aktiv · ${status.vektorer} vektorer · ${status.bits} bit${
                    status.sisteSokMs != null ? ` · siste søk ${status.sisteSokMs} ms` : ""
                  }`
                : "installert, men stoppet – bruker vanlig søk"}
        </span>
        {jobber ? (
          <span className="hud-title flex items-center gap-1 text-[8px] text-primary/70">
            <Loader2 className="size-3 animate-spin" /> {jobber}
          </span>
        ) : null}
      </header>

      <p className="text-[10px] text-muted-foreground">
        Komprimerer vektorene og søker mye raskere når basen vokser. Alt kjører lokalt på noden.
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={btnCls} disabled={!!jobber} onClick={() => void kjor("Installasjon", () => backend.indeksInstaller())}>
          <Wrench className="size-3" /> Installer turbovec
        </button>
        <button
          className={btnCls}
          disabled={!!jobber || !status?.installert || status?.kjorer}
          onClick={() => void kjor("Start", () => backend.indeksStart())}
        >
          <Play className="size-3" /> Start indeks
        </button>
        <button
          className={btnCls}
          disabled={!!jobber || !status?.kjorer}
          onClick={() => void kjor("Stopp", () => backend.indeksStopp())}
        >
          <Square className="size-3" /> Stopp
        </button>
        <button
          className={btnCls}
          disabled={!!jobber || !status?.kjorer}
          onClick={() =>
            void kjor("Bygg indeks", async () => {
              const r = await backend.indeksBygg();
              setMelding(`Indeksen er bygget på nytt: ${r.indeksert} av ${r.totalt} vektorer.`);
              return r;
            })
          }
        >
          <RefreshCw className="size-3" /> Bygg indeks på nytt
        </button>
      </div>

      {feil ? <p className="text-xs text-destructive">{feil}</p> : null}
      {melding ? <p className="text-xs text-primary/80">{melding}</p> : null}
      {status?.feil ? <p className="text-[10px] text-destructive/80">{status.feil}</p> : null}
      {status?.logg ? (
        <pre className="max-h-32 overflow-auto rounded-lg border border-primary/15 bg-background/40 p-2 text-[9px] text-muted-foreground">
          {status.logg}
        </pre>
      ) : null}
    </section>
  );
}
