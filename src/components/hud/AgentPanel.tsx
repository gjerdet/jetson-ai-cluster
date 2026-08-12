import { useMemo, useState } from "react";
import { Wrench, Bug, Route, Copy, Trash2, Download, Search } from "lucide-react";
import { TOOL_CATALOG, type ToolSpec } from "@/lib/agent-tools";
import type { HudConfig } from "@/lib/hud-store";
import {
  clearDebug,
  debugExport,
  groupDebug,
  setDebug,
  useDebugLog,
  type DebugEntry,
} from "@/lib/debug-log";
import { useRoutingLog, clearRouting } from "@/lib/routing-log";
import { klassifiser, nodeKlasse } from "@/lib/model-router";

const KATEGORI: Record<ToolSpec["category"], string> = {
  smarthus: "SMARTHUS",
  system: "SYSTEM",
  verden: "VERDEN",
  minne: "MINNE",
  verktoy: "VERKTØY",
  os: "OS OG NETT",
};

/** Naturlige eksempler – slik du kan be om handlingen i chatten. */
const EKSEMPLER: Record<string, string> = {
  mqtt_les: "«Hva er temperaturen i stua nå?»",
  mqtt_historikk: "«Vis min/maks temperatur i stua siste døgn»",
  enheter: "«Hvilke smarthusenheter er registrert?»",
  noder: "«Status på AI-nodene»",
  system_hent: "«Hent diskstatus fra TrueNAS»",
  world_brief: "«Gi meg topp 10 hendelser i verden»",
  minne_lagre: "«Husk at ruteren står i teknisk rom»",
  verktoy_liste: "«Hvilke egne verktøy har du laget?»",
  verktoy_lag: "«Lag et verktøy som henter været fra yr»",
  verktoy_slett: "«Slett verktøyet hent_vaer»",
  agent_status: "«Hvordan står det til med Jetson-noden?»",
  os_kjor: "«Sjekk hvor mye diskplass som er ledig»",
  skript_lag: "«Lagre et skript som sjekker docker-containere»",
  skript_kjor: "«Kjør sjekk.py»",
  skript_test: "«Skriv og test et python-skript som pinger gatewayen»",
  skript_liste: "«Hvilke skript ligger i sandkassen?»",
  skript_slett: "«Slett sjekk.py»",
  mal_liste: "«Hvilke skriptmaler har du?»",
  mal_test: "«Test docker-health-malen mot ollama»",
  mal_installer: "«Installer service-start-malen for ollama»",
  nett_sjekk: "«Sjekk nettverket – gateway, DNS og subnett»",
  nett_skann: "«Skann nettet mitt og list alle enheter»",
};

const FARGE: Record<DebugEntry["kind"], string> = {
  melding: "text-foreground/80",
  ruting: "text-cyan-300/80",
  prompt: "text-muted-foreground",
  runde: "text-primary/80",
  beslutning: "text-amber-300/80",
  verktoy: "text-emerald-300/80",
  dult: "text-orange-300/90",
  svar: "text-primary",
  feil: "text-destructive",
};

function Rad({ e }: { e: DebugEntry }) {
  const [open, setOpen] = useState(false);
  const tid = new Date(e.t).toLocaleTimeString("nb-NO");
  return (
    <div className="border-l border-primary/15 pl-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 py-0.5 text-left"
      >
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground/60">{tid}</span>
        <span className={`hud-title shrink-0 text-[9px] ${FARGE[e.kind]}`}>{e.kind}</span>
        <span className="flex-1 text-[11px] text-foreground/80">{e.title}</span>
        {e.ms != null ? (
          <span className="shrink-0 text-[9px] text-muted-foreground/60">{e.ms} ms</span>
        ) : null}
        {e.ok === false ? <span className="text-[9px] text-destructive">feil</span> : null}
      </button>
      {e.why ? (
        <p className="pl-[3.6rem] text-[10px] italic text-amber-200/70">hvorfor: {e.why}</p>
      ) : null}
      {open && e.detail ? (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-primary/15 bg-background/40 p-2 text-[10px] text-foreground/70">
          {e.detail}
        </pre>
      ) : null}
    </div>
  );
}

export function AgentPanel({ config }: { config: HudConfig }) {
  const [tab, setTab] = useState<"katalog" | "feilsok" | "ruting">("katalog");
  const [q, setQ] = useState("");
  const [test, setTest] = useState("");
  const dbg = useDebugLog();
  const ruting = useRoutingLog();

  const egne = (config.customTools ?? []).filter((t) => t.enabled);
  const treff = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return TOOL_CATALOG;
    return TOOL_CATALOG.filter(
      (t) =>
        t.name.includes(s) ||
        t.summary.toLowerCase().includes(s) ||
        (EKSEMPLER[t.name] ?? "").toLowerCase().includes(s),
    );
  }, [q]);

  const grupper = useMemo(() => groupDebug(dbg.entries), [dbg.entries]);
  const prov = test.trim() ? klassifiser(test) : null;

  const kopier = (s: string) => void navigator.clipboard?.writeText(s);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden text-xs">
      <div className="flex items-center gap-1">
        {(
          [
            ["katalog", "VERKTØYKATALOG", Wrench],
            ["feilsok", "FEILSØKING", Bug],
            ["ruting", "MODELL-RUTING", Route],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] ${
              tab === id ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Icon className="mr-1 inline size-3" />
            {label}
          </button>
        ))}
      </div>

      {tab === "katalog" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <label className="flex items-center gap-2 rounded border border-primary/20 bg-background/30 px-2 py-1">
            <Search className="size-3 text-primary/60" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="søk verktøy …"
              className="w-full bg-transparent text-[11px] outline-none"
            />
          </label>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
            {(Object.keys(KATEGORI) as ToolSpec["category"][]).map((kat) => {
              const liste = treff.filter((t) => t.category === kat);
              if (!liste.length) return null;
              return (
                <div key={kat} className="space-y-1">
                  <p className="hud-title text-[9px] text-primary/70">{KATEGORI[kat]}</p>
                  {liste.map((t) => (
                    <div
                      key={t.name}
                      className="rounded border border-primary/15 bg-background/30 p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-primary/90">{t.name}</span>
                        <button
                          onClick={() => kopier(`VERKTØY: ${t.name} ${t.args}`)}
                          title="Kopier verktøykall"
                          className="text-muted-foreground/60 hover:text-primary"
                        >
                          <Copy className="size-3" />
                        </button>
                      </div>
                      <p className="text-[10px] text-foreground/70">{t.summary}</p>
                      <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-1 font-mono text-[10px] text-cyan-200/80">
                        VERKTØY: {t.name} {t.args}
                      </pre>
                      {EKSEMPLER[t.name] ? (
                        <p className="mt-1 text-[10px] italic text-muted-foreground">
                          Be om: {EKSEMPLER[t.name]}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
            {egne.length ? (
              <div className="space-y-1">
                <p className="hud-title text-[9px] text-primary/70">EGENDEFINERTE</p>
                {egne.map((t) => (
                  <div key={t.id} className="rounded border border-primary/15 bg-background/30 p-2">
                    <span className="font-mono text-[11px] text-primary/90">{t.name}</span>
                    <p className="text-[10px] text-foreground/70">
                      {t.description || t.kind}
                    </p>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-1 font-mono text-[10px] text-cyan-200/80">
                      VERKTØY: {t.name} {t.args || "{}"}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "feilsok" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[10px]">
              <input
                type="checkbox"
                checked={dbg.on}
                onChange={(e) => setDebug(e.target.checked)}
              />
              FEILSØKINGSMODUS {dbg.on ? "PÅ" : "AV"}
            </label>
            <button
              onClick={() => clearDebug()}
              className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
            >
              <Trash2 className="mr-1 inline size-3" />
              TØM
            </button>
            <button
              onClick={() => kopier(debugExport())}
              className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
            >
              <Download className="mr-1 inline size-3" />
              KOPIER JSON
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Logger hver runde: valgt node og hvorfor, systemprompt, modellens rå svar,
            verktøykall med argumenter og resultat, dult ved passive svar, og endelig svar.
          </p>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
            {!grupper.length ? (
              <p className="text-[11px] text-muted-foreground">
                {dbg.on ? "Ingen sporing ennå – send en melding i KOMMANDO." : "Slå på feilsøkingsmodus for å spore."}
              </p>
            ) : null}
            {grupper.map((g) => (
              <div key={g.turId} className="rounded border border-primary/15 bg-background/25 p-2">
                <p className="hud-title mb-1 text-[9px] text-primary/70">
                  TUR {g.turId.slice(2, 10)} · {g.entries.length} steg ·{" "}
                  {new Date(g.entries[0]!.t).toLocaleTimeString("nb-NO")}
                </p>
                <div className="space-y-0.5">
                  {g.entries.map((e, i) => (
                    <Rad key={i} e={e} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "ruting" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <p className="text-[10px] text-muted-foreground">
            Automatisk ruting: {config.autoRoute === false ? "AV" : "PÅ"}
            {config.aiNodeId ? " · låst node overstyrer" : ""} · tunge oppgaver → tung node
            (OpenRouter/Hermes), småprat → lokal modell. Slås av/på under SYSTEM.
          </p>
          <div className="space-y-1">
            {config.nodes
              .filter((n) => n.enabled)
              .map((n) => (
                <div
                  key={n.id}
                  className="flex items-center justify-between rounded border border-primary/15 bg-background/30 px-2 py-1"
                >
                  <span className="text-[11px]">{n.name}</span>
                  <span className="text-[10px] text-muted-foreground">{n.model}</span>
                  <span
                    className={`hud-title text-[9px] ${
                      nodeKlasse(n) === "tung" ? "text-amber-300/80" : "text-cyan-300/80"
                    }`}
                  >
                    {nodeKlasse(n) === "tung" ? "TUNG" : "LOKAL"}
                  </span>
                </div>
              ))}
          </div>
          <label className="hud-title text-[9px] text-primary/70">TEST KLASSIFISERING</label>
          <input
            value={test}
            onChange={(e) => setTest(e.target.value)}
            placeholder="skriv en melding for å se hvordan den rutes …"
            className="rounded border border-primary/20 bg-background/30 px-2 py-1 text-[11px] outline-none"
          />
          {prov ? (
            <p className="text-[10px] text-foreground/80">
              → <span className="text-primary">{prov.vekt.toUpperCase()}</span> ({prov.grunn})
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            <p className="hud-title text-[9px] text-primary/70">SISTE RUTINGER</p>
            <button
              onClick={() => clearRouting()}
              className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
            >
              TØM
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-auto pr-1">
            {ruting.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="font-mono text-muted-foreground/60">
                  {new Date(r.t).toLocaleTimeString("nb-NO")}
                </span>
                <span className="hud-title text-[9px] text-primary/70">{r.oppgave}</span>
                <span className="flex-1 truncate">{r.nodeNavn}</span>
                {r.ms != null ? (
                  <span className="text-muted-foreground/60">{r.ms} ms</span>
                ) : null}
              </div>
            ))}
            {!ruting.length ? (
              <p className="text-[11px] text-muted-foreground">Ingen forespørsler ennå.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
