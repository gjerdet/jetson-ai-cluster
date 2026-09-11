import { useEffect, useState } from "react";
import { Download, Play, RefreshCw, Terminal, Trash2 } from "lucide-react";
import {
  agentCfg,
  agentDeleteScript,
  agentReadScript,
  agentRun,
  formatResult,
  type ScriptFile,
} from "@/lib/local-agent";
import { agentScripts } from "@/lib/local-agent";
import type { HudConfig } from "@/lib/hud-store";

type Kjoring = { ok: boolean; ms: number; tid: number; utdata: string };

function sprakFor(navn: string): "bash" | "python" | "node" {
  if (navn.endsWith(".py")) return "python";
  if (navn.endsWith(".js") || navn.endsWith(".mjs")) return "node";
  return "bash";
}

/** Skriptlageret: alle skript Jarvis har skrevet, med kjøring, logg og nedlasting. */
export function SkriptSection({ config }: { config: HudConfig }) {
  const cfg = agentCfg(config);
  const [filer, setFiler] = useState<ScriptFile[]>([]);
  const [feil, setFeil] = useState("");
  const [laster, setLaster] = useState(false);
  const [apen, setApen] = useState<string | null>(null);
  const [innhold, setInnhold] = useState<Record<string, string>>({});
  const [kjoringer, setKjoringer] = useState<Record<string, Kjoring>>({});
  const [jobber, setJobber] = useState<string | null>(null);

  const hent = async () => {
    setLaster(true);
    setFeil("");
    try {
      const r = await agentScripts(cfg);
      setFiler(r.files);
    } catch (e) {
      setFiler([]);
      setFeil(e instanceof Error ? e.message : "ukjent feil");
    }
    setLaster(false);
  };

  useEffect(() => {
    void hent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseUrl]);

  const apne = async (navn: string) => {
    if (apen === navn) {
      setApen(null);
      return;
    }
    setApen(navn);
    if (innhold[navn] != null) return;
    try {
      const f = await agentReadScript(cfg, navn);
      setInnhold((s) => ({ ...s, [navn]: f.content }));
    } catch (e) {
      setInnhold((s) => ({ ...s, [navn]: `Kunne ikke lese: ${e instanceof Error ? e.message : "ukjent"}` }));
    }
  };

  const kjor = async (navn: string) => {
    setJobber(navn);
    const t0 = performance.now();
    try {
      const r = await agentRun(cfg, { lang: sprakFor(navn), name: navn, args: [] });
      setKjoringer((s) => ({
        ...s,
        [navn]: { ok: (r.code ?? 0) === 0, ms: Math.round(performance.now() - t0), tid: Date.now(), utdata: formatResult(r) },
      }));
    } catch (e) {
      setKjoringer((s) => ({
        ...s,
        [navn]: {
          ok: false,
          ms: Math.round(performance.now() - t0),
          tid: Date.now(),
          utdata: e instanceof Error ? e.message : "ukjent feil",
        },
      }));
    }
    setJobber(null);
    setApen(navn);
  };

  const lastNed = async (navn: string) => {
    const tekst = innhold[navn] ?? (await agentReadScript(cfg, navn).then((f) => f.content).catch(() => ""));
    if (!tekst) return;
    const url = URL.createObjectURL(new Blob([tekst], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = navn;
    a.click();
    URL.revokeObjectURL(url);
  };

  const slett = async (navn: string) => {
    try {
      await agentDeleteScript(cfg, navn);
      setFiler((f) => f.filter((x) => x.name !== navn));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "ukjent feil");
    }
  };

  return (
    <div className="rounded border border-primary/25 bg-primary/[0.04] p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Terminal className="size-3 text-primary" />
        <div className="hud-title flex-1 text-[10px] text-primary">SKRIPTLAGER</div>
        <button
          onClick={() => void hent()}
          disabled={laster}
          className="hud-title hud-btn hud-btn-hoverable !py-0.5 text-[9px]"
        >
          <RefreshCw className="size-3" /> oppdater
        </button>
      </div>
      <p className="mb-1.5 text-[10px] text-muted-foreground">
        Alle skript Jarvis har skrevet og testet på Jetson. Kjør dem på nytt, les loggen eller last
        dem ned.
      </p>
      {feil ? <p className="mb-1 text-[10px] text-destructive">{feil}</p> : null}
      {!filer.length && !feil ? (
        <p className="text-[10px] text-muted-foreground">Ingen skript ennå.</p>
      ) : null}
      <div className="space-y-1">
        {filer.map((f) => {
          const k = kjoringer[f.name];
          return (
            <div key={f.name} className="rounded border border-primary/15 px-2 py-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void apne(f.name)}
                  className="flex-1 truncate text-left text-[10px] text-muted-foreground hover:text-primary"
                >
                  {f.name}
                </button>
                <span className="text-[9px] text-muted-foreground/70">{f.bytes} B</span>
                {k ? (
                  <span className={`text-[9px] ${k.ok ? "text-primary" : "text-destructive"}`}>
                    {k.ok ? "bestått" : "feilet"} · {k.ms} ms
                  </span>
                ) : null}
                <button
                  onClick={() => void kjor(f.name)}
                  disabled={jobber === f.name}
                  aria-label="Kjør skript"
                  className="rounded p-0.5 text-muted-foreground hover:text-primary"
                >
                  <Play className="size-3" />
                </button>
                <button
                  onClick={() => void lastNed(f.name)}
                  aria-label="Last ned skript"
                  className="rounded p-0.5 text-muted-foreground hover:text-primary"
                >
                  <Download className="size-3" />
                </button>
                <button
                  onClick={() => void slett(f.name)}
                  aria-label="Slett skript"
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              {apen === f.name ? (
                <div className="mt-1 space-y-1">
                  <pre className="max-h-64 overflow-auto rounded bg-background/60 p-1.5 text-[10px] text-foreground/85">
                    <code>{innhold[f.name] ?? "leser …"}</code>
                  </pre>
                  {k ? (
                    <pre className="max-h-48 overflow-auto rounded border border-primary/15 p-1.5 text-[10px] text-foreground/75">
                      <code>{k.utdata}</code>
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
