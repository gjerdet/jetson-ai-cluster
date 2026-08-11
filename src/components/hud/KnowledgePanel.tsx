import { useEffect, useState } from "react";
import { BookOpen, FileUp, Globe, Loader2, RefreshCw, Search, Trash2, Type } from "lucide-react";
import { backend, safe, backendToken, type KnowledgeDoc, type KnowledgeHit, type RagConfig } from "@/lib/backend";
import { extractText } from "@/lib/knowledge";
import { hentNettside } from "@/lib/web-extract.functions";

const inputCls =
  "w-full rounded-full border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60";
const btnCls =
  "hud-title inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-[9px] text-primary/90 transition hover:bg-primary/15 disabled:opacity-40";

/** Kunnskapsbase: last opp dokumenter, nettsider og notater for lokal RAG. */
export function KnowledgePanel() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState<{ dokumenter: number; biter: number; vektorer: number; model?: string; feil?: string } | null>(null);
  const [cfg, setCfg] = useState<RagConfig | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [jobber, setJobber] = useState("");
  const [url, setUrl] = useState("");
  const [tittel, setTittel] = useState("");
  const [notat, setNotat] = useState("");
  const [sok, setSok] = useState("");
  const [treff, setTreff] = useState<KnowledgeHit[] | null>(null);

  const innlogget = !!backendToken();

  const last = async () => {
    const [k, c] = await Promise.all([safe(() => backend.hentKunnskap()), safe(() => backend.hentRagConfig())]);
    if (k.data) {
      setDocs(k.data.dokumenter);
      setStats(k.data.statistikk);
    } else if (k.error) setFeil(k.error.message);
    if (c.data) setCfg(c.data.config);
  };

  useEffect(() => {
    if (innlogget) void last();
  }, [innlogget]);

  const indekser = async (d: { tittel: string; tekst: string; kilde?: string; type?: string }) => {
    setFeil(null);
    setMelding(null);
    setJobber(`indekserer «${d.tittel}»`);
    const { data, error } = await safe(() => backend.leggTilKunnskap(d));
    setJobber("");
    if (error) return setFeil(error.message);
    setMelding(
      `«${d.tittel}» indeksert i ${data.biter} biter.` +
        (data.embedFeil ? ` Embeddings feilet (${data.embedFeil}) – søk bruker nøkkelord til modellen er tilgjengelig.` : ""),
    );
    await last();
  };

  const lastOppFiler = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setJobber(`leser ${f.name}`);
      try {
        const tekst = await extractText(f);
        if (!tekst.trim()) {
          setFeil(`Fant ingen tekst i ${f.name}.`);
          continue;
        }
        await indekser({ tittel: f.name, tekst, kilde: f.name, type: f.name.split(".").pop() || "fil" });
      } catch (e) {
        setFeil(e instanceof Error ? e.message : `Klarte ikke lese ${f.name}`);
      }
    }
    setJobber("");
  };

  const hentUrl = async () => {
    if (!url.trim()) return;
    setFeil(null);
    setJobber("henter nettside");
    try {
      const side = await hentNettside({ data: { url: url.trim() } });
      await indekser({ tittel: side.tittel, tekst: side.tekst, kilde: side.url, type: "nettside" });
      setUrl("");
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Klarte ikke hente siden");
    }
    setJobber("");
  };

  const kjorSok = async () => {
    if (!sok.trim()) return;
    setJobber("søker");
    const { data, error } = await safe(() => backend.sokKunnskap(sok.trim(), cfg?.topK ?? 5));
    setJobber("");
    if (error) return setFeil(error.message);
    setTreff(data.treff);
  };

  const lagreCfg = async (v: Partial<RagConfig>) => {
    const { data, error } = await safe(() => backend.lagreRagConfig(v));
    if (error) return setFeil(error.message);
    setCfg(data.config);
    setMelding("Innstillinger lagret.");
  };

  if (!innlogget)
    return (
      <p className="text-xs text-muted-foreground">
        Logg inn mot backend-en i BACKEND-fanen for å bruke kunnskapsbasen. Den kjører lokalt på Jetson-en
        og lagrer dokumenter og vektorer i SQLite.
      </p>
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-2">
        <BookOpen className="size-4 text-primary/80" />
        <p className="hud-title text-[10px] text-primary/80">KUNNSKAPSBASE (LOKAL RAG)</p>
        {stats ? (
          <span className="hud-title rounded-full border border-primary/20 px-2 py-0.5 text-[8px] text-muted-foreground">
            {stats.dokumenter} dok · {stats.biter} biter · {stats.vektorer} vektorer
          </span>
        ) : null}
        {jobber ? (
          <span className="hud-title flex items-center gap-1 text-[8px] text-primary/70">
            <Loader2 className="size-3 animate-spin" /> {jobber}
          </span>
        ) : null}
      </header>

      {feil ? <p className="text-xs text-destructive">{feil}</p> : null}
      {melding ? <p className="text-xs text-primary/80">{melding}</p> : null}

      {/* kilder */}
      <section className="grid gap-3 md:grid-cols-3">
        <label className="flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.03] p-3">
          <span className="hud-title flex items-center gap-1.5 text-[9px] text-primary/80">
            <FileUp className="size-3.5" /> LAST OPP FILER
          </span>
          <span className="text-[10px] text-muted-foreground">PDF, txt, md, csv, json</span>
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.md,.markdown,.csv,.json,.log,text/*"
            className="hidden"
            onChange={(e) => void lastOppFiler(e.target.files)}
          />
        </label>

        <div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
          <span className="hud-title flex items-center gap-1.5 text-[9px] text-primary/80">
            <Globe className="size-3.5" /> NETTSIDE
          </span>
          <input className={inputCls} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className={btnCls} onClick={() => void hentUrl()} disabled={!url.trim() || !!jobber}>
            Hent og indekser
          </button>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
          <span className="hud-title flex items-center gap-1.5 text-[9px] text-primary/80">
            <Type className="size-3.5" /> NOTAT
          </span>
          <input className={inputCls} placeholder="Tittel" value={tittel} onChange={(e) => setTittel(e.target.value)} />
          <textarea
            className="h-16 w-full resize-none rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-xs outline-none focus:border-primary/60"
            placeholder="Tekst…"
            value={notat}
            onChange={(e) => setNotat(e.target.value)}
          />
          <button
            className={btnCls}
            disabled={!notat.trim() || !!jobber}
            onClick={async () => {
              await indekser({ tittel: tittel.trim() || "Notat", tekst: notat, kilde: "notat", type: "notat" });
              setNotat("");
              setTittel("");
            }}
          >
            Lagre i basen
          </button>
        </div>
      </section>

      {/* dokumentliste */}
      <section className="space-y-2">
        <p className="hud-title text-[9px] text-primary/70">DOKUMENTER</p>
        {docs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Ingen dokumenter ennå.</p>
        ) : (
          <ul className="space-y-1">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-lg border border-primary/15 bg-primary/[0.03] px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{d.tittel}</span>
                <span className="hud-title text-[8px] text-muted-foreground">
                  {d.type} · {d.biter} biter · {d.vektorer ? `${d.vektorer} vektorer` : "uten vektorer"}
                </span>
                <button
                  className="text-muted-foreground transition hover:text-destructive"
                  title="Slett"
                  onClick={async () => {
                    await safe(() => backend.slettKunnskap(d.id));
                    await last();
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* testsøk */}
      <section className="space-y-2">
        <p className="hud-title text-[9px] text-primary/70">TESTSØK</p>
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="Hva skal Jarvis finne?"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void kjorSok()}
          />
          <button className={btnCls} onClick={() => void kjorSok()} disabled={!sok.trim()}>
            <Search className="size-3" /> Søk
          </button>
        </div>
        {treff?.map((t, i) => (
          <div key={t.id} className="rounded-lg border border-primary/15 bg-primary/[0.03] px-3 py-2">
            <p className="hud-title text-[8px] text-primary/70">
              [{i + 1}] {t.tittel} · poeng {t.poeng}
            </p>
            <p className="mt-1 line-clamp-3 text-[11px] text-foreground/80">{t.tekst}</p>
          </div>
        ))}
      </section>

      {/* innstillinger */}
      {cfg ? (
        <section className="space-y-2">
          <p className="hud-title text-[9px] text-primary/70">EMBEDDING-MODELL</p>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              className={inputCls}
              value={cfg.baseUrl}
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:11434/v1"
            />
            <input
              className={inputCls}
              value={cfg.model}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              placeholder="nomic-embed-text"
            />
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              Bitstørrelse
              <input
                type="number"
                className={inputCls}
                value={cfg.bitStorrelse}
                onChange={(e) => setCfg({ ...cfg, bitStorrelse: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              Treff per søk
              <input
                type="number"
                className={inputCls}
                value={cfg.topK}
                onChange={(e) => setCfg({ ...cfg, topK: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-foreground/80">
            <input
              type="checkbox"
              checked={cfg.aktiv}
              onChange={(e) => void lagreCfg({ aktiv: e.target.checked })}
            />
            Bruk kunnskapsbasen automatisk i chatten
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={btnCls} onClick={() => void lagreCfg(cfg)}>
              Lagre
            </button>
            <button
              className={btnCls}
              onClick={async () => {
                setJobber("reindekserer");
                const { data, error } = await safe(() => backend.reindekserKunnskap());
                setJobber("");
                if (error) setFeil(error.message);
                else setMelding(`Reindeksert ${data.oppdatert}/${data.totalt} biter med ${data.model}.`);
                await last();
              }}
            >
              <RefreshCw className="size-3" /> Reindekser alt
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Tips: kjør <code>ollama pull nomic-embed-text</code> på Jetson-en. Uten embeddings faller søket
            tilbake på nøkkelord.
          </p>
        </section>
      ) : null}
    </div>
  );
}
