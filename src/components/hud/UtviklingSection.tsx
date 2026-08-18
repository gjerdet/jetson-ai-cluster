import { useEffect, useState } from "react";
import { Activity, History, Loader2, Play, Plus, Power, RotateCcw, Server, Stethoscope } from "lucide-react";
import { backend, type Kollega, type KollegaDiagnose, type MaskinKort, type Utvikling } from "@/lib/backend";

/**
 * UTVIKLING: viser hva agenten gjør i død tid – forbedringskø, revisjoner (med rollback),
 * maskin-ID-kort og kollega-diagnose.
 */
export function UtviklingSection() {
  const [data, setData] = useState<Utvikling | null>(null);
  const [kort, setKort] = useState<MaskinKort | null>(null);
  const [kollegaer, setKollegaer] = useState<Kollega[]>([]);
  const [diagnose, setDiagnose] = useState<KollegaDiagnose[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [jobber, setJobber] = useState<string | null>(null);
  const [ny, setNy] = useState("");

  const last = async () => {
    setFeil(null);
    try {
      const [u, i, k] = await Promise.all([
        backend.hentUtvikling(),
        backend.hentIdentitet().catch(() => null),
        backend.hentKollegaer().catch(() => [] as Kollega[]),
      ]);
      setData(u);
      setKort(i?.kort ?? null);
      setKollegaer(k);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void last();
    const id = setInterval(() => void last(), 15_000);
    return () => clearInterval(id);
  }, []);

  const kjor = async (navn: string, fn: () => Promise<unknown>) => {
    setJobber(navn);
    setFeil(null);
    try {
      await fn();
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e));
    } finally {
      setJobber(null);
    }
  };

  const s = data?.status;

  return (
    <div className="space-y-3 text-xs">
      {feil ? <div className="hud-panel border-rose-500/40 text-[10px] text-rose-400">{feil}</div> : null}

      <div className="hud-panel space-y-2">
        <div className="flex items-center justify-between">
          <span className="hud-label flex items-center gap-1">
            <Activity className="size-3" /> Selvforbedring
          </span>
          <div className="flex gap-1">
            <button
              className="rounded border border-primary/30 px-2 py-1 text-[10px] hover:bg-primary/10"
              onClick={() => void kjor("aktiv", () => backend.settUtviklingAktiv(!(s?.aktiv ?? false)))}
            >
              <Power className="mr-1 inline size-3" />
              {s?.aktiv ? "PÅ" : "AV"}
            </button>
            <button
              className="rounded border border-primary/30 px-2 py-1 text-[10px] hover:bg-primary/10"
              disabled={jobber === "kjor"}
              onClick={() => void kjor("kjor", () => backend.kjorUtvikling())}
            >
              {jobber === "kjor" ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : <Play className="mr-1 inline size-3" />}
              KJØR NÅ
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground sm:grid-cols-4">
          <Stat label="Status" verdi={s?.ledig ? "Ledig" : "Bruker aktiv"} />
          <Stat label="I kø" verdi={String(s?.ko ?? 0)} />
          <Stat label="Revisjoner" verdi={String(s?.revisjoner ?? 0)} />
          <Stat label="Jobber nå" verdi={s?.jobberNa ?? "–"} />
        </div>
        <div className="flex gap-1">
          <input
            value={ny}
            onChange={(e) => setNy(e.target.value)}
            placeholder="Legg en forbedringsoppgave i køen…"
            className="flex-1 rounded border border-primary/20 bg-transparent px-2 py-1 text-[10px] outline-none focus:border-primary/60"
          />
          <button
            className="rounded border border-primary/30 px-2 py-1 text-[10px] hover:bg-primary/10"
            onClick={() =>
              ny.trim() &&
              void kjor("ko", async () => {
                await backend.leggIUtviklingsko({ type: "forbedring", tekst: ny.trim(), prioritet: 5 });
                setNy("");
              })
            }
          >
            <Plus className="size-3" />
          </button>
        </div>
      </div>

      <div className="hud-panel space-y-1">
        <span className="hud-label">Lærte regler (R11)</span>
        {!data?.regler?.length ? (
          <div className="text-[10px] text-muted-foreground">
            Ingen lærte regler ennå. Korriger ham i chat – han lagrer regelen selv med laer_regel.
          </div>
        ) : (
          data.regler.map((r, i) => (
            <div key={r.id} className="flex items-start justify-between gap-2 border-b border-primary/10 py-1 text-[10px]">
              <div className="text-foreground">
                <span className="mr-1 font-mono text-primary/80">L{i + 1}</span>
                {r.tekst}
              </div>
              <span className="shrink-0 text-muted-foreground">{new Date(r.tid).toLocaleString("nb-NO")}</span>
            </div>
          ))
        )}
      </div>


      <div className="hud-panel space-y-1">
        <span className="hud-label">Forbedringskø</span>
        {!data?.ko?.length ? (
          <div className="text-[10px] text-muted-foreground">Køen er tom.</div>
        ) : (
          data.ko.map((j) => (
            <div key={j.id} className="flex items-start justify-between gap-2 border-b border-primary/10 py-1 text-[10px]">
              <div>
                <div className="text-foreground">{j.tekst}</div>
                <div className="text-muted-foreground">
                  {j.type} · prioritet {j.prioritet} · {j.status}
                  {j.resultat ? ` · ${j.resultat}` : ""}
                </div>
              </div>
              <span className="shrink-0 text-muted-foreground">{new Date(j.tid).toLocaleTimeString("nb-NO")}</span>
            </div>
          ))
        )}
      </div>

      <div className="hud-panel space-y-1">
        <span className="hud-label flex items-center gap-1">
          <History className="size-3" /> Revisjoner
        </span>
        {!data?.revisjoner?.length ? (
          <div className="text-[10px] text-muted-foreground">Ingen endringer logget enda.</div>
        ) : (
          data.revisjoner.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2 border-b border-primary/10 py-1 text-[10px]">
              <div>
                <div className={r.tilbakerullet ? "text-muted-foreground line-through" : "text-foreground"}>{r.hva}</div>
                <div className="text-muted-foreground">
                  {r.hvorfor} → {r.resultat}
                </div>
              </div>
              {!r.tilbakerullet ? (
                <button
                  className="shrink-0 rounded border border-primary/30 px-2 py-0.5 hover:bg-primary/10"
                  onClick={() => void kjor(`rb-${r.id}`, () => backend.rullTilbakeRevisjon(r.id))}
                >
                  <RotateCcw className="size-3" />
                </button>
              ) : (
                <span className="shrink-0 text-muted-foreground">tilbakerullet</span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="hud-panel space-y-1">
        <span className="hud-label flex items-center gap-1">
          <Server className="size-3" /> Maskin-ID-kort
        </span>
        {!kort ? (
          <div className="text-[10px] text-muted-foreground">Ikke tilgjengelig (lokal agent av?).</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground sm:grid-cols-3">
            <Stat label="Vert" verdi={kort.vert} />
            <Stat label="Modell" verdi={kort.modell} />
            <Stat label="IP" verdi={kort.primaerIp} />
            <Stat label="Subnett" verdi={kort.subnett} />
            <Stat label="CPU/minne" verdi={`${kort.kjerner} kj · ${Math.round(kort.minneMb / 1024)} GB`} />
            <Stat label="Modeller" verdi={String(kort.modeller?.length ?? 0)} />
          </div>
        )}
        <button
          className="rounded border border-primary/30 px-2 py-1 text-[10px] hover:bg-primary/10"
          onClick={() => void kjor("selvtest", async () => {
            const r = await backend.identitetSelvtest();
            setKort(r.kort);
            if (r.avvik?.length) setFeil(`Avvik: ${r.avvik.join("; ")}`);
          })}
        >
          SELVTEST
        </button>
      </div>

      <div className="hud-panel space-y-1">
        <span className="hud-label flex items-center gap-1">
          <Stethoscope className="size-3" /> Kolleger
        </span>
        {!kollegaer.length ? (
          <div className="text-[10px] text-muted-foreground">Ingen kolleger registrert.</div>
        ) : (
          kollegaer.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-2 border-b border-primary/10 py-1 text-[10px]">
              <div>
                <div className="text-foreground">{k.navn}</div>
                <div className="text-muted-foreground">
                  {k.model} · {k.profil?.snittMs ? `${Math.round(k.profil.snittMs)} ms` : "ukjent svartid"}
                  {k.profil?.sisteFeiltekst ? ` · ${k.profil.sisteFeiltekst}` : ""}
                </div>
              </div>
              <button
                className="shrink-0 rounded border border-primary/30 px-2 py-0.5 hover:bg-primary/10"
                disabled={jobber === `diag-${k.id}`}
                onClick={() => void kjor(`diag-${k.id}`, async () => setDiagnose(await backend.diagnoserKollega(k.id)))}
              >
                {jobber === `diag-${k.id}` ? <Loader2 className="size-3 animate-spin" /> : "DIAGNOSE"}
              </button>
            </div>
          ))
        )}
        {diagnose?.map((d, i) => (
          <div key={i} className="mt-1 rounded border border-primary/20 p-2 text-[10px]">
            <div className={d.ok ? "text-emerald-400" : "text-rose-400"}>
              {d.kollega ?? "ukjent"}: {d.ok ? "OK" : "FEIL"}
            </div>
            {d.steg.map((st, j) => (
              <div key={j} className="text-muted-foreground">
                {st.ok === null ? "–" : st.ok ? "✓" : "✗"} {st.navn}: {st.detalj}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, verdi }: { label: string; verdi: string }) {
  return (
    <div>
      <div className="uppercase tracking-wider">{label}</div>
      <div className="text-foreground">{verdi}</div>
    </div>
  );
}
