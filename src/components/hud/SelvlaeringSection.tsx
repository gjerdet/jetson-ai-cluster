import { useEffect, useState } from "react";
import { Brain, Loader2, RefreshCw, Sprout, Target } from "lucide-react";
import {
  backend,
  safe,
  type LearningEngine,
  type LearningGap,
  type LearningPlanItem,
  type LearningSession,
  type LearningStatus,
} from "@/lib/backend";

const inputCls =
  "w-full rounded-full border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60";
const btnCls =
  "hud-title inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-[9px] text-primary/90 transition hover:bg-primary/15 disabled:opacity-40";

const klokke = (t: number) => new Date(t).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });

/** Selvlæring: hva han mangler kunnskap om, og hva han har lært på egen hånd. */
export function SelvlaeringSection() {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [hull, setHull] = useState<LearningGap[]>([]);
  const [okter, setOkter] = useState<LearningSession[]>([]);
  const [tema, setTema] = useState("");
  const [jobber, setJobber] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  const last = async () => {
    const { data, error } = await safe(() => backend.hentLaering());
    if (error) return setFeil(error.message);
    setFeil(null);
    setStatus(data.status);
    setHull(data.hull);
    setOkter(data.okter);
  };

  useEffect(() => {
    void last();
  }, []);

  const kjor = async (navn: string, fn: () => Promise<string>) => {
    setFeil(null);
    setMelding(null);
    setJobber(navn);
    try {
      setMelding(await fn());
    } catch (e) {
      setFeil(e instanceof Error ? e.message : `Klarte ikke ${navn}`);
    } finally {
      setJobber("");
      await last();
    }
  };

  const laer = (emne: string) =>
    kjor(`lærer om «${emne}»`, async () => {
      const r = await backend.laerTema(emne);
      setTema("");
      return r.ok ? `Lærte om «${r.tema}» fra ${r.kilder} kilder.` : `Fant ingen brukbare kilder om «${r.tema}».`;
    });

  return (
    <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="hud-title flex items-center gap-1.5 text-[10px] text-primary/90">
          <Brain className="h-3.5 w-3.5" /> SELVLÆRING
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={btnCls} onClick={() => void last()} disabled={!!jobber}>
            <RefreshCw className="h-3 w-3" /> OPPDATER
          </button>
          <button className={btnCls} onClick={() => void kjor("selvtest", async () => {
            const r = await backend.kjorSelvtest();
            if (r.hoppet) return r.hoppet;
            return `Selvtest: ${r.score ?? "?"} av 10${r.svakt ? " – nytt læringsbehov notert." : "."}`;
          })} disabled={!!jobber}>
            SELVTEST NÅ
          </button>
          <button className={btnCls} onClick={() => void kjor("oppsummering", async () => {
            const r = await backend.konsoliderLaering();
            return r.hoppet || `${r.notater} nye varige notater.`;
          })} disabled={!!jobber}>
            OPPSUMMER
          </button>
          {status ? (
            <button
              className={btnCls}
              onClick={() => void kjor("endring", async () => {
                const r = await backend.settLaering(!status.aktiv);
                return r.aktiv ? "Selvlæring er på." : "Selvlæring er av.";
              })}
              disabled={!!jobber}
            >
              {status.aktiv ? "SLÅ AV" : "SLÅ PÅ"}
            </button>
          ) : null}
        </div>
      </header>

      {status ? (
        <p className="text-[11px] text-muted-foreground">
          {status.aktiv ? "Lærer på egen hånd når maskinen er ledig." : "Selvlæring er slått av."} ·{" "}
          {status.apneHull} åpne hull · {status.laerteTemaer} temaer lært · {status.okter} økter
          {status.sisteOkt ? ` · sist ${klokke(status.sisteOkt.tid)}` : ""}
        </p>
      ) : null}

      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="Tema han skal lære seg…"
          value={tema}
          onChange={(e) => setTema(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tema.trim()) void laer(tema.trim());
          }}
        />
        <button className={btnCls} onClick={() => tema.trim() && void laer(tema.trim())} disabled={!!jobber || !tema.trim()}>
          <Sprout className="h-3 w-3" /> LÆR
        </button>
      </div>

      {jobber ? (
        <p className="flex items-center gap-1.5 text-[11px] text-primary/80">
          <Loader2 className="h-3 w-3 animate-spin" /> {jobber}…
        </p>
      ) : null}
      {feil ? <p className="text-xs text-destructive">{feil}</p> : null}
      {melding ? <p className="text-xs text-primary/80">{melding}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="hud-title mb-1 text-[9px] text-muted-foreground">KUNNSKAPSHULL</p>
          {hull.length ? (
            <ul className="space-y-1">
              {hull.slice(0, 8).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-primary/15 px-2 py-1 text-[11px]">
                  <span className="truncate">
                    {h.tema}
                    <span className="text-muted-foreground"> · {h.grunn}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{h.status === "lukket" ? "lært" : `${h.antall}×`}</span>
                    {h.status !== "lukket" ? (
                      <button className={btnCls} onClick={() => void laer(h.tema)} disabled={!!jobber}>
                        LÆR NÅ
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">Ingen hull notert ennå.</p>
          )}
        </div>
        <div>
          <p className="hud-title mb-1 text-[9px] text-muted-foreground">LÆRINGSØKTER</p>
          {okter.length ? (
            <ul className="space-y-1">
              {okter.slice(0, 8).map((o, i) => (
                <li key={`${o.tid}-${i}`} className="rounded-lg border border-primary/15 px-2 py-1 text-[11px]">
                  <span className="text-muted-foreground">{klokke(o.tid)}</span> · {o.type}
                  {o.tema ? ` · ${o.tema}` : ""}
                  {typeof o.kilder === "number" ? ` · ${o.kilder} kilder` : ""}
                  {typeof o.score === "number" ? ` · ${o.score}/10` : ""}
                  {typeof o.notater === "number" ? ` · ${o.notater} notater` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">Ingen økter ennå.</p>
          )}
        </div>
      </div>
    </section>
  );
}
