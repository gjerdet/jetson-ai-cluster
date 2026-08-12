/**
 * OPPDATERING – starter en kontrollert, lokal systemd-jobb fra HUD-en.
 */
import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { backend, safe, type UpdateStatus } from "@/lib/backend";
import { Button } from "@/components/ui/button";

export function UpdateSection({ agent }: { agent: string | null }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [ref, setRef] = useState("main");
  const [melding, setMelding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hentStatus = async () => {
    const { data, error } = await safe(() => backend.hentOppdateringsstatus());
    if (data) setStatus(data);
    if (error) setMelding(error.message);
  };

  useEffect(() => {
    void hentStatus();
    const timer = window.setInterval(() => void hentStatus(), status?.aktiv ? 2500 : 10_000);
    return () => window.clearInterval(timer);
  }, [status?.aktiv]);

  const start = async () => {
    setBusy(true);
    setMelding(null);
    const { data, error } = await safe(() => backend.startOppdatering(ref));
    setMelding(error?.message ?? data?.melding ?? null);
    setBusy(false);
    if (!error) void hentStatus();
  };

  return (
    <div className="space-y-2 rounded-xl border border-primary/15 bg-background/20 p-3">
      <header className="hud-title text-[9px] text-primary/80">Oppdatering &amp; rollback</header>
      <p className="text-[9px] leading-relaxed text-muted-foreground">
        {agent ? `Noden kjører agent ${agent}.` : "Ikke koblet til en agent akkurat nå."} Oppdateringen tar
        backup, henter valgt versjon, bygger GUI-et og restarter tjenestene automatisk.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 text-[9px] uppercase text-muted-foreground">
          Versjon eller gren
          <input className="mt-1 w-full rounded border border-primary/20 bg-background/40 px-2 py-2 text-[10px] text-foreground" value={ref} onChange={(event) => setRef(event.target.value)} disabled={busy || status?.aktiv} />
        </label>
        <Button size="sm" variant="outline" onClick={() => void start()} disabled={busy || status?.aktiv || !agent}>
          {busy || status?.aktiv ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {status?.aktiv ? "Oppdaterer" : "Start oppdatering"}
        </Button>
      </div>
      <p className="text-[9px] text-muted-foreground">Status: {status?.status ?? "ukjent"}</p>
      {melding ? <p className="text-[9px] text-foreground/80">{melding}</p> : null}
      {status?.logg ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-primary/10 bg-background/40 p-2 font-mono text-[8px] text-primary/80">{status.logg}</pre> : null}
    </div>
  );
}
