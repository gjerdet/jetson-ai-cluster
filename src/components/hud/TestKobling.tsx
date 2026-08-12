import { useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { backend } from "@/lib/backend";

type Resultat = {
  ok: boolean;
  endpoint?: string;
  model?: string;
  byttetModell?: boolean;
  svar?: string;
  modeller?: string[];
  ms?: number;
  error?: string;
};

/** Liten «test kobling»-knapp for AI-noder (Hermes, ChatGPT, Ollama …). */
export function TestKobling({
  baseUrl,
  model,
  apiKey,
  etikett = "TEST KOBLING",
}: {
  baseUrl: string;
  model?: string;
  apiKey?: string;
  etikett?: string;
}) {
  const [kjorer, setKjorer] = useState(false);
  const [res, setRes] = useState<Resultat | null>(null);

  const test = async () => {
    setKjorer(true);
    setRes(null);
    try {
      const r = await backend.testAi({
        baseUrl,
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey } : {}),
      });

      setRes(r);
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setKjorer(false);
    }
  };

  return (
    <div className="col-span-3 mt-1">
      <button
        onClick={test}
        disabled={kjorer || !baseUrl.trim()}
        className="hud-btn hud-btn-hoverable hud-title flex items-center gap-1 rounded border border-primary/30 px-2 py-1 text-[9px] text-primary disabled:opacity-40"
      >
        {kjorer ? <Loader2 className="size-3 animate-spin" /> : <PlugZap className="size-3" />}
        {kjorer ? "TESTER …" : etikett}
      </button>

      {res ? (
        <div
          className={`mt-1 rounded border px-2 py-1 text-[9px] ${
            res.ok
              ? "border-primary/30 bg-primary/[0.05] text-primary"
              : "border-destructive/40 bg-destructive/[0.06] text-destructive"
          }`}
        >
          {res.ok ? (
            <>
              <p>
                Kontakt OK på {res.ms} ms — {res.model}
                {res.byttetModell ? " (byttet til installert modell)" : ""}
              </p>
              <p className="text-muted-foreground">{res.endpoint}</p>
              {res.svar ? <p className="text-muted-foreground">Svar: {res.svar}</p> : null}
            </>
          ) : (
            <p>{res.error || "Ukjent feil"}</p>
          )}
          {res.modeller?.length ? (
            <p className="mt-0.5 text-muted-foreground">
              Modeller på noden: {res.modeller.slice(0, 8).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
