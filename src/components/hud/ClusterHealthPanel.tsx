import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Cpu, Boxes, Server, Thermometer, AlertTriangle } from "lucide-react";
import { backend, backendToken, safe, type ClusterHealth, type HealthLevel, type NodeHealth } from "@/lib/backend";

const nivaFarge: Record<HealthLevel, string> = {
  ok: "text-primary",
  advarsel: "text-yellow-400",
  feil: "text-destructive",
};
const nivaPrikk: Record<HealthLevel, string> = {
  ok: "bg-primary shadow-[0_0_8px_hsl(var(--primary))]",
  advarsel: "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]",
  feil: "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))] animate-pulse",
};
const nivaTekst: Record<HealthLevel, string> = { ok: "OK", advarsel: "ADVARSEL", feil: "FEIL" };

const mb = (n?: number | null) => (n == null ? "–" : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);

function Maaler({ prosent, niva }: { prosent: number | null; niva: HealthLevel }) {
  const p = prosent == null ? 0 : Math.max(2, Math.min(100, prosent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
      <div
        className={`h-full rounded-full transition-all ${
          niva === "feil" ? "bg-destructive" : niva === "advarsel" ? "bg-yellow-400" : "bg-primary"
        }`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

function NodeKort({ n }: { n: NodeHealth }) {
  const s = n.snapshot;
  const tjenester = s?.tjenester ?? [];
  const modeller = s?.modeller;
  return (
    <div
      className={`rounded-lg border bg-background/25 p-3 ${
        n.niva === "feil" ? "border-destructive/40" : n.niva === "advarsel" ? "border-yellow-400/30" : "border-primary/20"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-2 rounded-full ${nivaPrikk[n.niva]}`} />
        <span className="hud-wrap flex-1 text-[11px] text-foreground/90">{n.navn}</span>
        <span className={`hud-title text-[9px] ${nivaFarge[n.niva]}`}>{nivaTekst[n.niva]}</span>
      </div>
      <p className="hud-wrap mb-2 text-[9px] text-muted-foreground">
        {n.via === "lokal" ? "denne maskinen" : n.agentUrl || n.baseUrl} · {n.svarMs} ms
        {n.balanserer ? ` · kø ${n.balanserer.inflight} · ${n.balanserer.snittMs ?? "–"} ms snitt` : ""}
      </p>

      {/* GPU */}
      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between text-[9px] text-muted-foreground">
          <span className="hud-title">
            <Cpu className="mr-1 inline size-3" />
            {s?.gpu?.navn ?? "GPU ukjent"}
          </span>
          <span className="text-foreground/70">
            {s?.gpu ? `${mb(s.gpu.frittMb)} ledig / ${mb(s.gpu.totalMb)}` : "–"}
            {s?.gpu?.tempC != null ? (
              <span className={s.gpu.tempC >= 75 ? "ml-2 text-yellow-400" : "ml-2"}>
                <Thermometer className="inline size-3" /> {s.gpu.tempC}°
              </span>
            ) : null}
          </span>
        </div>
        <Maaler prosent={n.frittProsent} niva={n.niva} />
        {s?.gpu?.utnyttelse != null ? (
          <p className="mt-1 text-[9px] text-muted-foreground">GPU-last {s.gpu.utnyttelse}%</p>
        ) : null}
      </div>

      {/* Modeller */}
      <div className="mb-2 text-[9px]">
        <span className="hud-title text-muted-foreground">
          <Boxes className="mr-1 inline size-3" />
          modeller
        </span>{" "}
        {modeller?.ok ? (
          <span className="text-foreground/70">
            {modeller.modeller.length} nedlastet
            {modeller.lastet.length ? ` · ${modeller.lastet.map((m) => m.navn).join(", ")} i minnet` : " · ingen i minnet"}
          </span>
        ) : (
          <span className="text-destructive">{modeller?.feil ?? "ukjent"}</span>
        )}
      </div>

      {/* Tjenester */}
      {tjenester.length ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {tjenester.map((t) => (
            <span
              key={t.navn}
              className={`rounded-full border px-2 py-0.5 text-[8px] uppercase tracking-[0.15em] ${
                t.status === "active"
                  ? "border-primary/30 text-primary/80"
                  : t.status === "ukjent"
                    ? "border-muted-foreground/20 text-muted-foreground"
                    : "border-destructive/40 text-destructive"
              }`}
            >
              <Server className="mr-1 inline size-2.5" />
              {t.navn} · {t.status}
            </span>
          ))}
        </div>
      ) : null}

      {n.varsler?.length ? (
        <ul className="space-y-0.5">
          {n.varsler.map((v, i) => (
            <li key={i} className={`hud-wrap text-[9px] ${nivaFarge[n.niva]}`}>
              <AlertTriangle className="mr-1 inline size-3" />
              {v}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** KLYNGE: helseoversikt for alle noder med tydelige faresignaler. */
export function ClusterHealthPanel() {
  const [data, setData] = useState<ClusterHealth | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [henter, setHenter] = useState(false);
  const [auto, setAuto] = useState(true);

  const hent = useCallback(async (frisk = false) => {
    if (!backendToken()) {
      setFeil("Ikke innlogget mot backend – logg inn under SYSTEM › Backend.");
      return;
    }
    setHenter(true);
    const r = await safe(() => backend.klyngeHelse(frisk));
    setHenter(false);
    if (r.data) setData(r.data);
    setFeil(r.data ? null : (r.error?.message ?? "Kunne ikke hente klyngehelsen."));
  }, []);

  useEffect(() => {
    void hent();
    if (!auto) return;
    const t = setInterval(() => void hent(), 15_000);
    return () => clearInterval(t);
  }, [hent, auto]);

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <p className="hud-title mr-auto text-[10px] text-primary/80">
          <Activity className="mr-1 inline size-3" />
          KLYNGEHELSE
        </p>
        {data ? (
          <span className={`hud-title text-[9px] ${nivaFarge[data.niva]}`}>
            {data.antall} noder · {data.feil} feil · {data.advarsler} advarsler
          </span>
        ) : null}
        <button
          onClick={() => setAuto(!auto)}
          className={`hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] ${auto ? "text-primary" : ""}`}
        >
          {auto ? "auto" : "manuell"}
        </button>
        <button
          onClick={() => void hent(true)}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
          title="Hent ferske målinger fra alle noder"
        >
          <RefreshCw className={`inline size-3 ${henter ? "animate-spin" : ""}`} />
        </button>
      </div>

      {feil ? <p className="hud-wrap text-[10px] text-destructive">{feil}</p> : null}

      <div className="grid min-h-0 flex-1 gap-2 overflow-auto pr-1 sm:grid-cols-2">
        {(data?.noder ?? []).map((n) => (
          <NodeKort key={n.id} n={n} />
        ))}
        {data && !data.noder.length ? (
          <p className="hud-wrap text-[10px] text-muted-foreground">Ingen noder registrert ennå.</p>
        ) : null}
      </div>

      {data ? (
        <p className="text-[9px] text-muted-foreground">
          Oppdatert {new Date(data.tid).toLocaleTimeString("nb-NO")} · lastbalansereren bruker ledig GPU og helsestatus
          til å velge node.
        </p>
      ) : null}
    </div>
  );
}
