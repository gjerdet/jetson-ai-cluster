import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Upload } from "lucide-react";
import { backend, safe, type ClusterNode } from "@/lib/backend";
import { NODE_DUTIES, NODE_DUTY_LABELS, type HudConfig, type ModelNode, type NodeDuty } from "@/lib/hud-store";

const btn =
  "flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary/80 transition hover:bg-primary/15 disabled:opacity-40";

const tilKlynge = (n: ModelNode): ClusterNode => ({
  id: n.id,
  navn: n.name,
  baseUrl: n.baseUrl,
  modell: n.model,
  rolle: n.role,
  oppgaver: n.duties?.length ? n.duties : ["chat", "verktoy"],
  aktiv: n.enabled,
  vekt: n.weight ?? 1,
  agentUrl: n.agentUrl ?? "",
  sistSett: Date.now(),
  kilde: "manuell",
});

const fraKlynge = (n: ClusterNode): ModelNode => ({
  id: n.id,
  name: n.navn,
  baseUrl: n.baseUrl,
  model: n.modell,
  role: n.rolle,
  duties: n.oppgaver,
  weight: n.vekt,
  agentUrl: n.agentUrl ?? "",
  enabled: n.aktiv,
});

/**
 * Klyngeregister: noder kan legges til her eller melde seg inn selv
 * (POST /api/noder/registrer med agent-tokenet). Listen deles av alle
 * HUD-er som er koblet til samme backend.
 */
export function ClusterSection({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const [remote, setRemote] = useState<ClusterNode[] | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const last = useCallback(async () => {
    const r = await safe(() => backend.hentNoder());
    if (r.error) {
      setRemote(null);
      setMelding(r.error.message);
    } else {
      setRemote(r.data.noder);
      setMelding(null);
    }
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  const push = async () => {
    setBusy(true);
    const r = await safe(() => backend.lagreNoder(config.nodes.map(tilKlynge)));
    setBusy(false);
    if (r.error) setMelding(r.error.message);
    else {
      setRemote(r.data.noder);
      setMelding(`${r.data.noder.length} noder lagret i klyngen.`);
    }
  };

  const pull = () => {
    if (!remote?.length) return;
    const byId = new Map(config.nodes.map((n) => [n.id, n]));
    for (const n of remote) byId.set(n.id, { ...byId.get(n.id), ...fraKlynge(n) });
    update({ ...config, nodes: [...byId.values()] });
    setMelding(`${remote.length} noder hentet fra klyngen.`);
  };

  return (
    <div className="space-y-2 rounded-2xl border border-primary/15 bg-primary/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-[0.25em] text-primary/60">KLYNGEREGISTER</span>
        <div className="flex gap-2">
          <button className={btn} onClick={() => void last()}>
            <RefreshCw className="size-3" /> sjekk
          </button>
          <button className={btn} disabled={!remote} onClick={pull}>
            <Download className="size-3" /> hent
          </button>
          <button className={btn} disabled={busy} onClick={() => void push()}>
            <Upload className="size-3" /> lagre
          </button>
        </div>
      </div>
      <p className="text-[9px] text-foreground/40">
        Noder kan også melde seg inn selv med POST /api/noder/registrer og agent-tokenet i
        <span className="text-primary/60"> x-agent-token</span>. Velg oppgaver per node under, så ruter
        lastbalansereren samtale, verktøykall og evaluering til riktig maskin.
      </p>
      {remote?.length ? (
        <div className="space-y-1">
          {remote.map((n) => (
            <div
              key={n.id}
              className="flex items-center justify-between rounded-xl border border-primary/10 bg-primary/[0.03] px-3 py-1.5 text-[9px] text-foreground/60"
            >
              <span className="text-primary/70">{n.navn}</span>
              <span className="truncate">
                {n.modell || "?"} · {n.oppgaver.join(", ")} · {n.kilde}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {melding ? <div className="text-[9px] text-foreground/50">{melding}</div> : null}
    </div>
  );
}

/** Valg av hvilke AI-oppgaver en node skal ta. */
export function DutyPicker({
  node,
  onChange,
}: {
  node: ModelNode;
  onChange: (duties: NodeDuty[]) => void;
}) {
  const valgt = node.duties?.length ? node.duties : (["chat", "verktoy"] as NodeDuty[]);
  return (
    <div className="col-span-3 flex flex-wrap gap-1">
      {NODE_DUTIES.map((d) => {
        const on = valgt.includes(d);
        return (
          <button
            key={d}
            onClick={() => onChange(on ? valgt.filter((x) => x !== d) : [...valgt, d])}
            className={`rounded-full px-2.5 py-1 text-[9px] transition ${
              on ? "bg-primary/20 text-primary" : "bg-primary/[0.04] text-foreground/40 hover:bg-primary/10"
            }`}
          >
            {NODE_DUTY_LABELS[d]}
          </button>
        );
      })}
    </div>
  );
}
