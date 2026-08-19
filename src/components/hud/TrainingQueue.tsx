import { useEffect, useRef, useState } from "react";
import { Play, Square, Trash2, Rocket, RefreshCw, Volume2 } from "lucide-react";
import { backend, backendUrl, BackendError, safe, type TrainingJob, type TtsConfig } from "@/lib/backend";

const feiltekst = (e: Error) =>
  e instanceof BackendError ? `${e.message}${e.raad ? ` ${e.raad}` : ""} (adresse: ${backendUrl()})` : e.message;

const STATUSFARGE: Record<string, string> = {
  "kø": "text-muted-foreground",
  "kjører": "text-primary",
  ferdig: "text-emerald-400",
  feilet: "text-destructive",
  avbrutt: "text-amber-400",
};

/** Treningskø for Piper-stemmer: status, fremdrift og logg per jobb. */
export function TrainingQueue() {
  const [jobber, setJobber] = useState<TrainingJob[]>([]);
  const [apen, setApen] = useState<string>("");
  const [navn, setNavn] = useState("");
  const [status, setStatus] = useState("");
  const [cfg, setCfg] = useState<TtsConfig | null>(null);
  const timer = useRef<number | null>(null);
  const feil = useRef(0);
  const [offline, setOffline] = useState(false);

  const stoppPolling = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };

  const last = async () => {
    const { data, error } = await safe(() => backend.treningsko());
    if (error) {
      feil.current += 1;
      // Ikke spam backend-en når den ikke svarer (typisk i Lovable-previewet).
      if (feil.current >= 3) {
        stoppPolling();
        setOffline(true);
      }
      return setStatus(feiltekst(error));
    }
    feil.current = 0;
    setOffline(false);
    setJobber(data.jobber);
  };

  const startPolling = () => {
    stoppPolling();
    feil.current = 0;
    setOffline(false);
    void last();
    timer.current = window.setInterval(() => void last(), 4000);
  };

  useEffect(() => {
    void last();
    void safe(() => backend.hentTtsConfig()).then(({ data }) => data && setCfg(data));
    timer.current = window.setInterval(() => void last(), 4000);
    return stoppPolling;
  }, []);

  const lagreCfg = async (endring: Partial<TtsConfig>) => {
    const { data, error } = await safe(() => backend.lagreTtsConfig(endring));
    if (error) return setStatus(feiltekst(error));
    setCfg(data);
    setStatus("innstilling lagret");
  };

  const provelytt = async (modell?: string) => {
    setStatus("lager prøvelyd…");
    const { data, error } = await safe(() =>
      backend.taleLyd("Systemene er tilkoblet. Dette er stemmen min etter trening.", modell),
    );
    if (error) return setStatus(`kunne ikke spille av: ${feiltekst(error)}`);
    const lyd = new Audio(URL.createObjectURL(data));
    void lyd.play();
    setStatus(modell ? `spiller av: ${modell}` : "spiller av aktiv stemme");
  };

  const start = async () => {
    setStatus("transkriberer klipp som mangler tekst og starter trening…");
    const { error } = await safe(() => backend.startTrening({ navn }));
    if (error) return setStatus(feiltekst(error));
    setNavn("");
    setStatus("jobb lagt i kø");
    void last();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="hud-title">TRENINGSKØ</span>
        <button onClick={() => void last()} className="flex items-center gap-1 hover:text-primary">
          <RefreshCw className="size-3" /> OPPDATER
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-[9px] text-muted-foreground">Treningskommando (kjøres lokalt · {"{manifest} {mappe} {navn} {ut}"})</label>
        <input
          className="hud-input w-full"
          defaultValue={cfg?.treningKommando ?? ""}
          placeholder="piper_train --dataset-dir {mappe} --metadata {manifest} --output-dir {ut}"
          onBlur={(e) => void lagreCfg({ treningKommando: e.target.value })}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          className="hud-input flex-1"
          value={navn}
          onChange={(e) => setNavn(e.target.value)}
          placeholder="jobbnavn (valgfritt)"
        />
        <button
          onClick={() => void provelytt()}
          className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
        >
          <Volume2 className="size-3" /> TEST AKTIV STEMME
        </button>
        <button
          onClick={() => void start()}
          className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
        >
          <Play className="size-3" /> START TRENING
        </button>
      </div>

      <div className="space-y-1">
        {jobber.map((j) => (
          <div key={j.id} className="rounded-lg border border-primary/15 bg-primary/[0.03] p-2 text-[10px]">
            <div className="flex items-center gap-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => setApen(apen === j.id ? "" : j.id)}>
                <span className="truncate text-foreground/80">{j.navn}</span>{" "}
                <span className={STATUSFARGE[j.status] ?? ""}>· {j.status}</span>
                <span className="text-muted-foreground"> · {j.klipp} klipp</span>
              </button>
              {j.status === "ferdig" && j.modellFil ? (
                <button
                  title="Prøvelytt denne stemmen"
                  onClick={() => void provelytt(j.modellFil)}
                  className="text-muted-foreground hover:text-primary"
                >
                  <Volume2 className="size-3.5" />
                </button>
              ) : null}
              {j.status === "ferdig" && j.modellFil ? (
                <button
                  title="Bruk som aktiv stemme"
                  onClick={async () => {
                    const { error } = await safe(() => backend.publiserTrening(j.id));
                    setStatus(error ? feiltekst(error) : `publisert: ${j.modellFil}`);
                    void last();
                  }}
                  className="text-muted-foreground hover:text-primary"
                >
                  <Rocket className="size-3.5" />
                </button>
              ) : null}
              {j.status === "kjører" || j.status === "kø" ? (
                <button
                  title="Avbryt"
                  onClick={async () => {
                    await safe(() => backend.avbrytTrening(j.id));
                    void last();
                  }}
                  className="text-muted-foreground hover:text-amber-400"
                >
                  <Square className="size-3.5" />
                </button>
              ) : (
                <button
                  title="Slett jobb"
                  onClick={async () => {
                    await safe(() => backend.slettTrening(j.id));
                    void last();
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            <div className="mt-1 h-1 overflow-hidden rounded-full bg-primary/10">
              <div className="h-full bg-primary transition-all" style={{ width: `${j.fremdrift}%` }} />
            </div>

            {j.feil ? <p className="mt-1 text-destructive">{j.feil}</p> : null}
            {j.publisert ? <p className="mt-1 text-emerald-400">aktiv stemme: {j.publisert}</p> : null}

            {apen === j.id ? (
              <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-primary/15 bg-background/40 p-2 text-[9px] text-foreground/70">
                {(j.logg || []).join("\n") || "ingen logg enda"}
              </pre>
            ) : null}
          </div>
        ))}
        {offline ? (
          <div className="space-y-2 border border-amber-500/40 p-2">
            <p className="text-[10px] text-amber-400">
              Får ikke kontakt med agenten på {backendUrl()} – oppdatering er satt på pause. Opplasting og
              trening fungerer bare når GUI-et åpnes direkte mot Jetson-en (https://192.168.12.5:8443).
            </p>
            <button
              className="hud-title border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
              onClick={startPolling}
            >
              PRØV IGJEN
            </button>
          </div>
        ) : null}
        {!jobber.length && !offline ? <p className="text-[10px] text-muted-foreground">Ingen treningsjobber enda.</p> : null}
      </div>

      {status ? <p className="text-[10px] text-muted-foreground">{status}</p> : null}
    </div>
  );
}
