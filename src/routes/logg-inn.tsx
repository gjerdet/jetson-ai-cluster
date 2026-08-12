import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AmbientField } from "@/components/hud/AmbientField";
import {
  backend,
  backendUrl,
  setBackendUrl,
  safe,
  BackendError,
  type BackendStatus,
} from "@/lib/backend";
import { ERROR_CODES } from "@/lib/contract";
import { useSession } from "@/lib/session";
import { getPreviewToken } from "@/lib/preview-session";
import { detectPreviewEnvironment } from "@/lib/preview-hosts";

export const Route = createFileRoute("/logg-inn")({
  head: () => ({
    meta: [
      { title: "Logg inn – Jarvis HUD for lokale Jetson-noder" },
      {
        name: "description",
        content:
          "Logg inn på den lokale Jarvis-backend-en for å styre AI-noder, smarthus og world monitor fra HUD-en.",
      },
      { property: "og:title", content: "Logg inn – Jarvis HUD" },
      {
        property: "og:description",
        content: "Innlogging mot den lokale agenten på Jetson – e-post og passord, ingen sky.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoggInn,
});

const field =
  "w-full rounded-full border border-primary/20 bg-primary/[0.05] px-4 py-2.5 text-xs text-foreground/90 outline-none transition focus:border-primary/50";
const btn =
  "rounded-full border border-primary/30 bg-primary/[0.08] px-5 py-2 text-[10px] uppercase tracking-[0.25em] text-primary/90 transition hover:bg-primary/20 disabled:opacity-40";
const label = "text-[9px] uppercase tracking-[0.25em] text-foreground/40";

const feilTekst = (e: unknown) =>
  e instanceof BackendError
    ? [e.message, e.raad].filter(Boolean).join(" ")
    : e instanceof Error
      ? e.message
      : String(e);

function LoggInn() {
  const navigate = useNavigate();
  const { state, status: sessionStatus } = useSession();
  const [url, setUrl] = useState(backendUrl());
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [epost, setEpost] = useState("");
  const [passord, setPassord] = useState("");
  const [feil, setFeil] = useState<string | null>(null);
  const [tlsFeil, setTlsFeil] = useState(false);
  const [busy, setBusy] = useState(false);

  const erTls = (e: unknown) => e instanceof BackendError && e.code === ERROR_CODES.TLS;
  const statusLenke = () => `${url.replace(/\/+$/, "")}/api/status`;
  const httpAlternativ = url.startsWith("https://")
    ? url.replace(/^https:/, "http:").replace(/:8443\b/, ":8787")
    : null;

  // I Lovable-preview med åpen forhåndsvisningsgate skal man ikke møte
  // backend-innloggingen — send brukeren rett inn i HUD-en.
  useEffect(() => {
    if (detectPreviewEnvironment() && getPreviewToken()) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (sessionStatus) setStatus(sessionStatus);
  }, [sessionStatus]);

  useEffect(() => {
    if (state === "inne") void navigate({ to: "/", replace: true });
  }, [state, navigate]);

  const sjekkBackend = async (nyUrl?: string) => {
    if (nyUrl !== undefined) setBackendUrl(nyUrl);
    setFeil(null);
    const r = await safe(() => backend.status());
    setStatus(r.data);
    if (r.error) setFeil(feilTekst(r.error));
  };

  const forstegang = status?.trengerOppsett === true || status?.brukere === 0;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeil(null);
    try {
      if (forstegang) await backend.register(epost, passord);
      else await backend.login(epost, passord);
      setPassord("");
      await navigate({ to: "/", replace: true });
    } catch (err) {
      setFeil(feilTekst(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="hud-root relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <AmbientField />
      <div className="hud-grid pointer-events-none absolute inset-0" />
      <div className="hud-scan pointer-events-none absolute inset-0" />

      <section className="relative z-20 w-full max-w-md rounded-3xl border border-primary/20 bg-background/25 p-7 backdrop-blur-xl">
        <h1 className="text-center text-sm uppercase tracking-[0.45em] text-primary/80">JARVIS</h1>
        <p className="mt-2 text-center text-[10px] uppercase tracking-[0.25em] text-foreground/40">
          {forstegang ? "opprett første bruker" : "identifisering kreves"}
        </p>

        <div className="mt-6 space-y-2">
          <div className={label}>LOKAL BACKEND</div>
          <div className="flex gap-2">
            <input
              className={field}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.1.50:8787"
            />
            <button type="button" className={btn} onClick={() => void sjekkBackend(url)}>
              KOBLE
            </button>
          </div>
          <div className="text-[10px] text-foreground/50">
            {status
              ? `TILKOBLET · ${status.vert} · ${status.brukere} bruker(e)`
              : "Ingen kontakt med agenten ennå."}
          </div>
        </div>

        <form className="mt-6 space-y-3" onSubmit={send}>
          <div className="space-y-1.5">
            <div className={label}>E-POST</div>
            <input
              className={field}
              type="email"
              autoComplete="username"
              value={epost}
              onChange={(e) => setEpost(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <div className={label}>PASSORD</div>
            <input
              className={field}
              type="password"
              autoComplete={forstegang ? "new-password" : "current-password"}
              value={passord}
              onChange={(e) => setPassord(e.target.value)}
              minLength={8}
              required
            />
          </div>

          {feil ? <div className="text-[10px] text-destructive/80">{feil}</div> : null}

          <button className={`${btn} w-full`} type="submit" disabled={busy}>
            {busy ? "…" : forstegang ? "OPPRETT OG LOGG INN" : "LOGG INN"}
          </button>
        </form>

        <p className="mt-5 border-t border-primary/10 pt-4 text-center text-[9px] leading-relaxed tracking-[0.15em] text-foreground/35">
          Du må ha agenten kjørende på Jetson for å bruke HUD-en. Skriv inn adressen over, trykk
          KOBLE, og opprett første bruker med e-post og passord (scrypt-hashet lokalt).
        </p>
      </section>
    </main>
  );
}

