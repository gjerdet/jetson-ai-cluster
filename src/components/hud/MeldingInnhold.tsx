import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SOKEKORT_SLUTT, SOKEKORT_START, type Sokekort } from "@/lib/agent-tools";
import { SokeKort } from "./SokeKort";

type Blokk =
  | { type: "tekst" | "kode"; sprak?: string; innhold: string }
  | { type: "sok"; kort: Sokekort };

function delSok(tekst: string): Blokk[] {
  const ut: Blokk[] = [];
  let i = 0;
  for (;;) {
    const start = tekst.indexOf(SOKEKORT_START, i);
    const slutt = start < 0 ? -1 : tekst.indexOf(SOKEKORT_SLUTT, start);
    if (start < 0 || slutt < 0) break;
    if (start > i) ut.push({ type: "tekst", innhold: tekst.slice(i, start) });
    const rå = tekst.slice(start + SOKEKORT_START.length, slutt);
    try {
      const kort = JSON.parse(rå) as Sokekort;
      if (kort && Array.isArray(kort.treff)) ut.push({ type: "sok", kort });
    } catch {
      ut.push({ type: "tekst", innhold: rå });
    }
    i = slutt + SOKEKORT_SLUTT.length;
  }
  if (i < tekst.length) ut.push({ type: "tekst", innhold: tekst.slice(i) });
  return ut;
}

function delKode(tekst: string): Blokk[] {
  const ut: Blokk[] = [];
  const re = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tekst))) {
    if (m.index > i) ut.push({ type: "tekst", innhold: tekst.slice(i, m.index) });
    ut.push({ type: "kode", sprak: m[1] || "", innhold: (m[2] ?? "").replace(/\n$/, "") });
    i = m.index + m[0].length;
  }
  if (i < tekst.length) ut.push({ type: "tekst", innhold: tekst.slice(i) });
  return ut;
}

function del(tekst: string): Blokk[] {
  return delSok(tekst)
    .flatMap((b) => (b.type === "tekst" ? delKode(b.innhold) : [b]))
    .filter((b) => b.type !== "tekst" || b.innhold.trim());
}

function Kode({ sprak, innhold }: { sprak?: string; innhold: string }) {
  const [kopiert, setKopiert] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded border border-primary/30 bg-background/60">
      <div className="flex items-center justify-between border-b border-primary/20 px-2 py-1">
        <span className="hud-title text-[9px] text-primary/70">{sprak || "kode"}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(innhold);
            setKopiert(true);
            setTimeout(() => setKopiert(false), 1500);
          }}
          className="flex items-center gap-1 text-[10px] text-primary/70 transition-colors hover:text-primary"
        >
          {kopiert ? <Check className="size-3" /> : <Copy className="size-3" />}
          {kopiert ? "kopiert" : "kopier"}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto p-2 text-[11px] leading-relaxed text-foreground/90">
        <code>{innhold}</code>
      </pre>
    </div>
  );
}

export function MeldingInnhold({ tekst }: { tekst: string }) {
  const blokker = del(tekst);
  return (
    <>
      {blokker.map((b, i) =>
        b.type === "sok" ? (
          <SokeKort key={i} kort={b.kort} />
        ) : b.type === "kode" ? (
          <Kode key={i} {...(b.sprak ? { sprak: b.sprak } : {})} innhold={b.innhold} />
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {b.innhold}
          </span>
        ),
      )}
    </>
  );
}
