import { useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  Trash2,
  Rocket,
  RefreshCw,
  Volume2,
  Wand2,
  Download,
  CheckCircle2,
  XCircle,
  Stethoscope,
  Share2,
  Server,
  BarChart3,
} from "lucide-react";
import {
  backend,
  backendUrl,
  BackendError,
  safe,
  type TrainingJob,
  type TrainingPlan,
  type PiperSelftest,
  type PiperPreflight,
  type TtsConfig,
  type TrainingResult,
  type TrainingNodes,
  type TrainingDistribution,
} from "@/lib/backend";

const feiltekst = (e: Error) =>
  e instanceof BackendError ? `${e.message}${e.raad ? ` ${e.raad}` : ""} (adresse: ${backendUrl()})` : e.message;

const STATUSFARGE: Record<string, string> = {
  "kø": "text-muted-foreground",
  "kjører": "text-primary",
  ferdig: "text-emerald-400",
  feilet: "text-destructive",
  avbrutt: "text-amber-400",
};

const TESTSETNING = "Systemene er tilkoblet. Dette er stemmen min etter trening.";

/** Ja/nei-merke for miljøsjekken. */
function Sjekk({ ok, navn }: { ok: boolean; navn: string }) {
  return (
    <span className={`flex items-center gap-1 ${ok ? "text-emerald-400" : "text-destructive"}`}>
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />} {navn}
    </span>
  );
}

/** Resultatliste fra den automatiske systemtesten av Piper-miljøet. */
function Systemtest({ test }: { test: PiperSelftest }) {
  return (
    <div className="mt-1 space-y-1 rounded-lg border border-primary/10 bg-background/50 p-2">
      <p className={`text-[9px] ${test.ok ? "text-emerald-400" : "text-destructive"}`}>{test.sammendrag}</p>
      {test.sjekker.map((s) => (
        <div key={s.navn} className="flex flex-wrap items-center gap-2 text-[9px]">
          <Sjekk ok={s.ok} navn={s.navn} />
          {s.detalj ? <span className="break-all text-muted-foreground/70">{s.detalj}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Treningskø for Piper-stemmer: kommandogenerator, validering, live logg og prøvelytting. */
export function TrainingQueue() {
  const [jobber, setJobber] = useState<TrainingJob[]>([]);
  const [apen, setApen] = useState<string>("");
  const [navn, setNavn] = useState("");
  const [status, setStatus] = useState("");
  const [cfg, setCfg] = useState<TtsConfig | null>(null);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [preset, setPreset] = useState("jetson-balansert");
  const [systemtest, setSystemtest] = useState<PiperSelftest | null>(null);
  const [preflight, setPreflight] = useState<PiperPreflight | null>(null);
  const [tester, setTester] = useState(false);
  const [kommando, setKommando] = useState("");
  const [fane, setFane] = useState<"ko" | "resultat" | "noder">("ko");
  const [resultater, setResultater] = useState<TrainingResult[]>([]);
  const [noder, setNoder] = useState<TrainingNodes | null>(null);
  const [modus, setModus] = useState<"enkel" | "fordel">("enkel");
  const [valgteNoder, setValgteNoder] = useState<string[]>(["lokal"]);
  const [fordeling, setFordeling] = useState<TrainingDistribution | null>(null);
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

  const hentPlan = async (p = preset, n = navn) => {
    const { data, error } = await safe(() => backend.treningPlan({ navn: n, preset: p }));
    if (error) return setStatus(feiltekst(error));
    setPlan(data);
    setKommando((forrige) => forrige || data.kommando);
    return data;
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
    void hentPlan();
    void safe(() => backend.hentTtsConfig()).then(({ data }) => {
      if (!data) return;
      setCfg(data);
      if (data.treningKommando) setKommando(data.treningKommando);
    });
    timer.current = window.setInterval(() => void last(), 4000);
    return stoppPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lagreCfg = async (endring: Partial<TtsConfig>) => {
    const { data, error } = await safe(() => backend.lagreTtsConfig(endring));
    if (error) return setStatus(feiltekst(error));
    setCfg(data);
    setStatus("innstilling lagret");
  };

  /** Fyller feltet med ferdig kommando for valgt preset og riktige stier. */
  const generer = async (p = preset) => {
    setStatus("henter stier og bygger kommando…");
    const data = await hentPlan(p);
    if (!data) return;
    setKommando(data.kommando);
    await lagreCfg({ treningKommando: data.kommando });
    setStatus("kommando generert og lagret");
  };

  /** Spiller av testsetningen og laster ned lydfila for sammenligning. */
  const provelytt = async (modell?: string, lagre = false) => {
    setStatus("lager prøvelyd…");
    const { data, error } = await safe(() => backend.taleLyd(TESTSETNING, modell));
    if (error) return setStatus(`kunne ikke spille av: ${feiltekst(error)}`);
    const url = URL.createObjectURL(data);
    void new Audio(url).play();
    if (lagre) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(modell || "aktiv-stemme").replace(/[^\w.-]+/g, "_")}.wav`;
      a.click();
    }
    setStatus(modell ? `spiller av: ${modell}` : "spiller av aktiv stemme");
  };

  const lastResultater = async () => {
    const { data, error } = await safe(() => backend.treningResultater());
    if (error) return setStatus(feiltekst(error));
    setResultater(data.resultater);
  };

  const lastNoder = async () => {
    setStatus("henter nodeoversikt…");
    const { data, error } = await safe(() => backend.treningNoder());
    if (error) return setStatus(feiltekst(error));
    setNoder(data);
    setStatus(`${data.klare} av ${data.antall} noder er klare for trening`);
  };

  const byttFane = (ny: "ko" | "resultat" | "noder") => {
    setFane(ny);
    if (ny === "resultat") void lastResultater();
    if (ny === "noder" && !noder) void lastNoder();
  };

  const velgNode = (id: string) =>
    setValgteNoder((forrige) => (forrige.includes(id) ? forrige.filter((n) => n !== id) : [...forrige, id]));

  const startFordelt = async () => {
    setStatus("fordeler treningsjobben til valgte noder…");
    const { data, error } = await safe(() => backend.fordelTrening({ navn, kommando, noder: valgteNoder }));
    if (error) return setStatus(feiltekst(error));
    setFordeling(data);
    setStatus(`startet på ${data.startet} av ${data.antall} noder`);
    void last();
    void lastNoder();
  };

  const start = async () => {
    if (modus === "fordel") return startFordelt();
    const p = await hentPlan(preset, navn);
    if (p && !p.kanStarte) return setStatus(`kan ikke starte: ${p.problemer[0]}`);
    setStatus("validerer, transkriberer og starter trening…");
    const { error } = await safe(() => backend.startTrening({ navn, kommando }));
    if (error) return setStatus(feiltekst(error));
    setNavn("");
    setStatus("jobb lagt i kø");
    void last();
  };

  const installerPiper = async () => {
    setStatus("starter installasjon av Piper-treningsmiljøet…");
    const { error } = await safe(() => backend.installerPiper());
    if (error) return setStatus(feiltekst(error));
    setStatus("installasjonsjobb lagt i kø – følg loggen under");
    void last();
  };

  const kjorPreflight = async () => {
    setStatus("sjekker JetPack, CUDA og PyTorch…");
    const { data, error } = await safe(() => backend.piperPreflight());
    if (error) return setStatus(feiltekst(error));
    setPreflight(data);
    setStatus(data.ok ? "PyTorch med CUDA er klar" : data.anbefaling);
  };

  const installerPytorch = async () => {
    setStatus("starter installasjon av NVIDIA PyTorch…");
    const { error } = await safe(() => backend.installerPytorch());
    if (error) return setStatus(feiltekst(error));
    setStatus("PyTorch-installasjon lagt i kø – følg loggen under");
    void last();
  };

  const kjorSystemtest = async () => {
    setTester(true);
    setStatus("kjører systemtest av Piper-miljøet…");
    const { data, error } = await safe(() => backend.piperSystemtest());
    setTester(false);
    if (error) return setStatus(feiltekst(error));
    setSystemtest(data);
    setStatus(data.ok ? "systemtest bestått" : `systemtest feilet: ${data.sammendrag}`);
    void hentPlan();
  };

  const siste = (j: TrainingJob) => (j.telemetri || [])[(j.telemetri || []).length - 1];
  const sisteFeillinjer = (j: TrainingJob) =>
    (j.logg || [])
      .filter((linje) => !/starter:|feilet med kode/i.test(linje))
      .slice(-8);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="hud-title">TRENINGSKØ</span>
        <button onClick={() => void last()} className="flex items-center gap-1 hover:text-primary">
          <RefreshCw className="size-3" /> OPPDATER
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        {([
          ["ko", "KØ", <Play key="a" className="size-3" />],
          ["resultat", "RESULTATER", <BarChart3 key="b" className="size-3" />],
          ["noder", "NODER", <Server key="c" className="size-3" />],
        ] as const).map(([id, tekst, ikon]) => (
          <button
            key={id}
            onClick={() => byttFane(id as "ko" | "resultat" | "noder")}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 ${
              fane === id ? "border-primary/50 bg-primary/10 text-primary" : "border-primary/20 text-muted-foreground hover:text-primary"
            }`}
          >
            {ikon} {tekst}
          </button>
        ))}
      </div>

      {fane === "ko" ? (
      <>
      {/* --- kommandogenerator --- */}
      <div className="space-y-2 rounded-lg border border-primary/15 bg-primary/[0.03] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="hud-input flex-1 min-w-[180px]"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              void generer(e.target.value);
            }}
          >
            {(plan?.presets || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.navn}
              </option>
            ))}
          </select>
          <button
            onClick={() => void generer()}
            className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
          >
            <Wand2 className="size-3" /> GENERER KOMMANDO
          </button>
        </div>
        {plan?.presets.find((p) => p.id === preset) ? (
          <p className="text-[9px] text-muted-foreground/80">{plan.presets.find((p) => p.id === preset)!.beskrivelse}</p>
        ) : null}

        <textarea
          className="hud-input h-16 w-full font-mono text-[9px]"
          value={kommando}
          onChange={(e) => setKommando(e.target.value)}
          onBlur={() => void lagreCfg({ treningKommando: kommando })}
          placeholder="bash /opt/jarvis-agent/scripts/tren-stemme.sh {mappe} {manifest} {navn} {ut}"
        />

        {plan ? (
          <div className="space-y-1 rounded-lg border border-primary/10 bg-background/40 p-2 text-[9px] text-muted-foreground">
            <p className="hud-title text-[9px] text-primary/80">FORHÅNDSVISNING</p>
            <p className="break-all">{"{mappe}"} = {plan.mappe}</p>
            <p className="break-all">{"{manifest}"} = {plan.manifest}</p>
            <p className="break-all">{"{navn}"} = {navn || plan.navn}</p>
            <p className="break-all">{"{ut}"} = {plan.utMappe}</p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Sjekk ok={plan.miljo.ffmpeg} navn="ffmpeg" />
              <Sjekk ok={plan.miljo.espeak} navn="espeak-ng" />
              <Sjekk ok={plan.miljo.piperTrain} navn="Piper trening" />
              <Sjekk ok={plan.miljo.skript} navn="tren-stemme.sh" />
              {plan.miljo.gpu ? (
                <span className="text-primary/80">
                  GPU: {plan.miljo.gpu.navn} · {plan.miljo.gpu.frittMb} MB ledig
                </span>
              ) : null}
            </div>
            <p>
              {plan.statistikk.medTekst ?? 0} klipp med tekst · {Math.round((plan.statistikk.aktiveSekunder ?? 0) / 60)} min lyd
            </p>
            {plan.problemer.map((pr) => (
              <p key={pr} className={plan.kanStarte ? "text-amber-400" : "text-destructive"}>
                • {pr}
              </p>
            ))}
            {!plan.miljo.piperTrain ? (
              <button
                onClick={() => void installerPiper()}
                className="mt-1 flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
              >
                <Download className="size-3" /> INSTALLER PIPER AUTOMATISK
              </button>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => void kjorSystemtest()}
                disabled={tester}
                className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <Stethoscope className="size-3" /> {tester ? "TESTER…" : "KJØR SYSTEMTEST"}
              </button>
              {systemtest ? (
                <span className={systemtest.ok ? "text-emerald-400" : "text-destructive"}>
                  {systemtest.ok ? "BESTÅTT" : "FEILET"} · {new Date(systemtest.tidspunkt).toLocaleTimeString("nb-NO")}
                </span>
              ) : null}
            </div>
            {systemtest ? <Systemtest test={systemtest} /> : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => void kjorPreflight()}
                className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
              >
                <Stethoscope className="size-3" /> SJEKK PYTORCH/CUDA
              </button>
              {preflight && !preflight.ok && preflight.kanInstallere ? (
                <button
                  onClick={() => void installerPytorch()}
                  className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
                >
                  <Download className="size-3" /> INSTALLER PYTORCH
                </button>
              ) : null}
            </div>
            {preflight ? (
              <div className="mt-1 space-y-1 rounded-lg border border-primary/10 bg-background/50 p-2">
                <p className={`text-[9px] ${preflight.ok ? "text-emerald-400" : "text-destructive"}`}>{preflight.anbefaling}</p>
                {preflight.sjekker.map((s) => (
                  <div key={s.navn} className="flex flex-wrap items-center gap-2 text-[9px]">
                    <Sjekk ok={s.ok} navn={s.navn} />
                    {s.detalj ? <span className="break-all text-muted-foreground/70">{s.detalj}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="hud-input flex-1"
          value={navn}
          onChange={(e) => setNavn(e.target.value)}
          placeholder="jobbnavn (valgfritt)"
        />
        <button
          onClick={() => void provelytt(undefined, false)}
          className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
        >
          <Volume2 className="size-3" /> TEST AKTIV STEMME
        </button>
        <select
          className="hud-input w-[150px]"
          value={modus}
          onChange={(e) => setModus(e.target.value as "enkel" | "fordel")}
          title="Jobbmodus"
        >
          <option value="enkel">Modus: én node</option>
          <option value="fordel">Modus: fordel</option>
        </select>
        <button
          onClick={() => void start()}
          disabled={modus === "enkel" && plan ? !plan.kanStarte : false}
          className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-40"
        >
          {modus === "fordel" ? <Share2 className="size-3" /> : <Play className="size-3" />}{" "}
          {modus === "fordel" ? "FORDEL TRENING" : "START TRENING"}
        </button>
      </div>

      {modus === "fordel" ? (
        <div className="space-y-2 rounded-lg border border-primary/15 bg-primary/[0.03] p-2 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="hud-title text-[9px] text-primary/80">VELG NODER SOM SKAL TRENE SAMTIDIG</span>
            <button onClick={() => void lastNoder()} className="flex items-center gap-1 text-muted-foreground hover:text-primary">
              <RefreshCw className="size-3" /> OPPDATER
            </button>
          </div>
          {(noder?.noder || []).map((n) => (
            <label key={n.id} className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={valgteNoder.includes(n.id)} onChange={() => velgNode(n.id)} />
              <span className="text-foreground/80">{n.navn}</span>
              <span className={n.klar ? "text-emerald-400" : "text-amber-400"}>{n.klar ? "klar" : "ikke klar"}</span>
              {n.aktivJobb ? <span className="text-primary/80">kjører {n.aktivJobb.navn} ({n.aktivJobb.fremdrift}%)</span> : null}
            </label>
          ))}
          {!noder ? <p className="text-muted-foreground">Trykk OPPDATER for å hente nodene.</p> : null}
          {fordeling ? (
            <div className="space-y-0.5 border-t border-primary/10 pt-1">
              {fordeling.resultater.map((r) => (
                <p key={r.id} className={r.ok ? "text-emerald-400" : "text-destructive"}>
                  {r.navn}: {r.ok ? `startet (${r.jobbId.slice(0, 8)})` : r.feil}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        {jobber.map((j) => {
          const t = siste(j);
          return (
            <div key={j.id} className="rounded-lg border border-primary/15 bg-primary/[0.03] p-2 text-[10px]">
              <div className="flex items-center gap-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => setApen(apen === j.id ? "" : j.id)}>
                  <span className="truncate text-foreground/80">{j.navn}</span>{" "}
                  <span className={STATUSFARGE[j.status] ?? ""}>· {j.status}</span>
                  <span className="text-muted-foreground"> · {j.klipp} klipp</span>
                </button>
                {j.status === "ferdig" && j.modellFil ? (
                  <>
                    <button
                      title="Prøv denne modellen nå (spill av og lagre lydfil)"
                      onClick={() => void provelytt(j.modellFil, true)}
                      className="text-muted-foreground hover:text-primary"
                    >
                      <Volume2 className="size-3.5" />
                    </button>
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
                  </>
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

              {j.status === "kjører" && t ? (
                <p className="mt-1 flex flex-wrap gap-3 text-[9px] text-primary/80">
                  <span>CPU {t.cpu}%</span>
                  <span>
                    RAM {Math.round(t.minneBruktMb / 102.4) / 10} / {Math.round(t.minneTotalMb / 102.4) / 10} GB
                  </span>
                  {t.gpuUtnyttelse !== null ? <span>GPU {t.gpuUtnyttelse}%</span> : null}
                  {t.gpuBruktMb !== null ? <span>VRAM {t.gpuBruktMb} MB</span> : null}
                  {t.tempC !== null ? <span>{t.tempC}°C</span> : null}
                  <span>{j.fremdrift}%</span>
                </p>
              ) : null}

              {j.feil ? (
                <div className="mt-1 space-y-0.5 text-destructive">
                  <p>{j.feil}</p>
                  {sisteFeillinjer(j).map((linje, indeks) => (
                    <p key={`${j.id}-feil-${indeks}`} className="break-all font-mono text-[9px] text-destructive/80">
                      {linje}
                    </p>
                  ))}
                </div>
              ) : null}
              {j.publisert ? <p className="mt-1 text-emerald-400">aktiv stemme: {j.publisert}</p> : null}

              {apen === j.id ? (
                <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-primary/15 bg-background/40 p-2 text-[9px] text-foreground/70">
                  {(j.logg || []).join("\n") || "ingen logg enda"}
                </pre>
              ) : null}
            </div>
          );
        })}
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
      </>
      ) : null}

      {fane === "resultat" ? (
        <div className="space-y-2">
          <button
            onClick={() => void lastResultater()}
            className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
          >
            <RefreshCw className="size-3" /> OPPDATER RESULTATER
          </button>
          {resultater.map((r) => (
            <div key={r.id} className="space-y-1 rounded-lg border border-primary/15 bg-primary/[0.03] p-2 text-[10px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground/80">{r.navn}</span>
                <span className={STATUSFARGE[r.status] ?? ""}>· {r.status}</span>
                <span className="text-muted-foreground">· node: {r.node}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-[9px] text-primary/80">
                <span>skår (beste tap): {r.besteTap ?? "–"}</span>
                <span>siste tap: {r.sisteTap ?? "–"}</span>
                <span>
                  epoker: {r.epoker.length}
                  {r.totaltEpoker ? ` / ${r.totaltEpoker}` : ""}
                </span>
                <span>tid per epoke: {r.snittEpokeSek != null ? `${r.snittEpokeSek}s` : "–"}</span>
                <span>total tid: {r.varighetSek != null ? `${Math.round(r.varighetSek / 60)} min` : "–"}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-[9px] text-muted-foreground">
                <span>CPU snitt {r.cpuSnitt ?? "–"}% · topp {r.cpuTopp ?? "–"}%</span>
                <span>CUDA snitt {r.gpuSnitt ?? "–"}%</span>
                <span>VRAM topp {r.vramToppMb ?? "–"} MB</span>
                <span>temp topp {r.tempToppC ?? "–"}°C</span>
              </div>
              {r.epoker.length ? (
                <div className="max-h-28 overflow-auto rounded-lg border border-primary/10 bg-background/40 p-1 font-mono text-[9px] text-foreground/70">
                  {r.epoker.slice(-20).map((e) => (
                    <p key={`${r.id}-${e.nummer}-${e.tid}`}>
                      epoke {e.nummer} · {e.sekunder}s · tap {e.tap ?? "–"}
                    </p>
                  ))}
                </div>
              ) : null}
              {r.modellFil ? <p className="break-all text-emerald-400">{r.modellFil}</p> : null}
            </div>
          ))}
          {!resultater.length ? <p className="text-[10px] text-muted-foreground">Ingen treningsresultater enda.</p> : null}
        </div>
      ) : null}

      {fane === "noder" ? (
        <div className="space-y-2">
          <button
            onClick={() => void lastNoder()}
            className="flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-[10px] text-primary hover:bg-primary/10"
          >
            <RefreshCw className="size-3" /> OPPDATER NODER
          </button>
          {(noder?.noder || []).map((n) => (
            <div key={n.id} className="space-y-1 rounded-lg border border-primary/15 bg-primary/[0.03] p-2 text-[10px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground/80">{n.navn}</span>
                <span className={n.online ? "text-emerald-400" : "text-destructive"}>{n.online ? "online" : "offline"}</span>
                {n.agentUrl ? <span className="break-all text-muted-foreground/70">{n.agentUrl}</span> : null}
              </div>
              <div className="flex flex-wrap gap-3 text-[9px] text-muted-foreground">
                <span>JetPack {n.jetpack || "ukjent"}</span>
                <span>L4T {n.l4t || "–"}</span>
                <span>CUDA {n.cuda || "–"}</span>
                <span>{n.gpu || "GPU ukjent"}</span>
                <span>torch {n.torch?.finnes ? `${n.torch.versjon}${n.torch.cuda ? " (CUDA)" : ""}` : "mangler"}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-[9px]">
                <Sjekk ok={n.klar} navn={n.klar ? "klar for trening" : "ikke klar"} />
                <span className="text-muted-foreground">i kø: {n.iKo}</span>
                {n.aktivJobb ? (
                  <span className="text-primary/80">
                    kjører {n.aktivJobb.navn} · {n.aktivJobb.fremdrift}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">ingen aktiv jobb</span>
                )}
              </div>
              {n.feil ? <p className="text-destructive">{n.feil}</p> : null}
              {!n.klar && n.anbefaling ? <p className="text-amber-400">{n.anbefaling}</p> : null}
              {n.sisteJobber.length ? (
                <p className="text-[9px] text-muted-foreground/80">
                  siste: {n.sisteJobber.map((j) => `${j.navn} (${j.status})`).join(" · ")}
                </p>
              ) : null}
            </div>
          ))}
          {!noder ? <p className="text-[10px] text-muted-foreground">Henter nodeoversikt…</p> : null}
        </div>
      ) : null}

      {status ? <p className="text-[10px] text-muted-foreground">{status}</p> : null}
      {cfg && !cfg.treningKommando ? (
        <p className="text-[9px] text-muted-foreground/70">
          Tips: trykk GENERER KOMMANDO – da fylles {"{mappe} {manifest} {navn} {ut}"} inn automatisk.
        </p>
      ) : null}
    </div>
  );
}
