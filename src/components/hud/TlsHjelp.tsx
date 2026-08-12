import { backendUrl, setBackendUrl } from "@/lib/backend";

const btn =
  "rounded-full border border-primary/30 bg-primary/[0.08] px-4 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary/90 transition hover:bg-primary/20";

/**
 * Konkrete handlinger når HTTPS mot den lokale agenten feiler: godta det
 * selvsignerte sertifikatet, prøv på nytt, eller fall tilbake til HTTP.
 */
export function TlsHjelp({ url, onRetry }: { url?: string; onRetry?: (url: string) => void }) {
  const adresse = (url ?? backendUrl()).replace(/\/+$/, "");
  const statusLenke = `${adresse}/api/status`;
  const httpAlternativ = adresse.startsWith("https://")
    ? adresse.replace(/^https:/, "http:").replace(/:8443\b/, ":8787")
    : null;
  const sideErHttps = typeof window !== "undefined" && window.location.protocol === "https:";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <a
          className={btn}
          href={statusLenke}
          target="_blank"
          rel="noreferrer"
          onClick={() => setTimeout(() => onRetry?.(adresse), 4000)}
        >
          ÅPNE OG GODTA SERTIFIKAT
        </a>
        <button type="button" className={btn} onClick={() => onRetry?.(adresse)}>
          PRØV IGJEN
        </button>
        {httpAlternativ ? (
          <button
            type="button"
            className={btn}
            onClick={() => {
              setBackendUrl(httpAlternativ);
              onRetry?.(httpAlternativ);
            }}
          >
            BRUK HTTP I STEDET
          </button>
        ) : null}
      </div>
      <ul className="space-y-1 text-[9px] leading-relaxed tracking-[0.08em] text-foreground/45">
        <li>1. Samme nett som Jetson (Wi-Fi, ikke mobildata).</li>
        <li>
          2. Åpne {statusLenke} i egen fane og velg «Avansert → Fortsett» – sertifikatet må godtas
          per nettleser.
        </li>
        <li>
          3. Får du «connection refused» lytter ikke agenten på porten: kjør{" "}
          <code className="text-primary/70">sudo bash agent/scripts/aktiver-tls.sh &lt;ip&gt;</code>{" "}
          på Jetson.
        </li>
        {sideErHttps && httpAlternativ ? (
          <li>4. HTTP-fallback blokkeres når HUD-en kjøres over HTTPS – bruk 8443 derfra.</li>
        ) : null}
      </ul>
    </div>
  );
}
