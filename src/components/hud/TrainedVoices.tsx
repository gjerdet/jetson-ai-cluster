import { useEffect, useState } from "react";
import { Check, RefreshCw, Sparkles, Volume2 } from "lucide-react";
import { backend, safe, type TrainedVoice } from "@/lib/backend";

/**
 * Ferdigtrente Piper-stemmer som ligger lokalt på noden.
 * Her velger du hvilken stemme Jarvis skal bruke, og kan trene en stemme
 * videre fra siste checkpoint når du har lastet opp flere klipp.
 */
export function TrainedVoices({ onValgt }: { onValgt?: (fil: string) => void } = {}) {
  const [stemmer, setStemmer] = useState<TrainedVoice[]>([]);
  const [status, setStatus] = useState("");
  const [epoker, setEpoker] = useState(1000);
  const [laster, setLaster] = useState(false);

  const last = async () => {
    setLaster(true);
    const { data, error } = await safe(() => backend.trenteStemmer());
    setLaster(false);
    if (error) return setStatus(error.message);
    setStemmer(data);
  };

  useEffect(() => {
    void last();
  }, []);

  const bruk = async (s: TrainedVoice) => {
    setStatus(`setter ${s.navn} som aktiv stemme…`);
    const { error } = await safe(() => backend.aktiverTrentStemme(s.fil));
    if (error) return setStatus(error.message);
    onValgt?.(s.fil);
    setStatus(`${s.navn} er nå aktiv stemme på noden`);
    void last();
  };

  const eksporter = async (s: TrainedVoice) => {
    setStatus(`lager ferdig stemmefil av ${s.navn}…`);
    const { data, error } = await safe(() => backend.eksporterStemme({ mappe: s.mappe }));
    if (error) return setStatus(error.message);
    setStatus(
      `${data.jobb.navn} lagt i kø – ingen ny trening, bare uthenting av stemmefila. Trykk OPPDATER om et par minutter.`,
    );
  };

  const trenMer = async (s: TrainedVoice) => {
    setStatus(`starter videre trening av ${s.navn}…`);
    const { data, error } = await safe(() => backend.fortsettTrening({ mappe: s.mappe, epoker }));
    if (error) return setStatus(error.message);
    setStatus(`videre trening lagt i kø: ${data.jobb.navn} (+${epoker} epoker) – følg loggen i treningskøen`);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="hud-title text-[10px] text-muted-foreground">DINE TRENTE STEMMER</span>
        <button
          onClick={() => void last()}
          className="flex items-center gap-1 rounded-full border border-primary/20 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-primary"
        >
          <RefreshCw className={`size-3 ${laster ? "animate-spin" : ""}`} /> OPPDATER
        </button>
      </div>

      {!stemmer.length ? (
        <p className="text-[10px] text-muted-foreground">
          Ingen ferdige stemmer enda. Når en trening fullfører, dukker stemmen opp her og kan velges med ett klikk.
        </p>
      ) : null}

      <div className="space-y-1">
        {stemmer.map((s) => (
          <div
            key={s.id}
            className={`rounded-lg border px-2 py-1.5 text-[10px] ${
              s.aktiv ? "border-primary/60 bg-primary/10" : "border-primary/15 bg-primary/[0.03]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Volume2 className="size-3.5 shrink-0 text-primary/70" />
              <div className="min-w-0 flex-1 truncate text-foreground/80">
                {s.navn}
                {s.aktiv ? <span className="ml-1 text-primary">· AKTIV</span> : null}
              </div>
              <span className="shrink-0 text-muted-foreground">
                {s.storrelseMb ? `${s.storrelseMb} MB` : s.fil ? "" : "kun checkpoint"}
              </span>
              {s.fil ? (
                <button
                  onClick={() => void bruk(s)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-primary hover:bg-primary/10"
                >
                  <Check className="size-3" /> BRUK
                </button>
              ) : null}
              {s.kanTreneMer && !s.fil ? (
                <button
                  onClick={() => void eksporter(s)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-primary hover:bg-primary/10"
                >
                  <Download className="size-3" /> LAG STEMMEFIL
                </button>
              ) : null}
              {s.kanTreneMer ? (
                <button
                  onClick={() => void trenMer(s)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-primary/20 px-2 py-0.5 text-muted-foreground hover:text-primary"
                >
                  <Sparkles className="size-3" /> TREN MER
                </button>
              ) : null}
            </div>
            {s.fil ? <div className="mt-1 truncate text-[9px] text-muted-foreground">{s.fil}</div> : null}
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
        Ekstra epoker ved «TREN MER»
        <input
          type="number"
          min={50}
          max={20000}
          step={50}
          value={epoker}
          onChange={(e) => setEpoker(Number(e.target.value) || 1000)}
          className="hud-input w-24 text-[10px]"
        />
      </label>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        «TREN MER» fortsetter fra siste lagrede punkt i samme stemmemappe og tar med alle klipp du har lastet opp
        siden sist. Stemmen blir bedre for hver runde – legg gjerne til flere opptak først.
      </p>

      {status ? <p className="text-[10px] text-primary/80">{status}</p> : null}
    </div>
  );
}
