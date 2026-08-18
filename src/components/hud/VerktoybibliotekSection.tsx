import { useEffect, useState } from "react";
import { Loader2, Play, Power, RotateCcw, Server, Trash2 } from "lucide-react";
import { backend, type ClusterNode, type GeneratedTool, type VerktoyStat } from "@/lib/backend";

/**
 * VERKTØYBIBLIOTEK: selvlagde verktøy med bruksstatistikk – test, av/på,
 * rollback til forrige versjon og sletting.
 */
export function VerktoybibliotekSection() {
  const [verktoy, setVerktoy] = useState<GeneratedTool[]>([]);
  const [stats, setStats] = useState<VerktoyStat[]>([]);
  const [feil, setFeil] = useState<string | null>(null);
  const [jobber, setJobber] = useState<string | null>(null);
  const [siste, setSiste] = useState<string | null>(null);
  const [onske, setOnske] = useState("");
  const [noder, setNoder] = useState<ClusterNode[]>([]);
  const [valgtNode, setValgtNode] = useState("");

  const last = async () => {
    setFeil(null);
    try {
      const r = await backend.hentVerktoybibliotek();
      setVerktoy(r.verktoy ?? []);
      setStats(r.statistikk ?? []);
      const n = await backend.hentNoder().catch(() => ({ noder: [] as ClusterNode[] }));
      setNoder(n.noder ?? []);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void last();
  }, []);

  const kjor = async (navn: string, fn: () => Promise<unknown>) => {
    setJobber(navn);
    setFeil(null);
    setSiste(null);
    try {
      const r = await fn();
      setSiste(JSON.stringify(r).slice(0, 400));
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e));
    } finally {
      setJobber(null);
    }
  };

  const statFor = (navn: string) => stats.find((s) => s.navn === navn);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-xs">
      {feil ? <div className="hud-panel border-rose-500/40 text-[10px] text-rose-400">{feil}</div> : null}

      <div className="flex items-center gap-2">
        <input
          value={onske}
          onChange={(e) => setOnske(e.target.value)}
          placeholder="beskriv et verktøy han skal bygge og teste selv …"
          className="flex-1 rounded border border-primary/20 bg-background/30 px-2 py-1 text-[11px] outline-none"
        />
        <button
          disabled={!onske.trim() || jobber === "bygg"}
          onClick={() => void kjor("bygg", async () => backend.byggVerktoy(onske.trim(), 3))}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
        >
          {jobber === "bygg" ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}
          BYGG
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="hud-title text-[9px] text-muted-foreground">KJØR PÅ</span>
        <select
          value={valgtNode}
          onChange={(e) => setValgtNode(e.target.value)}
          className="flex-1 rounded border border-primary/20 bg-background/30 px-2 py-1 text-[11px] outline-none"
        >
          <option value="">denne Jetson-noden (lokalt)</option>
          {noder.map((n) => (
            <option key={n.id} value={n.id}>
              {n.navn} {n.agentUrl ? "" : "(uten agent)"}
            </option>
          ))}
        </select>
      </div>

      {siste ? (
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-1 font-mono text-[10px] text-cyan-200/80">
          {siste}
        </pre>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {verktoy.map((t) => {
          const s = statFor(t.name);
          return (
            <div key={t.id} className="rounded border border-primary/15 bg-background/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-primary/90">{t.name}</span>
                <span className={`hud-title text-[9px] ${t.enabled ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {t.enabled ? "AKTIV" : "AV"}
                </span>
              </div>
              <p className="text-[10px] text-foreground/70">{t.description}</p>
              <p className="text-[10px] text-muted-foreground">
                {s
                  ? `${s.kall} kall · ${s.feilrate}% feil · ${s.snittMs} ms${s.sisteFeil ? ` · siste feil: ${s.sisteFeil}` : ""}`
                  : "ingen bruk registrert"}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  disabled={jobber === t.id}
                  onClick={() => void kjor(t.id, async () => backend.testGenerertVerktoy(t.id))}
                  className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
                >
                  <Play className="mr-1 inline size-3" />
                  TEST
                </button>
                <button
                  disabled={!valgtNode || jobber === `${t.id}-node`}
                  onClick={() =>
                    void kjor(`${t.id}-node`, async () =>
                      backend.kjorVerktoyPaaNode(valgtNode, t.name, t.testArgs ?? {}),
                    )
                  }
                  className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
                >
                  <Server className="mr-1 inline size-3" />
                  KJØR PÅ NODE
                </button>
                <button
                  onClick={() => void kjor(t.id, async () => backend.settVerktoyAktiv(t.id, !t.enabled))}
                  className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
                >
                  <Power className="mr-1 inline size-3" />
                  {t.enabled ? "SLÅ AV" : "SLÅ PÅ"}
                </button>
                <button
                  onClick={() => void kjor(t.id, async () => backend.rullTilbakeVerktoy(t.id))}
                  className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
                >
                  <RotateCcw className="mr-1 inline size-3" />
                  TILBAKE
                </button>
                <button
                  onClick={() => void kjor(t.id, async () => backend.slettGenerertVerktoy(t.id))}
                  className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] text-rose-400"
                >
                  <Trash2 className="mr-1 inline size-3" />
                  SLETT
                </button>
              </div>
            </div>
          );
        })}
        {!verktoy.length ? (
          <p className="text-[11px] text-muted-foreground">Ingen selvlagde verktøy ennå.</p>
        ) : null}
      </div>
    </div>
  );
}
