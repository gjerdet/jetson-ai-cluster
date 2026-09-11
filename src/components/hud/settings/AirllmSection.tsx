import { useEffect, useState } from "react";
import { Loader2, Play, Square, Download, RefreshCw, Plus } from "lucide-react";
import { backend, type AirllmStatus } from "@/lib/backend";
import type { HudConfig } from "@/lib/hud-store";

/**
 * AirLLM: stor modell lokalt, ett lag om gangen.
 * Tregt, men gir kvalitet uten sky og uten API-nøkler.
 */
export function AirllmSection({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const [status, setStatus] = useState<AirllmStatus | null>(null);
  const [laster, setLaster] = useState(false);
  const [melding, setMelding] = useState("");

  const hent = async () => {
    try {
      setStatus(await backend.airllmStatus());
    } catch (e) {
      setMelding(e instanceof Error ? e.message : "Får ikke kontakt med agenten.");
    }
  };

  useEffect(() => {
    hent();
    const t = setInterval(hent, 10_000);
    return () => clearInterval(t);
  }, []);

  const kjor = async (fn: () => Promise<unknown>, tekst: string) => {
    setLaster(true);
    setMelding(tekst);
    try {
      await fn();
      await hent();
      setMelding("");
    } catch (e) {
      setMelding(e instanceof Error ? e.message : "Noe gikk galt.");
    } finally {
      setLaster(false);
    }
  };

  const leggTilSomNode = () => {
    if (!status) return;
    update({
      ...config,
      nodes: [
        ...config.nodes,
        {
          id: `airllm-${Date.now()}`,
          name: "AirLLM (lokal stor modell)",
          baseUrl: status.baseUrl,
          model: status.config.modell,
          apiKey: "",
          enabled: true,
          role: "worker",
          duties: ["chat"],
        } as HudConfig["nodes"][number],
      ],
    });
    setMelding("Lagt til som node. Den brukes bare til tunge oppgaver.");
  };

  const valgt = status?.config.modell ?? "";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="hud-title text-[9px] text-primary">AirLLM · stor modell lokalt</span>
        <button onClick={hent} className="hud-btn flex items-center gap-1 text-[9px]">
          <RefreshCw className="size-3" /> Oppdater
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Kjører 8B–70B lag for lag på lite GPU-minne. Bruk den til grundige oppgaver som kan ta tid –
        vanlig chat går fortsatt til den raske modellen.
      </p>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <Felt navn="Installert" verdi={status?.installert ? "Ja" : "Nei"} ok={status?.installert} />
        <Felt navn="Kjører" verdi={status?.kjorer ? "Ja" : "Nei"} ok={status?.kjorer} />
        <Felt navn="Modell" verdi={valgt || "—"} />
        <Felt
          navn="Siste svartid"
          verdi={status?.sisteSvarSek != null ? `${status.sisteSvarSek} sek` : status?.opptatt ? "jobber nå …" : "—"}
        />
      </div>

      <div className="rounded border border-primary/25 bg-primary/[0.03] p-2">
        <p className="hud-title mb-1 text-[9px] text-primary">Velg modell</p>
        <div className="space-y-1">
          {(status?.modeller ?? []).map((m) => (
            <button
              key={m.id}
              onClick={() => kjor(() => backend.airllmLagre({ modell: m.id }), "Lagrer valg …")}
              className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left text-[10px] ${
                m.id === valgt ? "border-primary text-primary" : "border-primary/20 hover:border-primary/60"
              }`}
            >
              <span>{m.navn}</span>
              <span className="text-[9px] text-muted-foreground">
                ~{m.diskGb} GB disk · {m.svartid}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground">
          {(status?.modeller ?? []).find((m) => m.id === valgt)?.hint ?? ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={laster}
          onClick={() => kjor(() => backend.installerAirllm(valgt), "Starter installasjon …")}
          className="hud-btn hud-btn-hoverable flex items-center gap-1 text-[9px]"
        >
          {laster ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} Installer AirLLM
        </button>
        <button
          disabled={laster || !status?.installert}
          onClick={() => kjor(() => backend.airllmStart(), "Starter tjenesten …")}
          className="hud-btn hud-btn-hoverable flex items-center gap-1 text-[9px]"
        >
          <Play className="size-3" /> Start
        </button>
        <button
          disabled={laster || !status?.kjorer}
          onClick={() => kjor(() => backend.airllmStopp(), "Stopper tjenesten …")}
          className="hud-btn hud-btn-hoverable flex items-center gap-1 text-[9px]"
        >
          <Square className="size-3" /> Stopp
        </button>
        <button
          disabled={!status?.kjorer}
          onClick={leggTilSomNode}
          className="hud-btn hud-btn-hoverable flex items-center gap-1 text-[9px]"
        >
          <Plus className="size-3" /> Legg til som node
        </button>
      </div>

      {melding ? <p className="text-[10px] text-primary">{melding}</p> : null}
      {status?.feil ? <p className="text-[10px] text-destructive">{status.feil}</p> : null}

      {status?.installasjonsjobb ? (
        <p className="text-[9px] text-muted-foreground">
          Installasjonen kjører nå – følg loggen under SYSTEM → STEMME → TRENINGSKØ.
        </p>
      ) : null}

      {status?.logg ? (
        <pre className="max-h-40 overflow-auto rounded border border-primary/15 bg-background/40 p-2 text-[9px] text-muted-foreground">
          {status.logg}
        </pre>
      ) : null}
    </div>
  );
}

function Felt({ navn, verdi, ok }: { navn: string; verdi: string; ok?: boolean | undefined }) {
  return (
    <div className="rounded border border-primary/15 bg-background/20 px-2 py-1">
      <p className="text-[9px] text-muted-foreground">{navn}</p>
      <p className={ok === undefined ? "text-foreground" : ok ? "text-primary" : "text-muted-foreground"}>{verdi}</p>
    </div>
  );
}
