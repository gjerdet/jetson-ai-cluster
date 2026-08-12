import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ServerCog, Terminal } from "lucide-react";
import { backend, safe, type ProvisionJob } from "@/lib/backend";

const btn =
  "flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary/90 transition hover:bg-primary/20 disabled:opacity-40";

const farge = (s: ProvisionJob["status"]) =>
  s === "ok"
    ? "text-emerald-300"
    : s === "feil"
      ? "text-destructive"
      : s === "kjorer"
        ? "text-primary"
        : "text-muted-foreground";

/**
 * Automatisk innrullering: skriv inn IP-ene, brukernavn og passord –
 * Jarvis logger seg inn på hver maskin, installerer Ollama, henter
 * modellene og melder noden inn i klyngen selv.
 */
export function ProvisionSection() {
  const [ip, setIp] = useState("");
  const [bruker, setBruker] = useState("");
  const [passord, setPassord] = useState("");
  const [modeller, setModeller] = useState("llama3.2:3b");
  const [prefiks, setPrefiks] = useState("NODE");
  const [jobber, setJobber] = useState<ProvisionJob[]>([]);
  const [aapen, setAapen] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const last = useCallback(async () => {
    const r = await safe(() => backend.provisjonJobber());
    if (!r.error) setJobber(r.data);
  }, []);

  useEffect(() => {
    void last();
    timer.current = setInterval(() => void last(), 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [last]);

  const verter = ip.split(/[\s,;]+/).filter(Boolean);

  const start = async () => {
    setBusy(true);
    setMelding(null);
    const r = await safe(() =>
      backend.provisjoner({
        verter,
        bruker: bruker.trim(),
        passord,
        modeller: modeller.split(/[\s,]+/).filter(Boolean),
        navnPrefiks: prefiks,
      }),
    );
    setBusy(false);
    if (r.error) setMelding(r.error.message);
    else {
      setPassord("");
      setJobber(r.data.jobber);
      setMelding(`${r.data.jobber.length} maskin(er) rulles ut. Følg loggen under.`);
    }
  };

  const valgt = jobber.find((j) => j.id === aapen);

  return (
    <div className="space-y-3 rounded-2xl border border-primary/15 bg-primary/[0.02] p-3">
      <div className="flex items-center gap-2">
        <ServerCog className="size-3.5 text-primary/70" />
        <span className="text-[9px] uppercase tracking-[0.25em] text-primary/60">AUTOMATISK INNRULLERING</span>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Skriv inn IP-ene (én per linje eller kommaseparert) sammen med brukernavn og passord. Jarvis kobler seg til
        hver maskin, installerer Ollama, henter modellene, åpner for LAN-et og melder noden inn i klyngen.
      </p>

      <textarea
        value={ip}
        onChange={(e) => setIp(e.target.value)}
        rows={3}
        placeholder={"192.168.12.21\n192.168.12.22\n192.168.12.23"}
        className="hud-input min-h-[64px] w-full resize-y font-mono"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={bruker}
          onChange={(e) => setBruker(e.target.value)}
          placeholder="brukernavn"
          autoComplete="off"
          className="hud-input"
        />
        <input
          value={passord}
          onChange={(e) => setPassord(e.target.value)}
          type="password"
          placeholder="passord"
          autoComplete="new-password"
          className="hud-input"
        />
        <input
          value={modeller}
          onChange={(e) => setModeller(e.target.value)}
          placeholder="modeller, f.eks. llama3.2:3b hermes3:8b"
          className="hud-input col-span-2"
        />
        <input
          value={prefiks}
          onChange={(e) => setPrefiks(e.target.value)}
          placeholder="navneprefiks (NODE)"
          className="hud-input"
        />
        <button className={btn} disabled={busy || !verter.length || !bruker.trim()} onClick={() => void start()}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <ServerCog className="size-3" />}
          rull ut {verter.length ? `${verter.length} stk` : ""}
        </button>
      </div>

      {melding && <div className="text-[10px] text-primary/70">{melding}</div>}

      {jobber.length > 0 && (
        <div className="space-y-1">
          {jobber.map((j) => (
            <button
              key={j.id}
              onClick={() => setAapen(aapen === j.id ? null : j.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-primary/15 bg-primary/[0.04] px-2 py-1.5 text-left text-[10px] hover:bg-primary/10"
            >
              <span className="font-mono text-primary/80">{j.navn}</span>
              <span className="truncate text-muted-foreground">{j.feil || j.steg || "…"}</span>
              <span className={`uppercase tracking-[0.15em] ${farge(j.status)}`}>{j.status}</span>
            </button>
          ))}
        </div>
      )}

      {valgt && (
        <div className="rounded-lg border border-primary/15 bg-background/60 p-2">
          <div className="mb-1 flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-primary/60">
            <Terminal className="size-3" /> {valgt.navn} · {valgt.vert}
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground/75">
            {valgt.logg.map((l) => l.tekst).join("\n") || "venter på utdata…"}
          </pre>
        </div>
      )}
    </div>
  );
}
