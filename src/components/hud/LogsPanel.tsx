import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollText, RefreshCw, Pause, Play, Download, ArrowDownToLine } from "lucide-react";
import { backend, backendToken, safe, type LogSource, type LogTail } from "@/lib/backend";

const LINJEVALG = [100, 300, 800];

/** Farger loggnivåer slik at feil er lette å se i HUD-en. */
function nivaa(linje: string) {
  const l = linje.toLowerCase();
  if (/(error|feil|failed|fatal|✗)/.test(l)) return "text-destructive";
  if (/(warn|advarsel|!)/.test(l)) return "text-yellow-400/80";
  if (/(✓|ok\b|active|started|ferdig)/.test(l)) return "text-primary/80";
  return "text-foreground/60";
}

const statusFarge = (s: string) =>
  s === "active" || s === "fil"
    ? "text-primary/80"
    : s === "mangler" || s === "inactive" || s === "failed"
      ? "text-destructive"
      : "text-muted-foreground";

/**
 * LOGGER: sanntidsvisning av systemd-journalene for agent, web-GUI og Ollama,
 * pluss loggene fra oppsett.sh og den automatiske helsesjekken.
 */
export function LogsPanel() {
  const [kilder, setKilder] = useState<LogSource[]>([]);
  const [valgt, setValgt] = useState("agent");
  const [linjer, setLinjer] = useState(300);
  const [logg, setLogg] = useState<LogTail | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [henter, setHenter] = useState(false);
  const [autoBunn, setAutoBunn] = useState(true);
  const boks = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!backendToken()) return;
    void safe(() => backend.loggKilder()).then((r) => {
      if (r.data) setKilder(r.data);
    });
  }, []);

  const hent = useCallback(async () => {
    if (!backendToken()) {
      setFeil("Ikke innlogget mot backend – logg inn under SYSTEM › Backend.");
      setLogg(null);
      return;
    }
    setHenter(true);
    const r = await safe(() => backend.hentLogg(valgt, linjer));
    setHenter(false);
    setLogg(r.data ?? null);
    setFeil(r.data ? null : (r.error?.message ?? "Kunne ikke hente loggen."));
  }, [valgt, linjer]);

  useEffect(() => {
    void hent();
    if (!live) return;
    const t = setInterval(() => void hent(), 3000);
    return () => clearInterval(t);
  }, [hent, live]);

  useEffect(() => {
    if (autoBunn && boks.current) boks.current.scrollTop = boks.current.scrollHeight;
  }, [logg, autoBunn]);

  const lastNed = () => {
    if (!logg) return;
    const url = URL.createObjectURL(new Blob([logg.tekst], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-${logg.kilde}-${new Date().toISOString().slice(0, 19)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rader = (logg?.tekst ?? "").split("\n");

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <p className="hud-title mr-auto text-[10px] text-primary/80">
          <ScrollText className="mr-1 inline size-3" />
          LOGGER
        </p>
        <button
          onClick={() => setLive(!live)}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
          title={live ? "Sett på pause" : "Start sanntidsoppdatering"}
        >
          {live ? <Pause className="mr-1 inline size-3" /> : <Play className="mr-1 inline size-3" />}
          {live ? "live" : "pauset"}
        </button>
        <button
          onClick={() => void hent()}
          className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
          title="Oppdater nå"
        >
          <RefreshCw className={`inline size-3 ${henter ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => setAutoBunn(!autoBunn)}
          className={`hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] ${autoBunn ? "text-primary" : ""}`}
          title="Følg nyeste linje"
        >
          <ArrowDownToLine className="inline size-3" />
        </button>
        <button onClick={lastNed} className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]" title="Last ned">
          <Download className="inline size-3" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {(kilder.length
          ? kilder
          : [{ id: "agent", navn: "Backend-agent", status: "ukjent", type: "systemd", enhet: null, sti: null }]
        ).map((k) => (
          <button
            key={k.id}
            onClick={() => setValgt(k.id)}
            className={`hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] ${
              valgt === k.id ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {k.navn}
            <span className={`ml-1 ${statusFarge(k.status)}`}>·{k.status}</span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {LINJEVALG.map((n) => (
            <button
              key={n}
              onClick={() => setLinjer(n)}
              className={`hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] ${
                linjer === n ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {n}
            </button>
          ))}
        </span>
      </div>

      {feil ? <p className="hud-wrap text-[10px] text-destructive">{feil}</p> : null}

      {logg ? (
        <p className="hud-wrap text-[9px] text-muted-foreground">
          {logg.type === "systemd" ? `systemd · ${logg.enhet} · ` : `fil · ${logg.sti} · `}
          <span className={statusFarge(logg.status)}>{logg.status}</span>
          {" · oppdatert "}
          {new Date(logg.tid).toLocaleTimeString("nb-NO")}
        </p>
      ) : null}

      <pre
        ref={boks}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAutoBunn(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className="hud-wrap min-h-0 flex-1 overflow-auto rounded border border-primary/15 bg-background/40 p-2 font-mono text-[10px] leading-relaxed"
      >
        {rader.map((r, i) => (
          <div key={i} className={nivaa(r)}>
            {r || "\u00a0"}
          </div>
        ))}
      </pre>
    </div>
  );
}
