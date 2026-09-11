import { useState } from "react";
import { BookOpen, Check, ExternalLink, Search } from "lucide-react";
import { backend } from "@/lib/backend";
import type { Sokekort as SokekortData } from "@/lib/agent-tools";

/** Viser treffene fra et nettsøk med korte utdrag, og lar deg lagre en kilde lokalt. */
export function SokeKort({ kort }: { kort: SokekortData }) {
  const [status, setStatus] = useState<Record<string, "jobber" | "lagret" | string>>({});

  const laer = async (url: string) => {
    setStatus((s) => ({ ...s, [url]: "jobber" }));
    try {
      const r = await backend.laerOm(kort.sporsmal, { urler: [url] });
      setStatus((s) => ({ ...s, [url]: r.laerte > 0 ? "lagret" : "ingen tekst funnet" }));
    } catch (e) {
      setStatus((s) => ({ ...s, [url]: e instanceof Error ? e.message : "feilet" }));
    }
  };

  return (
    <div className="my-2 rounded border border-primary/30 bg-primary/[0.04] p-2">
      <div className="hud-title mb-1.5 flex items-center gap-1 text-[9px] text-primary/80">
        <Search className="size-3" /> NETTSØK · {kort.sporsmal}
      </div>
      <ol className="space-y-1.5">
        {kort.treff.map((t, i) => {
          const st = status[t.url];
          const lagret = st === "lagret" || t.lagret;
          return (
            <li key={`${t.url}-${i}`} className="rounded border border-primary/15 px-2 py-1">
              <div className="flex items-start gap-2">
                <span className="hud-title flex-1 text-[10px] text-primary/80">{t.tittel}</span>
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-primary"
                  aria-label="Åpne kilden"
                >
                  <ExternalLink className="size-3" />
                </a>
              </div>
              {t.utdrag ? (
                <p className="mt-0.5 text-[10px] leading-relaxed text-foreground/75">{t.utdrag}</p>
              ) : null}
              <div className="mt-1 flex items-center gap-2">
                <span className="flex-1 truncate text-[9px] text-muted-foreground/70">{t.url}</span>
                <button
                  onClick={() => void laer(t.url)}
                  disabled={st === "jobber" || lagret}
                  className="hud-title hud-btn hud-btn-hoverable !py-0.5 text-[9px]"
                >
                  {lagret ? <Check className="size-3" /> : <BookOpen className="size-3" />}
                  {lagret ? "lært" : st === "jobber" ? "leser …" : "lær av denne"}
                </button>
              </div>
              {st && st !== "jobber" && st !== "lagret" ? (
                <p className="mt-0.5 text-[9px] text-destructive">{st}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
