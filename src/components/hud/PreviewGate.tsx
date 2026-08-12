import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { unlockPreview } from "@/lib/preview-gate.functions";
import { setPreviewToken } from "@/lib/preview-session";

function isLocalhost() {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}


const field =
  "w-full rounded-full border border-primary/20 bg-primary/[0.05] px-4 py-2.5 text-xs text-foreground/90 outline-none transition focus:border-primary/50";
const btn =
  "rounded-full border border-primary/30 bg-primary/[0.08] px-5 py-2 text-[10px] uppercase tracking-[0.25em] text-primary/90 transition hover:bg-primary/20 disabled:opacity-40";

export function PreviewGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unlock = useServerFn(unlockPreview);

  useEffect(() => {
    if (!isLocalhost()) return;
    // Prøv automatisk opplåsing på localhost slik at lokal utvikling går raskt.
    void submit({ preventDefault: () => {} } as React.FormEvent);
  }, []);

  const submit = async (e: React.FormEvent) => {

    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const host = window.location.hostname;
      const r = await unlock({ data: { password, host } });
      if (r.ok && r.token) {
        setPreviewToken(r.token);
        onUnlock();
      } else {
        setError(r.error || "Feil passord.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ukjent feil.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="hud-root relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <section className="relative z-20 w-full max-w-md rounded-3xl border border-primary/20 bg-background/25 p-7 backdrop-blur-xl">
        <h1 className="text-center text-sm uppercase tracking-[0.45em] text-primary/80">FORHÅNDSVISNING</h1>
        <p className="mt-2 text-center text-[10px] uppercase tracking-[0.25em] text-foreground/40">
          Lokal utviklermodus
        </p>

        <p className="mt-5 text-center text-[10px] leading-relaxed tracking-[0.15em] text-foreground/50">
          Denne gaten finnes kun i Lovable-preview og på localhost. Når appen kjører på Jetson, kreves vanlig
          backend-innlogging.
        </p>

        <form className="mt-6 space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <div className="text-[9px] uppercase tracking-[0.25em] text-foreground/40">PREVIEW-PASSORD</div>
            <input
              className={field}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? <div className="text-[10px] text-destructive/80">{error}</div> : null}

          <button className={`${btn} w-full`} type="submit" disabled={busy}>
            {busy ? "…" : "ÅPNE HUD-EN"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onUnlock}
            className="text-[9px] uppercase tracking-[0.2em] text-foreground/30 underline-offset-4 transition hover:text-foreground/60 hover:underline"
          >
            Bruk backend-innlogging i stedet
          </button>
        </div>
      </section>
    </main>
  );
}
