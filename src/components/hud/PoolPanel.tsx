import { useEffect, useState } from "react";
import { Network, RefreshCw, Trash2, ShieldAlert } from "lucide-react";
import { backend, backendToken, safe, type PoolStatus } from "@/lib/backend";
import { useRoutingLog, clearRouting } from "@/lib/routing-log";
import type { HudConfig } from "@/lib/hud-store";

const OPPGAVER = ["chat", "verktoy", "embed"];

function bar(v: number, max: number) {
  return `${Math.min(100, max > 0 ? (v / max) * 100 : 0)}%`;
}

export function PoolPanel({ config }: { config: HudConfig }) {
  const [oppgave, setOppgave] = useState("chat");
  const [pool, setPool] = useState<PoolStatus | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [henter, setHenter] = useState(false);
  const ruting = useRoutingLog();

  useEffect(() => {
    let stopped = false;
    const hent = async () => {
      if (!backendToken()) {
        setPool(null);
        setFeil("Ikke innlogget mot backend – logg inn under SYSTEM › Backend.");
        return;
      }
      setHenter(true);
      const r = await safe(() => backend.aiPool(oppgave));
      if (stopped) return;
      setHenter(false);
      setPool(r.data ?? null);
      setFeil(r.data ? null : (r.error?.message ?? "Kunne ikke hente /ai/pool."));
    };
    void hent();
    const t = setInterval(() => void hent(), 5_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [oppgave]);

  const noder = pool?.noder ?? [];
  const maxKall = Math.max(1, ...noder.map((n) => n.kall));
  const laast = config.loadBalance === false && config.aiNodeId ? config.aiNodeId : null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto pr-1 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hud-title text-[10px] text-primary/80">
          <Network className="mr-1 inline size-3" />
          /api/ai/pool · {noder.length} noder
          {laast ? ` · låst til ${laast}` : ""}
        </p>
        <div className="flex items-center gap-1">
          {OPPGAVER.map((o) => (
            <button
              key={o}
              onClick={() => setOppgave(o)}
              className={`hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] ${
                oppgave === o ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {o}
            </button>
          ))}
          <RefreshCw className={`size-3 text-primary/70 ${henter ? "animate-spin" : "opacity-40"}`} />
        </div>
      </div>

      {feil ? <p className="text-[10px] text-destructive">{feil}</p> : null}

      <section className="space-y-2">
        <p className="hud-title text-[9px] text-muted-foreground">LIVE HELSE OG BELASTNING</p>
        {noder.length === 0 && !feil ? (
          <p className="text-muted-foreground">Ingen noder registrert i klyngen.</p>
        ) : null}
        {noder.map((n, i) => {
          const rate = n.kall > 0 ? n.ok / n.kall : 1;
          const neste = i === 0 && !n.karantene;
          return (
            <div
              key={n.id}
              className={`rounded border p-2 ${
                n.karantene ? "border-destructive/40" : neste ? "border-primary/40" : "border-primary/15"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="hud-title text-[10px] text-primary/90">
                  {neste ? "▸ " : ""}
                  {n.navn}
                </span>
                <span className={n.karantene ? "text-destructive" : "text-primary"}>
                  {n.karantene ? (
                    <>
                      <ShieldAlert className="mr-1 inline size-3" />
                      karantene {n.karanteneSek}s
                    </>
                  ) : (
                    `kostnad ${Math.round(n.kostnad)}`
                  )}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {n.modell} · vekt {n.vekt} · {n.inflight} i kø · siste {n.sisteMs ?? "–"} ms · snitt{" "}
                {n.snittMs ?? "–"} ms
              </p>
              <p className="text-[10px] text-muted-foreground">
                {n.ok}/{n.kall} ok ({Math.round(rate * 100)} %) · {n.feil} feil
                {n.sisteFeil ? ` · ${n.sisteFeil}` : ""}
              </p>
              <div className="mt-1 h-1 w-full overflow-hidden rounded bg-primary/10">
                <div
                  className={n.karantene ? "h-full bg-destructive/70" : "h-full bg-primary/60"}
                  style={{ width: bar(n.kall, maxKall) }}
                />
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="hud-title text-[9px] text-muted-foreground">VALGT NODE PER FORESPØRSEL</p>
          <button
            onClick={clearRouting}
            className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] text-muted-foreground"
          >
            <Trash2 className="mr-1 inline size-3" />
            tøm
          </button>
        </div>
        {ruting.length === 0 ? (
          <p className="text-muted-foreground">Ingen forespørsler ennå i denne økten.</p>
        ) : null}
        {ruting.map((r, i) => (
          <div key={`${r.t}-${i}`} className="rounded border border-primary/10 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`hud-title text-[10px] ${r.feil ? "text-destructive" : "text-primary/90"}`}>
                {r.nodeNavn}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(r.t).toLocaleTimeString("nb-NO")}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {r.oppgave}
              {r.model ? ` · ${r.model}` : ""}
              {r.ms != null ? ` · ${r.ms} ms` : ""}
              {r.nodeId ? ` · ${r.nodeId}` : ""}
            </p>
            {r.feil ? <p className="text-[10px] text-destructive">{r.feil}</p> : null}
            {r.hoppetOver?.length ? (
              <p className="text-[10px] text-destructive/80">
                hoppet over: {r.hoppetOver.map((h) => `${h.node} (${h.feil})`).join(", ")}
              </p>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}
