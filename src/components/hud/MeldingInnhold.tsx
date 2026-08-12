import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Blokk = { type: "tekst" | "kode"; sprak?: string; innhold: string };

function del(tekst: string): Blokk[] {
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
  return ut.filter((b) => b.type === "kode" || b.innhold.trim());
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
        b.type === "kode" ? (
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
