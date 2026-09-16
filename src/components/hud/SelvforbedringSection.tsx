import { useEffect, useState } from "react";
import { Loader2, RefreshCw, TrendingUp, Wrench } from "lucide-react";
import { backend, safe, type CodeProposal, type ImproveDay, type ImproveStatus } from "@/lib/backend";

const inputCls =
  "w-full rounded-full border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60";
const btnCls =
  "hud-title inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-[9px] text-primary/90 transition hover:bg-primary/15 disabled:opacity-40";

const klokke = (t: number) => new Date(t).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });
const pil = (n: number | null | undefined, godtErNed = false) => {
  if (n == null || Number.isNaN(n)) return "–";
  if (n === 0) return "uendret";
  const bra = godtErNed ? n < 0 : n > 0;
  return `${n > 0 ? "+" : ""}${n} ${bra ? "▲" : "▼"}`;
};

/** Daglig framgang og endringer Jarvis gjør på seg selv. */
export function SelvforbedringSection() {
  const [status, setStatus] = useState<ImproveStatus | null>(null);
  const [dager, setDager] = useState<ImproveDay[]>([]);
  const [forslag, setForslag] = useState<CodeProposal[]>([]);
  const [onske, setOnske] = useState("");
  const [jobber, setJobber] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  const last = async () => {
    const { data, error } = await safe(() => backend.hentSelvforbedring());
    if (error) return setFeil(error.message);
    setFeil(null);
    setStatus(data.status);
    setDager(data.dager);
    setForslag(data.kodeforslag);
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

  const idag = dager[0] ?? null;
  const igar = dager[1] ?? null;

  return (
    <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="hud-title flex items-center gap-1.5 text-[10px] text-primary/90">
          <TrendingUp className="h-3.5 w-3.5" /> DAGLIG FREMGANG
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={btnCls} onClick={() => void last()} disabled={!!jobber}>
            <RefreshCw className="h-3 w-3" /> OPPDATER
          </button>
          <button
            className={btnCls}
            disabled={!!jobber}
            onClick={() =>
              void kjor("dagskort", async () => {
                const r = await backend.kjorDagsrapport();
                return `Dagskort lagret for ${r.idag.dato}.`;
              })
            }
          >
            MÅL NÅ
          </button>
          <button
            className={btnCls}
            disabled={!!jobber}
            onClick={() =>
              void kjor("egenvurdering", async () => {
                const r = await backend.kjorRetrospektiv();
                return `${r.vurdering || "Vurdering ferdig"} – ${r.jobber.length} egne tiltak lagt i køen.`;
              })
            }
          >
            VURDER SEG SELV
          </button>
          {status ? (
            <button
              className={btnCls}
              disabled={!!jobber}
              onClick={() =>
                void kjor("innstilling", async () => {
                  const r = await backend.settSelvforbedringAuto(!status.auto);
                  return r.auto
                    ? "Han kan nå endre sin egen kode uten å spørre."
                    : "Endringer i egen kode må godkjennes av deg.";
                })
              }
            >
              EGENENDRING: {status.auto ? "AUTO" : "SPØR MEG"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { navn: "SVARSCORE", verdi: idag?.svarScore ?? "–", endring: igar && idag?.svarScore != null && igar.svarScore != null ? pil(Math.round((idag.svarScore - igar.svarScore) * 10) / 10) : "–" },
          { navn: "VERKTØYFEIL", verdi: `${idag?.verktoyFeilrate ?? 0} %`, endring: igar ? pil((idag?.verktoyFeilrate ?? 0) - igar.verktoyFeilrate, true) : "–" },
          { navn: "ÅPNE HULL", verdi: idag?.apneHull ?? 0, endring: igar ? pil((idag?.apneHull ?? 0) - igar.apneHull, true) : "–" },
          { navn: "EGNE REGLER", verdi: idag?.regler ?? 0, endring: igar ? pil((idag?.regler ?? 0) - igar.regler) : "–" },
        ].map((k) => (
          <div key={k.navn} className="rounded-lg border border-primary/15 bg-background/40 p-2">
            <div className="hud-title text-[8px] text-muted-foreground">{k.navn}</div>
            <div className="text-sm text-foreground">{String(k.verdi)}</div>
            <div className="text-[9px] text-muted-foreground">{k.endring}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="hud-title flex items-center gap-1.5 text-[9px] text-primary/80">
          <Wrench className="h-3 w-3" /> ENDRINGER PÅ SEG SELV
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            className={`${inputCls} max-w-md flex-1`}
            placeholder="Hva skal han forbedre i seg selv? (f.eks. «bedre feilmeldinger i nettleseverktøyet»)"
            value={onske}
            onChange={(e) => setOnske(e.target.value)}
          />
          <button
            className={btnCls}
            disabled={!!jobber || onske.trim().length < 5}
            onClick={() =>
              void kjor("kodeforslag", async () => {
                const r = await backend.lagKodeforslag(onske.trim());
                setOnske("");
                return r.syntaksOk
                  ? `Forslag til ${r.fil} klart: ${r.sammendrag}`
                  : `Forslaget til ${r.fil} strøk på syntakssjekken og ble forkastet.`;
              })
            }
          >
            {jobber === "kodeforslag" ? <Loader2 className="h-3 w-3 animate-spin" /> : null} SKRIV FORSLAG
          </button>
        </div>

        {forslag.length ? (
          <ul className="space-y-1.5">
            {forslag.map((f) => (
              <li key={f.id} className="rounded-lg border border-primary/15 bg-background/40 p-2 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-foreground">
                    {f.fil} · {f.status} · risiko {f.risiko}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{klokke(f.tid)}</span>
                </div>
                <p className="text-muted-foreground">{f.sammendrag || f.onske}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {f.status === "venter" ? (
                    <>
                      <button
                        className={btnCls}
                        disabled={!!jobber}
                        onClick={() =>
                          void kjor("godkjenning", async () => {
                            await backend.kodeforslagHandling(f.id, "godkjenn");
                            return `${f.fil} er endret. Start tjenesten på nytt for å ta det i bruk.`;
                          })
                        }
                      >
                        GODKJENN
                      </button>
                      <button
                        className={btnCls}
                        disabled={!!jobber}
                        onClick={() => void kjor("avvisning", async () => {
                          await backend.kodeforslagHandling(f.id, "avvis");
                          return "Forslaget er avvist.";
                        })}
                      >
                        AVVIS
                      </button>
                    </>
                  ) : null}
                  {f.status === "iverksatt" ? (
                    <button
                      className={btnCls}
                      disabled={!!jobber}
                      onClick={() => void kjor("tilbakerulling", async () => {
                        await backend.kodeforslagHandling(f.id, "tilbake");
                        return `${f.fil} er satt tilbake slik den var.`;
                      })}
                    >
                      RULL TILBAKE
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">Ingen endringer i egen kode foreløpig.</p>
        )}
      </div>

      {melding ? <p className="text-[11px] text-primary/80">{melding}</p> : null}
      {feil ? <p className="text-[11px] text-destructive">{feil}</p> : null}
    </section>
  );
}
