import { useEffect, useMemo, useState } from "react";
import type { MemoryItem as ContractMemoryItem } from "@/lib/contract";
import {
  Brain,
  Bot,
  Check,
  Cpu,
  FlaskConical,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquareWarning,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { backend } from "@/lib/backend";
import type {
  Evaluation,
  GeneratedTool,
  InitiativeStatus,
  InitiativeSuggestion,
  MemoryItem,
  MemoryStats,
  Plan,
} from "@/lib/contract";

const TYPE_LABEL: Record<string, string> = {
  hendelse: "Hendelse",
  beslutning: "Beslutning",
  faktum: "Faktum",
  erfaring: "Erfaring",
  mål: "Mål",
  plan: "Plan",
};

const RISK_CLASS: Record<string, string> = {
  lav: "border-emerald-500/40 text-emerald-400",
  medium: "border-amber-500/40 text-amber-400",
  høy: "border-rose-500/40 text-rose-400",
};

function useInterval(ms: number, deps: unknown[] = []) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, deps);
  return tick;
}

export function AgiPanel() {
  const [tab, setTab] = useState<"minne" | "planer" | "evalueringer" | "initiativ" | "verktoy">("minne");
  const tick = useInterval(5_000);

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [minner, setMinner] = useState<MemoryItem[]>([]);
  const [planer, setPlaner] = useState<Plan[]>([]);
  const [evalueringer, setEvalueringer] = useState<Evaluation[]>([]);
  const [initiativ, setInitiativ] = useState<InitiativeStatus | null>(null);
  const [forslag, setForslag] = useState<InitiativeSuggestion[]>([]);
  const [verktoy, setVerktoy] = useState<GeneratedTool[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      const [s, m, p, e, i, f, v] = await Promise.all([
        backend.hentMinneStatistikk(),
        backend.minneTidslinje({ maks: 30 }),
        backend.hentPlaner(),
        backend.hentEvalueringer().then((r) => r.evalueringer),
        backend.hentInitiativStatus(),
        backend.hentInitiativForslag().then((r) => r.forslag),
        backend.hentGenererteVerktoy().then((r) => r.verktoy),
      ]);
      setStats(s);
      setMinner(m.minner);
      setPlaner(p.planer);
      setEvalueringer(e);
      setInitiativ(i);
      setForslag(f);
      setVerktoy(v);
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    void refresh();
  }, [tick, tab]);

  const [query, setQuery] = useState("");
  const [sokTreff, setSokTreff] = useState<MemoryItem[] | null>(null);
  const sok = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const r = await backend.sokMinne(query, 8);
      setSokTreff(r.treff);
    } finally {
      setLoading(false);
    }
  };

  const [nyttMinne, setNyttMinne] = useState<{ tekst: string; type: ContractMemoryItem["type"]; viktighet: number; kontekst: string }>({ tekst: "", type: "faktum", viktighet: 5, kontekst: "" });
  const lagreMinne = async () => {
    if (!nyttMinne.tekst.trim()) return;
    setLoading(true);
    try {
      await backend.lagreMinne({
        tekst: nyttMinne.tekst,
        type: nyttMinne.type,
        viktighet: Number(nyttMinne.viktighet),
        kontekst: nyttMinne.kontekst,
      });
      setNyttMinne({ tekst: "", type: "faktum", viktighet: 5, kontekst: "" });
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const [mål, setMål] = useState("");
  const lagPlan = async () => {
    if (!mål.trim()) return;
    setLoading(true);
    try {
      await backend.lagPlan(mål);
      setMål("");
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const [beskrivelse, setBeskrivelse] = useState("");
  const genererVerktoy = async () => {
    if (!beskrivelse.trim()) return;
    setLoading(true);
    try {
      await backend.genererVerktoy(beskrivelse);
      setBeskrivelse("");
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const toggleInitiativ = async () => {
    setLoading(true);
    try {
      await backend.settInitiativAktiv(!initiativ?.aktiv);
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const kjørInitiativ = async () => {
    setLoading(true);
    try {
      await backend.kjorInitiativ();
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const aktivePlaner = useMemo(() => planer.filter((p) => p.status === "aktiv" || p.status === "påvent"), [planer]);

  return (
    <div className="flex h-full flex-col gap-3 text-xs">
      <div className="hud-title flex flex-wrap gap-1 text-[9px]">
        {[
          { id: "minne", label: "MINNE", icon: Brain },
          { id: "planer", label: "PLANER", icon: Target },
          { id: "evalueringer", label: "EVALUATOR", icon: MessageSquareWarning },
          { id: "initiativ", label: "INITIATIV", icon: Lightbulb },
          { id: "verktoy", label: "VERKTØY", icon: FlaskConical },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`flex items-center gap-1 rounded border px-2 py-1 transition-colors ${
              tab === t.id
                ? "border-primary/60 bg-primary/20 text-primary"
                : "border-primary/20 text-muted-foreground hover:text-primary"
            }`}
          >
            <t.icon className="size-3" />
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="hud-wrap min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1">
        {tab === "minne" ? (
          <>
            <div className="hud-panel space-y-2">
              <div className="flex items-center justify-between">
                <span className="hud-label">Statistikk</span>
                <span className="text-[10px] text-muted-foreground">{stats?.antall ?? "-"} / {stats?.maks ?? "-"}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                {Object.entries(stats?.perType ?? {}).map(([type, ant]) => (
                  <div key={type} className="rounded border border-primary/10 bg-primary/5 px-2 py-1 text-center">
                    <div className="text-muted-foreground">{TYPE_LABEL[type] ?? type}</div>
                    <div className="text-primary">{ant}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hud-panel space-y-2">
              <span className="hud-label">Søk i minnet</span>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void sok()}
                  placeholder="Hva husker du om..."
                  className="hud-input flex-1"
                />
                <button onClick={() => void sok()} className="hud-button">
                  <Search className="size-3" />
                </button>
              </div>
              {sokTreff?.length ? (
                <div className="space-y-1">
                  {sokTreff.map((m) => (
                    <MemoryRow key={m.id} m={m} onDelete={() => void backend.slettMinne(m.id).then(refresh)} />
                  ))}
                </div>
              ) : sokTreff !== null ? (
                <div className="text-[10px] text-muted-foreground">Ingen treff.</div>
              ) : null}
            </div>

            <div className="hud-panel space-y-2">
              <span className="hud-label">Legg til minne</span>
              <textarea
                value={nyttMinne.tekst}
                onChange={(e) => setNyttMinne({ ...nyttMinne, tekst: e.target.value })}
                rows={2}
                placeholder="Noe Jarvis bør huske..."
                className="hud-input w-full resize-none"
              />
              <div className="flex gap-2">
                <select
                  value={nyttMinne.type}
                  onChange={(e) => setNyttMinne({ ...nyttMinne, type: e.target.value as ContractMemoryItem["type"] })}
                  className="hud-select"
                >
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={nyttMinne.viktighet}
                  onChange={(e) => setNyttMinne({ ...nyttMinne, viktighet: Number(e.target.value) })}
                  className="hud-input w-16"
                />
                <button onClick={() => void lagreMinne()} disabled={loading} className="hud-button flex-1">
                  {loading ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                  LAGRE
                </button>
              </div>
            </div>

            <div className="space-y-1">
              {minner.map((m) => (
                <MemoryRow key={m.id} m={m} onDelete={() => void backend.slettMinne(m.id).then(refresh)} />
              ))}
            </div>
          </>
        ) : null}

        {tab === "planer" ? (
          <>
            <div className="hud-panel space-y-2">
              <span className="hud-label">Nytt mål</span>
              <div className="flex gap-2">
                <input
                  value={mål}
                  onChange={(e) => setMål(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void lagPlan()}
                  placeholder="Beskriv hva Jarvis skal planlegge..."
                  className="hud-input flex-1"
                />
                <button onClick={() => void lagPlan()} disabled={loading} className="hud-button">
                  {loading ? <Loader2 className="size-3 animate-spin" /> : <Target className="size-3" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {aktivePlaner.length === 0 ? (
                <div className="text-[10px] text-muted-foreground">Ingen aktive planer.</div>
              ) : null}
              {aktivePlaner.map((plan) => (
                <div key={plan.id} className="hud-panel space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-primary">{plan.mål}</div>
                      <div className="text-[10px] text-muted-foreground">{plan.steg.length} steg · {plan.status}</div>
                    </div>
                    <div className="flex gap-1">
                      {plan.status === "påvent" ? (
                        <button
                          onClick={() => void backend.gjenopptaPlan(plan.id).then(refresh)}
                          className="hud-button p-1"
                          title="Gjenoppta"
                        >
                          <Play className="size-3" />
                        </button>
                      ) : null}
                      <button
                        onClick={() => void backend.avbrytPlan(plan.id).then(refresh)}
                        className="hud-button p-1"
                        title="Sett på vent"
                      >
                        <X className="size-3" />
                      </button>
                      <button
                        onClick={() => void backend.markerPlanFerdig(plan.id, "Fullført av bruker").then(refresh)}
                        className="hud-button p-1"
                        title="Marker ferdig"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {plan.steg.map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-center gap-2 rounded border px-2 py-1 text-[10px] ${
                          s.status === "fullført"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : s.status === "aktiv"
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-primary/10 bg-primary/5 text-muted-foreground"
                        }`}
                      >
                        <ListChecks className="size-3 shrink-0" />
                        <span className="flex-1 truncate">{s.navn}</span>
                        <span className="rounded border border-primary/20 px-1 text-[9px] uppercase">{s.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "evalueringer" ? (
          <>
            <div className="hud-panel text-[10px] text-muted-foreground">
              Evaluatoren scorer AI-svar og lagrer erfaringer i minnet når score er under terskelen.
            </div>
            <div className="space-y-2">
              {evalueringer.length === 0 ? (
                <div className="text-[10px] text-muted-foreground">Ingen evalueringer ennå.</div>
              ) : null}
              {evalueringer.map((ev) => (
                <div key={ev.id} className="hud-panel space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-primary">Score {ev.score}/{ev.threshold}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(ev.tid).toLocaleString("no")}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground line-clamp-2">{ev.spørsmål}</div>
                  {ev.retryAnbefalt ? (
                    <div className="text-[10px] text-rose-300">Retry anbefalt: {ev.forbedring}</div>
                  ) : (
                    <div className="text-[10px] text-emerald-300">OK: {ev.forbedring}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "initiativ" ? (
          <>
            <div className="hud-panel space-y-2">
              <div className="flex items-center justify-between">
                <span className="hud-label flex items-center gap-1">
                  <Sparkles className="size-3" />
                  Initiativmotor
                </span>
                <span className={`text-[10px] ${initiativ?.aktiv ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {initiativ?.aktiv ? "AKTIV" : "AV"}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Siste kjøring: {initiativ?.sisteKjøring ? new Date(initiativ.sisteKjøring).toLocaleString("no") : "aldri"}
              </div>
              <div className="flex gap-2">
                <button onClick={() => void toggleInitiativ()} className="hud-button flex-1">
                  {initiativ?.aktiv ? "SKRU AV" : "SKRU PÅ"}
                </button>
                <button onClick={() => void kjørInitiativ()} disabled={loading} className="hud-button flex-1">
                  <RefreshCw className="size-3" />
                  KJØR NÅ
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {forslag.length === 0 ? (
                <div className="text-[10px] text-muted-foreground">Ingen forslag ennå.</div>
              ) : null}
              {forslag.map((f) => (
                <div key={f.id} className={`hud-panel space-y-2 border-l-2 ${RISK_CLASS[f.risiko]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[10px]">{f.tekst}</div>
                    <span className="rounded border border-primary/20 px-1 text-[9px] uppercase">{f.risiko}</span>
                  </div>
                  {f.handling && f.handling.type !== "none" ? (
                    <div className="text-[10px] text-muted-foreground">
                      Handling: {f.handling.type} {f.handling.payload ? `· ${f.handling.payload}` : ""}
                    </div>
                  ) : null}
                  {f.status === "venter" ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => void backend.godkjennForslag(f.id).then(refresh)}
                        className="hud-button flex-1"
                      >
                        <Check className="size-3" /> GODKJENN
                      </button>
                      <button
                        onClick={() => void backend.avvisForslag(f.id).then(refresh)}
                        className="hud-button flex-1"
                      >
                        <X className="size-3" /> AVVIS
                      </button>
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">Status: {f.status}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "verktoy" ? (
          <>
            <div className="hud-panel space-y-2">
              <span className="hud-label">Generer nytt verktøy</span>
              <div className="text-[10px] text-muted-foreground">
                Beskriv hva verktøyet skal gjøre. AI-en skriver JavaScript-koden og tester den i en sandkasse.
              </div>
              <input
                value={beskrivelse}
                onChange={(e) => setBeskrivelse(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void genererVerktoy()}
                placeholder="F.eks. hent været fra yr.no for en by"
                className="hud-input w-full"
              />
              <button onClick={() => void genererVerktoy()} disabled={loading} className="hud-button w-full">
                {loading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                GENERER
              </button>
            </div>

            <div className="space-y-2">
              {verktoy.length === 0 ? (
                <div className="text-[10px] text-muted-foreground">Ingen genererte verktøy ennå.</div>
              ) : null}
              {verktoy.map((v) => (
                <div key={v.id} className="hud-panel space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-primary">{v.name}</div>
                      <div className="text-[10px] text-muted-foreground">{v.description}</div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => void backend.aktiverGenerertVerktoy(v.id, !v.enabled).then(refresh)}
                        className={`hud-button p-1 ${v.enabled ? "text-emerald-400" : ""}`}
                        title={v.enabled ? "Deaktiver" : "Aktiver"}
                      >
                        {v.enabled ? <Check className="size-3" /> : <X className="size-3" />}
                      </button>
                      <button
                        onClick={() => void backend.slettGenerertVerktoy(v.id).then(refresh)}
                        className="hud-button p-1 text-rose-400"
                        title="Slett"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Testet: {v.testet ? (v.testResult?.ok ? "OK" : "Feil") : "Ikke testet"}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MemoryRow({ m, onDelete }: { m: MemoryItem; onDelete: () => void }) {
  return (
    <div className="hud-panel group flex items-start gap-2">
      <div className="mt-0.5 shrink-0">
        {m.pinned ? <Pin className="size-3 text-primary" /> : <Brain className="size-3 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px]">{m.tekst}</div>
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          <span className="rounded border border-primary/20 px-1">{TYPE_LABEL[m.type] ?? m.type}</span>
          <span>viktighet {m.viktighet}</span>
          <span>{new Date(m.tid).toLocaleString("no")}</span>
        </div>
      </div>
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100" title="Slett">
        <Trash2 className="size-3 text-rose-400" />
      </button>
    </div>
  );
}
