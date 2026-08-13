import { useState, useEffect } from "react";
import { ClipboardList, Play, Trash2, RefreshCw, Plus } from "lucide-react";
import { backend } from "@/lib/backend";

type Plan = {
  id: string;
  mål: string;
  status: string;
  steg: { id: string; navn: string; type: string; status: string }[];
};

type QueueItem = { planId: string; status: string; prioritet: number };

export function OppgavePanel() {
  const [planer, setPlaner] = useState<Plan[]>([]);
  const [koe, setKoe] = useState<{ items: QueueItem[]; active: QueueItem[] }>({ items: [], active: [] });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const hentPlaner = async () => {
    const data = await backend.hentOppgaveListe();
    setPlaner((data.planer as Plan[]) ?? []);
  };

  const hentKoe = async () => {
    const data = await backend.hentOppgaveKoe();
    setKoe(data.ko as { items: QueueItem[]; active: QueueItem[] });
  };

  useEffect(() => {
    hentPlaner();
    hentKoe();
  }, []);

  // Auto-kjør neste ventende oppgave når det er ledig kapasitet
  useEffect(() => {
    if (!koe.items.length) return;
    if (koe.active.length) return;
    const neste = koe.items.find((i: any) => i.status === "venter");
    if (!neste) return;
    const t = setTimeout(() => backend.kjorOppgave(neste.planId), 1500);
    return () => clearTimeout(t);
  }, [koe]);

  const opprettOgKjor = async () => {
    if (!input.trim()) return;
    setLoading(true);
    try {
      await backend.planleggOppgave(input.trim());
      setInput("");
      await hentPlaner();
    } finally {
      setLoading(false);
    }
  };

  const kjor = async (id: string) => {
    setLoading(true);
    try {
      await backend.kjorOppgave(id, 10);
      await hentPlaner();
    } finally {
      setLoading(false);
    }
  };

  const leggIKoe = async (id: string) => {
    await backend.koeOppgave(id, 0, 2);
    await hentKoe();
  };

  const fjernFraKoe = async (id: string) => {
    await backend.fjernFraKoe(id);
    await hentKoe();
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden text-xs">
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nytt mål, f.eks. Ping 192.168.9.2"
          className="flex-1 rounded border border-primary/20 bg-background/40 px-2 py-1 text-xs outline-none focus:border-primary"
        />
        <button onClick={opprettOgKjor} disabled={loading || !input.trim()} className="hud-btn flex items-center gap-1">
          <Plus className="size-3" /> Opprett
        </button>
        <button onClick={hentPlaner} className="hud-btn flex items-center gap-1">
          <RefreshCw className="size-3" /> Oppdater
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 overflow-hidden">
        <div className="flex flex-col gap-2 overflow-auto">
          <h3 className="hud-title text-[10px]">Planer</h3>
          {planer.length === 0 && <p className="text-muted-foreground">Ingen planer ennå.</p>}
          {planer.map((p) => (
            <div key={p.id} className="rounded border border-primary/10 p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.mål}</span>
                <span className="text-[9px] text-muted-foreground">{p.status}</span>
              </div>
              <div className="mt-1 flex gap-1">
                <button onClick={() => kjor(p.id)} className="hud-btn flex items-center gap-1">
                  <Play className="size-3" /> Kjør
                </button>
                <button onClick={() => leggIKoe(p.id)} className="hud-btn flex items-center gap-1">
                  <ClipboardList className="size-3" /> Kø
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-[10px] text-foreground/70">
                {p.steg.map((s) => (
                  <li key={s.id}>
                    {s.id}. {s.navn} <span className="text-muted-foreground">({s.type})</span> – {s.status}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 overflow-auto">
          <h3 className="hud-title text-[10px]">Kø</h3>
          {koe.items.length === 0 && <p className="text-muted-foreground">Køen er tom.</p>}
          {koe.items.map((q) => (
            <div key={q.planId} className="flex items-center justify-between rounded border border-primary/10 p-2">
              <div>
                <div className="font-mono text-[10px]">prioritet: {q.prioritet}</div>
                <div className="text-[10px] text-muted-foreground">{q.planId}</div>
              </div>
              <button onClick={() => fjernFraKoe(q.planId)} className="hud-btn text-destructive">
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
