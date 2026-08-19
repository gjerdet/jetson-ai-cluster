import { useEffect, useState } from "react";
import { Trash2, Upload, FileAudio, Copy, Pause, Play, Mic, ShieldCheck } from "lucide-react";
import { backend, backendUrl, BackendError, safe, type VoiceClip, type VoiceClipStats } from "@/lib/backend";
import { TrainingQueue } from "./TrainingQueue";
import { delOppLyd, type Bit } from "@/lib/audio-split";

/** Feiltekst med konkret råd og hvilken adresse som ble forsøkt. */
const feiltekst = (e: Error) =>
  e instanceof BackendError
    ? `${e.message}${e.raad ? ` ${e.raad}` : ""} (adresse: ${backendUrl()})`
    : e.message;

/**
 * Opplasting av treningsklipp for stemme-kloning.
 * Klippene lagres lokalt av agenten (AGENT_DATA/stemmeklipp) sammen med
 * transkripsjonen, og eksporteres som et LJSpeech-manifest til piper-train.
 */
export function VoiceTraining() {
  const [klipp, setKlipp] = useState<VoiceClip[]>([]);
  const [stat, setStat] = useState<VoiceClipStats>({ antall: 0, sekunder: 0, bytes: 0 });
  const [verifisering, setVerifisering] = useState("");
  const [tekst, setTekst] = useState("");
  const [status, setStatus] = useState("");
  const [manifest, setManifest] = useState("");
  const [mappe, setMappe] = useState("");

  const last = async () => {
    const { data, error } = await safe(() => backend.hentKlipp());
    if (error) return setStatus(feiltekst(error));
    setKlipp(data.klipp);
    setStat(data.statistikk);
  };

  useEffect(() => {
    void last();
  }, []);

  const varighet = (fil: File) =>
    new Promise<number>((res) => {
      const url = URL.createObjectURL(fil);
      const a = new Audio(url);
      a.addEventListener("loadedmetadata", () => {
        res(Number.isFinite(a.duration) ? a.duration : 0);
        URL.revokeObjectURL(url);
      });
      a.addEventListener("error", () => res(0));
    });

  const lastOpp = async (filer: FileList | null) => {
    if (!filer?.length) return;
    const alle = Array.from(filer);
    let lagret = 0;
    let feilet = 0;

    for (let f = 0; f < alle.length; f++) {
      const fil = alle[f]!;
      setStatus(`behandler ${fil.name} (${f + 1}/${alle.length})…`);

      let biter: Bit[] = [];
      try {
        biter = await delOppLyd(fil);
      } catch {
        // Klarer ikke nettleseren å dekode fila, sender vi den rå til agenten.
        try {
          const base64 = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).split(",")[1] ?? "");
            r.onerror = () => rej(new Error("Klarte ikke lese fila"));
            r.readAsDataURL(fil);
          });
          const sek = await varighet(fil);
          biter = [{ base64, sekunder: sek, navn: fil.name }];
        } catch (e) {
          feilet++;
          setStatus(`lesefeil for ${fil.name}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
      }

      for (let b = 0; b < biter.length; b++) {
        const bit = biter[b]!;
        setStatus(
          `laster opp ${bit.navn} (fil ${f + 1}/${alle.length}` +
            (biter.length > 1 ? `, del ${b + 1}/${biter.length}` : "") +
            ")…",
        );
        const { error } = await safe(() =>
          backend.leggTilKlipp({
            navn: bit.navn,
            // Transkripsjonen gjelder bare når én fil lastes opp udelt.
            tekst: alle.length === 1 && biter.length === 1 ? tekst : "",
            lydBase64: bit.base64,
            mime: bit.navn.endsWith(".wav") ? "audio/wav" : fil.type || "audio/wav",
            sekunder: bit.sekunder,
          }),
        );
        if (error) {
          feilet++;
          setStatus(`opplastingsfeil for ${bit.navn}: ${feiltekst(error)}`);
        } else {
          lagret++;
        }
      }
      // Oppdater lista underveis så du ser at klippene legger seg oppå de gamle.
      void last();
    }

    if (lagret) setTekst("");
    const { data: ver } = await safe(() => backend.verifiserKlipp());
    if (ver) {
      setVerifisering(
        ver.ok
          ? `verifisert: ${ver.antall} klipp på disk, ingen tapt`
          : `ADVARSEL: ${ver.mangler.length} klipp mangler lydfil på disk`,
      );
    }
    setStatus(
      `lagret ${lagret} klipp` +
        (feilet ? ` – ${feilet} feilet` : "") +
        " – klippene legges til i settet og erstatter ikke de gamle. De brukes ikke av TEST STEMME før en Piper-modell er trent og valgt.",
    );
    void last();
  };


  const settTekst = async (id: string, ny: string) => {
    const { error } = await safe(() => backend.oppdaterKlipp(id, { tekst: ny }));
    if (error) return setStatus(feiltekst(error));
    void last();
  };

  const vekslePause = async (k: VoiceClip) => {
    const { error } = await safe(() => backend.oppdaterKlipp(k.id, { pauset: !k.pauset }));
    if (error) return setStatus(feiltekst(error));
    void last();
  };

  const transkriber = async (id?: string) => {
    const mål = id ? klipp.filter((k) => k.id === id) : klipp.filter((k) => !k.tekst?.trim());
    if (!mål.length) return setStatus("alle klipp har allerede transkripsjon");
    let ok = 0;
    for (let i = 0; i < mål.length; i++) {
      setStatus(`transkriberer ${mål[i]!.navn} (${i + 1}/${mål.length})…`);
      const { error } = await safe(() => backend.transkriberKlipp(mål[i]!.id, Boolean(id)));
      if (error) setStatus(`transkripsjonsfeil for ${mål[i]!.navn}: ${feiltekst(error)}`);
      else ok++;
      void last();
    }
    setStatus(`auto-transkriberte ${ok} av ${mål.length} klipp – rett gjerne teksten manuelt`);
  };

  const verifiser = async () => {
    const { data, error } = await safe(() => backend.verifiserKlipp());
    if (error) return setVerifisering(feiltekst(error));
    setVerifisering(
      data.ok
        ? `OK – ${data.antall} klipp, alle lydfiler finnes i ${data.mappe}` +
            (data.foreldrelose.length ? ` (${data.foreldrelose.length} ubrukte filer på disk)` : "")
        : `ADVARSEL – mangler lydfil for: ${data.mangler.map((m) => m.navn).join(", ")}`,
    );
  };

  const slett = async (id: string) => {
    await safe(() => backend.slettKlipp(id));
    void last();
  };

  const hentManifest = async () => {
    if (!klipp.length) {
      setStatus("Ingen klipp lastet opp enda – last opp lydfiler først, så lager jeg treningssettet.");
      return;
    }
    setStatus("lager treningssett…");
    const { data, error } = await safe(() => backend.hentTreningssett());
    if (error) return setStatus(feiltekst(error));
    setManifest(data.manifest);
    setMappe(data.mappe);
    const utenTekst = klipp.filter((k) => !k.tekst?.trim()).length;
    setStatus(
      data.manifest.trim()
        ? `treningssett klart – ${data.manifest.trim().split("\n").length} linjer` +
            (utenTekst ? ` (${utenTekst} klipp mangler transkripsjon og er utelatt)` : "")
        : "Ingen klipp har transkripsjon – legg inn tekst på klippene før du lager treningssett.",
    );
  };

  const min = Math.round(stat.sekunder / 6) / 10;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="hud-title">TRENINGSKLIPP FOR NY STEMME</span>
        <span>
          {stat.antall} klipp · {min} min
        </span>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Last opp ren tale (helst 16 kHz WAV, 3–15 sek per klipp) med nøyaktig transkripsjon.
        10–20 minutter holder til finetuning av en eksisterende Piper-modell; 30–60 minutter gir
        best resultat. Alt lagres lokalt på Jetson-en. Ett opplastet klipp er bare treningsdata og
        endrer ikke stemmen som brukes av TEST STEMME. Du kan velge mange filer på én gang – lange opptak deles automatisk i 3–15 sek biter og konverteres til WAV 22 kHz mono. Nye opplastinger legges til, ingenting slettes.
      </p>

      <textarea
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        placeholder="Transkripsjon for klippet (brukes når du laster opp én fil om gangen)"
        rows={2}
        className="hud-input w-full resize-none"
      />

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-primary/30 px-4 py-2 text-[10px] text-primary transition-colors hover:bg-primary/10">
        <Upload className="size-3.5" />
        VELG LYDFILER
        <input
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => void lastOpp(e.target.files)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void verifiser()}
          className="flex items-center gap-1 rounded-full border border-primary/20 px-3 py-1 text-[10px] text-muted-foreground hover:text-primary"
        >
          <ShieldCheck className="size-3" /> VERIFISER FILER
        </button>
        <button
          onClick={() => void transkriber()}
          className="flex items-center gap-1 rounded-full border border-primary/20 px-3 py-1 text-[10px] text-muted-foreground hover:text-primary"
        >
          <Mic className="size-3" /> AUTO-TRANSKRIBER MANGLENDE
        </button>
      </div>

      {verifisering ? <p className="text-[10px] text-primary/80">{verifisering}</p> : null}

      <div className="text-[10px] text-muted-foreground">
        {stat.antall} filer · {stat.aktive ?? stat.antall} aktive · {stat.pauset ?? 0} pauset ·{" "}
        {stat.medTekst ?? 0} med tekst
      </div>

      <div className="max-h-72 space-y-1 overflow-y-auto">
        {klipp.map((k) => (
          <div
            key={k.id}
            className={`rounded-lg border px-2 py-1.5 text-[10px] ${
              k.pauset ? "border-primary/10 bg-background/20 opacity-60" : "border-primary/15 bg-primary/[0.03]"
            }`}
          >
            <div className="flex items-center gap-2">
              <FileAudio className="size-3.5 shrink-0 text-primary/70" />
              <div className="min-w-0 flex-1 truncate text-foreground/80">{k.navn}</div>
              <span className="shrink-0 text-muted-foreground">{k.sekunder.toFixed(1)}s</span>
              <button
                title="Auto-transkriber dette klippet"
                onClick={() => void transkriber(k.id)}
                className="shrink-0 text-muted-foreground hover:text-primary"
              >
                <Mic className="size-3.5" />
              </button>
              <button
                title={k.pauset ? "Ta med i trening" : "Pause (utelat fra trening)"}
                onClick={() => void vekslePause(k)}
                className="shrink-0 text-muted-foreground hover:text-primary"
              >
                {k.pauset ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </button>
              <button onClick={() => void slett(k.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                defaultValue={k.tekst}
                key={`${k.id}-${k.tekst}`}
                placeholder="— mangler transkripsjon —"
                onBlur={(e) => {
                  if (e.target.value !== k.tekst) void settTekst(k.id, e.target.value);
                }}
                className="hud-input w-full text-[10px]"
              />
              <span className="shrink-0 text-[9px] text-muted-foreground">{k.tekstKilde || "—"}</span>
            </div>
          </div>
        ))}
        {!klipp.length ? <p className="text-[10px] text-muted-foreground">Ingen klipp lastet opp enda.</p> : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void hentManifest()}
          className="rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary transition-colors hover:bg-primary/10"
        >
          LAG TRENINGSSETT
        </button>
        {manifest ? (
          <button
            onClick={() => void navigator.clipboard.writeText(manifest)}
            className="flex items-center gap-1 rounded-full border border-primary/20 px-3 py-1 text-[10px] text-muted-foreground hover:text-primary"
          >
            <Copy className="size-3" /> KOPIER MANIFEST
          </button>
        ) : null}
      </div>

      {manifest ? (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground">
            Lydfilene ligger i <code>{mappe}</code>. Kjør piper-train derfra med manifestet under
            (<code>metadata.csv</code>), og pek «Piper-modell» til den ferdige <code>.onnx</code>-fila.
          </p>
          <pre className="max-h-32 overflow-auto rounded-lg border border-primary/15 bg-background/40 p-2 text-[9px] text-foreground/70">
            {manifest}
          </pre>
        </div>
      ) : null}

      {status ? <p className="text-[10px] text-muted-foreground">{status}</p> : null}

      <div className="border-t border-primary/15 pt-3">
        <TrainingQueue />
      </div>
    </div>
  );
}
